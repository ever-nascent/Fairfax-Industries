// Three explosion variants for the Powder Keg loss screen, in the style of Holliday's select background:
// flat shapes, teal / orange / cream, halftone dot gradients, grungy texture from the background itself.
const { mock, createCanvas } = require('./mock.js');
const { halftone, grain, grainAndVignette, seeded } = require('D:/Projects/Discord Bots/Fairfax Industries/src/utils/art.js');
const { loadImage } = require('D:/Projects/Discord Bots/Fairfax Industries/node_modules/@napi-rs/canvas');
const T = 'C:/Users/Umi/AppData/Local/Temp/mocks/';
const S = { img: 'card/souls.png', s: 18 };
const W = 800, H = 300, gr = grain(W, H, 11, 70);
const TEAL = '#1d2927', TEAL2 = '#2f4441', SMOKE = '#435e5a', SMOKE_HI = '#6f8e88';
const ORANGE = '#d9782d', AMBER = '#f0a442', CREAM = '#efe3c8', WHITE = '#f6f2ea', DARK = '#16201f';

let keg, bg;
async function load() {
  bg ??= await loadImage(T + 'astro_bg.png');
  if (!keg) {
    const i = await loadImage('D:/Projects/Discord Bots/Fairfax Industries/assets/trivia/abilities/powder_keg.png');
    keg = createCanvas(137, 137); const g = keg.getContext('2d');
    g.drawImage(i, 0, 0); g.clearRect(0, 0, 137, 29); g.clearRect(100, 29, 19, 3);
  }
}

// Jagged burst outline, stretched a little sideways.
function burstPath(g, cx, cy, R, n, rnd, sx = 1.25) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i + rnd() * .5) / (n * 2) * Math.PI * 2;
    const r = i % 2 ? R * (.52 + rnd() * .12) : R * (.8 + rnd() * .4);
    g.lineTo(cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r);
  }
  g.closePath();
}
// One layer: flat fill, then halftone dots of the next colour growing toward the centre (the comic gradient).
function layer(g, cx, cy, R, n, seed, fill, dots) {
  const rnd = seeded(seed);
  burstPath(g, cx, cy, R, n, rnd); g.fillStyle = fill; g.fill();
  if (!dots) return;
  g.save(); burstPath(g, cx, cy, R, n, seeded(seed)); g.clip();
  halftone(g, cx - R * 1.6, cy - R * 1.2, R * 3.2, R * 2.4, 9,
    (u, v) => Math.max(0, 1.05 - Math.hypot((u - .5) * 1.2, v - .5) * 2.4), dots);
  g.restore();
}
// Grunge: the background art multiplied into whatever shape is clipped.
function grunge(g, clipFn, alpha) {
  g.save(); clipFn(); g.clip(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = alpha;
  g.drawImage(bg, 2300, 1300, 1700, 1000, 0, 0, W, H); g.restore();
}
function fireball(g, cx, cy, R, seed) {
  layer(g, cx, cy, R, 13, seed, ORANGE, AMBER);
  grunge(g, () => burstPath(g, cx, cy, R, 13, seeded(seed)), .3);
  layer(g, cx, cy, R * .72, 11, seed + 1, AMBER, CREAM);
  layer(g, cx, cy, R * .45, 9, seed + 2, CREAM, WHITE);
  layer(g, cx, cy, R * .22, 7, seed + 3, '#fffdf6');
}
// Long angular light shards, like the jagged cut-outs in the background.
function shards(g, cx, cy, n, len, seed, col, alpha) {
  const rnd = seeded(seed); g.save(); g.globalAlpha = alpha; g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, w = .04 + rnd() * .05, l = len * (.6 + rnd() * .5);
    g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a - w) * l * 1.2, cy + Math.sin(a - w) * l);
    g.lineTo(cx + Math.cos(a + w) * l * .9 * 1.2, cy + Math.sin(a + w) * l * .9); g.fill();
  }
  g.restore();
}
// Smoke: flat cloud blobs, lighter halftone on top.
function cloud(g, blobs, seed, base = SMOKE) {
  const path = () => { g.beginPath(); for (const [x, y, r] of blobs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 7); } };
  path(); g.fillStyle = base; g.fill();
  g.save(); path(); g.clip();
  const ys = blobs.map((b) => b[1] - b[2]), ye = blobs.map((b) => b[1] + b[2]);
  const top = Math.min(...ys), bot = Math.max(...ye);
  halftone(g, 0, top, W, bot - top, 8, (u, v) => Math.max(0, .9 - v * 1.3), SMOKE_HI);
  g.restore();
  grunge(g, path, .3);
}
// A keg stave: a white plank with the icon's dark bands, plus a motion streak behind it.
function stave(g, x, y, ang, len, fromX, fromY) {
  const d = Math.hypot(x - fromX, y - fromY), ux = (x - fromX) / d, uy = (y - fromY) / d;
  g.save(); g.globalAlpha = .4; g.strokeStyle = CREAM; g.lineWidth = 2;
  for (const o of [-6, 0, 6]) { g.beginPath(); g.moveTo(x - ux * 22 - uy * o, y - uy * 22 + ux * o); g.lineTo(x - ux * 75 - uy * o, y - uy * 75 + ux * o); g.stroke(); }
  g.restore();
  const h = len / 2, t = 9, bow = 4;
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(-h, -t + 1); g.quadraticCurveTo(0, -t - bow, h, -t + 1);
  g.lineTo(h - 6, -3); g.lineTo(h + 2, 1); g.lineTo(h - 5, 5); g.lineTo(h, t - 1);   // splintered end
  g.quadraticCurveTo(0, t - bow, -h, t - 1); g.closePath();
  g.fillStyle = WHITE; g.fill();
  g.strokeStyle = 'rgba(22,32,31,.35)'; g.lineWidth = 1.5;                               // wood grain
  g.beginPath(); g.moveTo(-h + 6, -2); g.quadraticCurveTo(0, -5, h - 10, -2); g.stroke();
  g.fillStyle = DARK; g.beginPath(); g.moveTo(-h * .45, -t - 2); g.lineTo(-h * .45 + 6, -t - 2); g.lineTo(-h * .45 + 6, t - 2); g.lineTo(-h * .45, t - 2); g.fill();
  g.restore();
}
function sparks(g, cx, cy, n, R, seed) {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = R * (.7 + rnd() * .8), x = cx + Math.cos(a) * r * 1.3, y = cy + Math.sin(a) * r;
    g.fillStyle = rnd() > .5 ? WHITE : AMBER; g.beginPath(); g.arc(x, y, 1.5 + rnd() * 3, 0, 7); g.fill();
  }
}
// The keg icon cut into wedges that fly apart (variant C).
function shatter(g, cx, cy, size, seed) {
  const rnd = seeded(seed), k = size / 137, ccx = 62, ccy = 84, N = 6;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2 + .4, a1 = (i + 1) / N * Math.PI * 2 + .4, mid = (a0 + a1) / 2;
    const p = createCanvas(137, 137), pg = p.getContext('2d');
    pg.beginPath(); pg.moveTo(ccx, ccy); pg.lineTo(ccx + Math.cos(a0) * 200, ccy + Math.sin(a0) * 200);
    pg.lineTo(ccx + Math.cos(mid) * 200, ccy + Math.sin(mid) * 200); pg.lineTo(ccx + Math.cos(a1) * 200, ccy + Math.sin(a1) * 200); pg.closePath(); pg.clip();
    pg.drawImage(keg, 0, 0);
    const dist = 38 + rnd() * 30, spin = (rnd() - .5) * 1.2;
    const x = cx + Math.cos(mid) * dist * 1.3, y = cy + Math.sin(mid) * dist;
    g.save(); g.globalAlpha = .4; g.strokeStyle = CREAM; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + Math.cos(mid) * 20, cy + Math.sin(mid) * 20); g.lineTo(x - Math.cos(mid) * 14, y - Math.sin(mid) * 14); g.stroke(); g.restore();
    g.save(); g.translate(x, y); g.rotate(spin); g.drawImage(p, -ccx * k, -ccy * k, 137 * k, 137 * k); g.restore();
  }
}

async function scene(variant) {
  await load();
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = TEAL; g.fillRect(0, 0, W, H);
  g.globalAlpha = .9; g.drawImage(bg, 1500, 0, 2596, 1466, 250, -10, 620, 350); g.globalAlpha = 1;
  // orange flash washing over the left side
  const fl = g.createRadialGradient(150, 190, 20, 150, 190, 380);
  fl.addColorStop(0, 'rgba(217,120,45,.4)'); fl.addColorStop(1, 'rgba(217,120,45,0)');
  g.fillStyle = fl; g.fillRect(0, 0, W, H);
  const cx = 160, cy = 185;

  if (variant === 'A') { // Blast: big fireball, smoke ring, staves thrown outward
    cloud(g, [[60, 120, 60], [130, 80, 70], [230, 95, 62], [290, 170, 55], [250, 250, 60], [70, 250, 55], [30, 190, 50]], 3);
    shards(g, cx, cy, 16, 330, 5, CREAM, .22);
    fireball(g, cx, cy, 120, 21);
    for (const [x, y, a] of [[330, 70, .7], [345, 235, -.5], [40, 40, -1.1], [260, 30, 1.9], [30, 280, .4]]) stave(g, x, y, a, 58, cx, cy);
    sparks(g, cx, cy, 40, 150, 9);
  } else if (variant === 'B') { // Smoke column: fire at the base, a tall cloud rolling up, staves raining down
    cloud(g, [[160, 40, 70], [95, 55, 50], [235, 50, 55], [150, 110, 52], [180, 150, 45], [120, 160, 40]], 4);
    cloud(g, [[165, 18, 45], [120, 20, 35], [215, 25, 38]], 5, '#50706b');
    const ul = g.createLinearGradient(0, 200, 0, 90); ul.addColorStop(0, 'rgba(217,120,45,.55)'); ul.addColorStop(1, 'rgba(217,120,45,0)');
    g.save(); g.beginPath(); for (const [x, y, r] of [[150, 110, 52], [180, 150, 45], [120, 160, 40]]) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 7); } g.clip(); g.fillStyle = ul; g.fillRect(0, 0, W, H); g.restore();
    shards(g, cx, 235, 10, 260, 6, CREAM, .18);
    fireball(g, cx, 235, 95, 31);
    for (const [x, y, a] of [[330, 110, 2.2], [40, 95, 1.2], [300, 40, -.6], [20, 30, .8]]) stave(g, x, y, a, 52, cx, 200);
    sparks(g, cx, 230, 30, 120, 12);
  } else { // Shatter: the keg icon itself cut into pieces over a smaller burst
    cloud(g, [[80, 110, 50], [240, 110, 55], [260, 230, 50], [60, 240, 48]], 7);
    shards(g, cx, cy, 20, 320, 8, CREAM, .25);
    fireball(g, cx, cy, 90, 41);
    shatter(g, cx, cy, 170, 13);
    sparks(g, cx, cy, 45, 140, 15);
  }

  // plate, knocked slightly crooked by the blast
  g.save(); g.translate(635, 209); g.rotate(-.035);
  g.beginPath(); g.roundRect(-135, -59, 270, 118, 10); g.fillStyle = 'rgba(20,28,27,.9)'; g.fill(); g.lineWidth = 3; g.strokeStyle = CREAM; g.stroke();
  g.textAlign = 'center'; g.fillStyle = CREAM; g.font = '20px Radiance'; g.fillText('BOOM', 0, -29);
  g.font = '64px Radiance'; g.fillStyle = '#ed4245'; g.fillText('1.62×', 0, 39);
  g.restore();
  grainAndVignette(g, W, H, gr, { grainAlpha: .55, inner: 220, outer: 520, dark: .55 });
  return c;
}

const NAMES = { A: 'Blast (big fireball, smoke ring, keg staves thrown outward)', B: 'Smoke Column (fire at the base, smoke rolling up, staves raining down)', C: 'Shatter (the keg icon itself breaks into pieces)' };
if (require.main === module) (async () => {
  for (const v of ['A', 'B', 'C']) {
    await mock({ file: `powder-keg-boom-${v}.png`, color: '#ed4245',
      authorIcon: 'trivia/abilities/powder_keg.png', author: "Holliday's Powder Keg",
      label: `POWDER KEG loss screen · explosion ${v}: ${NAMES[v]}. Same message as before, only the picture changes.`,
      title: 'BOOM',
      lines: [['The keg blew at ', { b: '1.62×' }, '. ', { ping: '@Zechariah' }, ' loses ', S, { b: '100' }, '.'], ['Balance: ', S, { b: '4,620' }]],
      thumb: T + 'astro_card_gloat.png', image: () => scene(v),
      footer: '"Should\'ve walked away. Nobody in this city ever does."',
      buttons: [[{ label: 'Play Again', style: 'primary' }]] });
  }
  console.log('done');
})();
module.exports.scene = scene;
