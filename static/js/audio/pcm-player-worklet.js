class PCMPlayerProcessor extends AudioWorkletProcessor {

    constructor() {
        super();

        console.log("[WORKLET] Constructor called");

        this.buffer = new Float32Array(0);
        this.readIndex = 0;

        this.port.onmessage = (event) => {
            if (event.data && event.data.type) {
                if (event.data.type === 'stop' || event.data.type === 'reset') {
                    this.buffer = new Float32Array(0);
                    this.readIndex = 0;
                    console.log('[WORKLET] Reset');
                    return;
                }
                return;
            }
            
            const newData = event.data;
            if (!newData || newData.length === 0) return;

            const merged = new Float32Array(this.buffer.length + newData.length);
            merged.set(this.buffer, 0);
            merged.set(newData, this.buffer.length);
            this.buffer = merged;
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0][0];

        for (let i = 0; i < output.length; i++) {
            if (this.readIndex < this.buffer.length) {
                output[i] = this.buffer[this.readIndex++];
            } else {
                output[i] = 0;
            }
        }

        if (this.readIndex > 8192) {
            this.buffer = this.buffer.slice(this.readIndex);
            this.readIndex = 0;
        }

        // Prevent memory growth - keep buffer under 1 second
        if (this.buffer.length > 48000) {
            this.buffer = this.buffer.slice(this.readIndex);
            this.readIndex = 0;
        }

        return true;
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor);
