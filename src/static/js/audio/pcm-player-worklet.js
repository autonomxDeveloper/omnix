const MAX_BUFFER_CHUNKS = 200;
const CROSSFADE_SAMPLES = 16;

class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSamples = 0;
        this.currentChunk = null;
        this.chunkOffset = 0;
        this.previousChunk = null;
        this.lastSample = 0;
        this.draining = false;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            if (data.type === 'reset') {
                this.buffer = [];
                this.bufferSamples = 0;
                this.currentChunk = null;
                this.chunkOffset = 0;
                this.previousChunk = null;
                this.lastSample = 0;
                this.draining = false;
                return;
            }

            if (data.type === 'stop') {
                // Soft stop: finish playing queued audio, then go silent.
                // Do NOT clear the buffer — frames already queued must play out.
                this.draining = true;
                return;
            }

            if (!(data instanceof Float32Array)) {
                if (data !== null && typeof data !== 'object') {
                    console.warn('[PCMPlayerProcessor] Invalid audio chunk type — expected Float32Array, got:', typeof data);
                }
                return;
            }

            if (!this.draining && data.length > 0) {
                this.buffer.push(data);
                this.bufferSamples += data.length;

                // Prevent memory blowup — drop oldest chunks
                if (this.buffer.length > MAX_BUFFER_CHUNKS) {
                    const dropped = this.buffer.shift();
                    this.bufferSamples -= dropped.length;
                }
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        let outputIndex = 0;

        while (outputIndex < output.length) {
            // Load next chunk if needed
            if (!this.currentChunk || this.chunkOffset >= this.currentChunk.length) {
                if (this.buffer.length > 0) {
                    this.previousChunk = this.currentChunk;
                    this.currentChunk = this.buffer.shift();
                    this.chunkOffset = 0;

                    // Cross-chunk smoothing: crossfade at chunk boundaries
                    if (this.previousChunk && this.currentChunk.length > 0) {
                        const fadeSamples = Math.min(
                            CROSSFADE_SAMPLES,
                            this.previousChunk.length,
                            this.currentChunk.length
                        );
                        for (let i = 0; i < fadeSamples; i++) {
                            const t = i / fadeSamples;
                            const prev = this.previousChunk[this.previousChunk.length - fadeSamples + i] || 0;
                            this.currentChunk[i] = prev * (1 - t) + this.currentChunk[i] * t;
                        }
                    }
                } else {
                    // Underrun: smooth decay instead of harsh silence
                    this.lastSample *= 0.98;
                    output[outputIndex++] = this.lastSample;
                    continue;
                }
            }

            const remainingChunk = this.currentChunk.length - this.chunkOffset;
            const remainingOutput = output.length - outputIndex;
            const copySize = Math.min(remainingChunk, remainingOutput);

            output.set(
                this.currentChunk.subarray(this.chunkOffset, this.chunkOffset + copySize),
                outputIndex
            );

            // Track last sample for underrun smoothing
            if (copySize > 0) {
                this.lastSample = output[outputIndex + copySize - 1];
            }

            this.chunkOffset += copySize;
            this.bufferSamples -= copySize;
            outputIndex += copySize;
        }

        if (this.draining && this.buffer.length === 0 &&
            (!this.currentChunk || this.chunkOffset >= this.currentChunk.length)) {
            this.draining = false;
            this.port.postMessage({ type: 'drained' });
        }

        return true;
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor);
