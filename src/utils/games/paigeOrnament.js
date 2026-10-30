// The scrolled border round each page of the storybook (paigeBook.js): a double frame with notched corners, curled scrollwork flowing out of every
// corner along both edges (tapered strokes ending in spirals, with leaves), a small fleuron on the middle of each edge and a flower at each corner.
// Drawn in the style of old fairy-tale book covers; the shapes are our own. Everything is built in one corner's own space (the corner at 0,0, x along
// the top edge, y down the left one) and mirrored into the other three.
const INK = 'rgba(84,50,22,0.86)';
const GOLD = 'rgba(176,132,44,0.95)';

// ---- shapes ---------------------------------------------------------------------------------------------------------------------

const bezier = (p0, p1, p2, p3, n = 32) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
});
// A spiral from `start` (a point on it) round `centre`, `turns` (negative = the other way), the radius shrinking to `rEnd`.
function spiral(centre, start, turns, rEnd, n = 56) {
  const r0 = Math.hypot(start[0] - centre[0], start[1] - centre[1]), a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, a = a0 + t * turns * 2 * Math.PI, r = r0 + (rEnd - r0) * (t * t * 0.4 + t * 0.6);
    return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
  });
}
const mirror = (pts) => pts.map(([x, y]) => [y, x]); // across the corner's diagonal

// A calligraphic stroke along `pts`: thin at both ends, swelling to `max` (at `peak` of the way along), as one filled shape.
function brush(g, pts, max, peak = 0.35, min = 0.5) {
  const n = pts.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const t = i / (n - 1), swell = t < peak ? t / peak : 1 - ((t - peak) / (1 - peak)) ** 1.5;
    const w = (min + (max - min) * Math.max(0, swell)) / 2;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  g.beginPath(); left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  right.reverse().forEach(([x, y]) => g.lineTo(x, y)); g.closePath(); g.fill();
  const [ex, ey] = pts[n - 1]; g.beginPath(); g.arc(ex, ey, min * 1.4, 0, 7); g.fill(); // a round dot where it ends
}
function leaf(g, x, y, angle, length, width) { // a pointed leaf, base at x,y
  g.save(); g.translate(x, y); g.rotate(angle);
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(length * 0.3, -width, length * 0.75, -width * 0.7, length, 0); g.bezierCurveTo(length * 0.75, width * 0.7, length * 0.3, width, 0, 0); g.fill();
  g.restore();
}
function dot(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
function diamond(g, x, y, r) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.75, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.75, y); g.closePath(); g.fill(); }

// The scrollwork of one corner, flowing out along the top edge. (The same shape, mirrored across the diagonal, flows down the left edge.)
function arm(g) {
  g.fillStyle = INK;
  // the long flowing stroke: out of the corner in a wave, ending in a curl that turns back inwards
  const wave = bezier([16, 17], [28, 5], [52, 27], [72, 15]);
  const curl = spiral([77, 25], wave.at(-1), 1.05, 2.6);
  brush(g, [...wave, ...curl.slice(1)], 3.1, 0.3, 0.6);
  // a branch that leaves the wave and curls up towards the frame line
  const branch = bezier([40, 19], [46, 14], [55, 6], [62, 7]);
  brush(g, [...branch, ...spiral([63, 11.5], branch.at(-1), -0.95, 1.6).slice(1)], 1.7, 0.4, 0.4);
  // a second, longer and finer line running on along the edge from the end of the wave, ending in a tiny curl
  const run = bezier([96, 20], [112, 28], [126, 8], [150, 14]);
  brush(g, [...run, ...spiral([151, 18.5], run.at(-1), 0.9, 1.2).slice(1)], 1.5, 0.3, 0.4);
  // leaves along the wave, and gold ones
  leaf(g, 31, 11, -0.55, 12, 3.4); leaf(g, 56, 19, 0.5, 11, 3);
  g.fillStyle = GOLD; leaf(g, 60, 25, 0.9, 9, 2.6); leaf(g, 88, 14, -0.4, 10, 2.8); dot(g, 77, 25, 1.9); dot(g, 103, 22, 1.6);
}

// A little flower at the corner itself: three petals and a gold heart.
function flower(g) {
  g.fillStyle = INK;
  leaf(g, 12, 12, Math.PI / 4, 20, 5);
  leaf(g, 12, 12, Math.PI / 4 - 0.75, 15, 3.8); leaf(g, 12, 12, Math.PI / 4 + 0.75, 15, 3.8);
  g.fillStyle = GOLD; diamond(g, 16, 16, 4.2);
}

// The fleuron on the middle of an edge: a diamond with a scroll curling away on each side (drawn for the top edge, rotated for the sides).
function fleuron(g, size = 1) {
  g.save(); g.scale(size, size);
  g.fillStyle = GOLD; diamond(g, 0, 0, 6);
  g.fillStyle = INK;
  for (const side of [-1, 1]) {
    const tail = bezier([side * 7, 0], [side * 15, -7], [side * 26, 6], [side * 36, 0]);
    brush(g, [...tail, ...spiral([side * 36, 4.2], tail.at(-1), side * 0.95, 1.2).slice(1)], 2.2, 0.35, 0.5);
    leaf(g, side * 14, 0.5, side > 0 ? 0.55 : Math.PI - 0.55, 8, 2.2);
    dot(g, side * 46, 0, 1.4);
  }
  g.restore();
}

// ---- the frame -----------------------------------------------------------------------------------------------------------------

// A rectangle with its corners bitten out in a curve, as a path.
function notched(g, x0, y0, x1, y1, r) {
  g.beginPath();
  g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.quadraticCurveTo(x1 - r, y0 + r, x1, y0 + r);
  g.lineTo(x1, y1 - r); g.quadraticCurveTo(x1 - r, y1 - r, x1 - r, y1);
  g.lineTo(x0 + r, y1); g.quadraticCurveTo(x0 + r, y1 - r, x0, y1 - r);
  g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0 + r, y0 + r, x0 + r, y0); g.closePath();
}

// Draws the whole border for the page whose frame runs from (x0, y0) to (x1, y1).
function drawBorder(g, x0, y0, x1, y1) {
  g.save();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // the double line, with a gap where each fleuron sits (clipped out, so the paper shows through as it is)
  g.save();
  g.beginPath(); g.rect(x0 - 40, y0 - 40, x1 - x0 + 80, y1 - y0 + 80);
  for (const [x, y, w, h] of [[cx, y0, 84, 14], [cx, y1, 84, 14], [x0, cy, 14, 84], [x1, cy, 14, 84]]) g.rect(x - w / 2, y - h / 2, w, h);
  g.clip('evenodd');
  g.strokeStyle = INK; g.lineWidth = 1.9; notched(g, x0, y0, x1, y1, 15); g.stroke();
  g.lineWidth = 0.9; notched(g, x0 + 6, y0 + 6, x1 - 6, y1 - 6, 10); g.stroke();
  g.restore();
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.save(); g.translate(x, y); g.scale(sx, sy);
    arm(g);
    g.save(); g.transform(0, 1, 1, 0, 0, 0); arm(g); g.restore(); // the same, flowing down the side
    flower(g);
    g.restore();
  }
  for (const [x, y, turn] of [[cx, y0 + 3, 0], [cx, y1 - 3, 0], [x0 + 3, cy, Math.PI / 2], [x1 - 3, cy, Math.PI / 2]]) {
    g.save(); g.translate(x, y); g.rotate(turn);
    fleuron(g, turn ? 0.8 : 1);
    g.restore();
  }
  g.restore();
}

// ---- the damask on the leather ---------------------------------------------------------------------------------------------------

// One motif of the damask: a leaf with a diamond on top, a scroll curling away on each side, a small leaf below.
function motif(g) {
  leaf(g, 0, 9, -Math.PI / 2, 22, 4.4);
  diamond(g, 0, -17, 2.8);
  for (const side of [-1, 1]) {
    const tail = bezier([0, 7], [side * 9, 9], [side * 14, -2], [side * 9, -8], 18);
    brush(g, [...tail, ...spiral([side * 7, -7], tail.at(-1), side * 0.95, 1, 22).slice(1)], 2.1, 0.4, 0.5);
  }
  leaf(g, 0, 11, Math.PI / 2, 7, 2.6);
}

// A tone-on-tone damask over the box (x0, y0)-(x1, y1), in half-drop rows: pressed in (dark) with a faint lit edge, like blind embossing.
function damask(g, x0, y0, x1, y1, dark = 'rgba(32,4,2,0.3)', light = 'rgba(255,150,125,0.14)') {
  const across = 28, down = 17;
  for (const [fill, shift] of [[light, -0.9], [dark, 0]]) {
    g.fillStyle = fill;
    for (let row = 0, y = y0; y < y1 + down; row++, y += down) {
      for (let x = x0 + (row % 2 ? across / 2 : 0); x < x1 + across; x += across) { g.save(); g.translate(x + shift, y + shift); motif(g); g.restore(); }
    }
  }
}

module.exports = { drawBorder, fleuron, damask };
