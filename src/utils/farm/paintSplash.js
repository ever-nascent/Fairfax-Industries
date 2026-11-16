// The paint over an Item Violet painted in Descend (her replica; heroCard.js itemTile, only her copies: `replicas` on the run). 
// Nov 7: "much more effort", then his second reference picture (a flat vector spatter frame; round 1's "a line with a dot" was rejected).
// Built by a design panel (4 designers, 3 judges, a refine and an art director's pass), . About 3 ms a 100 px tile.
// Violet's replica: a flat paint-spatter frame over an item tile, after separate ragged splats hugging the
// edges and corners (each its own blot, with white between them), arms and fingers radiating out of them, small paler specks inside,
// white knocked through their inner side where they break up, and a long cloud of small flecks (teardrops, slivers, shards, mostly
// tiny) flying in toward a clean middle. Drawn with paths only, seeded only by the item name.
const TAU = Math.PI * 2;
const C = {
  magenta: '#e5127f', purple: '#5b4ea3', lilac: '#9f6db0', mauve: '#c77fae', orange: '#f28e23', redorange: '#e9482a',
  yellow: '#f6b41a', peach: '#f9c66c', ygreen: '#c9d834', cyan: '#2fb2e6', lightblue: '#a2d3f1', teal: '#35b07e',
  coral: '#f47b58', cream: '#fbe7a4', paleyellow: '#f7dd78', palepink: '#f3bedb', lavender: '#c8b6e6',
};
// The reference's composition, clockwise from the top-left corner: [x, y] (fractions of the tile), size (fraction of the short side),
// colour, the paler specks inside it, how much it sprays.
const TEMPLATE = [
  [0.00, 0.03, 0.140, 'magenta', ['palepink', 'lilac'], 0.5],
  [0.07, 0.10, 0.231, 'purple', ['lightblue', 'lilac'], 1.5],
  [0.25, 0.00, 0.119, 'orange', ['peach', 'cream'], 1.0],
  [0.42, 0.00, 0.085, 'peach', ['orange', 'cream'], 0.8],
  [0.60, 0.00, 0.105, 'cyan', ['lightblue', 'ygreen'], 0.9],
  [0.75, 0.05, 0.091, 'ygreen', ['paleyellow', 'cream'], 2.0],
  [0.96, 0.00, 0.126, 'orange', ['peach', 'lightblue'], 0.8],
  [1.00, 0.16, 0.119, 'lilac', ['lightblue', 'lavender'], 1.0],
  [1.00, 0.38, 0.126, 'magenta', ['mauve', 'peach'], 1.2],
  [1.00, 0.52, 0.070, 'orange', ['teal', 'paleyellow'], 0.6],
  [1.00, 0.64, 0.091, 'paleyellow', ['cream', 'ygreen'], 0.9],
  [1.00, 0.77, 0.091, 'lightblue', ['cream', 'teal'], 0.9],
  [0.93, 0.97, 0.231, 'redorange', ['lightblue', 'cream', 'lightblue', 'peach'], 1.5],
  [0.66, 1.00, 0.085, 'orange', ['paleyellow', 'cream'], 0.8],
  [0.44, 1.00, 0.105, 'cyan', ['lightblue', 'redorange'], 1.2],
  [0.24, 1.00, 0.111, 'orange', ['yellow', 'cream'], 1.0],
  [0.03, 0.99, 0.126, 'redorange', ['peach', 'magenta'], 0.8],
  [0.00, 0.81, 0.099, 'mauve', ['magenta', 'lavender'], 1.1],
  [0.00, 0.63, 0.119, 'magenta', ['palepink', 'mauve'], 1.2],
  [0.00, 0.45, 0.091, 'coral', ['peach', 'redorange'], 1.5],
  [0.00, 0.28, 0.099, 'lilac', ['lightblue', 'palepink'], 0.9],
];
// which zones a smaller tile keeps (fewer, bigger blots read better at 100 px)
const SMALL = [1, 4, 6, 8, 12, 14, 16, 18];
const MEDIUM = [0, 1, 2, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 19];
const CORNERS = [1, 12];
const STRONG = new Set(['purple', 'magenta', 'redorange', 'orange', 'cyan']);
// a small tile swaps a pale colour for its strong cousin (pale paint vanishes into the cream shop art there)
const BOLD = { peach: 'orange', paleyellow: 'yellow', lightblue: 'cyan', lavender: 'lilac', mauve: 'magenta', coral: 'redorange', ygreen: 'ygreen' };
// the paler, slightly muted spray a splat throws further out (the reference's mauve flecks out of magenta)
const PALER = { magenta: 'mauve', purple: 'lilac', lilac: 'lavender', orange: 'peach', redorange: 'coral', yellow: 'paleyellow', cyan: 'lightblue', mauve: 'palepink', ygreen: 'paleyellow', coral: 'peach', peach: 'cream', paleyellow: 'cream', lightblue: 'lavender' };

function paintOverlay(g, x, y, w, h, name) {
  let st = 2166136261;
  for (const ch of String(name)) st = Math.imul(st ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a, b) => a + rnd() * (b - a);
  const s = Math.min(w, h);
  const small = s < 150, medium = !small && s < 300;
  const MIN = small ? 0.75 : 0.55; // smallest fleck radius in real pixels
  const lod = Math.min(1, Math.sqrt(s / 700)); // a small tile throws fewer specks: they would only read as grain
  const k01 = Math.max(0, Math.min(1, (lod - 0.378) / 0.622)); // 0 at a 100 px tile, 1 at the 706 px frame
  const capHard = 0.17 + 0.11 * k01, capSoft = capHard * 0.7; // how far in the paint reaches (fraction of the short side)
  const big2 = small ? 1.6 : medium ? 1.2 : 1; // a small tile throws fewer, bigger flecks: they read as paint, not grain
  const mx = x + w / 2, my = y + h / 2;
  const edge = (px, py) => Math.min(px - x, x + w - px, py - y, y + h - py) / s;

  // per item: one of four layouts that keep the heavy corners on the top-left / bottom-right diagonal (the top-right stays light:
  // the Hero card's tier tab sits there), now and then the colours turned along the ring, every splat nudged and weighted
  const variant = Math.floor(rnd() * 4);
  const N = TEMPLATE.length;
  let shift = 0;
  if (rnd() > 0.35) {
    const shifts = [];
    for (let k = 1; k < N; k++) if (CORNERS.every((i) => STRONG.has(TEMPLATE[(i + k) % N][3]))) shifts.push(k);
    shift = shifts[Math.floor(rnd() * shifts.length)];
  }
  const heavy = rnd() < 0.5 ? 1 : 12; // the one corner that gets the most paint
  const keep = small ? SMALL : medium ? MEDIUM : null;
  const grow = small ? 1.3 : medium ? 1.1 : 1;
  const zones = [];
  TEMPLATE.forEach((z, i) => {
    const src = TEMPLATE[(i + shift) % N];
    const along = between(-0.025, 0.025), sz = between(0.7, 1.05), quiet = rnd(); // drawn for every zone, so the seed stays in step
    if (keep && !keep.includes(i)) return;
    const corner = CORNERS.includes(i);
    if (!corner && quiet < (keep ? 0.12 : 0.08)) return; // a quiet stretch of edge now and then
    let zx = z[0], zy = z[1];
    if (variant === 1) { zx = 1 - zx; zy = 1 - zy; } else if (variant === 2) { [zx, zy] = [zy, zx]; } else if (variant === 3) { [zx, zy] = [1 - zy, 1 - zx]; }
    if (zx < 0.05 || zx > 0.95) zy += along; else zx += along;
    const cx = x + zx * w, cy = y + zy * h;
    // flying inward: away from the nearest edge, leaning toward the middle
    const nx = zx < 0.05 ? 1 : zx > 0.95 ? -1 : 0, ny = zy < 0.05 ? 1 : zy > 0.95 ? -1 : 0;
    const toMid = Math.atan2(my - cy, mx - cx);
    const inward = nx || ny ? Math.atan2(ny + Math.sin(toMid) * 0.8, nx + Math.cos(toMid) * 0.8) : toMid;
    const R = z[2] * s * sz * (corner ? 1 : grow) * (i === heavy ? 1.12 : corner ? 0.92 : 1);
    let col = src[3];
    if (small && BOLD[col]) col = BOLD[col];
    zones.push({ cx, cy, R, col, tints: src[4], spray: z[5] * between(0.75, 1.25) * (i === heavy ? 1.2 : 1), inward, corner });
  });

  // shapes, batched by layer and colour: each entry is [kind, points]; layer 0 = bodies (holes knocked through), 1 = tints, 2 = spray
  const layers = [new Map(), new Map(), new Map()];
  const holes = [];
  const put = (layer, col, shape) => {
    const m = layers[layer];
    let l = m.get(col);
    if (!l) m.set(col, (l = []));
    l.push(shape);
  };
  // a ragged blob: a wobbly outline with many lobes, notches and nicks, as a closed curve through points
  const blob = (cx, cy, R, rag) => {
    const n = Math.max(7, Math.min(64, Math.round(R * 1.3)));
    const p0 = rnd() * TAU, p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU;
    const a0 = 0.1 * rag * between(0.4, 1.4), a1 = 0.08 * rag * between(0.4, 1.4), a2 = 0.05 * rag * between(0.4, 1.4), a3 = 0.04 * rag;
    const pts = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      let r = R * (1 + a0 * Math.sin(2 * a + p0) + a1 * Math.sin(3 * a + p1) + a2 * Math.sin(5 * a + p2) + a3 * Math.sin(13 * a + p3) + (rnd() - 0.5) * 0.18 * rag);
      const q = rnd();
      if (q < 0.1 * rag) r *= between(0.72, 0.86); else if (q < 0.17 * rag) r *= between(1.1, 1.28);
      pts[i * 2] = cx + Math.cos(a) * r; pts[i * 2 + 1] = cy + Math.sin(a) * r;
    }
    return [1, pts];
  };
  // an arm: a finger of paint jutting out of a splat, a little bulge then a long taper to a point, slightly bent
  const arm = (cx, cy, ang, len, wid) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), bend = between(-0.3, 0.3) * wid;
    const pts = [];
    const at = (u, v) => pts.push(cx + u * ca - v * sa, cy + u * sa + v * ca);
    at(-wid * 1.2, 0); at(0, -wid); at(len * 0.3, -wid * between(0.7, 0.95) + bend * 0.3); at(len * 0.65, -wid * 0.42 + bend);
    at(len, bend * 1.6); at(len * 0.65, wid * 0.42 + bend); at(len * 0.3, wid * between(0.7, 0.95) + bend * 0.3); at(0, wid);
    return [1, pts];
  };
  // a fleck flying at angle ang, radius r: a teardrop, a sliver, an almond or a shard, stretched along its flight
  const fleck = (cx, cy, r, ang, stretch, mix) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pts = [];
    const at = (u, v) => pts.push(cx + u * ca - v * sa, cy + u * sa + v * ca);
    if (r < 1.1) { // too small for its shape to show: a little irregular sliver-ish pentagon, along its flight
      const L = r * between(1.1, 1.4 + stretch * 0.7), W = r * between(0.6, 0.9);
      at(L, 0); at(L * 0.15, W); at(-L * 0.8, W * 0.5); at(-L * 0.9, -W * 0.4); at(L * 0.2, -W);
      return [0, pts];
    }
    const kind = rnd() * (mix || 1);
    if (kind < 0.2) { // teardrop: a rounded head flying ahead, a short pointed tail back toward where it came from
      const tail = r * between(1.25, 1.7 + stretch * 0.5);
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 5) * Math.PI; at(Math.cos(a) * r, Math.sin(a) * r * 0.9); }
      at(-tail * 0.45, r * 0.5); at(-tail, (rnd() - 0.5) * r * 0.4); at(-tail * 0.45, -r * 0.5);
      return [1, pts];
    }
    if (kind < 0.3) { // a sliver, pointed at both ends (at most about 3:1, never a stick)
      const L = r * between(1.5, 2 + stretch * 0.4), W = r * between(0.5, 0.7);
      at(L, 0); at(L * 0.15, W); at(-L, (rnd() - 0.5) * W * 0.4); at(-L * 0.1, -W);
      return [0, pts];
    }
    // an irregular piece: a lumpy, notched outline with a point or two, stretched a little along its flight
    const n = 5 + Math.floor(rnd() * 3), asp = 1 + stretch * between(0, 0.6), off = rnd() * TAU, sharp = kind < 0.6;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU + (rnd() - 0.5) * (TAU / n) * 0.7, rr = r * (rnd() < 0.2 ? between(1.2, 1.55) : between(0.5, 1.05));
      at(Math.cos(a) * rr * asp, (Math.sin(a) * rr) / Math.sqrt(asp));
    }
    return [sharp ? 0 : 1, pts];
  };
  // too small to show: keep some at the smallest size, so the same paint lands on average (fewer on a small tile)
  const size = (r) => (r >= MIN ? r : rnd() < (r / MIN) ** 2 * (small ? 0.5 : 1) ? MIN : 0);
  const reach = (px, py, r) => { const e = edge(px, py); return !(e > capHard || (e > capSoft && rnd() < 0.7) || e < -r); };

  for (const z of zones) {
    const { cx, cy, R, inward } = z;
    const Rn = R / (0.1 * s);
    const dirs = (spread) => inward + (rnd() - 0.5) * spread;
    const paler = PALER[z.col] || z.col;
    // the body: a core plus a few overlapping drops, mostly along the edge, so the outline is many-lobed
    put(0, z.col, blob(cx - Math.cos(inward) * R * 0.08, cy - Math.sin(inward) * R * 0.08, R * 0.5, 1.3));
    for (const side of [-1, 1]) { // wider along the edge than it reaches in
      const a = inward + side * Math.PI / 2;
      put(0, z.col, blob(cx + Math.cos(a) * R * between(0.3, 0.45) - Math.cos(inward) * R * 0.12, cy + Math.sin(a) * R * between(0.3, 0.45) - Math.sin(inward) * R * 0.12, R * between(0.36, 0.46), 1.4));
    }
    const drops = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < drops; i++) {
      const a = dirs(3.8), d = R * between(0.25, 0.65);
      put(0, z.col, blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * between(0.1, 0.27) * (1 - d / R / 2), 1.7));
    }
    for (const side of [-1, 1]) { // along the edge a little way, tapering off: the blot stays its own
      for (const [d0, d1, r0, r1] of [[0.55, 0.85, 0.392, 0.4], [1.0, 1.35, 0.16, 0.26]]) {
        const a = inward + side * Math.PI / 2 + (rnd() - 0.5) * 0.5, d = R * between(d0, d1);
        put(0, z.col, blob(cx + Math.cos(a) * d - Math.cos(inward) * R * 0.25, cy + Math.sin(a) * d - Math.sin(inward) * R * 0.25, R * between(r0, r1), 1.6));
      }
    }
    // arms and fingers radiating out of it, long and short, some with a fleck flying on past the tip
    const arms = Math.round((small ? 3 : 5) + rnd() * (small ? 3 : 6) * Math.min(1.5, Rn));
    for (let i = 0; i < arms; i++) {
      const a = dirs(3.3), d = R * between(0.3, 0.5), len = R * between(0.25, 0.7) * (rnd() < 0.25 ? 1.15 : 1);
      const wid = Math.max(small ? 1.4 : 1, R * between(0.06, 0.11));
      const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d, aa = a + (rnd() - 0.5) * 0.25;
      put(0, z.col, arm(bx, by, aa, len, wid));
      if (rnd() < 0.5) { // a piece that broke off the tip, smaller than the arm is wide, flying on
        const e = d + len + R * between(0.06, 0.2), r = size(wid * between(0.4, 0.8));
        if (r) put(2, z.col, fleck(cx + Math.cos(aa) * e, cy + Math.sin(aa) * e, r, aa, 1.2, 0.6));
      }
    }
    // where the splat breaks up: ragged chunks of every size from its edge a little way out, lined up along the ways they flew
    const nc = Math.round(70 * z.spray * Math.min(2.5, Rn) * lod / big2);
    const bands = [];
    for (let i = 0; i < 7; i++) bands.push(dirs(3.3));
    for (let i = 0; i < nc; i++) {
      const a = rnd() < 0.6 ? bands[i % 7] + (rnd() - 0.5) * 0.35 : dirs(3.4), k = rnd() ** 1.3, d = R * (0.55 + 0.8 * k);
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const r0 = R * (0.015 + 0.075 * rnd() ** 2.2) * (1.15 - k * 0.6) * big2;
      if (!reach(px, py, r0)) continue;
      const r = size(r0);
      if (!r) continue;
      put(0, z.col, r > R * 0.045 ? blob(px, py, r, 1.9) : fleck(px, py, r, a + (rnd() - 0.5) * 0.6, 0.6));
    }
    // white knocked through the body where it breaks up (more toward its inner side; the outermost strip stays solid)
    const nhole = Math.round(between(26, 38) * Math.min(3, Rn) * Math.sqrt(lod) * (small ? 0.3 : medium ? 0.9 : 1.6));
    for (let i = 0; i < nhole; i++) {
      const a = dirs(3.6), d = R * (0.2 + 0.85 * rnd() ** 0.55);
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      if (edge(px, py) < 0.035) continue;
      const r = Math.max(small ? 1.3 : 0.8, R * between(0.012, 0.05) * (0.5 + d / R));
      holes.push(rnd() < 0.6 ? blob(px, py, r, 1.6) : fleck(px, py, r, a + (rnd() - 0.5) * 0.8, 0.5));
    }
    // paler specks inside it: small, on a dominant body colour (a corner splat now and then gets one bigger drop)
    let rounds = z.corner && !small && z.tints.includes('cream') && rnd() < 0.7 ? 1 : 0; // the reference's big cream drops sit in its red corner
    const nt = Math.round(between(26, 40) * Math.min(3, Rn) * lod * (small ? 0.5 : 1));
    for (let i = 0; i < nt; i++) {
      const a = rnd() * TAU, d = R * Math.sqrt(rnd()) * 0.8;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const r = size(R * (0.01 + 0.03 * rnd() ** 3));
      if (!r || edge(px, py) < -r) continue;
      const col = z.tints[Math.floor(rnd() * z.tints.length)];
      if (rounds > 0 && d < R * 0.5) { rounds--; put(1, col, blob(px, py, R * between(0.08, 0.11), 0.6)); continue; }
      put(1, col, r < 1.4 ? fleck(px, py, r, rnd() * TAU, 0.3) : blob(px, py, r, 1.3));
    }
    // the spray: jets, clusters and a loose fan, plus some flying sideways into the neighbours' paint; a few chunky pieces right at
    // the splat, then mostly small and tiny flecks, thinning out on a long tail toward the middle, the far ones often paler
    const jets = [];
    for (let i = 0; i < 6; i++) jets.push(dirs(2.6));
    const clusters = [];
    for (let i = 0; i < 7; i++) { const a = dirs(3.0), d = R * (0.9 + -Math.log(1 - rnd() * 0.95) * 0.7); clusters.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, a]); }
    const nf = Math.round(1500 * z.spray * Math.min(2.2, Rn) * lod ** 1.6 / big2 ** 1.3);
    const paleShare = small ? 0.06 : 0.25;
    for (let i = 0; i < nf; i++) {
      const mode = rnd();
      let px, py, a, t;
      if (mode < 0.22) { // a cluster: a tight clump
        const c = clusters[i % 7], sd = R * 0.18, u = Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)), v = rnd() * TAU;
        px = c[0] + Math.cos(v) * u * sd; py = c[1] + Math.sin(v) * u * sd; a = c[2]; t = Math.hypot(px - cx, py - cy) / R - 0.6;
      } else {
        if (mode < 0.76) a = jets[i % 6] + (rnd() - 0.5) * 0.55;
        else if (mode < 0.82) a = inward + (rnd() < 0.5 ? -1 : 1) * between(1.1, 1.55); // sideways, into the neighbours
        else a = dirs(2.6);
        t = -Math.log(1 - rnd() * 0.99) * (mode < 0.7 ? 0.8 : 0.5);
        const d = R * (0.5 + t);
        px = cx + Math.cos(a) * d; py = cy + Math.sin(a) * d;
      }
      t = Math.max(0, t);
      const near = Math.max(0, 1 - t * 1.4); // right at the splat: bigger pieces
      const r0 = s * (0.0014 + 0.0055 * rnd() ** 3 + 0.008 * near * rnd() ** 2) * Math.max(0.4, 1 - t * 0.3) * big2;
      if (!reach(px, py, r0)) continue;
      const r = size(r0);
      if (!r) continue;
      const q = rnd();
      const col = q < 0.05 ? z.tints[Math.floor(rnd() * z.tints.length)] : q < 0.05 + paleShare * Math.min(1, t * 0.8) ? paler : z.col;
      put(2, col, fleck(px, py, r, a + (rnd() - 0.5) * 0.9, r < 2.2 ? 0.25 : 0.7));
    }
  }

  const trace = (sh) => {
    const pts = sh[1], n = pts.length / 2;
    if (sh[0] === 0) { // straight-sided
      g.moveTo(pts[0], pts[1]);
      for (let i = 1; i < n; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
    } else { // curved through the midpoints
      g.moveTo((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
      for (let i = 1; i <= n; i++) {
        const j = (i % n) * 2, k = ((i + 1) % n) * 2;
        g.quadraticCurveTo(pts[j], pts[j + 1], (pts[j] + pts[k]) / 2, (pts[j + 1] + pts[k + 1]) / 2);
      }
    }
    g.closePath();
  };
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowColor = 'transparent'; g.shadowBlur = 0; g.filter = 'none';
  // the bodies, through a clip with the holes cut out of it (even-odd: the tile's rectangle minus every hole)
  g.save();
  g.beginPath(); g.rect(x, y, w, h);
  for (const sh of holes) trace(sh);
  g.clip('evenodd');
  for (const [col, list] of layers[0]) { g.beginPath(); for (const sh of list) trace(sh); g.fillStyle = C[col]; g.fill('nonzero'); }
  g.restore();
  // then the tints and the spray, one path per colour and layer, filled once
  for (const m of [layers[1], layers[2]]) {
    for (const [col, list] of m) { g.beginPath(); for (const sh of list) trace(sh); g.fillStyle = C[col]; g.fill('nonzero'); }
  }
  g.restore();
  g.beginPath(); // leave no path of ours behind
}

module.exports = { paintOverlay };
