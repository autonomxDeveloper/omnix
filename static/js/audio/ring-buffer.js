export class RingBuffer {
    constructor(size) {
        this.buffer = new Float32Array(size);
        this.size = size;
        this.readIndex = 0;
        this.writeIndex = 0;
    }

    availableRead() {
        return (this.writeIndex - this.readIndex + this.size) % this.size;
    }

    availableWrite() {
        return this.size - this.availableRead() - 1;
    }

    write(data) {
        for (let i = 0; i < data.length; i++) {
            if (this.availableWrite() === 0) return;
            this.buffer[this.writeIndex] = data[i];
            this.writeIndex = (this.writeIndex + 1) % this.size;
        }
    }

    read(target) {
        for (let i = 0; i < target.length; i++) {
            if (this.availableRead() === 0) {
                target[i] = 0;
                continue;
            }
            target[i] = this.buffer[this.readIndex];
            this.readIndex = (this.readIndex + 1) % this.size;
        }
    }

    clear() {
        this.readIndex = 0;
        this.writeIndex = 0;
    }
}
