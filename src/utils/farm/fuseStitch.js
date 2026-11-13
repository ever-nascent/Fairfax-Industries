// Victor's Abomination (Descend; his pick Nov 7 of a design panel's 4 templates, "D"): two Items sewn into one tile.
// One fixed template for every pair: a curved scar from the top edge to the bottom, Item A's picture on its left, Item B's on its right, each over its own kind's tile colours, then the scar drawn over the join:
// a dark groove with bruised edges and a faint electric green glow in it, dark surgical sutures across it with their needle holes, and two
// metal staples. The scar layer is drawn once per tile size and kept (the "template"); a tile is then two clipped pictures and one drawImage.
const { createCanvas } = require('@napi-rs/canvas');

// The seam, as fractions of the tile: two cubic curves, top edge to bottom edge (A is left of it, B right). It starts left of the tier tab.
const SEAM = {
  start: [0.6, -0.04],
  curves: [
    [[0.47, 0.16], [0.7, 0.34], [0.52, 0.5]],
    [[0.34, 0.66], [0.55, 0.86], [0.4, 1.04]],
  ],
  // where along the seam (0 = top, 1 = bottom) each crossing sits, and what it is
  marks: [[0.1, 'suture'], [0.23, 'suture'], [0.37, 'staple'], [0.51, 'suture'], [0.64, 'suture'], [0.78, 'staple'], [0.91, 'suture']],
};

// The seam as a polyline in tile pixels, with each point's distance along it.
function seamPoints(size, n = 80) {
  const pts = [];
  let [px, py] = SEAM.start;
  for (const [c1, c2, p] of SEAM.curves) {
    for (let i = pts.length ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const f = (a, b, c, d) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
      pts.push([f(px, c1[0], c2[0], p[0]) * size, f(py, c1[1], c2[1], p[1]) * size]);
    }
    [px, py] = p;
  }
  let len = 0;
  pts.forEach((p, i) => { if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); p.push(len); });
  return { pts, len };
}
// The point at fraction f of the seam's length, with the unit normal pointing right (toward B).
function along({ pts, len }, f) {
  const d = f * len;
  let i = 1;
  while (i < pts.length - 1 && pts[i][2] < d) i++;
  const [ax, ay, ad] = pts[i - 1], [bx, by, bd] = pts[i];
  const t = (d - ad) / (bd - ad || 1);
  const tx = bx - ax, ty = by - ay, tl = Math.hypot(tx, ty) || 1;
  return { x: ax + tx * t, y: ay + ty * t, nx: ty / tl, ny: -tx / tl };
}
const traceSeam = (g, x, y, size) => {
  const [sx, sy] = SEAM.start;
  g.lineTo(x + sx * size, y + sy * size);
  for (const [c1, c2, p] of SEAM.curves) g.bezierCurveTo(x + c1[0] * size, y + c1[1] * size, x + c2[0] * size, y + c2[1] * size, x + p[0] * size, y + p[1] * size);
};
// One half of the tile as a path (side 'a' = left of the seam, 'b' = right), for clipping a picture or an overlay to it.
function halfPath(g, x, y, size, side) {
  const e = size * 0.1, edgeX = side === 'a' ? x - e : x + size + e;
  g.beginPath();
  g.moveTo(edgeX, y - e);
  traceSeam(g, x, y, size);
  g.lineTo(edgeX, y + size + e);
  g.closePath();
}

const GLOW = 'rgba(132,255,96,';
// The scar layer for one tile size, transparent everywhere but the scar.
const layers = new Map();
function scarLayer(size) {
  if (layers.has(size)) return layers.get(size);
  const k = size / 100;
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.beginPath(); g.roundRect(0, 0, size, size, 12 * k); g.clip();
  const seam = () => { g.beginPath(); g.moveTo(SEAM.start[0] * size, SEAM.start[1] * size); traceSeam(g, 0, 0, size); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  // the skin pulled in along the cut: a soft dark shadow, then a bruised raw edge
  seam(); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 9 * k; g.filter = `blur(${2.5 * k}px)`; g.stroke(); g.filter = 'none';
  seam(); g.strokeStyle = 'rgba(128,52,72,0.6)'; g.lineWidth = 5 * k; g.stroke();
  // the groove, then the green spark in it
  seam(); g.strokeStyle = '#140e11'; g.lineWidth = 2.6 * k; g.stroke();
  g.save();
  g.shadowColor = `${GLOW}0.9)`; g.shadowBlur = 5 * k;
  seam(); g.strokeStyle = `${GLOW}0.55)`; g.lineWidth = 0.8 * k; g.stroke();
  g.restore();

  const s = seamPoints(size);
  const hole = (hx, hy) => {
    g.beginPath(); g.arc(hx, hy, 1.6 * k, 0, Math.PI * 2); g.fillStyle = 'rgba(128,52,72,0.75)'; g.fill();
    g.beginPath(); g.arc(hx, hy, 1 * k, 0, Math.PI * 2); g.fillStyle = '#140e11'; g.fill();
  };
  for (const [f, kind] of SEAM.marks) {
    const p = along(s, f);
    const tx = -p.ny, ty = p.nx; // along the seam (downward)
    if (kind === 'suture') {
      // a thread pulled tight straight across the cut, a needle hole at each end, the skin pinched a little under it
      const r = 6.5 * k;
      const ax = p.x - p.nx * r, ay = p.y - p.ny * r, bx = p.x + p.nx * r, by = p.y + p.ny * r;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4.4 * k; g.stroke(); // the pinch
      const thread = (w, col) => {
        g.beginPath(); g.moveTo(ax, ay);
        g.quadraticCurveTo(p.x + tx * 0.9 * k, p.y + ty * 0.9 * k, bx, by);
        g.strokeStyle = col; g.lineWidth = w; g.stroke();
      };
      thread(3.2 * k, 'rgba(238,230,208,0.85)'); // a pale edge so it reads on dark art
      thread(1.8 * k, '#1a1311');
      hole(ax, ay); hole(bx, by);
    } else {
      // a skin staple: a flat steel crown straight across the cut, its legs bent down into the skin
      const r = 7 * k;
      const ax = p.x - p.nx * r, ay = p.y - p.ny * r, bx = p.x + p.nx * r, by = p.y + p.ny * r;
      hole(ax + tx * 0.6 * k, ay + ty * 0.6 * k); hole(bx + tx * 0.6 * k, by + ty * 0.6 * k);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 2.5 * k; g.shadowOffsetY = 1.2 * k;
      g.beginPath(); g.moveTo(ax + tx * 1.6 * k, ay + ty * 1.6 * k); g.lineTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx + tx * 1.6 * k, by + ty * 1.6 * k);
      g.strokeStyle = '#2a2e33'; g.lineWidth = 4.2 * k; g.lineJoin = 'miter'; g.stroke();
      g.restore();
      const steel = g.createLinearGradient(ax, ay, bx, by);
      steel.addColorStop(0, '#9aa3ab'); steel.addColorStop(0.45, '#f4f8fb'); steel.addColorStop(0.6, '#c5ccd3'); steel.addColorStop(1, '#7d868f');
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
      g.strokeStyle = steel; g.lineWidth = 2.3 * k; g.lineCap = 'butt'; g.stroke(); g.lineCap = 'round';
      // a little spark where the steel crosses the live scar
      g.save();
      g.shadowColor = `${GLOW}1)`; g.shadowBlur = 4 * k;
      g.beginPath(); g.arc(p.x, p.y, 0.9 * k, 0, Math.PI * 2); g.fillStyle = '#e9ffd8'; g.fill();
      g.restore();
    }
  }
  layers.set(size, c);
  return c;
}

// One half: its kind's tile colours, then its picture pushed toward its own side so more of it shows.
function half(g, x, y, size, side, item) {
  g.save();
  g.beginPath(); g.roundRect(x, y, size, size, 12 * size / 100); g.clip();
  halfPath(g, x, y, size, side); g.clip();
  const fill = g.createLinearGradient(x, y, x, y + size);
  fill.addColorStop(0, item.tile[0]); fill.addColorStop(1, item.tile[1]);
  g.fillStyle = fill; g.fillRect(x, y, size, size);
  const shift = (side === 'a' ? -0.1 : 0.1) * size;
  if (item.art) g.drawImage(item.art, x + shift, y, size, size);
  item.over?.(g); // this Item's own marks (Enhanced, corrupted, Fragile, painted), kept to its half
  // the edge of this half flushed in its kind's colour, so two pale pictures still read as two pieces
  g.beginPath(); g.moveTo(x + SEAM.start[0] * size, y + SEAM.start[1] * size); traceSeam(g, x, y, size);
  g.strokeStyle = `rgba(${item.rgb},0.22)`; g.lineWidth = 16 * size / 100; g.stroke();
  g.strokeStyle = `rgba(${item.rgb},0.3)`; g.lineWidth = 8 * size / 100; g.stroke();
  g.restore();
}

// The whole tile picture at (x, y): A left of the seam, B right of it, then the scar. a, b = { art: Image|null, tile: [top, bottom], rgb,
// over(g)?: drawn after the picture, clipped to that half }.
// No border, tier tab or name: heroCard.js draws those.
async function fusedTile(g, x, y, size, a, b) {
  half(g, x, y, size, 'a', a);
  half(g, x, y, size, 'b', b);
  g.drawImage(scarLayer(size), x, y, size, size);
}

module.exports = { fusedTile, SEAM, halfPath };
