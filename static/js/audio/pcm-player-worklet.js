class PCMPlayerProcessor extends AudioWorkletProcessor {

    constructor() {
        super()
        this.queue = []
        this.index = 0
        this.loggedOnce = false;

        this.port.onmessage = (e) => {
            if (!this.loggedOnce) {
                console.log("[WORKLET] Received:", e.data.length, "samples");
                this.loggedOnce = true;
                setTimeout(() => this.loggedOnce = false, 1000);
            }
            this.queue.push(e.data)
        }
    }

    process(inputs, outputs) {
        const output = outputs[0][0]
        
        let played = 0;

        for (let i = 0; i < output.length; i++) {

            if (this.queue.length === 0) {
                output[i] = 0
                continue
            }

            const buffer = this.queue[0]
            
            if (this.index >= buffer.length) {
                this.queue.shift()
                this.index = 0
                if (this.queue.length === 0) {
                    output[i] = 0
                    continue
                }
            }

            output[i] = buffer[this.index++]
            played++;
        }
        
        return true
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor)
