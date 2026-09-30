const { mock, createCanvas, halftone, grain, grainAndVignette } = require('./mock.js');
const { loadImage } = require('D:/Projects/Discord Bots/Fairfax Industries/node_modules/@napi-rs/canvas');
const T = 'C:/Users/Umi/AppData/Local/Temp/mocks/';
const S = { img: 'card/souls.png', s: 18 };
const W = 800, H = 300, gr = grain(W, H, 11, 70);
const TEAL = '#1d2927', ORANGE = '#d9782d', CREAM = '#efe3c8';

// Keg icon with its baked-in spark cut off, so our fuse carries on from the icon's own fuse stub.
let keg, bg;
async function kegIcon() {
  if (keg) return keg;
  const i = await loadImage('D:/Projects/Discord Bots/Fairfax Industries/assets/trivia/abilities/powder_keg.png');
  keg = createCanvas(137, 137); const g = keg.getContext('2d');
  g.drawImage(i, 0, 0); g.clearRect(0, 0, 137, 29); g.clearRect(100, 29, 19, 3);
  return keg;
}
const KX = 50, KY = 80, KS = 190 / 137;             // where the keg sits and its scale
const TIP = { x: KX + 123 * KS, y: KY + 29 * KS };   // top of the icon's fuse stub
const FW = 6 * KS;                                   // same thickness as the icon's fuse
// Fuse path, keg end first: straight up out of the stub, then snakes right along the top.
const P = [TIP, { x: TIP.x, y: TIP.y - 70 }, { x: 330, y: 0 }, { x: 390, y: 60 },
  { x: 450, y: 120 }, { x: 560, y: 20 }, { x: 640, y: 50 }];
function bez(a, b, c, d, t) { const u = 1 - t; return { x: u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x, y: u*u*u*a.y + 3*u*u*t*b.y + 3*u*t*t*c.y + t*t*t*d.y }; }
function fusePoints() { const pts = []; for (let s = 0; s < 2; s++) for (let i = 0; i <= 40; i++) pts.push(bez(P[s*3], P[s*3+1], P[s*3+2], P[s*3+3], i / 40)); return pts; }

function spark(g, p, big) {
  g.save(); g.translate(p.x, p.y);
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + .3, r1 = 10, r2 = big ? 26 : 20; g.lineWidth = FW * .8; g.beginPath(); g.moveTo(Math.cos(a)*r1, Math.sin(a)*r1); g.lineTo(Math.cos(a)*r2, Math.sin(a)*r2); g.stroke(); }
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
  g.fillStyle = ORANGE; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  g.restore();
}
function smoke(g, p) {
  g.fillStyle = 'rgba(200,200,190,.55)';
  for (const [dx, dy, r] of [[0, -10, 9], [8, -24, 12], [-4, -42, 14], [10, -60, 11]]) { g.beginPath(); g.arc(p.x + dx, p.y + dy, r, 0, 7); g.fill(); }
}
function boom(g, cx, cy) {
  const star = (R, r, n, col) => { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * Math.PI * 2, rad = i % 2 ? r : R * (0.8 + 0.2 * Math.sin(i * 7)); g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.closePath(); g.fillStyle = col; g.fill(); };
  star(170, 90, 12, ORANGE); star(120, 65, 10, '#ffd34d'); star(70, 38, 9, CREAM);
}

async function scene({ mult, fuse, state }) {
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = TEAL; g.fillRect(0, 0, W, H);
  bg ??= await loadImage(T + 'astro_bg.png');
  g.globalAlpha = .9; g.drawImage(bg, 1500, 0, 2596, 1466, 250, -10, 620, 350); g.globalAlpha = 1;
  halftone(g, 0, 0, W, H, 10, (u, v) => Math.max(0, .55 - Math.hypot(u - .15, v - .6) * 1.1), '#2f4441');
  const pts = fusePoints(), n = Math.round(fuse * (pts.length - 1));
  if (state !== 'boom') {
    g.strokeStyle = '#fff'; g.lineWidth = FW; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i <= n; i++) g.lineTo(pts[i].x, pts[i].y); g.stroke();
    g.drawImage(await kegIcon(), KX, KY, 137 * KS, 137 * KS);
    if (state === 'lit') spark(g, pts[n], fuse > .95); else smoke(g, pts[n]);
  } else {
    boom(g, KX + 90, KY + 110);
    g.save(); g.translate(KX + 95, KY + 115); g.rotate(-.5); g.globalAlpha = .9; g.drawImage(await kegIcon(), -70, -70, 140, 140); g.restore();
  }
  // multiplier plate
  const col = state === 'cash' ? '#57f287' : state === 'boom' ? '#ed4245' : '#f2c14e';
  g.beginPath(); g.roundRect(500, 150, 270, 118, 10); g.fillStyle = 'rgba(20,28,27,.88)'; g.fill(); g.lineWidth = 3; g.strokeStyle = CREAM; g.stroke();
  g.textAlign = 'center'; g.fillStyle = CREAM; g.font = '20px Radiance';
  g.fillText(state === 'cash' ? 'CASHED OUT' : state === 'boom' ? 'BOOM' : 'FUSE LIT', 635, 180);
  g.font = '64px Radiance'; g.fillStyle = col; g.fillText(mult.toFixed(2) + '×', 635, 248);
  grainAndVignette(g, W, H, gr, { grainAlpha: .55, inner: 220, outer: 520, dark: .55 });
  return c;
}
const base = { authorIcon: 'trivia/abilities/powder_keg.png', author: "Holliday's Powder Keg" };
const fuseAt = (m) => 1 - Math.log(m) / Math.log(10); // full fuse at 1x, reaches the keg at the 10x cap
const LIT = '"Fuse is lit. I don\'t have all day, and neither does that keg."';

(async () => {
  await mock({ ...base, file: 'powder-keg-1-start.png', color: '#e67e22',
    label: 'POWDER KEG 1 of 4 · /mini-game game:Powder Keg bet:100 · public message, the moment the game starts. Fuse at full length, 1.00×.',
    title: 'The fuse is lit',
    lines: [[{ ping: '@Zechariah' }, ' put ', S, { b: '100' }, ' on the keg.'], ['The longer you wait, the more it pays. Cash Out before it blows.']],
    thumb: T + 'astro_card.png', image: () => scene({ mult: 1, fuse: 1, state: 'lit' }), footer: LIT,
    buttons: [[{ label: 'Cash Out (100)', style: 'success' }]] });
  await mock({ ...base, file: 'powder-keg-2-burning.png', color: '#e67e22',
    label: 'POWDER KEG 2 of 4 · same message a few seconds later (updates every ~2 s). The fuse burns down toward the keg as the multiplier climbs; the keg can blow at any point before the fuse runs out.',
    title: 'The fuse is lit',
    lines: [[{ ping: '@Zechariah' }, ' put ', S, { b: '100' }, ' on the keg.'], ['Cash out now for ', S, { b: '184' }, '.']],
    thumb: T + 'astro_card.png', image: () => scene({ mult: 1.84, fuse: fuseAt(1.84), state: 'lit' }), footer: LIT,
    buttons: [[{ label: 'Cash Out (184)', style: 'success' }]] });
  await mock({ ...base, file: 'powder-keg-3-cashed-out.png', color: '#57f287',
    label: 'POWDER KEG 3 of 4 · same message after Cash Out (player wins). Green, Holliday injured, fuse snuffed where it was, and it shows where the keg would have blown.',
    title: 'Cashed out',
    lines: [[{ ping: '@Zechariah' }, ' cashed out at ', { b: '2.35×' }, ' and walks away with ', S, { b: '235' }, '.'], ['The keg would have blown at ', { b: '3.10×' }, '.'], ['Balance: ', S, { b: '4,955' }]],
    thumb: T + 'astro_card_critical.png', image: () => scene({ mult: 2.35, fuse: fuseAt(2.35), state: 'cash' }),
    footer: '"Fine. Take it and get out of my sight."',
    buttons: [[{ label: 'Play Again', style: 'primary' }]] });
  await mock({ ...base, file: 'powder-keg-4-boom.png', color: '#ed4245',
    label: 'POWDER KEG 4 of 4 · same message when the keg blows before Cash Out (player loses). Red, Holliday gloating.',
    title: 'BOOM',
    lines: [['The keg blew at ', { b: '1.62×' }, '. ', { ping: '@Zechariah' }, ' loses ', S, { b: '100' }, '.'], ['Balance: ', S, { b: '4,620' }]],
    thumb: T + 'astro_card_gloat.png', image: () => scene({ mult: 1.62, fuse: fuseAt(1.62), state: 'boom' }),
    footer: '"Should\'ve walked away. Nobody in this city ever does."',
    buttons: [[{ label: 'Play Again', style: 'primary' }]] });
  console.log('done');
})();
