// A Tempered Item's fire on the Hero card (Descend, Infernus' Stoke the Fire; heroCard.js). Two functions, both (g, x, y, size, name):
// `flameFrame` is drawn behind the tile, before every tile and name of the grid (the tile hides the flames' roots); `emberOverlay` is drawn
// over the Item's picture, inside the tile's rounded clip. Everything random is seeded by the Item's name, so a redraw never moves it.
// A Tempered Item's fire (his ask Nov 14, his reference: the "hot vector frames", a frame burning on every side). Fire always rises: the tongues on
// the top edge stand tall, the ones on the sides climb up and lean out, the ones on the bottom edge rise up over the bottom of the picture. Each
// tongue is three layers added together (a red outer flame with a soft glow, an orange one, a yellow-white core), seeded by the Item's name so a
// redraw never moves them. `flameFrame` is drawn behind the tile (the tile hides their roots), `emberOverlay` inside it.
const seeded = (name, salt) => {
  let s = salt;
  for (const ch of name) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
const FLAME = [ // [size, glow, gradient stops from the root up]
  [1, 6, [[0, 'rgba(255,90,10,0.9)'], [0.5, 'rgba(220,40,0,0.6)'], [1, 'rgba(120,0,0,0)']]],
  [0.62, 2, [[0, 'rgba(255,170,40,0.95)'], [0.6, 'rgba(255,110,10,0.45)'], [1, 'rgba(255,80,0,0)']]],
  [0.32, 0, [[0, 'rgba(255,250,210,0.95)'], [0.7, 'rgba(255,220,110,0.35)'], [1, 'rgba(255,200,80,0)']]],
];
function tongue(g, bx, by, w, h, lean) { // root at (bx, by), rising h, the tip pushed sideways by lean
  for (const [k, blur, stops] of FLAME) {
    const W = w * k, H = h * k, L = lean * k;
    const grad = g.createLinearGradient(0, by, 0, by - H);
    for (const [at, c] of stops) grad.addColorStop(at, c);
    g.shadowColor = 'rgba(255,80,0,0.9)';
    g.shadowBlur = blur;
    g.beginPath();
    g.moveTo(bx - W / 2, by);
    g.bezierCurveTo(bx - W * 0.75, by - H * 0.35, bx + L * 0.2 - W * 0.4, by - H * 0.72, bx + L, by - H);
    g.bezierCurveTo(bx + L * 0.45 + W * 0.2, by - H * 0.62, bx + W * 0.72, by - H * 0.3, bx + W / 2, by);
    g.quadraticCurveTo(bx, by + W * 0.4, bx - W / 2, by);
    g.fillStyle = grad;
    g.fill();
  }
}
function flameFrame(g, x, y, TILE, name) {
  const rnd = seeded(name, 7);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.shadowColor = 'rgba(255,90,0,0.9)'; // the heat round the whole tile
  g.shadowBlur = 22;
  g.beginPath();
  g.roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 12);
  g.fillStyle = 'rgba(255,70,0,0.35)';
  g.fill();
  for (let d = -2; d <= TILE + 2; d += 7 + rnd() * 5) { // the top edge: the tallest flames, tallest at the middle
    const mid = 1 - Math.abs(d - TILE / 2) / (TILE / 2);
    tongue(g, x + d, y + 6, 9 + rnd() * 7, 18 + mid * 12 + rnd() * 14, (rnd() - 0.5) * 18);
  }
  for (const side of [-1, 1]) { // the sides: flames climbing up, leaning out, taller toward the top
    const ex = side < 0 ? x + 3 : x + TILE - 3;
    for (let d = TILE - 6; d > 6; d -= 8 + rnd() * 5) {
      const up = 1 - d / TILE;
      tongue(g, ex, y + d, 8 + rnd() * 5, 12 + up * 18 + rnd() * 10, side * (7 + rnd() * 10));
    }
  }
  for (let i = 0; i < 4; i++) { // loose flickers torn off above the top
    const fx = x + 10 + rnd() * (TILE - 20);
    tongue(g, fx, y - 22 - rnd() * 8, 4 + rnd() * 3, 7 + rnd() * 6, (rnd() - 0.5) * 6);
  }
  g.shadowBlur = 0;
  for (let i = 0; i < 12; i++) { // embers drifting up
    const ex = x - 8 + rnd() * (TILE + 16), ey = y - 6 - rnd() * 26;
    g.beginPath();
    g.arc(ex, ey, 0.7 + rnd() * 1.1, 0, Math.PI * 2);
    g.fillStyle = `rgba(255,${170 + Math.floor(rnd() * 70)},90,${0.5 + rnd() * 0.5})`;
    g.fill();
  }
  g.restore();
}
function emberOverlay(g, x, y, TILE, name) { // inside the tile's clip
  const rnd = seeded(name, 13);
  g.save();
  const scorch = g.createRadialGradient(x + TILE / 2, y + TILE * 0.42, TILE * 0.28, x + TILE / 2, y + TILE / 2, TILE * 0.75); // the picture darkens to a red-hot edge
  scorch.addColorStop(0, 'rgba(90,0,0,0)');
  scorch.addColorStop(1, 'rgba(110,8,0,0.75)');
  g.fillStyle = scorch;
  g.fillRect(x, y, TILE, TILE);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.85;
  for (let d = 2; d <= TILE - 2; d += 9 + rnd() * 6) { // flames rising off the bottom edge over the picture, taller at the corners
    const edge = Math.min(d, TILE - d) / (TILE / 2); // lower in the middle, so the picture still shows
    tongue(g, x + d, y + TILE + 4, 8 + rnd() * 6, 10 + (1 - edge) * 16 + rnd() * 10, (rnd() - 0.5) * 12);
  }
  g.globalAlpha = 1;
  g.shadowColor = 'rgba(255,120,0,1)';
  g.shadowBlur = 8;
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,150,40,0.7)'; // the inner rim, glowing
  g.beginPath();
  g.roundRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3, 11);
  g.stroke();
  g.restore();
}

module.exports = { flameFrame, emberOverlay };
