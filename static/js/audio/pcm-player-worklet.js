class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        console.log("[WORKLET] Constructor called");

        this.buffer = new Float32Array(0);
        this.readIndex = 0;

        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            if (data.type === 'stop' || data.type === 'reset') {
                this.buffer = new Float32Array(0);
                this.readIndex = 0;
                console.log('[WORKLET] Reset');
                return;
            }

            if (data.length) {
                const newBuffer = new Float32Array(this.buffer.length + data.length);
                newBuffer.set(this.buffer, 0);
                newBuffer.set(data, this.buffer.length);
                this.buffer = newBuffer;
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0][0];
        const remaining = this.buffer.length - this.readIndex;
        
        if (remaining >= output.length) {
            for (let i = 0; i < output.length; i++) {
                output[i] = this.buffer[this.readIndex++];
            }
        } else {
            for (let i = 0; i < remaining; i++) {
                output[i] = this.buffer[this.readIndex++];
            }
            for (let i = remaining; i < output.length; i++) {
                output[i] = 0;
            }
            this.buffer = new Float32Array(0);
            this.readIndex = 0;
        }

        return true;
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor);
