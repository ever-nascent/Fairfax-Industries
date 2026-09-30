const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

(async () => {
  const W = 1120, H = 640;
  const c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d1233'); bg.addColorStop(1, '#0d3a3f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const v = await loadImage(path.join(root, 'assets/heroes/full body/viscous.png'));
  const vh = 520, vw = v.width * vh / v.height;
  g.drawImage(v, 0, H - vh - 10, vw, vh);
  const rows = 8, slots = 9, gx = 70, top = 70, cx = 810;
  const mults = ['10x', '3x', '1.5x', '0.5x', '0.2x', '0.5x', '1.5x', '3x', '10x'];
  const rowY = i => top + i * 52;
  const pegX = (i, j) => cx + (j - i / 2) * gx * 0.9;

  // deterministic path: 8 bounces, right = +1
  const dirs = [1, 1, 1, 0, 1, 1, 1, 1];
  let pos = 0; const pts = [[cx, 30]];
  dirs.forEach((d, i) => { pos += d; pts.push([pegX(i + 1, pos) , rowY(i) + 26]); });
  const landed = pos + 0; // 0..8 -> slot index
  const slotIdx = landed;

  // pegs
  g.fillStyle = '#7fe6dc';
  for (let i = 0; i < rows; i++) for (let j = 0; j <= i; j++) {
    g.beginPath(); g.arc(pegX(i, j), rowY(i), 6, 0, 7); g.fill();
  }
  // slots
  const sw = gx * 0.9, sy = rowY(rows) + 10;
  const sx0 = cx - (rows / 2) * sw;
  mults.forEach((m, k) => {
    const x = sx0 + k * sw;
    const hit = k === slotIdx;
    g.fillStyle = hit ? '#f2c14e' : (parseFloat(m) < 1 ? '#5a2a3a' : '#1f5a4c');
    g.fillRect(x + 3, sy, sw - 6, 56);
    g.fillStyle = hit ? '#241a00' : '#fff';
    g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    g.fillText(m, x + sw / 2, sy + 36);
  });
  // path
  g.strokeStyle = '#b6ff5c'; g.lineWidth = 4; g.setLineDash([8, 6]);
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  g.setLineDash([]);
  const last = pts[pts.length - 1];
  g.fillStyle = '#b6ff5c'; g.beginPath(); g.arc(last[0], sy - 8, 14, 0, 7); g.fill();

  fs.writeFileSync(path.join(__dirname, 'viscous-plinko-mock.png'), c.toBuffer('image/png'));
  console.log('slot', slotIdx, mults[slotIdx]);
})();
