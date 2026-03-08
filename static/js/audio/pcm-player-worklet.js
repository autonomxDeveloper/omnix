class PCMPlayerProcessor extends AudioWorkletProcessor {

    constructor() {
        super();
        this.buffer = new Float32Array(0);
        console.log('[WORKLET] Constructor called');
        
        this.port.onmessage = (event) => {
            const data = event.data;
            if (!data) return;
            
            let newData = data;
            if (data instanceof ArrayBuffer) {
                newData = new Float32Array(data);
            }
            
            if (newData.length > 0) {
                const oldLen = this.buffer.length;
                const newBuf = new Float32Array(oldLen + newData.length);
                newBuf.set(this.buffer, 0);
                newBuf.set(newData, oldLen);
                this.buffer = newBuf;
                console.log('[WORKLET] Buffer now has', this.buffer.length, 'samples');
            }
        };
        
        this.port.onmessageerror = (e) => console.error('[WORKLET] Error:', e);
    }

    process(inputs, outputs, parameters) {
        const channel = outputs[0][0];
        
        if (this.buffer.length === 0) {
            for (let i = 0; i < channel.length; i++) {
                channel[i] = 0;
            }
            return true;
        }
        
        const toCopy = Math.min(channel.length, this.buffer.length);
        
        for (let i = 0; i < toCopy; i++) {
            channel[i] = this.buffer[i];
        }
        
        for (let i = toCopy; i < channel.length; i++) {
            channel[i] = 0;
        }
        
        if (toCopy < this.buffer.length) {
            this.buffer = this.buffer.slice(toCopy);
        } else {
            this.buffer = new Float32Array(0);
        }
        
        return true;
    }
}

registerProcessor('pcm-player', PCMPlayerProcessor);
