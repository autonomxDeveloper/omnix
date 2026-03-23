"""
Tests that streaming audio playback does NOT create a new Audio() element
per chunk.  Instead, all chunk-level playback should use the Web Audio API
(AudioContext + createBufferSource) to reuse a single context.

Tests use source-code inspection (regex) since no JS test framework exists.
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _read_source(relative_path):
    with open(os.path.join(REPO_ROOT, relative_path)) as f:
        return f.read()


# ---------------------------------------------------------------------------
# audiobook.js  –  playAudioSegment must NOT use new Audio()
# ---------------------------------------------------------------------------

class TestAudiobookNoNewAudio:
    """playAudioSegment in audiobook.js must use Web Audio API."""

    def _get_source(self):
        return _read_source("src/static/audiobook.js")

    def test_play_audio_segment_defined(self):
        src = self._get_source()
        assert "function playAudioSegment" in src

    def test_play_audio_segment_no_new_audio(self):
        """playAudioSegment must not contain 'new Audio('."""
        src = self._get_source()
        # Extract the playAudioSegment function body
        m = re.search(r'function playAudioSegment\b.*?\n\}', src, re.DOTALL)
        assert m, "playAudioSegment function not found"
        body = m.group(0)
        assert "new Audio(" not in body, \
            "playAudioSegment still creates a new Audio element per chunk"

    def test_play_audio_segment_uses_audio_context(self):
        """playAudioSegment should use AudioContext."""
        src = self._get_source()
        m = re.search(r'function playAudioSegment\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "AudioContext" in body or "_sseAudioCtx" in body, \
            "playAudioSegment should use Web Audio API AudioContext"

    def test_play_audio_segment_uses_buffer_source(self):
        """playAudioSegment should use createBufferSource."""
        src = self._get_source()
        m = re.search(r'function playAudioSegment\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "createBufferSource" in body, \
            "playAudioSegment should use createBufferSource for playback"

    def test_sse_audio_ctx_declared(self):
        """A reusable _sseAudioCtx variable should exist."""
        src = self._get_source()
        assert "_sseAudioCtx" in src

    def test_stop_cleans_up_sse_ctx(self):
        """stopStreamingAudio should clean up _sseAudioCtx."""
        src = self._get_source()
        m = re.search(r'function stopStreamingAudio\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_sseAudioCtx" in body, \
            "stopStreamingAudio must clean up _sseAudioCtx"

    def test_pause_suspends_sse_ctx(self):
        """pauseStreamingAudio should suspend _sseAudioCtx."""
        src = self._get_source()
        m = re.search(r'function pauseStreamingAudio\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_sseAudioCtx" in body, \
            "pauseStreamingAudio must suspend _sseAudioCtx"

    def test_resume_resumes_sse_ctx(self):
        """resumeStreamingAudio should resume _sseAudioCtx."""
        src = self._get_source()
        m = re.search(r'function resumeStreamingAudio\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_sseAudioCtx" in body, \
            "resumeStreamingAudio must resume _sseAudioCtx"


# ---------------------------------------------------------------------------
# podcast.js  –  playPodcastChunk must NOT use new Audio()
# ---------------------------------------------------------------------------

class TestPodcastNoNewAudio:
    """playPodcastChunk in podcast.js must use Web Audio API."""

    def _get_source(self):
        return _read_source("src/static/podcast.js")

    def test_play_podcast_chunk_defined(self):
        src = self._get_source()
        assert "function playPodcastChunk" in src

    def test_play_podcast_chunk_no_new_audio(self):
        src = self._get_source()
        m = re.search(r'function playPodcastChunk\b.*?\n\}', src, re.DOTALL)
        assert m, "playPodcastChunk function not found"
        body = m.group(0)
        assert "new Audio(" not in body, \
            "playPodcastChunk still creates a new Audio element per chunk"

    def test_play_podcast_chunk_uses_buffer_source(self):
        src = self._get_source()
        m = re.search(r'function playPodcastChunk\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "createBufferSource" in body

    def test_podcast_audio_ctx_declared(self):
        src = self._get_source()
        assert "_podcastAudioCtx" in src

    def test_stop_cleans_up_podcast_ctx(self):
        src = self._get_source()
        m = re.search(r'function stopPodcastStreaming\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_podcastAudioCtx" in body

    def test_pause_suspends_podcast_ctx(self):
        src = self._get_source()
        m = re.search(r'function pausePodcastStreaming\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_podcastAudioCtx" in body

    def test_resume_resumes_podcast_ctx(self):
        src = self._get_source()
        m = re.search(r'function resumePodcastStreaming\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "_podcastAudioCtx" in body


# ---------------------------------------------------------------------------
# chat/audio-player.js  –  playTTSQueue and playTTS must NOT use new Audio()
# ---------------------------------------------------------------------------

class TestChatAudioPlayerNoNewAudio:
    """TTS playback in chat/audio-player.js must not create Audio elements."""

    def _get_source(self):
        return _read_source("src/static/chat/audio-player.js")

    def test_play_tts_queue_no_new_audio(self):
        src = self._get_source()
        m = re.search(r'(?:async )?function playTTSQueue\b.*?\n\}', src, re.DOTALL)
        assert m, "playTTSQueue function not found"
        body = m.group(0)
        assert "new Audio(" not in body, \
            "playTTSQueue still creates a new Audio element per queue item"

    def test_play_tts_queue_uses_web_audio(self):
        src = self._get_source()
        m = re.search(r'(?:async )?function playTTSQueue\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "getWebAudioContext" in body or "decodeAudioData" in body, \
            "playTTSQueue should use Web Audio API"

    def test_play_tts_no_new_audio(self):
        src = self._get_source()
        m = re.search(r'function playTTS\b.*?\n\}', src, re.DOTALL)
        assert m, "playTTS function not found"
        body = m.group(0)
        assert "new Audio(" not in body, \
            "playTTS still creates a new Audio element"

    def test_play_tts_uses_web_audio(self):
        src = self._get_source()
        m = re.search(r'function playTTS\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "getWebAudioContext" in body or "decodeAudioData" in body, \
            "playTTS should use Web Audio API"

    def test_clear_tts_queue_stops_source(self):
        src = self._get_source()
        m = re.search(r'function clearTTSQueue\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        # Should call .stop() on the source node, not .pause()
        assert ".stop()" in body, \
            "clearTTSQueue should stop the BufferSource, not pause an Audio element"


# ---------------------------------------------------------------------------
# features.js  –  playAudiobookFromLibrary must NOT use new Audio()
# ---------------------------------------------------------------------------

class TestFeaturesNoNewAudio:
    """playAudiobookFromLibrary in features.js must not create Audio element."""

    def _get_source(self):
        return _read_source("src/static/features.js")

    def test_no_new_audio(self):
        src = self._get_source()
        m = re.search(r'function playAudiobookFromLibrary\b.*?\n\}', src, re.DOTALL)
        assert m, "playAudiobookFromLibrary function not found"
        body = m.group(0)
        assert "new Audio(" not in body, \
            "playAudiobookFromLibrary still creates a new Audio element"

    def test_uses_web_audio(self):
        src = self._get_source()
        m = re.search(r'function playAudiobookFromLibrary\b.*?\n\}', src, re.DOTALL)
        assert m
        body = m.group(0)
        assert "AudioContext" in body or "createBufferSource" in body, \
            "playAudiobookFromLibrary should use Web Audio API"
