// Heritage map adapter. DSP by Liyucheng1997, used with user-confirmed permission.
import { createInstrument, playInstrumentNote } from './heritage-instruments.js';
import { Reverb } from '../src/dsp/reverb.js';
class HeritageGuzheng extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kind = options?.processorOptions?.instrument ?? 'guzheng';
    this.instrument = createInstrument(this.kind, sampleRate);
    this.reverb = new Reverb(sampleRate, { rt60: 2.2, wet: .25, damp: .4, predelay: .016 });
    this.left = new Float64Array(128); this.right = new Float64Array(128);
    this.port.onmessage = ({ data }) => {
      playInstrumentNote(this.instrument, this.kind, data.midi, data.velocity);
    };
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    if (!left) return true;
    if (this.left.length !== left.length) {
      this.left = new Float64Array(left.length); this.right = new Float64Array(left.length);
    }
    this.left.fill(0); this.right.fill(0);
    this.instrument.process(this.left, this.right, 0, left.length);
    this.reverb.processBlock(this.left, this.right, left.length, 1);
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.tanh(this.left[i] * 1.6);
      if (right) right[i] = Math.tanh(this.right[i] * 1.6);
    }
    return true;
  }
}
registerProcessor('heritage-guzheng', HeritageGuzheng);
