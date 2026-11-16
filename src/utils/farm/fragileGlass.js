// The broken glass over a Fragile Item's picture (Descend's Broker; after picture of a shattered pane).
// Drawn by code, never from a picture. A panel of three designers drew candidates from the reference, a judge picked the cleanest at the
// 100 px Hero card tile as the base, its hole and rim were improved, and he then picked the looks he likes by seeing them on four items
// ("I liked how all of these looked except for 2, just use those with no rotation changes").
// So there are exactly THREE looks, fixed: the glass this drawing makes for the seeds in LOOKS (Extra Health, Mystic Burst, Close Quarters),
// always at that orientation, never turned or re-rolled. An item gets one of the three by its name (FNV-1a), so different items still
// differ a little. What drawGlass makes: the item greyed a bit (a 45-degree gradient like the Enhanced one: colour drained, strongest
// bottom-left); hairline cracks as filled tapered ribbons (sharp kinks, Y forks, fading to hairlines) over a thin dark edge so they show on
// pale art; a few broken arcs; one or two pale shard wedges; then the hole: off-centre, lopsided, thin dark spikes, see-through on its lit
// side, a broken white rim with chipped bands and a few chips. Used by itemArt.js (crackOverlay, crackedPicture: the Hero card tile and the
// Broker's stall picture). About 1.3 ms a 192 px draw.
function drawGlass(g, x, y, w, h, seed) {
  // Seeded PRNG: FNV-1a hash of the seed -> mulberry32. Same name, same glass.
  let st = 2166136261;
  for (const c of String(seed)) st = Math.imul(st ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a, b) => a + rnd() * (b - a);
  const s = Math.min(w, h);
  const px = s / 100; // 1 at the 100 px tile
  const big = s > 150; // the 192 px picture gets the finer details
  const TAU = Math.PI * 2;
  const wrap = (a) => ((a % TAU) + TAU) % TAU;
  const angGap = (p, q) => Math.abs(wrap(p - q + Math.PI) - Math.PI); // 0..PI

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();

  // Grey-out, strongest bottom-left, fading to the top-right (like the enhanced overlay): mostly a loss of colour,
  // with a light neutral wash on top, so dark art keeps its contrast.
  const half = (w + h) / 4;
  const greyOut = (op, a0, a1) => {
    const gr = g.createLinearGradient(x + w / 2 - half, y + h / 2 + half, x + w / 2 + half, y + h / 2 - half);
    gr.addColorStop(0.2, `rgba(128,132,140,${a0})`);
    gr.addColorStop(0.8, `rgba(128,132,140,${a1})`);
    g.globalCompositeOperation = op;
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  };
  greyOut('saturation', 0.6, 0.1);
  greyOut('source-over', 0.25, 0.04);
  g.globalCompositeOperation = 'source-over';

  // The hole: off-centre, a lopsided two-lobed blob with a few bites and 2-4 thin dark spikes.
  const oa = rnd() * TAU, od = s * between(0.07, 0.13);
  const cx = x + w / 2 + Math.cos(oa) * od;
  const cy = y + h / 2 + Math.sin(oa) * od;
  const r0 = s * between(0.092, 0.108);
  const p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU;
  const e1 = between(0.2, 0.32), e2 = between(0.14, 0.24), e3 = between(0.05, 0.1);
  const blob = (a) => r0 * (1 + e1 * Math.sin(a + p1) + e2 * Math.sin(2 * a + p2) + e3 * Math.sin(3 * a + p3));

  // Spikes: jittered so never evenly spread, never straight opposite, never overlapping (an overlapping one is
  // dropped, so a hole can end up with a single spike).
  const spikes = [];
  const nSpikes = 2 + Math.floor(rnd() * 3);
  const sp0 = rnd() * TAU;
  const [mLo, mHi, mLong] = big ? [2.2, 3.0, 3.4] : [2.0, 2.6, 3.0];
  let long = false; // at most one long spike
  for (let k = 0; k < nSpikes; k++) {
    let a = wrap(sp0 + (k / nSpikes) * TAU + (rnd() - 0.5) * 1.2);
    const sh = between(0.09, 0.16);
    let m = between(mLo, mHi);
    if (!long && rnd() < 0.35) { m = between(mHi, mLong); long = true; }
    if (nSpikes === 2 && k === 1 && angGap(a, spikes[0].a) > Math.PI - 0.3) a = wrap(a + (rnd() < 0.5 ? -0.4 : 0.4));
    if (spikes.some((p) => angGap(a, p.a) < p.half + sh + 0.15)) continue;
    spikes.push({ a, half: sh, len: blob(a) * m });
  }
  const N = 16;
  const verts = [];
  let bite = 0; // a bite pulls two neighbouring vertices in together
  for (let i = 0; i < N; i++) {
    const a = wrap(((i + (rnd() - 0.5) * 0.9) / N) * TAU);
    if (spikes.some((p) => angGap(a, p.a) < p.half + 0.06)) { bite = 0; continue; } // the spike takes this stretch
    if (!bite && rnd() < 0.15) bite = 2;
    const r = blob(a) * (bite ? between(0.6, 0.8) : between(0.95, 1.05));
    if (bite) bite--;
    verts.push({ a, r });
  }
  for (const p of spikes) { // a thin sliver: a slight kink on each flank (opposite sides), a sharp tip
    const b = blob(p.a), side = rnd() < 0.5 ? 1 : -1;
    verts.push({ a: wrap(p.a - p.half), r: b * 1.03, base: p });
    verts.push({ a: wrap(p.a - p.half * 0.3 * side), r: b + (p.len - b) * 0.45, spike: true });
    verts.push({ a: p.a, r: p.len, spike: true, tip: true });
    verts.push({ a: wrap(p.a + p.half * 0.2 * side), r: b + (p.len - b) * 0.6, spike: true, after: true });
    verts.push({ a: wrap(p.a + p.half), r: b * 1.03, base: p });
  }
  verts.sort((p, q) => p.a - q.a);
  for (const v of verts) { v.x = cx + Math.cos(v.a) * v.r; v.y = cy + Math.sin(v.a) * v.r; }
  const NV = verts.length;
  const body = verts.filter((v) => !v.spike);
  const holeR = (a) => { // the hole's radius towards angle a, ignoring the spikes (linear between vertices)
    a = wrap(a);
    for (let i = 0; i < body.length; i++) {
      const p = body[i], q = body[(i + 1) % body.length];
      const qa = i + 1 === body.length ? q.a + TAU : q.a;
      const aa = a < p.a ? a + TAU : a;
      if (aa >= p.a && aa <= qa) return p.r + (q.r - p.r) * ((aa - p.a) / (qa - p.a || 1));
    }
    return r0;
  };
  const nearSpike = (a, pad) => spikes.some((p) => angGap(a, p.a) < p.half + pad);
  const polygon = (pts) => { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); };

  // Distance from the centre to the square's edge along angle a.
  const toEdge = (a) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const tx = dx > 0 ? (x + w - cx) / dx : dx < 0 ? (x - cx) / dx : Infinity;
    const ty = dy > 0 ? (y + h - cy) / dy : dy < 0 ? (y - cy) / dy : Infinity;
    return Math.min(tx, ty);
  };

  // A crack: a polyline of few, nearly straight segments with sharp kinks; an optional steady curl bends it. Its
  // heading never strays more than `clamp` from `dir`, so neighbouring cracks don't cross.
  const crack = (sx, sy, dir, len, segs, wobble, clamp = 0.4, curl = 0) => {
    const pts = [[sx, sy]];
    let off = 0;
    const parts = Array.from({ length: segs }, () => between(0.6, 1.4));
    const sum = parts.reduce((t, v) => t + v, 0);
    for (const p of parts) {
      off = Math.max(-clamp, Math.min(clamp, off + curl + (rnd() - 0.5) * wobble));
      const L = (p / sum) * len;
      const [lx, ly] = pts[pts.length - 1];
      pts.push([lx + Math.cos(dir + off) * L, ly + Math.sin(dir + off) * L]);
    }
    return pts;
  };

  // Tapered ribbon along a polyline: half-width hw0 at the start to hw1 at the end.
  const ribbon = (pts, hw0, hw1, extra = 0) => {
    const n = pts.length;
    const lens = [0];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[n - 1] || 1;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const p = pts[i];
      // miter normal: average of the neighbouring segment normals
      let nx = 0, ny = 0;
      if (i > 0) { const dx = p[0] - a[0], dy = p[1] - a[1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
      if (i < n - 1) { const dx = b[0] - p[0], dy = b[1] - p[1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const t = lens[i] / total;
      const hw = hw0 + (hw1 - hw0) * Math.pow(t, 0.7) + extra;
      left.push([p[0] + nx * hw, p[1] + ny * hw]);
      right.push([p[0] - nx * hw, p[1] - ny * hw]);
    }
    g.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) g.lineTo(left[i][0], left[i][1]);
    for (let i = n - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
  };

  // Radial cracks: unevenly spaced (clustered, with a minimum gap), from the rim and every spike tip.
  const nRad = Math.round(7 + s / 24); // 11 at 100 px, 15 at 192
  const gaps = Array.from({ length: nRad }, () => 0.6 + Math.pow(rnd(), 2.2) * 2);
  const gsum = gaps.reduce((t, v) => t + v, 0);
  let acc = rnd() * TAU;
  const angles = gaps.map((gp) => wrap(acc += (gp / gsum) * TAU));
  const fromTip = new Map(); // angle index -> the spike whose tip it starts at
  for (const p of spikes) {
    let best = -1;
    angles.forEach((a, i) => { if (!fromTip.has(i) && (best < 0 || angGap(a, p.a) < angGap(angles[best], p.a))) best = i; });
    angles[best] = p.a;
    fromTip.set(best, p);
  }
  // each radial's gap to its neighbours (after the tip angles moved): prev = clockwise, next = counter-clockwise
  const order = angles.map((a, i) => i).sort((p, q) => angles[p] - angles[q]);
  const nb = new Map();
  order.forEach((ai, k) => {
    const prev = angles[order[(k - 1 + nRad) % nRad]], next = angles[order[(k + 1) % nRad]];
    nb.set(ai, { prev: wrap(angles[ai] - prev), next: wrap(next - angles[ai]) });
  });
  const lines = []; // { pts, hw0, hw1, alpha }
  const radials = [];
  const base = 0.3 + 0.3 * px; // root half-width: 1.2 px wide at 100 px, 1.75 at 192
  const farHw = 0.45; // far ends: a 0.9 px hairline at either size
  angles.forEach((a, ai) => {
    const tip = fromTip.get(ai);
    const { prev, next } = nb.get(ai);
    const clamp = Math.min(0.4, 0.45 * Math.min(prev, next));
    const r = tip ? tip.len : holeR(a) * (rnd() < 0.2 ? between(1.15, 1.5) : 1); // a few start just off the rim
    const sx = cx + Math.cos(a) * r, sy = cy + Math.sin(a) * r;
    const D = Math.max(toEdge(a) - r, s * 0.05);
    const reach = rnd() < 0.55;
    const len = reach ? D * 1.25 : D * between(0.35, 0.85);
    const segs = 2 + Math.floor(rnd() * 2) + (big ? 1 : 0) + (rnd() < 0.3 ? 1 : 0);
    const curl = rnd() < 0.4 ? between(-0.15, 0.15) : 0; // some bend steadily
    const pts = crack(sx, sy, a, len, segs, 0.8, clamp, curl);
    const alpha = big ? between(0.62, 1) : between(0.75, 1);
    const hw0 = base * between(0.85, 1.25);
    lines.push({ pts, hw0, hw1: reach ? Math.max(farHw, hw0 * 0.2) : 0, alpha });
    radials.push({ a, pts });
    const roomy = Math.max(prev, next);
    if (rnd() < 0.42 && pts.length > 2 && roomy > 0.5) { // a Y fork near the end, towards the roomier side
      const j = Math.max(1, pts.length - 2 - Math.floor(rnd() * 2));
      const [fx, fy] = pts[j];
      const fd = Math.atan2(pts[j + 1][1] - fy, pts[j + 1][0] - fx) + (next >= prev ? 1 : -1) * between(0.3, 0.6);
      lines.push({ pts: crack(fx, fy, fd, len * between(0.18, 0.32), 2, 0.5), hw0: hw0 * 0.6, hw1: 0, alpha: alpha * 0.85 });
    }
  });
  // A tuft of short bright cracks fanning out of each spike tip.
  for (const p of spikes) {
    const tx = cx + Math.cos(p.a) * p.len, ty = cy + Math.sin(p.a) * p.len;
    const n = big ? 2 + Math.floor(rnd() * 2) : 2;
    for (let k = 0; k < n; k++) {
      const d = p.a + (k % 2 ? 1 : -1) * between(0.15, 0.4);
      lines.push({ pts: crack(tx, ty, d, s * between(0.05, 0.12), 2, 0.4), hw0: base * 0.8, hw1: 0, alpha: between(0.8, 1) });
    }
  }
  // Short cracks between the radials near the hole; their roots start inside the hole and are clipped away.
  const nShort = big ? Math.round(3 + s / 40) : 2;
  for (let i = 0; i < nShort; i++) {
    const a = rnd() * TAU;
    const r = holeR(a) * 0.97;
    lines.push({ pts: crack(cx + Math.cos(a) * r, cy + Math.sin(a) * r, a, s * between(0.05, 0.13), 2, 0.6), hw0: base * 0.7, hw1: 0, alpha: between(0.55, 0.85) });
  }

  // Connecting arcs: short, angular (one kink), at uneven radii, densest near the hole where they cut small shards.
  const sorted = radials.slice().sort((p, q) => p.a - q.a);
  const atRadius = (pts, R) => { // where a crack crosses distance R from the centre
    for (let i = 1; i < pts.length; i++) {
      const d0 = Math.hypot(pts[i - 1][0] - cx, pts[i - 1][1] - cy), d1 = Math.hypot(pts[i][0] - cx, pts[i][1] - cy);
      if (d0 <= R && d1 >= R) {
        const t = (R - d0) / (d1 - d0 || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
    }
    return null;
  };
  const rings = big ? [between(1.4, 1.8), 2.4, 3.6, 5.4] : [between(1.4, 1.8), 2.6];
  rings.forEach((k, ri) => {
    const R = r0 * k * (ri ? between(0.8, 1.2) : 1);
    let prev = false;
    for (let i = 0; i < sorted.length; i++) {
      const skip = ri === 0 ? rnd() < (big ? 0.3 : 0.45) : rnd() > (prev ? 0.15 : 0.45);
      prev = false;
      if (skip) continue;
      const A = sorted[i], B = sorted[(i + 1) % sorted.length];
      const R2 = R * between(0.82, 1.18);
      let P = atRadius(A.pts, R), Q = atRadius(B.pts, R2);
      if (!P || !Q) continue;
      const a0 = Math.atan2(P[1] - cy, P[0] - cx);
      const span = wrap(Math.atan2(Q[1] - cy, Q[0] - cx) - a0);
      if (span > 1.1 || span < 0.08) continue;
      const am = a0 + span * between(0.35, 0.65);
      const Rm = ((R + R2) / 2) * between(0.95, 1.12);
      const M = [cx + Math.cos(am) * Rm, cy + Math.sin(am) * Rm];
      // broken: an arc may stop short of either crack
      if (rnd() < 0.4) { const t = between(0.15, 0.5); P = [P[0] + (M[0] - P[0]) * t, P[1] + (M[1] - P[1]) * t]; }
      else if (rnd() < 0.3) { const t = between(0.15, 0.5); Q = [Q[0] + (M[0] - Q[0]) * t, Q[1] + (M[1] - Q[1]) * t]; }
      const hw0 = base * 0.8;
      lines.push({ pts: [P, M, Q], hw0, hw1: hw0 * 0.75, alpha: between(0.75, 1) });
      prev = true;
    }
  });

  // Everything up to the hole is clipped to outside it, so no crack root or wedge shows through the see-through fill.
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  polygon(verts);
  g.clip('evenodd');

  // 1) Dark edges under the cracks and arcs (crisp, not a shadow: same shape, slightly wider).
  g.fillStyle = 'rgba(12,14,20,0.2)';
  g.beginPath();
  for (const l of lines) ribbon(l.pts, l.hw0, l.hw1, 0.35);
  g.fill();

  // 2) Pale shard wedges between neighbouring crack starts: 1 (2 at 192), never side by side, never across a spike.
  const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  let nWedges = 0, lastWedge = -9;
  const off0 = Math.floor(rnd() * sorted.length);
  for (let k = 0; k < sorted.length && nWedges < (big ? 2 : 1); k++) {
    const i = (off0 + k) % sorted.length;
    if (k - lastWedge < 2 || (lastWedge === 0 && k === sorted.length - 1)) continue;
    const a1 = sorted[i].a;
    const da = wrap(sorted[(i + 1) % sorted.length].a - a1);
    if (da > 1.3 || da < 0.3) continue;
    if (spikes.some((p) => wrap(p.a - a1) < da + p.half)) continue;
    lastWedge = k;
    const r1 = holeR(a1), r2 = holeR(a1 + da);
    const e1p = pt(a1, r1 * 0.9), e2p = pt(a1 + da, r2 * 0.9);
    const am = a1 + da * between(0.3, 0.7);
    const out = pt(am, holeR(am) + r0 * between(0.5, 0.9));
    const shape = rnd() < 0.5 ? [e1p, out, e2p] : [e1p, pt(a1 + da * 0.15, r1 + r0 * between(0.2, 0.4)), out, e2p];
    const al = between(0.38, 0.55);
    const lg = g.createLinearGradient(...pt(am, holeR(am)), ...out);
    lg.addColorStop(0, `rgba(240,246,255,${al.toFixed(2)})`);
    lg.addColorStop(1, `rgba(240,246,255,${(al * 0.45).toFixed(2)})`);
    g.fillStyle = lg;
    g.beginPath();
    shape.forEach(([u, v], j) => (j ? g.lineTo(u, v) : g.moveTo(u, v)));
    g.closePath();
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${Math.min(0.85, al + 0.3).toFixed(2)})`; // only the outer edges catch the light
    g.lineWidth = Math.max(1, px * 0.6);
    g.lineJoin = 'miter';
    g.beginPath();
    shape.forEach(([u, v], j) => (j ? g.lineTo(u, v) : g.moveTo(u, v)));
    g.stroke();
    nWedges++;
  }

  // 3) White hairlines, brightest by the hole and fading towards the far ends (a faint glow at 192 only).
  const fade = g.createRadialGradient(cx, cy, r0, cx, cy, 0.75 * w);
  fade.addColorStop(0, 'rgba(250,252,255,1)');
  fade.addColorStop(1, 'rgba(250,252,255,0.75)');
  g.fillStyle = fade;
  // Batched into four brightness levels: one fill per level, not per crack; at 192 only the brightest gets the glow
  // (a blur pass per fill is the costliest thing here).
  const levels = new Map();
  for (const l of lines) {
    const k = Math.round(Math.max(0, l.alpha - 0.5) * 6) / 6 + 0.5;
    if (!levels.has(k)) levels.set(k, []);
    levels.get(k).push(l);
  }
  for (const [k, ls] of levels) {
    const glow = big && k >= 1;
    g.shadowColor = glow ? 'rgba(220,235,255,0.25)' : 'transparent';
    g.shadowBlur = glow ? 0.7 * px : 0;
    g.globalAlpha = Math.min(1, k);
    g.beginPath();
    for (const l of ls) ribbon(l.pts, l.hw0, l.hw1);
    g.fill();
  }
  g.globalAlpha = 1;
  g.shadowBlur = 0;
  g.shadowColor = 'transparent';
  g.restore(); // back to the tile clip

  // 4) The hole: see-through blue-grey on the lit side, darkening across it; the spikes are dark slivers.
  const la = rnd() * TAU; // lit side angle; the gradient runs across the hole from its rim, symmetric on its centre
  const HR = holeR(la) * 0.95, HD = holeR(la + Math.PI);
  const ux = Math.cos(la), uy = Math.sin(la);
  const hg = g.createLinearGradient(cx + ux * HR, cy + uy * HR, cx - ux * HD, cy - uy * HD);
  hg.addColorStop(0, 'rgba(40,58,82,0.34)');
  hg.addColorStop(0.4, 'rgba(20,30,44,0.62)');
  hg.addColorStop(0.75, 'rgba(4,6,10,0.9)');
  hg.addColorStop(1, 'rgba(4,6,10,0.9)');
  g.fillStyle = hg;
  g.beginPath();
  polygon(body);
  g.fill();
  g.fillStyle = 'rgba(4,6,10,0.85)';
  g.beginPath();
  for (let i = 0; i < NV; i++) { // each spike, from its base pair, reaching a little into the hole
    if (!verts[i].base || !verts[(i + 1) % NV].spike) continue;
    const sp = verts[i].base, pts = [];
    for (let j = i; ; j = (j + 1) % NV) { pts.push(verts[j]); if (j !== i && verts[j].base) break; }
    const b = blob(sp.a) * 0.8;
    pts.push({ x: cx + Math.cos(sp.a) * b, y: cy + Math.sin(sp.a) * b });
    polygon(pts);
  }
  g.fill();

  // 5) The rim: thin, bright, broken, each stretch its own brightness (a stretch is drawn as one polyline so its joins
  // stay crisp); the spikes stay dark slivers (lit on one flank only).
  const rimW = Math.max(0.9, 0.85 * px);
  g.lineJoin = 'miter';
  g.lineWidth = rimW;
  let run = null;
  const endRun = () => {
    if (run && run.length > 1) {
      g.strokeStyle = `rgba(255,255,255,${run.al.toFixed(2)})`;
      g.beginPath();
      run.forEach((v, k) => (k ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y)));
      g.stroke();
    }
    run = null;
  };
  for (let i = 0; i < NV; i++) {
    const A = verts[i], B = verts[(i + 1) % NV];
    const onSpike = A.spike || B.spike;
    if ((onSpike && (A.tip || A.after || rnd() < 0.4)) || rnd() < 0.05) { endRun(); continue; }
    if (run && rnd() < 0.35) endRun(); // a new brightness
    if (!run) { run = [A]; run.al = rnd() < 0.2 ? between(0.1, 0.3) : between(0.7, 1); }
    run.push(B);
  }
  endRun();

  // 6) Chipped bands: 2-3 ragged white bands of broken edge just outside the rim, on the lit side and the bottom.
  const bands = [la + between(-0.5, 0.5), Math.PI / 2 + between(-0.5, 0.5)];
  if (rnd() < 0.5) bands.push(rnd() * TAU);
  const chipAt = [];
  for (const bc of bands) {
    const span = between(0.5, 1.0), k = between(1.12, 1.28);
    const al = between(0.55, 0.85);
    const steps = Math.max(4, Math.round(span / 0.11));
    let piece = [];
    const flush = () => {
      if (piece.length > 1) {
        const inner = piece.map((a) => { const r = holeR(a) * 0.98; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
        const outer = piece.map((a, j) => { // tapered at the ends, ragged in between
          const end = j === 0 || j === piece.length - 1;
          const hr = holeR(a), r = end ? hr * 1.01 : hr + (hr * (k - 1) + 0.6 * px) * between(0.45, 1.25);
          return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
        });
        g.fillStyle = `rgba(255,255,255,${al.toFixed(2)})`;
        g.beginPath();
        polygon(inner.concat(outer.reverse()));
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 1;
        g.beginPath();
        outer.forEach((v, j) => (j ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y)));
        g.stroke();
        chipAt.push({ a: piece[Math.floor(piece.length / 2)], k });
      }
      piece = [];
    };
    for (let j = 0; j <= steps; j++) {
      const a = wrap(bc - span / 2 + (span * j) / steps);
      if (nearSpike(a, 0.08)) flush(); else piece.push(a);
    }
    flush();
  }

  // 7) A few chips hugging the bands.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const nChips = 3 + Math.floor(rnd() * 2);
  for (let c = 0; c < nChips && chipAt.length; c++) {
    const b = chipAt[c % chipAt.length];
    const a = b.a + between(-0.3, 0.3), r = holeR(a) * b.k * between(1.08, 1.25), sz = between(1.1, 1.6) * px;
    const qx = cx + Math.cos(a) * r, qy = cy + Math.sin(a) * r, rot = rnd() * TAU;
    g.beginPath();
    for (let v = 0; v < 3; v++) {
      const va = rot + (v / 3) * TAU + (rnd() - 0.5) * 0.8, vr = sz * between(0.6, 1.2);
      v ? g.lineTo(qx + Math.cos(va) * vr, qy + Math.sin(va) * vr) : g.moveTo(qx + Math.cos(va) * vr, qy + Math.sin(va) * vr);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
}


// The three looks he picked: drawGlass's output for these seeds, which must never change (changing drawGlass's random draws changes them).
const LOOKS = ['Extra Health', 'Mystic Burst', 'Close Quarters'];

// FNV-1a of the item's name: which of the three looks it gets.
const lookOf = (name) => {
  let h = 2166136261;
  for (const c of String(name)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return LOOKS[h % LOOKS.length];
};

const crackOverlay = (g, x, y, w, h, name = '') => drawGlass(g, x, y, w, h, lookOf(name));

module.exports = { crackOverlay, lookOf, LOOKS };
