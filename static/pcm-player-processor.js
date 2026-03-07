/**
 * LM Studio Chatbot - PCM Player AudioWorklet
 * Low-latency audio playback using AudioWorklet
 * Replaces ScriptProcessorNode for better performance
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(0);
        this.isPlaying = true;
        this.samplesPlayed = 0;
        
        // Handle messages from main thread
        this.port.onmessage = (event) => {
            if (event.data.type === 'audio') {
                // Append new audio data to buffer
                const newData = new Float32Array(event.data.data);
                const newBuffer = new Float32Array(this.buffer.length + newData.length);
                newBuffer.set(this.buffer, 0);
                newBuffer.set(newData, this.buffer.length);
                this.buffer = newBuffer;
                
                // Debug logging
                console.log('[WORKLET] Received audio, buffer now:', this.buffer.length, 'first sample:', this.buffer[0]?.toFixed(4));
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.buffer = new Float32Array(0);
            } else if (event.data.type === 'clear') {
                this.buffer = new Float32Array(0);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.isPlaying || this.buffer.length === 0) {
            // Fill with silence
            for (let i = 0; i < channel.length; i++) {
                channel[i] = 0;
            }
            return true;
        }
        
        // Copy buffer to output
        const samplesToPlay = Math.min(channel.length, this.buffer.length);
        for (let i = 0; i < samplesToPlay; i++) {
            channel[i] = this.buffer[i];
        }
        
        // Debug: log occasionally
        if (this.samplesPlayed === 0 || this.samplesPlayed % 48000 === 0) {
            console.log('[WORKLET] Playing, buffer:', this.buffer.length, 'samplesToPlay:', samplesToPlay, 'first sample:', this.buffer[0]?.toFixed(4));
        }
        this.samplesPlayed += samplesToPlay;
        
        // Fill remaining with silence
        for (let i = samplesToPlay; i < channel.length; i++) {
            channel[i] = 0;
        }
        
        // Shift buffer (remove played samples)
        if (samplesToPlay < this.buffer.length) {
            this.buffer = this.buffer.slice(samplesToPlay);
        } else {
            this.buffer = new Float32Array(0);
        }
        
        return true;
    }
}

// Register the processor
registerProcessor('pcm-player', PCMPlayerProcessor);
