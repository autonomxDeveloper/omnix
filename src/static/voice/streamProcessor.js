/**
 * AudioWorklet processor for continuous streaming audio playback.
 *
 * Uses a ring buffer to decouple the main-thread push rate from the
 * audio-thread consumption rate, eliminating gaps, clicks and drift
 * that occur with per-chunk AudioBufferSourceNode scheduling.
 *
 * Main thread sends { type: "push", samples: Float32Array } messages
 * to feed audio data into the buffer.
 */
class StreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const sr = (options && options.processorOptions && options.processorOptions.sampleRate)
      ? options.processorOptions.sampleRate
      : sampleRate;
    this.buffer = new Float32Array(sr * 10); // 10 sec ring buffer
    this.writeIndex = 0;
    this.readIndex = 0;
    this.availableSamples = 0;
    this.totalSamplesPlayed = 0;
    this.frameCount = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === "push") {
        this.pushData(event.data.samples);
      }
    };
  }

  pushData(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (this.availableSamples >= this.buffer.length) {
        // buffer full — drop oldest (backpressure safety)
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
        this.availableSamples--;
      }

      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.availableSamples++;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0][0];

    for (let i = 0; i < output.length; i++) {
      if (this.availableSamples > 0) {
        output[i] = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
        this.availableSamples--;
        this.totalSamplesPlayed++;
      } else {
        // underrun — output silence
        output[i] = 0;
      }
    }

    // Report playback progress and buffer level to main thread (~every 53ms)
    this.frameCount++;
    if (this.frameCount >= 10) {
      this.frameCount = 0;
      this.port.postMessage({
        type: "progress",
        samplesPlayed: this.totalSamplesPlayed,
        availableSamples: this.availableSamples,
      });
    }

    return true;
  }
}

registerProcessor("stream-processor", StreamProcessor);
