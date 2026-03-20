/**
 * Voice Studio – frontend logic
 * Handles voice loading, slider bindings, TTS generation and playback.
 */

/* ------------------------------------------------------------------ */
/*  Load voices                                                       */
/* ------------------------------------------------------------------ */

async function loadVoiceStudioVoices() {
    try {
        const res = await fetch("/api/voice_studio/voices");
        const data = await res.json();

        const select = document.getElementById("vs-voice");
        if (!select) return;
        select.innerHTML = "";

        if (data.success && data.voices && data.voices.length > 0) {
            data.voices.forEach(function (v) {
                const opt = document.createElement("option");
                opt.value = v.id;
                opt.textContent = v.name + " (" + v.gender + ")";
                select.appendChild(opt);
            });
        } else {
            var fallback = document.createElement("option");
            fallback.value = "default";
            fallback.textContent = "Default";
            select.appendChild(fallback);
        }
    } catch (e) {
        console.error("[VoiceStudio] Failed to load voices:", e);
    }
}

/* ------------------------------------------------------------------ */
/*  Open / close modal                                                */
/* ------------------------------------------------------------------ */

function openVoiceStudioModal() {
    var modal = document.getElementById("voiceStudioModal");
    if (modal) {
        modal.classList.add("active");
        loadVoiceStudioVoices();
    }
}

function closeVoiceStudioModal() {
    var modal = document.getElementById("voiceStudioModal");
    if (modal) {
        modal.classList.remove("active");
    }
}

/* ------------------------------------------------------------------ */
/*  Slider + textarea bindings                                        */
/* ------------------------------------------------------------------ */

function initVoiceStudioControls() {
    var speedSlider = document.getElementById("vs-speed");
    var pitchSlider = document.getElementById("vs-pitch");
    var textArea    = document.getElementById("vs-text");

    if (speedSlider) {
        speedSlider.oninput = function () {
            document.getElementById("vs-speed-val").innerText = speedSlider.value;
        };
    }
    if (pitchSlider) {
        pitchSlider.oninput = function () {
            document.getElementById("vs-pitch-val").innerText = pitchSlider.value;
        };
    }
    if (textArea) {
        textArea.oninput = function () {
            var counter = document.getElementById("vs-char-count");
            if (counter) counter.innerText = textArea.value.length + " / 2000";
        };
    }

    // Close button
    var closeBtn = document.getElementById("closeVoiceStudio");
    if (closeBtn) {
        closeBtn.addEventListener("click", closeVoiceStudioModal);
    }

    // Click outside modal to close
    var modal = document.getElementById("voiceStudioModal");
    if (modal) {
        modal.addEventListener("click", function (e) {
            if (e.target === modal) closeVoiceStudioModal();
        });
    }

    // Generate button
    var genBtn = document.getElementById("vs-generate");
    if (genBtn) {
        genBtn.addEventListener("click", handleVoiceStudioGenerate);
    }
}

/* ------------------------------------------------------------------ */
/*  Base64 → Blob                                                     */
/* ------------------------------------------------------------------ */

function vsBase64ToBlob(base64, mime) {
    var bytes = atob(base64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
        arr[i] = bytes.charCodeAt(i);
    }
    return new Blob([arr], { type: mime });
}

/* ------------------------------------------------------------------ */
/*  Generate handler                                                  */
/* ------------------------------------------------------------------ */

async function handleVoiceStudioGenerate() {
    var btn = document.getElementById("vs-generate");
    var errorEl = document.getElementById("vs-error");
    var playerSection = document.getElementById("vs-player-section");

    // Reset error display
    if (errorEl) { errorEl.style.display = "none"; errorEl.innerText = ""; }

    var text = (document.getElementById("vs-text").value || "").trim();
    var voice_id = document.getElementById("vs-voice").value;
    var speed = parseFloat(document.getElementById("vs-speed").value);
    var pitch = parseFloat(document.getElementById("vs-pitch").value);
    var emotion = document.getElementById("vs-emotion").value;

    if (!text) {
        showVsError("Please enter some text.");
        return;
    }
    if (text.length > 2000) {
        showVsError("Text must be 2000 characters or fewer.");
        return;
    }
    if (!voice_id) {
        showVsError("Please select a voice.");
        return;
    }

    btn.disabled = true;
    btn.innerText = "Generating...";

    try {
        var res = await fetch("/api/voice_studio/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text, voice_id: voice_id, speed: speed, pitch: pitch, emotion: emotion })
        });

        var data = await res.json();

        if (!data.success) throw new Error(data.error || "Generation failed");

        var blob = vsBase64ToBlob(data.audio_base64, "audio/wav");
        var url = URL.createObjectURL(blob);

        var player = document.getElementById("vs-player");
        player.src = url;
        player.play();

        var dl = document.getElementById("vs-download");
        dl.href = url;

        if (playerSection) playerSection.style.display = "block";
    } catch (err) {
        showVsError(err.message || "An error occurred.");
    }

    btn.disabled = false;
    btn.innerText = "Generate";
}

function showVsError(msg) {
    var errorEl = document.getElementById("vs-error");
    if (errorEl) {
        errorEl.innerText = msg;
        errorEl.style.display = "block";
    }
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                         */
/* ------------------------------------------------------------------ */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVoiceStudioControls);
} else {
    initVoiceStudioControls();
}
