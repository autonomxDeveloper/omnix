class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSamples = 0;
        this.chunkOffset = 0;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            if (data.type === 'stop' || data.type === 'reset') {
                this.buffer = [];
                this.bufferSamples = 0;
                this.chunkOffset = 0;
                return;
            }

            if (data instanceof Float32Array && data.length > 0) {
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

            output.set(chunk.subarray(this.chunkOffset, this.chunkOffset + toCopy), written);
            written += toCopy;
            this.chunkOffset += toCopy;
            this.bufferSamples -= toCopy;

            if (this.chunkOffset >= chunk.length) {
                this.buffer.shift();
                this.chunkOffset = 0;
            }
        }

        for (let i = written; i < needed; i++) {
            output[i] = 0;
        }

        return true;
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor);
