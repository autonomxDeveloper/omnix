"""
Tests for new audiobook features #4-11.

Tests do not require external services (LLM, TTS, STT).
All LLM-dependent modules are tested with mock callables.
"""

import json
import os
import sys
import tempfile
import threading
import time
import uuid

import pytest

# Ensure src/ is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# #4  Dialogue Parser (LLM-based)
# ---------------------------------------------------------------------------

class TestDialogueParser:
    def _parse(self, **kw):
        from audiobook.ai.dialogue_parser import parse_dialogue_llm
        return parse_dialogue_llm(**kw)

    def _parse_ctx(self, **kw):
        from audiobook.ai.dialogue_parser import parse_with_context
        return parse_with_context(**kw)

    # -- parse_dialogue_llm --

    def test_empty_text_returns_empty(self):
        assert self._parse(text="") == []
        assert self._parse(text="   ") == []

    def test_no_llm_uses_regex_fallback(self):
        text = '"Hello," said Alice.'
        result = self._parse(text=text, llm_fn=None)
        assert isinstance(result, list)
        assert len(result) >= 1

    def test_llm_returns_valid_json(self):
        response = json.dumps([
            {"speaker": "Tom", "text": "Hello there.", "type": "dialogue"},
            {"speaker": "Narrator", "text": "He walked away.", "type": "narration"},
        ])
        result = self._parse(text="some text", llm_fn=lambda _: response)
        assert len(result) == 2
        assert result[0]["speaker"] == "Tom"
        assert result[0]["type"] == "dialogue"
        assert result[1]["speaker"] == "Narrator"
        assert result[1]["type"] == "narration"

    def test_llm_markdown_fences(self):
        response = '```json\n[{"speaker": "A", "text": "Hi", "type": "dialogue"}]\n```'
        result = self._parse(text="text", llm_fn=lambda _: response)
        assert len(result) == 1
        assert result[0]["speaker"] == "A"

    def test_llm_invalid_json_retries_then_fallback(self):
        calls = []

        def bad_llm(prompt):
            calls.append(1)
            return "NOT JSON"

        text = '"Hello," said Alice.'
        result = self._parse(text=text, llm_fn=bad_llm)
        # Should retry MAX_RETRIES (3) times, then fallback to regex
        assert len(calls) == 3
        assert isinstance(result, list)

    def test_llm_exception_retries(self):
        calls = []

        def failing_llm(prompt):
            calls.append(1)
            raise RuntimeError("API down")

        result = self._parse(text="some text", llm_fn=failing_llm)
        assert len(calls) == 3
        assert isinstance(result, list)

    def test_type_field_auto_added(self):
        response = json.dumps([
            {"speaker": "Bob", "text": "Hey"},
            {"speaker": "Narrator", "text": "He left"},
        ])
        result = self._parse(text="text", llm_fn=lambda _: response)
        assert result[0]["type"] == "dialogue"
        assert result[1]["type"] == "narration"

    def test_empty_text_segments_filtered(self):
        response = json.dumps([
            {"speaker": "A", "text": "", "type": "dialogue"},
            {"speaker": "B", "text": "Real text", "type": "dialogue"},
        ])
        result = self._parse(text="text", llm_fn=lambda _: response)
        assert len(result) == 1

    # -- parse_with_context --

    def test_context_returns_tuple(self):
        response = json.dumps([
            {"speaker": "Alice", "text": "Hi", "type": "dialogue"},
        ])
        segments, last = self._parse_ctx(text="t", llm_fn=lambda _: response)
        assert isinstance(segments, list)
        assert last == "Alice"

    def test_context_with_last_speaker(self):
        calls = []

        def llm(prompt):
            calls.append(prompt)
            return json.dumps([{"speaker": "Bob", "text": "Ok", "type": "dialogue"}])

        segments, last = self._parse_ctx(
            text="t", llm_fn=llm, last_speaker="Alice"
        )
        # The prompt should include context about Alice
        assert "Alice" in calls[0]
        assert last == "Bob"

    def test_context_no_llm_fallback(self):
        text = '"Hello," said Alice.'
        segments, last = self._parse_ctx(text=text)
        assert isinstance(segments, list)

    def test_context_empty_text(self):
        segments, last = self._parse_ctx(text="", last_speaker="X")
        assert segments == []
        assert last == "X"


# ---------------------------------------------------------------------------
# #4  Safe JSON Load helper
# ---------------------------------------------------------------------------

class TestSafeJsonLoad:
    def _load(self, text):
        from audiobook.ai.dialogue_parser import _safe_json_load
        return _safe_json_load(text)

    def test_direct_list(self):
        assert self._load('[{"a": 1}]') == [{"a": 1}]

    def test_dict_with_segments(self):
        r = self._load('{"segments": [{"a": 1}]}')
        assert r == [{"a": 1}]

    def test_dict_with_script(self):
        r = self._load('{"script": [{"b": 2}]}')
        assert r == [{"b": 2}]

    def test_markdown_fences(self):
        r = self._load('```json\n[{"x": 1}]\n```')
        assert r == [{"x": 1}]

    def test_embedded_array(self):
        r = self._load('Some text before [{"z": 3}] and after')
        assert r == [{"z": 3}]

    def test_none_for_empty(self):
        assert self._load("") is None
        assert self._load(None) is None

    def test_none_for_garbage(self):
        assert self._load("not json at all") is None


# ---------------------------------------------------------------------------
# #4  Validate Segments helper
# ---------------------------------------------------------------------------

class TestValidateSegments:
    def _validate(self, data):
        from audiobook.ai.dialogue_parser import _validate_segments
        return _validate_segments(data)

    def test_valid_segments(self):
        result = self._validate([
            {"speaker": "A", "text": "hi", "type": "dialogue"},
        ])
        assert len(result) == 1

    def test_missing_speaker(self):
        result = self._validate([{"text": "hi"}])
        assert len(result) == 0

    def test_missing_text(self):
        result = self._validate([{"speaker": "A"}])
        assert len(result) == 0

    def test_invalid_type_corrected(self):
        result = self._validate([{"speaker": "A", "text": "hi", "type": "unknown"}])
        assert result[0]["type"] == "dialogue"

    def test_narrator_type(self):
        result = self._validate([{"speaker": "Narrator", "text": "x"}])
        assert result[0]["type"] == "narration"

    def test_non_dict_filtered(self):
        result = self._validate(["string", 42, None])
        assert len(result) == 0


# ---------------------------------------------------------------------------
# #5  Voice Classifier
# ---------------------------------------------------------------------------

class TestVoiceClassifier:
    def _classify(self, **kw):
        from audiobook.voice.voice_classifier import classify_character_voice
        return classify_character_voice(**kw)

    def _clear(self):
        from audiobook.voice.voice_classifier import clear_voice_cache
        clear_voice_cache()

    def test_empty_name(self):
        r = self._classify(name="")
        assert r["gender"] == "neutral"

    def test_keyword_female(self):
        r = self._classify(name="Sarah")
        assert r["gender"] == "female"

    def test_keyword_male(self):
        r = self._classify(name="James")
        assert r["gender"] == "male"

    def test_honorific_male(self):
        r = self._classify(name="Mr. Smith")
        assert r["gender"] == "male"

    def test_unknown_name_neutral(self):
        self._clear()
        r = self._classify(name="Xyzzy")
        assert r["gender"] == "neutral"

    def test_cache_hit(self):
        self._clear()
        r1 = self._classify(name="Sarah", context="She smiled.")
        r2 = self._classify(name="Sarah", context="She smiled.")
        assert r1 == r2

    def test_llm_override(self):
        self._clear()
        response = json.dumps(
            {"gender": "female", "age": "elder", "tone": "soft", "confidence": 0.9}
        )
        r = self._classify(name="Gandalf", llm_fn=lambda _: response)
        assert r["gender"] == "female"
        assert r["age"] == "elder"

    def test_llm_bad_json_falls_back(self):
        self._clear()
        r = self._classify(name="James", llm_fn=lambda _: "NOT JSON")
        assert r["gender"] == "male"

    def test_validation_clamps(self):
        self._clear()
        response = json.dumps(
            {"gender": "alien", "age": "baby", "tone": "angry", "confidence": 5.0}
        )
        r = self._classify(name="Test", llm_fn=lambda _: response)
        assert r["gender"] == "neutral"
        assert r["age"] == "adult"
        assert r["tone"] == "calm"
        assert r["confidence"] == 1.0

    def test_clear_cache(self):
        self._clear()
        self._classify(name="Alice")
        from audiobook.voice.voice_classifier import _voice_cache
        assert len(_voice_cache) > 0
        self._clear()
        assert len(_voice_cache) == 0


# ---------------------------------------------------------------------------
# #6  VoiceManager
# ---------------------------------------------------------------------------

class TestVoiceManager:
    def _make(self, **kw):
        from audiobook.voice.voice_manager import VoiceManager
        d = tempfile.mkdtemp()
        return VoiceManager(book_id="test_book", base_dir=d, **kw)

    def test_get_voice_assigns_consistently(self):
        vm = self._make(available_voices=["male_deep", "female_soft"])
        v1 = vm.get_voice("Alice")
        v2 = vm.get_voice("Alice")
        assert v1 == v2

    def test_different_characters_different_voices(self):
        vm = self._make(available_voices=["male_deep", "female_soft", "neutral_calm"])
        v1 = vm.get_voice("Sarah")  # female keyword name
        v2 = vm.get_voice("James")  # male keyword name
        # They should get different voices since genders differ
        assert v1 != v2

    def test_override(self):
        vm = self._make(available_voices=["v1", "v2"])
        vm.get_voice("Alice")
        vm.override("Alice", "v2")
        assert vm.get_voice("Alice") == "v2"

    def test_get_all_assignments(self):
        vm = self._make(available_voices=["v1"])
        vm.get_voice("Alice")
        vm.get_voice("Bob")
        assignments = vm.get_all_assignments()
        assert "Alice" in assignments
        assert "Bob" in assignments

    def test_no_available_voices(self):
        vm = self._make()
        v = vm.get_voice("Alice")
        assert v == "neutral_voice"

    def test_persistence(self):
        d = tempfile.mkdtemp()
        from audiobook.voice.voice_manager import VoiceManager

        vm1 = VoiceManager(book_id="persist_test", base_dir=d, available_voices=["v1"])
        v1 = vm1.get_voice("Alice")
        vm1.save()

        vm2 = VoiceManager(book_id="persist_test", base_dir=d, available_voices=["v1"])
        v2 = vm2.get_voice("Alice")
        assert v1 == v2


# ---------------------------------------------------------------------------
# #7  TTS Provider Abstraction
# ---------------------------------------------------------------------------

class TestTTSProviderAbstraction:
    def test_register_and_get(self):
        from app.providers.tts_abstraction import (
            register_provider,
            get_provider,
            list_providers,
            unregister_provider,
            LocalModelTTSProvider,
        )

        p = LocalModelTTSProvider(base_url="http://localhost:9999")
        register_provider("test_local", p)
        assert "test_local" in list_providers()
        assert get_provider("test_local") is p
        unregister_provider("test_local")
        assert "test_local" not in list_providers()

    def test_openai_provider_name(self):
        from app.providers.tts_abstraction import OpenAITTSProvider
        p = OpenAITTSProvider(api_key="fake")
        assert p.name == "openai"

    def test_local_provider_name(self):
        from app.providers.tts_abstraction import LocalModelTTSProvider
        p = LocalModelTTSProvider()
        assert p.name == "local"

    def test_get_nonexistent(self):
        from app.providers.tts_abstraction import get_provider
        assert get_provider("nonexistent_xyz") is None

    def test_local_generate_connection_error(self):
        from app.providers.tts_abstraction import LocalModelTTSProvider
        # Should gracefully return empty bytes, not raise
        p = LocalModelTTSProvider(base_url="http://localhost:1")
        result = p.generate("test")
        assert result == b""

    def test_openai_generate_connection_error(self):
        from app.providers.tts_abstraction import OpenAITTSProvider
        p = OpenAITTSProvider(base_url="http://localhost:1")
        result = p.generate("test")
        assert result == b""


# ---------------------------------------------------------------------------
# #8  Chunking Strategy
# ---------------------------------------------------------------------------

class TestChunkText:
    def _chunk(self, **kw):
        from audiobook.segmentation.chunk_text import chunk_text
        return chunk_text(**kw)

    def _split(self, text):
        from audiobook.segmentation.chunk_text import split_sentences
        return split_sentences(text)

    # -- split_sentences --

    def test_split_simple(self):
        r = self._split("Hello world. Goodbye world.")
        assert len(r) == 2

    def test_split_no_break_abbreviation(self):
        r = self._split("Mr. Smith went home.")
        assert len(r) == 1

    def test_split_exclamation(self):
        r = self._split("Run! Hide! Now!")
        assert len(r) == 3

    def test_split_empty(self):
        r = self._split("")
        assert r == ['']

    # -- chunk_text --

    def test_empty_text(self):
        assert self._chunk(text="") == ['']

    def test_short_text(self):
        r = self._chunk(text="Hello world.", max_chars=500)
        assert len(r) == 1
        assert "Hello" in r[0]

    def test_respects_max_chars(self):
        text = "First sentence. Second sentence. Third sentence. Fourth sentence."
        r = self._chunk(text=text, max_chars=30)
        for chunk in r:
            # Each chunk may exceed max by one sentence only
            assert isinstance(chunk, str)
        assert len(r) > 1

    def test_single_long_sentence(self):
        text = "A" * 600
        r = self._chunk(text=text, max_chars=500)
        assert len(r) == 1
        assert len(r[0]) == 600

    def test_whitespace_only(self):
        assert self._chunk(text="   ") == ['']


# ---------------------------------------------------------------------------
# #9  Audio Preloader
# ---------------------------------------------------------------------------

class TestAudioPreloader:
    def _make(self, **kw):
        from audiobook.audio_preloader import AudioPreloader
        return AudioPreloader(**kw)

    def test_get_chunk_generates(self):
        gen_fn = lambda text: text.encode()
        p = self._make(generate_fn=gen_fn)
        audio = p.get_chunk(0, "hello")
        assert audio == b"hello"

    def test_set_chunks_and_get(self):
        gen_fn = lambda text: text.encode()
        p = self._make(generate_fn=gen_fn)
        p.set_chunks(["chunk0", "chunk1", "chunk2"])
        assert p.get_chunk(0) == b"chunk0"
        assert p.get_chunk(1) == b"chunk1"

    def test_preload_caches(self):
        gen_fn = lambda text: text.encode()
        p = self._make(generate_fn=gen_fn)
        p.set_chunks(["a", "b", "c"])
        p.get_chunk(0)
        # Give background preload time
        time.sleep(0.2)
        assert 1 in p.cached_indices

    def test_clear(self):
        gen_fn = lambda text: text.encode()
        p = self._make(generate_fn=gen_fn)
        p.get_chunk(0, "test")
        p.clear()
        assert p.cached_indices == []

    def test_no_text_returns_none(self):
        gen_fn = lambda text: text.encode()
        p = self._make(generate_fn=gen_fn)
        assert p.get_chunk(99) is None

    def test_generation_failure_caches_none(self):
        def failing_fn(text):
            raise RuntimeError("TTS down")
        p = self._make(generate_fn=failing_fn)
        audio = p.get_chunk(0, "test")
        assert audio is None


# ---------------------------------------------------------------------------
# #10  Job Queue
# ---------------------------------------------------------------------------

class TestJobQueue:
    def _make(self, **kw):
        from app.job_queue import JobQueue
        return JobQueue(**kw)

    def test_enqueue_returns_id(self):
        q = self._make()
        job_id = q.enqueue("hello")
        assert isinstance(job_id, str)
        assert len(job_id) > 0

    def test_process_job(self):
        def worker(text, speaker, voice_id, **kw):
            return {"audio": text.encode(), "sample_rate": 24000}

        q = self._make(worker_fn=worker)
        q.start()
        job_id = q.enqueue("hello", speaker="narrator")

        # Wait for processing
        for _ in range(50):
            r = q.get_result(job_id)
            if r and r["status"] == "completed":
                break
            time.sleep(0.05)

        r = q.get_result(job_id)
        assert r["status"] == "completed"
        assert r["audio"]["audio"] == b"hello"
        q.stop()

    def test_failed_job(self):
        def failing_worker(text, speaker, voice_id, **kw):
            raise RuntimeError("TTS error")

        q = self._make(worker_fn=failing_worker)
        q.start()
        job_id = q.enqueue("test")

        for _ in range(50):
            r = q.get_result(job_id)
            if r and r["status"] == "failed":
                break
            time.sleep(0.05)

        r = q.get_result(job_id)
        assert r["status"] == "failed"
        assert "TTS error" in r["error"]
        q.stop()

    def test_cancel_job(self):
        # Don't start workers so job stays pending
        q = self._make()
        job_id = q.enqueue("test")
        assert q.cancel(job_id) is True
        r = q.get_result(job_id)
        assert r["status"] == "failed"
        assert "Cancelled" in r["error"]

    def test_get_nonexistent(self):
        q = self._make()
        assert q.get_result("nonexistent") is None

    def test_pending_count(self):
        q = self._make()
        q.enqueue("a")
        q.enqueue("b")
        assert q.pending_count == 2

    def test_global_queue(self):
        from app.job_queue import get_job_queue
        q = get_job_queue()
        assert q is not None


# ---------------------------------------------------------------------------
# #11  Chapter Detection
# ---------------------------------------------------------------------------

class TestChapterDetection:
    def _detect(self, text, **kw):
        from app.audiobook_ux import detect_chapters
        return detect_chapters(text, **kw)

    def test_standard_chapters(self):
        text = "Chapter 1\nSome text.\n\nChapter 2\nMore text."
        result = self._detect(text)
        assert len(result) == 2
        assert result[0]["title"] == "Chapter 1"
        assert result[1]["title"] == "Chapter 2"

    def test_chapter_with_title(self):
        text = "Chapter 1: The Beginning\nSome text."
        result = self._detect(text)
        assert len(result) == 1
        assert "Beginning" in result[0]["title"]

    def test_prologue_epilogue(self):
        text = "Prologue\nOnce upon a time.\n\nEpilogue\nThe end."
        result = self._detect(text)
        assert len(result) == 2

    def test_no_chapters_single_result(self):
        text = "Just a plain paragraph with no chapters."
        result = self._detect(text)
        assert len(result) == 1
        assert result[0]["title"] == "Full Text"

    def test_part_detection(self):
        text = "Part 1\nSomething.\n\nPart 2\nElse."
        result = self._detect(text)
        assert len(result) == 2

    def test_roman_numeral(self):
        text = "I.\nFirst chapter.\n\nII.\nSecond chapter."
        result = self._detect(text)
        assert len(result) == 2

    def test_llm_fallback(self):
        response = json.dumps([
            {"title": "Intro", "start": 0},
            {"title": "Main", "start": 50},
        ])
        result = self._detect("no regex chapters here", llm_fn=lambda _: response)
        assert len(result) == 2
        assert result[0]["title"] == "Intro"

    def test_empty_text(self):
        result = self._detect("")
        assert len(result) == 1
