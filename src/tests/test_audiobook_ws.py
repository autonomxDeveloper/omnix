"""
Tests for audiobook WebSocket improvements (Steps 1-8).

Tests do not require external services (LLM, TTS, STT).
Tests for server_fastapi functions use source file inspection since uvicorn
is not available in the sandboxed test environment (same as Flask).
"""

import json
import os
import re
import sys
import threading
import time

import numpy as np
import pytest

# Ensure src/ is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Repo root (parent of src/)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_source(relative_path):
    """Read a source file from the repo root."""
    with open(os.path.join(REPO_ROOT, relative_path)) as f:
        return f.read()


# ---------------------------------------------------------------------------
# STEP 2: _generate_audiobook_tts_pcm yields raw PCM int16
# ---------------------------------------------------------------------------

class TestGenerateAudiobookTtsPcm:
    """Test that _generate_audiobook_tts_pcm in server_fastapi.py produces
    raw PCM int16 bytes — no base64, no WAV header."""

    def _get_source(self):
        return _read_source("server_fastapi.py")

    def test_function_defined(self):
        src = self._get_source()
        assert "def _generate_audiobook_tts_pcm" in src

    def test_yields_int16_tobytes(self):
        """Must convert float32 → int16 and call .tobytes()."""
        src = self._get_source()
        # Find the function body
        match = re.search(
            r'def _generate_audiobook_tts_pcm.*?(?=\ndef |\nclass |\n# ===)',
            src, re.DOTALL
        )
        assert match, "_generate_audiobook_tts_pcm must exist"
        body = match.group(0)
        assert "np.int16" in body, "Must convert to int16"
        assert ".tobytes()" in body, "Must call tobytes()"

    def test_no_base64_encoding(self):
        """Function must NOT base64-encode the output."""
        src = self._get_source()
        match = re.search(
            r'def _generate_audiobook_tts_pcm.*?(?=\ndef |\nclass |\n# ===)',
            src, re.DOTALL
        )
        assert match
        body = match.group(0)
        assert "base64.b64encode" not in body, "Must not use base64 encoding"
        assert "b64encode" not in body, "Must not use b64encode"

    def test_no_wav_header_creation(self):
        """Function must NOT build WAV/RIFF headers."""
        src = self._get_source()
        match = re.search(
            r'def _generate_audiobook_tts_pcm.*?(?=\ndef |\nclass |\n# ===)',
            src, re.DOTALL
        )
        assert match
        body = match.group(0)
        assert "RIFF" not in body, "Must not write RIFF header"
        assert "wave.open" not in body, "Must not create WAV file"

    def test_uses_semaphore(self):
        """Must use a semaphore for concurrency control."""
        src = self._get_source()
        match = re.search(
            r'def _generate_audiobook_tts_pcm.*?(?=\ndef |\nclass |\n# ===)',
            src, re.DOTALL
        )
        assert match
        body = match.group(0)
        assert "_audiobook_tts_semaphore" in body, "Must use semaphore"

    def test_frame_size_defined(self):
        """Must define AUDIOBOOK_FRAME_SIZE for consistent chunk sizes."""
        src = self._get_source()
        assert "AUDIOBOOK_FRAME_SIZE" in src
        # Should be 2400 (100ms at 24kHz)
        match = re.search(r'AUDIOBOOK_FRAME_SIZE\s*=\s*(\d+)', src)
        assert match
        assert int(match.group(1)) == 2400


# ---------------------------------------------------------------------------
# STEP 7: Semaphore replaces Lock in audio.py
# ---------------------------------------------------------------------------

class TestSemaphoreReplacement:
    """Verify that audio.py uses Semaphore(2) instead of Lock."""

    def test_semaphore_exists(self):
        content = _read_source("src/app/audio.py")

        assert "_generation_semaphore" in content, "Must define _generation_semaphore"
        assert "threading.Semaphore(2)" in content, "Must use Semaphore(2)"
        assert "_generation_lock = threading.Lock()" not in content, (
            "Old _generation_lock = threading.Lock() must be removed"
        )

    def test_semaphore_used_in_sse(self):
        """The SSE handler should acquire the semaphore, not a Lock."""
        content = _read_source("src/app/audio.py")
        assert "with _generation_semaphore:" in content


# ---------------------------------------------------------------------------
# STEP 8: _split_into_paragraphs / chunk_text
# ---------------------------------------------------------------------------

class TestSplitIntoParagraphs:
    """Test the text splitting logic used for long audiobook text.

    Since server_fastapi.py delegates to audiobook.segmentation.chunk_text,
    we test that module directly.
    """

    def test_short_text_single_chunk(self):
        from audiobook.segmentation.chunk_text import chunk_text
        result = chunk_text("Hello world.", max_chars=500)
        assert len(result) == 1
        assert result[0] == "Hello world."

    def test_splits_long_text(self):
        from audiobook.segmentation.chunk_text import chunk_text
        text = "This is a sentence. " * 50  # ~1000 chars
        result = chunk_text(text, max_chars=200)
        assert len(result) > 1

    def test_empty_text(self):
        from audiobook.segmentation.chunk_text import chunk_text
        result = chunk_text("")
        assert result == ['']

    def test_preserves_content(self):
        from audiobook.segmentation.chunk_text import chunk_text
        text = "First paragraph. Second paragraph."
        result = chunk_text(text, max_chars=500)
        combined = " ".join(result)
        assert "First" in combined
        assert "Second" in combined

    def test_split_into_paragraphs_defined(self):
        """server_fastapi.py must define _split_into_paragraphs."""
        src = _read_source("server_fastapi.py")
        assert "def _split_into_paragraphs" in src
        assert "chunk_text" in src


# ---------------------------------------------------------------------------
# STEP 5: AudioOutput buffering (source code check)
# ---------------------------------------------------------------------------

class TestAudioOutputBuffering:
    """Verify AudioOutput.enqueue() has minimum buffer logic."""

    def test_min_buffer_in_source(self):
        content = _read_source("src/static/voice/audioOutput.js")

        assert "minBufferSize" in content, "Must define minBufferSize property"
        assert "flush" in content, "Must have flush method"
        assert "_flushing" in content, "Must have _flushing flag"

    def test_enqueue_has_buffer_check(self):
        content = _read_source("src/static/voice/audioOutput.js")

        assert "this.minBufferSize" in content
        assert "this.audioQueue.length < this.minBufferSize" in content
        assert "_shouldWaitForBuffer" in content, "Must have helper method"

    def test_flushing_reset_on_stop(self):
        content = _read_source("src/static/voice/audioOutput.js")

        # Both stop() and stopAll() should reset _flushing
        assert content.count("this._flushing = false") >= 2


# ---------------------------------------------------------------------------
# STEP 3: TTSClient.speakAudiobook (source code check)
# ---------------------------------------------------------------------------

class TestTTSClientAudiobookMode:
    """Verify TTSClient.js has speakAudiobook method."""

    def test_speak_audiobook_exists(self):
        content = _read_source("src/static/voice/ttsClient.js")

        assert "speakAudiobook" in content, "Must define speakAudiobook method"
        assert "type: 'start'" in content or 'type: "start"' in content

    def test_on_segment_callback(self):
        content = _read_source("src/static/voice/ttsClient.js")

        assert "onSegment" in content, "Must have onSegment callback"
        assert "'segment'" in content or '"segment"' in content

    def test_sends_segments_and_voice_mapping(self):
        content = _read_source("src/static/voice/ttsClient.js")

        assert "segments" in content
        assert "voice_mapping" in content
        assert "default_voices" in content


# ---------------------------------------------------------------------------
# STEP 1: WebSocket endpoint exists in server_fastapi.py
# ---------------------------------------------------------------------------

class TestWebSocketEndpointDefined:
    """Verify /ws/audiobook endpoint is defined."""

    def test_ws_audiobook_route(self):
        content = _read_source("server_fastapi.py")

        assert '/ws/audiobook' in content, "Must define /ws/audiobook endpoint"
        assert 'websocket_audiobook' in content, "Must define handler function"

    def test_no_base64_in_ws_handler(self):
        """The WS audiobook handler must not use base64 encoding."""
        content = _read_source("server_fastapi.py")

        match = re.search(
            r'async def websocket_audiobook.*?(?=\nasync def |\nclass |\n# ===|\Z)',
            content, re.DOTALL
        )
        assert match, "websocket_audiobook function must exist"
        fn_body = match.group(0)
        assert 'base64' not in fn_body, (
            "websocket_audiobook must not use base64 encoding"
        )

    def test_sends_segment_metadata(self):
        """WS handler should send segment index metadata."""
        content = _read_source("server_fastapi.py")

        match = re.search(
            r'async def websocket_audiobook.*?(?=\nasync def |\nclass |\n# ===|\Z)',
            content, re.DOTALL
        )
        assert match
        fn_body = match.group(0)
        assert '"segment"' in fn_body or "'segment'" in fn_body
        assert '"index"' in fn_body or "'index'" in fn_body


# ---------------------------------------------------------------------------
# STEP 6: Deprecation comments on old endpoints
# ---------------------------------------------------------------------------

class TestDeprecationComments:
    """Old streaming endpoints should have deprecation notices."""

    def test_tts_stream_deprecated(self):
        content = _read_source("src/app/audio.py")
        assert "deprecated" in content.lower(), "Must contain deprecation notice"

    def test_tts_stream_sse_deprecated(self):
        content = _read_source("src/app/audio.py")
        assert "Prefer the ``/ws/audiobook``" in content or "Prefer the `/ws/audiobook`" in content


# ---------------------------------------------------------------------------
# Audiobook.js WebSocket integration (source code check)
# ---------------------------------------------------------------------------

class TestAudiobookJSWebSocket:
    """Verify audiobook.js uses WebSocket with SSE fallback."""

    def test_ws_generation_function(self):
        content = _read_source("src/static/audiobook.js")

        assert "generateAudiobookWS" in content, "Must define WS generation function"
        assert "generateAudiobookSSE" in content, "Must define SSE fallback function"
        assert "/ws/audiobook" in content, "Must reference /ws/audiobook endpoint"

    def test_ws_fallback_to_sse(self):
        content = _read_source("src/static/audiobook.js")

        assert "generateAudiobookWS" in content
        assert "generateAudiobookSSE" in content
        assert "catch" in content

    def test_ws_uses_arraybuffer(self):
        content = _read_source("src/static/audiobook.js")

        assert "binaryType" in content
        assert "'arraybuffer'" in content or '"arraybuffer"' in content

    def test_stop_closes_websocket(self):
        content = _read_source("src/static/audiobook.js")

        assert "audiobookWs" in content
        assert "audiobookWs.close()" in content or "audiobookWs.close" in content

    def test_pcm_playback_without_base64(self):
        """The WS generation path should play PCM directly from ArrayBuffer."""
        content = _read_source("src/static/audiobook.js")

        # generateAudiobookWS should use Int16Array for PCM playback
        match = re.search(
            r'function generateAudiobookWS.*?(?=\nfunction |\n// ===|\Z)',
            content, re.DOTALL
        )
        assert match, "generateAudiobookWS must exist"
        fn_body = match.group(0)
        assert "Int16Array" in fn_body, "Must decode PCM as Int16Array"
        assert "ArrayBuffer" in fn_body, "Must handle ArrayBuffer data"


# ---------------------------------------------------------------------------
# Issue 1: Voice mapping normalisation
# ---------------------------------------------------------------------------

class TestVoiceMappingNormalisation:
    """Verify that voice mapping keys are normalised to lowercase in both the
    frontend (audiobook.js) and the backend (audiobook.py, server_fastapi.py).
    This prevents stale voice assignments when users change voices in the UI."""

    def test_normalize_key_function_exists(self):
        content = _read_source("src/static/audiobook.js")
        assert "_normalizeKey" in content, "audiobook.js must define _normalizeKey helper"

    def test_normalize_key_lowercases(self):
        content = _read_source("src/static/audiobook.js")
        # Find the _normalizeKey function using a robust terminator set
        match = re.search(
            r'function _normalizeKey\s*\(.*?\{.*?\}',
            content, re.DOTALL
        )
        assert match, "_normalizeKey function must be defined"
        body = match.group(0)
        assert "toLowerCase" in body, "_normalizeKey must call toLowerCase()"
        assert "trim" in body, "_normalizeKey must call trim()"

    def test_update_voice_mapping_uses_normalize(self):
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function updateVoiceMapping.*?(?=\n// |\nfunction )',
            content, re.DOTALL
        )
        assert match, "updateVoiceMapping must exist"
        body = match.group(0)
        assert "_normalizeKey" in body, "updateVoiceMapping must normalise the key"

    def test_display_speakers_uses_normalize(self):
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function displaySpeakers.*?(?=\n// |\nfunction )',
            content, re.DOTALL
        )
        assert match, "displaySpeakers must exist"
        body = match.group(0)
        assert "_normalizeKey" in body, "displaySpeakers must normalise voiceMapping keys"

    def test_backend_normalises_merged_map_keys(self):
        """audiobook.py must build merged_map with lower-cased keys."""
        content = _read_source("src/app/audiobook.py")
        # Should contain a dict comprehension that calls .lower() or .lower().strip()
        assert "lower().strip()" in content or ".lower().strip():" in content, (
            "audiobook.py generate() must normalise merged_map keys"
        )

    def test_fastapi_normalises_merged_map_keys(self):
        """server_fastapi.py WS handler must build merged_map with lower-cased keys."""
        content = _read_source("server_fastapi.py")
        match = re.search(
            r'async def websocket_audiobook.*?(?=\nasync def |\nclass |\n# ===|\Z)',
            content, re.DOTALL
        )
        assert match, "websocket_audiobook must exist"
        body = match.group(0)
        assert "lower().strip()" in body, (
            "websocket_audiobook must normalise merged_map keys"
        )


# ---------------------------------------------------------------------------
# Issue 2: PCM chunk validation
# ---------------------------------------------------------------------------

class TestPcmChunkValidation:
    """Verify that the WebSocket binary handler validates PCM chunk integrity
    before scheduling playback, to prevent squeaking noise from corrupted data."""

    def test_odd_byte_length_check(self):
        content = _read_source("src/static/audiobook.js")
        # Must check that byteLength is even before creating Int16Array
        assert "byteLength % 2" in content, (
            "audiobook.js WS handler must reject odd-length PCM chunks"
        )

    def test_minimum_sample_count_check(self):
        content = _read_source("src/static/audiobook.js")
        # Must skip chunks that are too short
        assert "pcm16.length < 100" in content, (
            "audiobook.js WS handler must skip chunks with fewer than 100 samples"
        )

    def test_validation_before_schedule(self):
        """Validation must happen before scheduleChunk is called in onmessage."""
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function generateAudiobookWS.*?(?=\nfunction |\n// ===|\Z)',
            content, re.DOTALL
        )
        assert match, "generateAudiobookWS must exist"
        body = match.group(0)
        # Find the onmessage handler section
        onmessage_match = re.search(r'ws\.onmessage.*', body, re.DOTALL)
        assert onmessage_match, "Must have onmessage handler"
        onmessage_body = onmessage_match.group(0)
        odd_idx = onmessage_body.find("byteLength % 2")
        schedule_call_idx = onmessage_body.find("scheduleChunk(pcm16")
        assert odd_idx != -1, "onmessage handler must check odd byte length"
        assert schedule_call_idx != -1, "onmessage handler must call scheduleChunk"
        assert odd_idx < schedule_call_idx, "Validation must precede scheduleChunk call"


# ---------------------------------------------------------------------------
# Issue 3: Download available after segmentation
# ---------------------------------------------------------------------------

class TestEarlyDownloadAvailability:
    """Verify that the download button is made available as soon as audio
    generation completes (WS: on 'done'; SSE: on 'job' event) rather than
    waiting for the full playback UI to render."""

    def test_show_early_download_button_defined(self):
        content = _read_source("src/static/audiobook.js")
        assert "_showEarlyDownloadButton" in content, (
            "audiobook.js must define _showEarlyDownloadButton"
        )

    def test_show_early_server_download_button_defined(self):
        content = _read_source("src/static/audiobook.js")
        assert "_showEarlyServerDownloadButton" in content, (
            "audiobook.js must define _showEarlyServerDownloadButton"
        )

    def test_ws_done_builds_blob_early(self):
        """On WS 'done', build WAV blob and show download button before audio drains."""
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function generateAudiobookWS.*?(?=\nfunction |\n// ===|\Z)',
            content, re.DOTALL
        )
        assert match, "generateAudiobookWS must exist"
        body = match.group(0)
        # The 'done' case must call _showEarlyDownloadButton
        assert "_showEarlyDownloadButton" in body, (
            "WS 'done' handler must call _showEarlyDownloadButton"
        )

    def test_sse_handler_handles_job_type(self):
        """SSE handler must handle the 'job' event type to show the download button."""
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function generateAudiobookSSE.*?(?=\nfunction |\n// ===|\Z)',
            content, re.DOTALL
        )
        assert match, "generateAudiobookSSE must exist"
        body = match.group(0)
        assert "data.type === 'job'" in body or 'data.type === "job"' in body, (
            "SSE handler must handle 'job' event type"
        )
        assert "_showEarlyServerDownloadButton" in body, (
            "SSE handler must call _showEarlyServerDownloadButton on 'job' event"
        )

    def test_backend_emits_job_event(self):
        """audiobook.py SSE generator must yield a 'job' event before TTS loop."""
        content = _read_source("src/app/audiobook.py")
        assert "'type': 'job'" in content or '"type": "job"' in content, (
            "audiobook.py generate() must yield a 'job' SSE event"
        )
        assert "download_url" in content, (
            "The 'job' event must include a download_url"
        )

    def test_backend_saves_wav_file(self):
        """audiobook.py SSE generator must write a WAV file for download."""
        content = _read_source("src/app/audiobook.py")
        # Must create the output path
        assert "output_path" in content, "Must define output_path for WAV file"
        # Must write RIFF/WAV header
        assert "RIFF" in content and "WAVE" in content, (
            "Must write valid WAV (RIFF/WAVE) header"
        )

    def test_buildAndShowFinalPlayer_skips_double_blob_build(self):
        """buildAndShowFinalPlayer must skip blob building if already done eagerly."""
        content = _read_source("src/static/audiobook.js")
        assert "!combinedAudioBlob" in content, (
            "buildAndShowFinalPlayer must check for pre-built blob to avoid duplication"
        )


# ---------------------------------------------------------------------------
# P1: updateVoicePanelEntry uses delete not undefined
# ---------------------------------------------------------------------------

class TestUpdateVoicePanelEntryDelete:
    """updateVoicePanelEntry must delete the key when voice is falsy, not store
    undefined, to prevent stale entries remaining in voiceMapping."""

    def test_uses_delete_for_falsy_voice(self):
        content = _read_source("src/static/audiobook.js")
        assert "function updateVoicePanelEntry" in content, (
            "updateVoicePanelEntry must be defined"
        )
        # The function must contain a 'delete' operation on voiceMapping
        assert "delete audiobookState.voiceMapping" in content, (
            "updateVoicePanelEntry must use 'delete' to remove falsy voice entries"
        )
        # Must NOT store undefined as a voiceMapping value
        assert "voiceMapping[key] = voice || undefined" not in content, (
            "Must NOT assign 'undefined' to voiceMapping; use delete instead"
        )

    def test_uses_normalize_key(self):
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function updateVoicePanelEntry\s*\(.*?\{.*?\}',
            content, re.DOTALL
        )
        assert match, "updateVoicePanelEntry must be defined"
        body = match.group(0)
        assert "_normalizeKey" in body, (
            "updateVoicePanelEntry must use _normalizeKey for the lookup key"
        )


# ---------------------------------------------------------------------------
# P2: Float32 sample validation (NaN / overflow protection)
# ---------------------------------------------------------------------------

class TestFloat32SampleValidation:
    """scheduleChunk must validate float32 samples and hard-clamp to [-1, 1]
    to prevent squeaking noise from NaN values or overflow distortion."""

    def _get_schedule_chunk_body(self):
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function scheduleChunk\s*\(.*?\{.*?(?=\n        \}\n\n        function )',
            content, re.DOTALL
        )
        assert match, "scheduleChunk must be defined inside generateAudiobookWS"
        return match.group(0)

    def test_nan_check_present(self):
        body = self._get_schedule_chunk_body()
        assert "isFinite" in body, (
            "scheduleChunk must check Number.isFinite to skip corrupt samples"
        )

    def test_hard_clamp_present(self):
        body = self._get_schedule_chunk_body()
        # The clamp: float32[i] > 1 → 1; float32[i] < -1 → -1
        assert "> 1" in body or "> 1.0" in body, (
            "scheduleChunk must hard-clamp values above 1"
        )
        assert "< -1" in body or "< -1.0" in body, (
            "scheduleChunk must hard-clamp values below -1"
        )

    def test_nan_check_before_audio_buffer(self):
        """The NaN/isFinite check must happen before createBuffer to avoid
        writing corrupt data into the audio graph."""
        body = self._get_schedule_chunk_body()
        nan_idx = body.find("isFinite")
        buf_idx = body.find("createBuffer")
        assert nan_idx != -1, "scheduleChunk must call isFinite"
        assert buf_idx != -1, "scheduleChunk must call createBuffer"
        assert nan_idx < buf_idx, "isFinite check must precede createBuffer"


# ---------------------------------------------------------------------------
# P3: Gain ramp + overlap for artifact-free transitions
# ---------------------------------------------------------------------------

class TestGainRampAndOverlap:
    """scheduleChunk must use a GainNode with linear ramps and a small overlap
    between consecutive chunks to eliminate inter-chunk click/pop artifacts."""

    def _get_schedule_chunk_body(self):
        content = _read_source("src/static/audiobook.js")
        match = re.search(
            r'function scheduleChunk\s*\(.*?\{.*?(?=\n        \}\n\n        function )',
            content, re.DOTALL
        )
        assert match, "scheduleChunk must be defined"
        return match.group(0)

    def test_gain_node_used(self):
        body = self._get_schedule_chunk_body()
        assert "createGain" in body, (
            "scheduleChunk must use a GainNode for smooth transition ramps"
        )

    def test_linear_ramp_used(self):
        body = self._get_schedule_chunk_body()
        assert "linearRampToValueAtTime" in body, (
            "scheduleChunk must use linearRampToValueAtTime for smooth volume transitions"
        )

    def test_chunk_overlap_defined(self):
        content = _read_source("src/static/audiobook.js")
        assert "CHUNK_OVERLAP_SECONDS" in content, (
            "audiobook.js must define CHUNK_OVERLAP_SECONDS for inter-chunk overlap"
        )

    def test_scheduled_time_uses_overlap(self):
        """scheduledTime must be advanced by duration minus overlap."""
        body = self._get_schedule_chunk_body()
        assert "CHUNK_OVERLAP_SECONDS" in body, (
            "scheduleChunk must subtract CHUNK_OVERLAP_SECONDS from scheduledTime advance"
        )
        # Must subtract (not add)
        assert "duration - CHUNK_OVERLAP_SECONDS" in body, (
            "scheduledTime must advance by (duration - CHUNK_OVERLAP_SECONDS)"
        )

    def test_source_connects_through_gain(self):
        """The source BufferSource must route through the GainNode."""
        body = self._get_schedule_chunk_body()
        assert "source.connect(gainNode)" in body, (
            "Source must connect to gainNode, not directly to destination"
        )
        assert "gainNode.connect(audioCtx.destination)" in body, (
            "gainNode must connect to destination"
        )


# ---------------------------------------------------------------------------
# P4: Progressive WAV streaming in backend
# ---------------------------------------------------------------------------

class TestProgressiveWavStreaming:
    """audiobook.py must write a WAV header at the start and append PCM bytes
    incrementally, then finalize the header at the end — so the file is usable
    for download before generation is complete."""

    def test_wav_header_written_before_loop(self):
        """A WAV header must be written BEFORE the TTS generation loop."""
        content = _read_source("src/app/audiobook.py")
        # The header-write and the job-yield must come before the for-loop
        header_idx = content.find("b\"RIFF\"")
        loop_idx = content.find("for i, seg in enumerate(segments)")
        assert header_idx != -1, "Must write RIFF header before loop"
        assert loop_idx != -1, "Must have segment for-loop"
        assert header_idx < loop_idx, "WAV header must be written before the TTS loop"

    def test_pcm_appended_per_segment(self):
        """Each segment's PCM must be appended to the file as it is generated."""
        content = _read_source("src/app/audiobook.py")
        # Must open in append-binary mode inside the loop
        assert '"ab"' in content or "'ab'" in content, (
            "audiobook.py must open the WAV file in append mode ('ab') per segment"
        )

    def test_header_finalized_after_loop(self):
        """After the loop the RIFF/data sizes must be updated with real values."""
        content = _read_source("src/app/audiobook.py")
        # Must seek to offset 4 (RIFF size) and 40 (data size)
        assert "seek(4)" in content, "Must seek to byte 4 to update RIFF size"
        assert "seek(40)" in content, "Must seek to byte 40 to update data size"

    def test_total_pcm_bytes_tracked(self):
        """Must track total PCM bytes written to correctly finalize the header."""
        content = _read_source("src/app/audiobook.py")
        assert "total_pcm_bytes" in content, (
            "audiobook.py must track total_pcm_bytes for WAV header finalization"
        )

    def test_no_full_accumulation_in_memory(self):
        """Should NOT accumulate all PCM in memory (bytearray) before writing."""
        content = _read_source("src/app/audiobook.py")
        assert "accumulated_pcm" not in content, (
            "audiobook.py must NOT use an accumulated_pcm bytearray; "
            "append each segment directly to the file instead"
        )
