// Animated GIFs for the games (gifenc). One palette for all frames, and pixels that didn't change since the
// last frame become transparent, so only the moving parts are stored and the file stays small.
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

// frames: [{ rgba (Uint8ClampedArray, width*height*4, or a function that draws it: then only one frame is
// held at a time), delay (ms) }]. Plays once, then stays on the last frame; { loop: true } plays forever, and { picks } says which frames the
// palette is made from (default: four spread through the animation; fewer is faster when most frames look alike).
// { dither: true } adds an ordered (Bayer) pattern before the colours are matched, so soft gradients don't band; the pattern depends on the pixel's
// place only, so still parts of the picture stay identical from frame to frame.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function dithered(rgba, width) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const p = i >> 2;
    const t = (BAYER[((Math.floor(p / width) & 3) << 2) | (p % width & 3)] / 16 - 0.47) * 12;
    out[i] += t; out[i + 1] += t; out[i + 2] += t;
  }
  return out;
}
function encodeGif(frames, width, height, { loop = false, dither = false, picks = [0, Math.floor(frames.length / 3), Math.floor((frames.length * 2) / 3), frames.length - 1] } = {}) {
  const raw = (frame) => (typeof frame.rgba === 'function' ? frame.rgba() : frame.rgba);
  const pixels = dither ? (frame) => dithered(raw(frame), width) : raw;
  // palette from a few frames spread through the animation, so colours that only show up mid-way are in it
  const size = width * height * 4;
  const sample = new Uint8ClampedArray(size * picks.length);
  picks.forEach((f, i) => sample.set(pixels(frames[f]), i * size));
  const palette = quantize(sample, 255);
  const clear = palette.length; // one extra palette slot = "unchanged"

  const gif = GIFEncoder();
  let shown = null; // what the viewer sees so far, as palette indexes
  frames.forEach((frame, f) => {
    const index = applyPalette(pixels(frame), palette);
    if (shown) {
      for (let i = 0; i < index.length; i++) {
        if (index[i] === shown[i]) index[i] = clear;
        else shown[i] = index[i];
      }
    } else shown = new Uint8Array(index);
    gif.writeFrame(index, width, height, {
      palette: f === 0 ? [...palette, [0, 0, 0]] : undefined,
      delay: frame.delay,
      repeat: loop ? 0 : -1, // forever, or once
      transparent: f > 0,
      transparentIndex: clear,
      dispose: 1, // keep the previous frame under the transparent pixels
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = { encodeGif };
