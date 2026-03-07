class PCMPlayerProcessor extends AudioWorkletProcessor {

    constructor() {
        super()

        this.bufferSize = 96000
        this.buffer = new Float32Array(this.bufferSize)

        this.readIndex = 0
        this.writeIndex = 0

        this.port.onmessage = (event) => {
            const data = event.data
            if (!data) return
            
            if (data instanceof Float32Array) {
                for (let i = 0; i < data.length; i++) {
                    this.buffer[this.writeIndex] = data[i]
                    this.writeIndex = (this.writeIndex + 1) % this.bufferSize
                }
            } else if (Array.isArray(data)) {
                for (let sample of data) {
                    this.buffer[this.writeIndex] = sample
                    this.writeIndex = (this.writeIndex + 1) % this.bufferSize
                }
            }
        }
    }

    process(inputs, outputs) {

        const output = outputs[0][0]

        for (let i = 0; i < output.length; i++) {
            if (this.readIndex !== this.writeIndex) {
                output[i] = this.buffer[this.readIndex]
                this.readIndex = (this.readIndex + 1) % this.bufferSize
            } else {
                output[i] = 0
            }
        }

        return true
    }
}

registerProcessor("pcm-player", PCMPlayerProcessor)
