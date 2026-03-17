const MAX_CORRUPTION_COUNT = 5000;

class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSamples = 0;
        this.chunkOffset = 0;
        this.draining = false;
        this.corruptionCount = 0;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            if (data.type === 'reset') {
                this.buffer = [];
                this.bufferSamples = 0;
                this.chunkOffset = 0;
                this.draining = false;
                this.corruptionCount = 0;
                return;
            }

            if (data.type === 'stop') {
                // Soft stop: finish playing queued audio, then go silent.
                // Do NOT clear the buffer — frames already queued must play out.
                this.draining = true;
                return;
            }

            if (!this.draining && data instanceof Float32Array && data.length > 0) {
                this.buffer.push(data);
                this.bufferSamples += data.length;
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        const needed = output.length;
        let written = 0;

        while (written < needed && this.buffer.length > 0) {
            const chunk = this.buffer[0];
            const available = chunk.length - this.chunkOffset;
            const toCopy = Math.min(available, needed - written);

            for (let j = 0; j < toCopy; j++) {
                let sample = chunk[this.chunkOffset + j];

                // Reject corrupt samples (NaN, Infinity, extreme values)
                if (!Number.isFinite(sample) || Math.abs(sample) > 5) {
                    sample = 0;
                    this.corruptionCount++;
                }

                // Soft-clip to [-1, 1]
                sample = Math.max(-1, Math.min(1, sample));
                output[written + j] = sample;
            }

            written += toCopy;
            this.chunkOffset += toCopy;
            this.bufferSamples -= toCopy;

            if (this.chunkOffset >= chunk.length) {
                this.buffer.shift();
                this.chunkOffset = 0;
            }
        }

        // Reset on sustained corruption to prevent speaker damage
        if (this.corruptionCount > MAX_CORRUPTION_COUNT) {
            this.buffer = [];
            this.bufferSamples = 0;
            this.chunkOffset = 0;
            this.corruptionCount = 0;
        }

        if (this.draining && this.buffer.length === 0) {
            this.draining = false;
            // Notify the main thread that the buffer has fully drained
            this.port.postMessage({ type: 'drained' });
        }

        for (let i = written; i < needed; i++) {
            output[i] = 0;
        }

        return true;
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor);