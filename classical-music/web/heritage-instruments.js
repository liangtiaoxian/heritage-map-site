import { Guzheng } from '../src/dsp/guzheng.js';
import { Pipa } from '../src/dsp/pipa.js';
import { Erhu } from '../src/dsp/erhu.js';
import { Suona } from '../src/dsp/suona.js';
export function createInstrument(kind, fs) {
  return new ({ guzheng: Guzheng, pipa: Pipa, erhu: Erhu, suona: Suona }[kind] ?? Guzheng)(fs);
}
export function playInstrumentNote(instrument, kind, midi, velocity = .65) {
      const t = instrument.pos / instrument.fs + .004;
      const hz = 440 * 2 ** ((midi - 69) / 12);
      if (kind === 'erhu') {
        for (const string of [0, 1]) instrument.bow(t, string, 0, .4, .02);
        const string = midi < 69 ? 0 : 1;
        instrument.pitch(t, string, [[0, hz]], true);
        instrument.bow(t, string, .25, .4, .04);
        instrument.bow(t + .65, string, 0, .4, .08);
      } else if (kind === 'suona') {
        instrument.pitch(t, [[0, hz]]);
        instrument.breath(t, .82, .035);
        instrument.breath(t + .55, 0, .06);
      } else {
        const note = instrument.findString(midi);
        if (note) instrument.pluck(t, note.string, velocity, { cents: note.cents });
      }
}
