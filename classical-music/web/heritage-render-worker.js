import { renderPiece } from '../src/render.js';
import { PIECES } from '../src/pieces.js';
import { encodeWav } from '../src/wav.js';
self.onmessage = ({ data }) => {
  try {
    const piece = PIECES.find(piece => piece.id === (data?.pieceId ?? 'yuzhou'));
    if (!piece) throw new Error('Unknown piece');
    const rendered = renderPiece(piece, {
      onProgress: progress => self.postMessage({ type: 'progress', progress }),
    });
    const wav = encodeWav([rendered.L, rendered.R], rendered.fs);
    self.postMessage({ type: 'done', wav: wav.buffer, duration: rendered.duration }, [wav.buffer]);
  } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
};
