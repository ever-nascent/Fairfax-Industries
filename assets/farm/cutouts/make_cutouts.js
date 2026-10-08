// Cuts the roam finds out of the wiki's in-game screenshots as transparent PNGs, by hand-traced outlines (pixel coordinates in the
// original files). Run: node assets/farm/cutouts/make_cutouts.js  (downloads the originals from deadlock.wiki, writes next to this file).
// The Golden Statue needs no cutout: assets/farm/icons/golden-statue.png is already transparent (the owl statue he supplied).
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const WIKI = 'https://deadlock.wiki';
const HEADERS = { 'User-Agent': 'FairfaxBot/1.0' };
const circle = (cx, cy, r, n = 20) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 6.283), cy + r * Math.sin((i / n) * 6.283)]);

// Keeps what is inside the polygons (soft edge, `shrink` px tighter), minus the holes, cropped to them.
async function cut(img, polys, { holes = [], shrink = 0.5, pad = 3, blur = 0.8 } = {}) {
  const all = polys.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const w = Math.min(img.width, Math.ceil(Math.max(...xs)) + pad) - x0;
  const h = Math.min(img.height, Math.ceil(Math.max(...ys)) + pad) - y0;
  const m = createCanvas(w, h);
  const mg = m.getContext('2d');
  const trace = (p) => { mg.beginPath(); p.forEach(([x, y], i) => (i ? mg.lineTo(x - x0, y - y0) : mg.moveTo(x - x0, y - y0))); mg.closePath(); };
  for (const p of polys) { trace(p); mg.fill(); }
  mg.globalCompositeOperation = 'destination-out';
  mg.lineWidth = shrink * 2;
  for (const p of polys) { trace(p); mg.stroke(); }
  for (const p of holes) { trace(p); mg.fill(); }
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.filter = `blur(${blur}px)`;
  g.drawImage(m, 0, 0);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  return c.toBuffer('image/png');
}

const sign = [[80, 302], [95, 290], [115, 283], [150, 276], [200, 270], [260, 265], [330, 268], [400, 279], [432, 277], [424, 300], [400, 325], [360, 350], [340, 366], [250, 376], [170, 378], [120, 350], [90, 325]];
const JOBS = {
  // the boxes are plain straight-edged outlines, like an angled square
  crate: { file: 'Fairfax_crates.png', shrink: 0, polys: [[[30, 237], [47, 229], [112, 224], [190, 234], [192, 352], [135, 375], [31, 358]]] },
  'tough-crate': { file: 'Tough_Crate.png', shrink: 0, polys: [[[128, 122], [190, 102], [262, 93], [388, 117], [388, 270], [262, 329], [141, 274]]] },
  'sinners-sacrifice': {
    file: "Sinner's_Sacrifice_machine.png",
    polys: [
      sign,
      [...circle(151, 261, 17), [151, 270], [158, 280], [145, 280]], circle(344, 248, 19), // the two lamps
      [[145, 262], [158, 262], [162, 285], [142, 285]], [[336, 255], [352, 255], [350, 272], [338, 272]], // lamp stems
      [[64, 395], [70, 375], [95, 358], [125, 352], [160, 358], [168, 372], [160, 395], [135, 418], [100, 420], [72, 412]], // left oval sign
      [[340, 360], [350, 350], [395, 340], [430, 347], [455, 362], [462, 380], [450, 400], [420, 414], [385, 415], [355, 402], [340, 382]], // right oval sign
      [[122, 426], [130, 418], [150, 415], [400, 416], [410, 423], [412, 470], [413, 700], [415, 740], [346, 742], [346, 825], [375, 830], [410, 840], [417, 860], [417, 900], [422, 940], [430, 1000], [442, 1060], [446, 1078], [436, 1086], [420, 1072], [405, 1030], [400, 1005], [350, 995], [250, 983], [160, 970], [148, 1000], [143, 1030], [130, 1040], [125, 1033], [122, 990], [120, 930], [122, 860], [126, 830], [125, 780], [127, 768], [160, 766], [160, 745], [128, 738], [121, 705], [120, 430]], // machine
      [[450, 640], [466, 648], [467, 668], [458, 700], [462, 740], [462, 782], [440, 788], [378, 782], [340, 782], [340, 762], [430, 765], [440, 720], [440, 690], [447, 660]], // lever
    ],
    holes: [[[183, 383], [318, 374], [318, 416], [183, 416]]], // the gap between the sign posts
    shrink: 0.4,
  },
};

(async () => {
  for (const [name, { file, polys, holes, shrink }] of Object.entries(JOBS)) {
    const q = `${WIKI}/api.php?action=query&titles=${encodeURIComponent(`File:${file}`)}&prop=imageinfo&iiprop=url&format=json`;
    const { query } = await (await fetch(q, { headers: HEADERS })).json();
    const url = Object.values(query.pages)[0].imageinfo[0].url;
    const img = await loadImage(Buffer.from(await (await fetch(url, { headers: HEADERS })).arrayBuffer()));
    fs.writeFileSync(path.join(__dirname, `${name}.png`), await cut(img, polys, { holes, shrink }));
    console.log(`[ok] ${name}.png`);
  }
})();
