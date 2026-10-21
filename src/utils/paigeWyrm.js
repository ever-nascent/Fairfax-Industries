// The Bookwyrm drawing for Don't Wake the Bookwyrm (paige.js, paigeBook.js): an engraver's plate that wakes. Drawn into the book's left page by
// draw(g, ctx), ctx.stage 0-3 (stage = floor(wrong guesses / 2)):
//   stage 0 (0-1 wrong): a fine pen outline, eyes shut, z's drifting up beside its wing
//   stage 1 (2-3): the first pass of engraved lines, following the pages and the cape; it sleeps lighter (two z's)
//   stage 2 (4-5): cross-hatched so densely the ink pools and glistens, beads gather at its points, one eye opens
//   stage 3 (6): it wakes: the plate turns to wet ink, both eyes burn, drips run off it (one all the way to the page, where it lands),
//               and ink is flung off its outer edges in streaks, sprays and landed blots
// In the icon the dragon is a cut-out of a dark book shape; the dark shape is what gets engraved. Each stage is drawn once and cached (the bot
// draws the page on every guess), so after the first draw a stage costs one drawImage. No green aura, his call: only the eyes glow.
// ctx: { art: { wyrm }, cx, y, size, stage, seeded, createCanvas, PAGE: { left, right, top, bottom }, SERIF }

const K = 2;                 // the plate is worked at twice the page's resolution, then halved
const PAD = 22;              // page px of working room around the drawing
const FIT = 0.935;           // the drawing's size as a share of the box book.js gives (room for drips under it)
const INK = [42, 26, 16], WET = [16, 10, 6];
const HI = [255, 240, 218];  // the candle caught on wet ink
const TO_LIGHT = [-0.55, -0.83]; // towards the candle, top left
// the icon's eye slits (left eye; the right one is its mirror), as shares: outer corner, inner corner
const EYE = { outer: [0.392, 0.408], inner: [0.455, 0.466] };

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }; // 0..1, fixed per n

// ---- distance fields -------------------------------------------------------------------------------------------
function dt1(f, n, d, v, z) { // Felzenszwalb's 1-D squared distance transform
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(feature, W, H = W) { // distance from every pixel to the nearest feature pixel
  const M = Math.max(W, H);
  const g = new Float64Array(W * H), f = new Float64Array(M), d = new Float64Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  for (let i = 0; i < W * H; i++) g[i] = feature[i] ? 0 : 1e20;
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; dt1(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) f[x] = g[o + x]; dt1(f, W, d, v, z); for (let x = 0; x < W; x++) out[o + x] = Math.sqrt(d[x]); }
  return out;
}
function blur(a, W, H = W) { // a 3x3 box, twice
  let src = a; const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; tmp[i] = (src[i - 1] + src[i] + src[i + 1]) / 3; }
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) { const i = y * W + x; dst[i] = (tmp[i - W] + tmp[i] + tmp[i + W]) / 3; }
    for (let x = 0; x < W; x++) { dst[x] = src[x]; dst[(H - 1) * W + x] = src[(H - 1) * W + x]; }
    for (let y = 0; y < H; y++) { dst[y * W] = src[y * W]; dst[y * W + W - 1] = src[y * W + W - 1]; }
    src = dst;
  }
  return src;
}
function flood(mask, N, starts, value) { // 4-connected fill of the pixels equal to mask[start]; returns the filled set
  const out = new Uint8Array(N * N), st = [];
  for (const p of starts) if (mask[p] === value && !out[p]) { out[p] = 1; st.push(p); }
  while (st.length) {
    const p = st.pop(), x = p % N;
    if (x > 0 && mask[p - 1] === value && !out[p - 1]) { out[p - 1] = 1; st.push(p - 1); }
    if (x < N - 1 && mask[p + 1] === value && !out[p + 1]) { out[p + 1] = 1; st.push(p + 1); }
    if (p >= N && mask[p - N] === value && !out[p - N]) { out[p - N] = 1; st.push(p - N); }
    if (p < N * N - N && mask[p + N] === value && !out[p + N]) { out[p + N] = 1; st.push(p + N); }
  }
  return out;
}

// The plate: the icon's dark shape (eye slits taken out: the eyes are drawn per stage), its signed distance (page px,
// negative inside), and the small parts inked solid: the nostrils (tiny) and the mouth (small).
let plate = null;
function analyse(img, createCanvas, s) {
  const box = Math.round(s * K), pad = PAD * K, N = box + 2 * pad;
  const c = createCanvas(N, N), t = c.getContext('2d');
  t.imageSmoothingQuality = 'high';
  t.drawImage(img, pad, pad, box, box);
  const a = t.getImageData(0, 0, N, N).data;
  const bin = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) bin[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
  for (const side of [0, 1]) { // the eye slits become paper
    const ex = side ? 1 - (EYE.outer[0] + EYE.inner[0]) / 2 : (EYE.outer[0] + EYE.inner[0]) / 2, ey = (EYE.outer[1] + EYE.inner[1]) / 2;
    const p = Math.round(pad + ey * box) * N + Math.round(pad + ex * box);
    const eye = flood(bin, N, [p, p + 1, p - 1, p + N, p - N], 1);
    for (let i = 0; i < N * N; i++) if (eye[i]) bin[i] = 0;
  }
  const small = new Uint8Array(N * N); // 1: a nostril (under 60 page px^2), 2: the mouth (under 600)
  const seen = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (!bin[i] || seen[i]) continue;
    const part = flood(bin, N, [i], 1);
    let area = 0; for (let j = 0; j < N * N; j++) if (part[j]) { area++; seen[j] = 1; }
    if (area < 600 * K * K) for (let j = 0; j < N * N; j++) if (part[j]) small[j] = area < 60 * K * K ? 1 : 2;
  }
  const out = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) out[i] = 1 - bin[i];
  const din = edt(out, N), dout = edt(bin, N);
  const sd = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) sd[i] = (bin[i] ? 0.5 - din[i] : dout[i] - 0.5) / K;
  const sds = blur(sd, N);
  const down = new Float32Array(N * N); // page px from each inked pixel down to the edge below it (where ink gathers)
  for (let x = 0; x < N; x++) { let run = 0; for (let y = N - 1; y >= 0; y--) { const i = y * N + x; run = bin[i] ? run + 1 : 0; down[i] = run / K; } }
  return { N, box, pad, bin, small, sd: sds, dout, down };
}

// where the shape closes over (its outline, the head's cut-out filled in): what the splash must stay out of
function hull(P, gap) {
  const { N, bin, dout } = P, R = 13 * K;
  const dil = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) dil[i] = bin[i] || dout[i] <= R ? 1 : 0;
  const starts = [];
  for (let k = 0; k < N; k++) starts.push(k, (N - 1) * N + k, k * N, k * N + N - 1);
  const bg = flood(dil, N, starts, 0);
  const dbg = edt(bg, N);
  const a = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) a[i] = clamp(dbg[i] - (R - gap * K) + 0.5);
  return a;
}

// ---- line fields ----------------------------------------------------------------------------------------------
// noise: a smooth seeded field, about 1 at its peaks
function noiseField(seeded, n, seed) {
  const rnd = seeded(seed), grid = new Float32Array((n + 1) * (n + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  return (u, v) => { // u, v in 0..1
    const x = clamp(u) * n, y = clamp(v) * n, i = Math.min(n - 1, x | 0), j = Math.min(n - 1, y | 0), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), r = n + 1;
    const a = grid[j * r + i], b = grid[j * r + i + 1], c = grid[(j + 1) * r + i], d = grid[(j + 1) * r + i + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
// ink of a family of parallel lines at coordinate u (page px), spacing S, line width w (page px); 1 = ink
const lines = (u, S, w) => { const dd = Math.abs(u - S * Math.round(u / S)); return clamp((w / 2 - dd) * K + 0.5); };
// The wings are the book's pages: their lines run along the page, parallel to its curled top edge near the top and easing
// to its straight bottom edge, bunching towards the gutter. Returns [line coordinate (page px), share along the line].
function pageLine(X, Y, s) {
  const t = clamp(Math.abs(X - 0.5) / 0.43); // 0 at the spine, 1 at the outer edge
  const top = 0.02 + 0.27 * (1 - t) ** 1.15 + 0.04 * Math.sin(Math.PI * t), bot = 0.53 - 0.05 * t + 0.05 * Math.sin(Math.PI * t);
  return [((Y - top) / (bot - top)) * 0.44 * s, t];
}
// the pressure of the graver along a line: it swells in the middle of the stroke and lifts off at the ends, and no two
// lines swell in the same place
const HASH = Float32Array.from({ length: 2048 }, (_, i) => hash(i - 1024)); // hash() of each line number, looked up
const pressure = (along, u, S) => {
  const k = (Math.round(u / S) + 1024) & 2047, h = HASH[k], h2 = HASH[(k + 71) & 2047];
  const q = clamp(0.08 + 0.84 * along + 0.22 * (h - 0.5));
  return 0.5 + 2.48 * q * (1 - q) * (0.8 + 0.4 * h2); // a swell, 0.62 at its peak
};

// The engraving at one stage, as an RGBA canvas of the plate's size at page resolution.
function engrave(P, stage, seeded, s, createCanvas) {
  const { N, pad, box, sd, small, down } = P;
  const n1 = noiseField(seeded, 6, 11), n2 = noiseField(seeded, 17, 23), n3 = noiseField(seeded, 29, 37);
  const hi = new Float32Array(N * N * 4); // premultiplied
  const S = 3.5, S2 = 4.1;
  for (let hy = 1; hy < N - 1; hy++) {
    for (let hx = 1; hx < N - 1; hx++) {
      const i = hy * N + hx, d = sd[i];
      if (d > 1.2) continue;
      const X = (hx + 0.5 - pad) / box, Y = (hy + 0.5 - pad) / box; // shares of the drawing
      let nx = sd[i + 1] - sd[i - 1], ny = sd[i + N] - sd[i - N];
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const lit = nx * TO_LIGHT[0] + ny * TO_LIGHT[1]; // > 0: this edge faces the candle
      const depth = -d; // page px inside the edge
      const shape = clamp(0.5 - d * K);
      const dn = down[i]; // page px down to the edge below
      const wing = Y < 0.535;
      let ink = 0;
      if (stage < 3) {
        // the outline: a pen line just inside the edge, heavier on the shadow side
        const hw = (0.56 + 0.44 * clamp(-lit)) * [1, 1.1, 1.28][stage];
        ink = clamp((hw - Math.abs(depth - 0.85)) * K + 0.5);
        // the nostrils are inked from the start; the mouth is an outline with a light tone, then a mid tone, then solid
        if (small[i] === 1) ink = Math.max(ink, shape * [0.75, 0.9, 1][stage]);
        if (small[i] === 2) ink = Math.max(ink, shape * [0.1, 0.42, 1][stage]);
        let wet = 0, shine = 0;
        if (stage >= 1 && !small[i]) {
          // tone: light where the candle falls (top left, edges facing it), dark in the book's gutter, low down and deep inside
          const gutter = wing ? Math.exp(-(((X - 0.5) / 0.08) ** 2)) * smooth(0.5, 0.2, Y) : 0;
          const low = smooth(12, 2, dn);
          const shade = 0.06 + 0.42 * Y + 0.34 * (X - 0.5) + 0.34 * gutter + 0.22 * smooth(1.5, 12, depth) + 0.12 * n1(X, Y)
            + 0.16 * low - 0.34 * clamp(lit) * smooth(11, 2, depth);
          const rim = smooth(stage === 2 ? 1.1 : 1.5, stage === 2 ? 2.0 : 2.8, depth); // paper between the outline and the hatching
          // family A follows the form: on the wings, along the pages; on the cape, folds falling from the neck
          const wob = 0.6 * n2(X * 1.7, Y * 1.7);
          let uA, along;
          if (wing) { const [u, t] = pageLine(X, Y, s); uA = u + wob; along = t; }
          else { uA = Math.atan2(Math.abs(X - 0.5), Y - 0.47) * 0.36 * s + wob; along = clamp((Math.hypot(X - 0.5, Y - 0.47) - 0.07) / 0.46); }
          const pA = pressure(along, uA, S);
          let h;
          if (stage === 1) h = lines(uA, S, clamp(-0.02 + 1.0 * shade, 0, 1) * S * pA * (0.85 + 0.3 * n3(X * 2, Y * 2)));
          else {
            const Xm = X < 0.5 ? X : 1 - X; // mirrored, so both halves cross the same way
            const uB = (-0.82 * Xm + 0.57 * Y) * s + wob, uC = (0.5 * Xm + 0.866 * Y) * s - wob;
            let pool = 0; // where the ink gathers first: the book's gutter, the low inner corners of the wings, the tips below
            for (const [px, py, pr] of POOLS) { const q = ((X - px) ** 2 + (Y - py) ** 2) / (pr * pr); if (q < 1) pool += (1 - q) ** 2; }
            const t2 = shade + 0.26 + 0.42 * pool * (0.75 + 0.5 * n2(X * 2.3, Y * 2.3));
            h = 1 - (1 - lines(uA, S, clamp(0.16 + 0.95 * t2, 0, 1.15) * S * (0.55 + 0.45 * pA) * (0.88 + 0.24 * n3(X * 2, Y * 2))))
              * (1 - lines(uB, S2, clamp(-0.5 + 1.05 * t2, 0, 1.0) * S2 * pressure(Y * 1.4, uB, S2)))
              * (1 - lines(uC, S * 0.9, clamp(-0.95 + 1.35 * t2, 0, 1.1) * S * 0.9));
            // the ink has started to gather along the lower edges, in a wet bead that catches the light
            const pw = 3 + 2.8 * (0.5 + 0.5 * n2(X * 1.3 + 0.3, Y * 1.3)) + 3 * gutter;
            const band = smooth(pw + 0.8, pw - 0.8, dn);
            // and the lines run together into pools where the shade is deepest; their old ridges still glisten
            const deep = smooth(0.84, 1.02, t2 + 0.16 * n2(X * 2.1, Y * 2.1));
            wet = Math.max(band, deep);
            h = Math.max(h, wet);
            shine = Math.max(Math.exp(-(((dn - pw * 0.62) / 0.7) ** 2)) * band * smooth(0.25, 0.6, n3(X * 1.2, Y * 1.2)) * 0.95,
              lines(uA + S / 2, S, 0.55) * deep * smooth(0.2, 0.6, n3(X * 1.7 + 0.4, Y * 1.7)) * 0.42);
          }
          ink = Math.max(ink, h * rim * shape);
          if (wet) { ink = Math.max(ink, wet * shape); }
        }
        const r = INK[0] + (WET[0] - INK[0]) * wet + (HI[0] - INK[0]) * shine, gg = INK[1] + (WET[1] - INK[1]) * wet + (HI[1] - INK[1]) * shine;
        const b = INK[2] + (WET[2] - INK[2]) * wet + (HI[2] - INK[2]) * shine;
        hi[i * 4] = r * ink; hi[i * 4 + 1] = gg * ink; hi[i * 4 + 2] = b * ink; hi[i * 4 + 3] = ink;
      } else {
        // wet ink: near black; a sharp broken meniscus and a soft sheen on the edges that face the candle, a wet bead
        // along the lower edges, and the last of the engraving still showing high on the wings as it melts
        const brk = smooth(0.15, 0.55, n3(X * 1.4, Y * 1.4));
        const spec = Math.exp(-(((depth - 1.45) / 0.5) ** 2)) * smooth(0.4, 0.85, lit) * brk * 0.9;
        const sheen = Math.exp(-(((depth - 4.5) / 1.8) ** 2)) * smooth(0.3, 0.9, lit) * (0.3 + 0.7 * brk) * 0.1;
        const bead = Math.exp(-(((dn - 2.4) / 0.5) ** 2)) * smooth(0.0, 0.4, n2(X * 1.3 + 0.3, Y * 1.3)) * smooth(2, 4, depth + dn) * 0.55;
        let ghost = 0;
        if (wing && !small[i]) ghost = lines(pageLine(X, Y, s)[0], S, 1.0) * smooth(0.42, 0.12, Y) * smooth(2.5, 6, depth) * 0.15;
        const hl = Math.min(1, spec + sheen + bead);
        const r = WET[0] + (HI[0] - WET[0]) * hl + 58 * ghost, gg = WET[1] + (HI[1] - WET[1]) * hl + 38 * ghost, b = WET[2] + (HI[2] - WET[2]) * hl + 24 * ghost;
        hi[i * 4] = r * shape; hi[i * 4 + 1] = gg * shape; hi[i * 4 + 2] = b * shape; hi[i * 4 + 3] = shape;
      }
    }
  }
  return halve(hi, N, N, createCanvas);
}
// a premultiplied float RGBA buffer at K x into ImageData-ready canvas pixels at page resolution (a 2x2 box)
function halve(hi, W, H, createCanvas) {
  const MW = W / K, MH = H / K, c = createCanvas(MW, MH), t = c.getContext('2d'), img = t.createImageData(MW, MH), o = img.data;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) { const j = ((y * K + dy) * W + x * K + dx) * 4; r += hi[j]; g += hi[j + 1]; b += hi[j + 2]; al += hi[j + 3]; }
    const p = (y * MW + x) * 4;
    if (al > 0) { o[p] = r / al; o[p + 1] = g / al; o[p + 2] = b / al; o[p + 3] = (al / (K * K)) * 255; }
  }
  t.putImageData(img, 0, 0);
  return c;
}

// where the ink gathers first at stage 2 (shares: x, y, radius): the gutter, the wings' low inner corners, the cape's points
const POOLS = [[0.5, 0.26, 0.1], [0.37, 0.47, 0.085], [0.63, 0.47, 0.085], [0.5, 0.88, 0.09], [0.32, 0.87, 0.06], [0.69, 0.87, 0.06]];

// ---- the eyes -------------------------------------------------------------------------------------------------
// 0, 1: shut, a relaxed lid line. 2: the left eye half open and lit, the right one barely cracked. 3: both open, angry, burning.
function eyes(g, stage, ox, oy, s) {
  const ex = (EYE.outer[0] + EYE.inner[0]) / 2, ey = (EYE.outer[1] + EYE.inner[1]) / 2;
  const full = Math.atan2(EYE.inner[1] - EYE.outer[1], EYE.inner[0] - EYE.outer[0]);
  const L = (Math.hypot(EYE.inner[0] - EYE.outer[0], EYE.inner[1] - EYE.outer[1]) * s) / 2;
  const R = L * 1.2;
  const almond = () => { g.beginPath(); g.moveTo(-R, 0); g.quadraticCurveTo(0, -R * 0.28, R, R * 0.08); g.quadraticCurveTo(R * 0.1, R * 1.0, -R, 0); g.closePath(); };
  const iris = (glow) => {
    g.save(); g.shadowColor = 'rgba(70,232,138,0.95)'; g.shadowBlur = glow;
    const gr = g.createRadialGradient(R * 0.05, R * 0.25, 0, R * 0.05, R * 0.25, R * 0.95);
    gr.addColorStop(0, '#fbffe6'); gr.addColorStop(0.4, '#b8f7b4'); gr.addColorStop(1, '#2fae62');
    g.fillStyle = gr; almond(); g.fill(); g.restore();
  };
  const pupil = (h) => { g.save(); g.rotate(-full); g.fillStyle = `rgb(${WET})`; g.beginPath(); g.ellipse(R * 0.02, R * 0.32, R * 0.11, R * h, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
  for (const side of [-1, 1]) {
    g.save();
    g.translate(ox + s * (side < 0 ? ex : 1 - ex), oy + s * ey);
    g.scale(-side, 1); // local +x runs from the outer corner to the inner one
    if (stage < 2 || (stage === 2 && side > 0)) {
      g.rotate(full * 0.42);
      g.fillStyle = stage < 2 ? `rgb(${INK})` : `rgb(${WET})`;
      g.beginPath(); g.moveTo(-L * 0.95, -L * 0.05); g.quadraticCurveTo(0, L * 0.66, L * 0.95, -L * 0.05); g.quadraticCurveTo(0, L * 0.34, -L * 0.95, -L * 0.05); g.fill();
      g.strokeStyle = `rgba(${INK},0.55)`; g.lineWidth = 0.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-L * 0.55, -L * 0.32); g.quadraticCurveTo(0, -L * 0.12, L * 0.5, -L * 0.3); g.stroke(); // the crease of the lid
      if (stage === 2) { // barely cracked: a hairline of light along the lid
        g.save(); g.shadowColor = 'rgba(70,232,138,0.9)'; g.shadowBlur = 3; g.strokeStyle = '#d8ffd8'; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(-L * 0.42, L * 0.36); g.quadraticCurveTo(0, L * 0.52, L * 0.42, L * 0.34); g.stroke(); g.restore();
      }
    } else if (stage === 2) {
      // half open: the burning eye under a heavy lid that has lifted halfway
      g.rotate(full * 0.85); g.scale(1.12, 1.12);
      g.fillStyle = `rgb(${WET})`; g.save(); g.scale(1.14, 1.24); almond(); g.restore(); g.fill();
      g.save(); almond(); g.clip();
      iris(7);
      pupil(0.34);
      g.fillStyle = `rgb(${WET})`; // the upper lid, its edge a soft curve across the eye
      g.beginPath(); g.moveTo(-R * 1.3, -R * 1.2); g.lineTo(R * 1.3, -R * 1.2); g.lineTo(R * 1.3, R * 0.08);
      g.quadraticCurveTo(0, R * 0.3, -R * 1.3, -R * 0.08); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(-R * 0.36, R * 0.32, R * 0.09, 0, Math.PI * 2); g.fill();
    } else {
      g.rotate(full);
      g.fillStyle = `rgb(${WET})`; g.save(); g.scale(1.16, 1.28); almond(); g.restore(); g.fill(); // the dark lids
      iris(9);
      pupil(0.42); // a slit pupil, upright on the page
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(-R * 0.38, R * 0.08, R * 0.11, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
}

// ---- asleep: z's drifting up beside the right wing (in ink, lettered like the rest of the book) --------------------
function zzz(g, stage, ox, oy, s, SERIF) {
  const zs = stage === 0 ? [[0.995, 0.33, 17, 0.72], [1.065, 0.22, 22, 0.8], [1.145, 0.09, 28, 0.86]] : [[0.995, 0.33, 17, 0.64], [1.065, 0.22, 21, 0.7]];
  g.save(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (const [sx, sy, size, a] of zs) { g.font = `italic ${size}px ${SERIF}`; g.fillStyle = `rgba(${INK},${a})`; g.fillText('z', ox + sx * s, oy + sy * s); }
  g.restore();
}

// ---- wet ink: drips, drops and the splash, drawn as one mask and lit like the plate ---------------------------------
// shapes are filled white into the mask; the lighting pass decides their colour
function teardrop(g, x, y, ang, r, tail, bend = 0) { // a drop moving along ang: round head at (x, y), tail pointing back (bent a little)
  g.save(); g.translate(x, y); g.rotate(ang);
  const b = bend * tail;
  g.beginPath(); g.moveTo(-r - tail, b);
  g.bezierCurveTo(-r - tail * 0.45, -r * 0.2 + b * 0.35, -r * 0.95, -r, 0, -r);
  g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  g.bezierCurveTo(-r * 0.95, r, -r - tail * 0.45, r * 0.2 + b * 0.35, -r - tail, b);
  g.fill(); g.restore();
}
const dot = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
// a blot of ink that landed: longer along the way it was going, its edge jagged like the right page's blotted-out
// letters, a short crown of spikes where it splashed furthest, and a few specks thrown on past it
function blot(g, x, y, R, ang, rnd, glints, { along = 1.28, across = 0.86, spread = 0.9, specks = 3, both = false } = {}) {
  const n = 22, crown = new Map();
  for (let k = 0; k < 3; k++) {
    const side = both && k % 2 ? Math.PI : 0;
    const v = Math.round(((side + (rnd() - 0.5) * 2 * spread) / (Math.PI * 2)) * n + n * 4) % n, h = 1.18 + rnd() * 0.22;
    crown.set(v, h); if (!crown.has((v + 1) % n)) crown.set((v + 1) % n, 1 + (h - 1) * 0.55);
  }
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const to = (u, v) => [x + u * ca - v * sa, y + u * sa + v * ca]; // local u runs the way it was going
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const r = R * (0.82 + rnd() * 0.26) * (crown.get(k) || 1);
    g.lineTo(...to(Math.cos(a) * r * along, Math.sin(a) * r * across));
  }
  g.closePath(); g.fill();
  for (let k = 0; k < specks; k++) {
    const side = both && k % 2 ? Math.PI : 0;
    const a = side + (rnd() - 0.5) * 2 * spread * 0.8, d = R * (1.9 + rnd() * 1.1), r = Math.min(1.8, 0.6 + rnd() * 0.22 * R);
    const [px, py] = to(Math.cos(a) * d * along, Math.sin(a) * d * across);
    dot(g, px, py, r);
  }
  glints.push([x, y, R * 0.72]);
}
// one drip hanging from (x, y): a meniscus where it leaves the ink, a stem that wanders, a slug of ink on the way down
// on the long ones, a neck, a heavy bead. Returns the bead.
function drip(g, x, y, len, w, bend, top, rnd) {
  const y0 = y - 3, n = Math.max(18, Math.round(len * 1.6)), rb = w * 0.6;
  const ph = rnd() * 6.28, slug = len > 30 ? 0.3 + rnd() * 0.3 : -1;
  const at = (t) => x + bend * Math.sin(t * 2.4) * t + (len > 20 ? 0.9 * Math.sin((t * len) / 11 + ph) * Math.min(1, t * 3) : 0);
  const hw = (t) => {
    let r = w * 0.5 * (0.8 + 0.2 * smooth(0.45, 1, t));
    r *= 1 + top * 1.8 * Math.exp(-(t * len) / 4.5);
    if (slug > 0) r *= 1 + 0.42 * Math.exp(-((((t - slug) * len) / 6) ** 2));
    return r;
  };
  g.beginPath();
  for (let k = 0; k <= n; k++) { const t = k / n; g.lineTo(at(t) - hw(t), y0 + len * t); }
  for (let k = n; k >= 0; k--) { const t = k / n; g.lineTo(at(t) + hw(t), y0 + len * t); }
  g.closePath(); g.fill();
  const bx = at(1), by = y0 + len + rb * 0.25;
  g.beginPath(); g.ellipse(bx, by, rb, rb * 1.1, 0, 0, Math.PI * 2); g.fill();
  return [bx, by, rb];
}

// The lighting pass for a white mask of wet ink (W x H at K x, page offset ox0, oy0): depth from the edge (counting the
// plate as ink too, so a drip runs out of it seamlessly), a bright broken meniscus where an edge faces the candle, a soft
// sheen just inside it. Thin specks stay plain ink.
function lightLiquid(mask, W0, H0, P, plateAt, seeded, createCanvas) {
  const full = mask.getContext('2d').getImageData(0, 0, W0, H0).data;
  // work only round the ink (with room for the depths that matter), on even pixels so it halves cleanly
  let x0 = W0, y0 = H0, x1 = -1, y1 = -1;
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (full[(y * W0 + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const M = 10 * K;
  x0 = Math.max(0, (x0 - M) & ~1); y0 = Math.max(0, (y0 - M) & ~1); x1 = Math.min(W0, (x1 + M + 2) & ~1); y1 = Math.min(H0, (y1 + M + 2) & ~1);
  const W = x1 - x0, H = y1 - y0;
  const cov = new Float32Array(W * H), bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = full[((y + y0) * W0 + x + x0) * 4 + 3] / 255, i = y * W + x; cov[i] = c; bin[i] = c >= 0.5 ? 1 : 0; }
  const { N, bin: pb } = P, px0 = plateAt[0] - x0, py0 = plateAt[1] - y0;
  for (let hy = 0; hy < N; hy++) { const y = hy + py0; if (y < 0 || y >= H) continue; for (let hx = 0; hx < N; hx++) { const x = hx + px0; if (x >= 0 && x < W && pb[hy * N + hx]) bin[y * W + x] = 1; } }
  const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) out[i] = 1 - bin[i];
  const din = edt(out, W, H);
  const ds = blur(din, W, H);
  const n3 = noiseField(seeded, 23, 59);
  const hi = new Float32Array(W * H * 4);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, c = cov[i];
    if (c <= 0) continue;
    let nx = ds[i - 1] - ds[i + 1], ny = ds[i - W] - ds[i + W]; // outward: down the depth
    const nl = Math.hypot(nx, ny);
    let hl = 0;
    if (nl > 1e-3) {
      nx /= nl; ny /= nl;
      const lit = nx * TO_LIGHT[0] + ny * TO_LIGHT[1], depth = din[i] / K;
      const qx = Math.round(x - nx * 2.4 * K), qy = Math.round(y - ny * 2.4 * K); // is it thick enough to hold a highlight
      const thick = qx >= 0 && qy >= 0 && qx < W && qy < H ? smooth(1.4, 2.4, din[qy * W + qx] / K) : 0;
      const brk = smooth(0.1, 0.5, n3((x + x0) / W0, (y + y0) / H0));
      const spec = Math.exp(-(((depth - 1.3) / 0.48) ** 2)) * smooth(0.35, 0.85, lit) * thick * (0.35 + 0.65 * brk) * 0.9;
      const sheen = Math.exp(-(((depth - 3.4) / 1.5) ** 2)) * smooth(0.3, 0.9, lit) * thick * 0.12;
      hl = Math.min(1, spec + sheen);
    }
    const j = i * 4;
    hi[j] = (WET[0] + (HI[0] - WET[0]) * hl) * c; hi[j + 1] = (WET[1] + (HI[1] - WET[1]) * hl) * c; hi[j + 2] = (WET[2] + (HI[2] - WET[2]) * hl) * c; hi[j + 3] = c;
  }
  return { pic: halve(hi, W, H, createCanvas), x: x0 / K, y: y0 / K };
}
const glint = (g, x, y, r) => { // the candle's hot spot on a drop (top left)
  g.save(); g.fillStyle = 'rgba(255,246,228,0.88)';
  g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.4, r * 0.28, r * 0.18, -0.75, 0, Math.PI * 2); g.fill(); g.restore();
};

// The splash, flung off it as it wakes: drops thrown out from the middle of each wing (and from the cape), only outwards
// (never into the face, never up under the title), each side its own throw (not a mirror), with bare paper between the
// throws. The big drops landed and splashed like the blotted-out letters; the fast ones are long streaks with drops
// trailing them; the rest fly rounder and smaller the further they go.
// [from (shares), throws: [angle (deg, 0 right, 90 down), kind, size (radius), distance past the edge to its centre (px)]]
const THROWS = [
  [[0.27, 0.27], [[214, 'streak', 3.4, 30], [199, 'drop', 2.0, 14], [186, 'streak', 5.2, 40], [171, 'blot', 8.5, 30], [156, 'drop', 3.0, 22],
    [146, 'streak', 3.6, 36], [134, 'drop', 1.8, 14]]],
  [[0.73, 0.27], [[-36, 'drop', 2.6, 20], [-20, 'blot', 7.5, 26], [-6, 'drop', 1.8, 10], [5, 'streak', 5.4, 42], [19, 'drop', 3.0, 20],
    [31, 'streak', 3.4, 34], [45, 'drop', 2.0, 16]]],
  [[0.5, 0.8], [[152, 'streak', 3.0, 24], [36, 'drop', 2.8, 18], [46, 'streak', 2.0, 26]]],
];
function splash(g, P, ox, oy, s, area, seeded, glints) {
  const kx0 = ox - PAD, ky0 = oy - PAD, N = P.N;
  const inKnock = (x, y) => { const ix = Math.round((x - kx0) * K), iy = Math.round((y - ky0) * K); return ix >= 0 && iy >= 0 && ix < N && iy < N && P.knock[iy * N + ix] > 0.5; };
  const fits = (x, y, r) => x - r > area.left + 8 && x + r < area.right - 8 && y - r > area.top + 4 && y + r < area.bottom - 6;
  THROWS.forEach(([[fx, fy], list], side) => {
    const rnd = seeded(401 + side * 97), c = [ox + fx * s, oy + fy * s];
    for (const [deg, kind, size, dist] of list) {
      const a = ((deg + (rnd() - 0.5) * 4) * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      let edge = 0; for (let r = 0; r < 200; r += 0.5) if (inKnock(c[0] + dx * r, c[1] + dy * r)) edge = r; // where it leaves the dragon
      const at = (d, off = 0) => [c[0] + dx * (edge + d) - dy * off, c[1] + dy * (edge + d) + dx * off];
      const drop = (d, r, tail, off = 0) => {
        const [x, y] = at(d, off);
        if (!fits(x, y, r)) return false;
        if (r > 1.1) teardrop(g, x, y, a + (rnd() - 0.5) * 0.08, r, tail, (rnd() - 0.5) * 0.16); else dot(g, x, y, Math.max(0.7, r));
        if (r > 1.9) glints.push([x, y, r]);
        return true;
      };
      const r = size * (0.92 + rnd() * 0.16), d = dist * (0.94 + rnd() * 0.12);
      if (kind === 'streak') { // the lead drop's tail reaches back towards the dragon; two smaller drops follow it out
        if (!drop(d, r, Math.min(d - r - 2, r * (6 + rnd() * 2.5)))) continue;
        let dd = d + r, rr = r;
        for (let k = 0; k < 2; k++) { rr *= 0.5 + rnd() * 0.12; dd += 3 + rnd() * 3 + rr * 2.6; if (!drop(dd, rr, rr * (1.2 + rnd()), (rnd() - 0.5) * 1.6)) break; dd += rr; }
      } else if (kind === 'drop') {
        if (drop(d, r, r * (1.4 + rnd() * 1.2)) && rnd() < 0.6) drop(d + r * 2.4 + 3 + rnd() * 3, r * 0.45, r * 0.6, (rnd() - 0.5) * 2);
      } else if (kind === 'specks') {
        for (let k = 0; k < 3; k++) drop(d + (rnd() - 0.5) * 10, 0.7 + rnd() * 0.6, 0, (rnd() - 0.5) * 9);
      } else { // a big drop that landed: it splashed, and threw specks on past it
        const [x, y] = at(d);
        if (!fits(x, y, r * 1.6)) continue;
        blot(g, x, y, r, a, rnd, glints, { specks: 3 + Math.floor(rnd() * 2) });
      }
    }
  });
}

// drips at stage 2 (the first beads) and 3: [x share, search from, to (shares down), length, width, bend, meniscus, lands]
const BEADS = [[0.5, 0.94, 1.0, 7, 3.2, 0.2, 0.25], [0.21, 0.6, 0.9, 6, 2.6, -0.2, 0.25], [0.152, 0.3, 0.56, 6.5, 3.2, 0, 0.6], [0.83, 0.3, 0.56, 4.5, 2.6, 0, 0.6]];
const DRIPS = [
  [0.152, 0.3, 0.56, 76, 6.2, 2.2, 1.0, true], [0.315, 0.3, 0.56, 8, 3.6, -0.3, 0.8],
  [0.805, 0.3, 0.56, 52, 5.6, -1.3, 1.0], [0.872, 0.3, 0.56, 13, 4.2, 0.4, 0.9],
  [0.5, 0.94, 1.0, 8, 4.6, 0.3, 0.35], [0.287, 0.88, 0.99, 6, 3.6, -0.2, 0.35], [0.805, 0.8, 0.9, 19, 4.4, 0.6, 0.35],
];
// where the ink's lower edge is at a column (page px), searching between two shares down
function edgeBelow(P, oy, X, from, to) {
  const { N, pad, box, bin } = P, hx = Math.round(pad + X * box);
  let low = -1;
  for (let hy = Math.round(pad + from * box); hy <= Math.round(pad + to * box); hy++) if (bin[hy * N + hx]) low = hy;
  return low < 0 ? null : oy + (low + 1 - pad) / K;
}

// ---- the whole picture per stage ---------------------------------------------------------------------------------
const cache = new Map();
function build(ctx) {
  const { art, cx, y, size, stage, seeded, createCanvas, PAGE, SERIF } = ctx;
  const s = Math.round(size * FIT), ox = Math.round(cx - s / 2), oy = Math.round(y - 2);
  if (!plate || plate.s !== s) plate = { ...analyse(art.wyrm, createCanvas, s), s };
  const P = plate;
  const area = { left: PAGE.left, top: PAGE.top, right: PAGE.right, bottom: PAGE.bottom };
  const W = area.right - area.left, H = area.bottom - area.top;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.translate(-area.left, -area.top);
  const glints = [];
  if (stage >= 2) { // the wet ink off the plate, in one mask at K x
    const m = createCanvas(W * K, H * K), mg = m.getContext('2d');
    mg.scale(K, K); mg.translate(-area.left, -area.top); mg.fillStyle = '#fff';
    if (stage === 3) {
      if (!P.knock) {
        P.knock = hull(P, 2.4);
        const kc = createCanvas(P.N, P.N), kt = kc.getContext('2d'), im = kt.createImageData(P.N, P.N);
        for (let i = 0; i < P.N * P.N; i++) im.data[i * 4 + 3] = P.knock[i] * 255;
        kt.putImageData(im, 0, 0);
        P.knockCanvas = kc;
      }
      splash(mg, P, ox, oy, s, area, seeded, glints);
      mg.save(); mg.globalCompositeOperation = 'destination-out'; mg.drawImage(P.knockCanvas, ox - PAD, oy - PAD, P.N / K, P.N / K); mg.restore(); // the paper gap round the dragon
    }
    (stage === 2 ? BEADS : DRIPS).forEach(([X, from, to, len, w, bend, top, lands], k) => {
      const ey = edgeBelow(P, oy, X, from, to);
      if (ey === null) return;
      const rnd = seeded(211 + k * 13);
      const [bx, by, rb] = drip(mg, ox + X * s, ey, len, w, bend, top, rnd);
      if (rb > 1.6) glints.push([bx, by, rb]);
      if (!lands) return;
      // it let go: a drop on its way down, and where the last one landed on the page
      const ly = area.bottom - 13, fy = by + rb + (ly - by) * 0.42;
      teardrop(mg, bx + 0.4, fy, Math.PI / 2, rb * 0.62, rb * 1.3);
      glints.push([bx + 0.4, fy, rb * 0.62]);
      blot(mg, bx + 1.2, ly, rb * 1.55, 0, rnd, glints, { along: 1.35, across: 0.8, spread: 0.5, specks: 2, both: true });
    });
    const wet = lightLiquid(m, W * K, H * K, P, [(ox - PAD - area.left) * K, (oy - PAD - area.top) * K], seeded, createCanvas);
    if (wet) g.drawImage(wet.pic, area.left + wet.x, area.top + wet.y);
  }
  g.drawImage(engrave(P, stage, seeded, s, createCanvas), ox - PAD, oy - PAD);
  for (const [x, yy, r] of glints) glint(g, x, yy, r);
  eyes(g, stage, ox, oy, s);
  if (stage < 2) zzz(g, stage, ox, oy, s, SERIF);
  return c;
}

module.exports = {
  draw(g, ctx) {
    const key = `${ctx.stage}:${ctx.cx}:${ctx.y}:${ctx.size}`;
    let pic = cache.get(key);
    if (!pic) { pic = build(ctx); cache.set(key, pic); }
    g.drawImage(pic, ctx.PAGE.left, ctx.PAGE.top);
  },
};
