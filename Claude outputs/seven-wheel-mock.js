const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

(async () => {
  const W = 1120, H = 640;
  const c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1230'); bg.addColorStop(1, '#1b2f5c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const v = await loadImage(path.join(root, 'assets/heroes/full body/seven.png'));
  const vh = 520, vw = v.width * vh / v.height;
  g.drawImage(v, 0, H - vh - 10, vw, vh);

  const segs = [
    ['0x', '#3a2233'], ['2x', '#2b6f8f'], ['0.5x', '#4a2a55'], ['3x', '#2b8f6a'],
    ['0x', '#3a2233'], ['1.5x', '#3a6fb0'], ['0.5x', '#4a2a55'], ['5x', '#c99a2e'],
    ['0x', '#3a2233'], ['2x', '#2b6f8f'], ['0.5x', '#4a2a55'], ['10x', '#e8e04a'],
  ];
  const cx = 810, cy = 330, R = 250, n = segs.length, a = Math.PI * 2 / n;
  const win = 7; // 5x segment sits under the pointer at the top
  const rot = -Math.PI / 2 - (win + 0.5) * a;
  segs.forEach(([label, col], i) => {
    const s = rot + i * a;
    g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, s, s + a); g.closePath(); g.fill();
    g.strokeStyle = '#0b1230'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(s + a / 2);
    g.fillStyle = i === win ? '#241a00' : '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'right';
    g.fillText(label, R - 22, 10); g.restore();
  });
  g.fillStyle = '#0b1230'; g.beginPath(); g.arc(cx, cy, 34, 0, 7); g.fill();
  g.strokeStyle = '#f2e35a'; g.lineWidth = 5; g.stroke();
  // lightning bolt hub
  g.fillStyle = '#f2e35a'; g.beginPath();
  [[6, -22], [-14, 4], [-2, 4], [-8, 24], [14, -6], [2, -6]].forEach(([x, y], i) => i ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y));
  g.fill();
  // pointer
  g.fillStyle = '#ff4d4d'; g.beginPath();
  g.moveTo(cx, cy - R + 8); g.lineTo(cx - 20, cy - R - 26); g.lineTo(cx + 20, cy - R - 26); g.closePath(); g.fill();
  // lightning strike on the winning slice
  g.strokeStyle = '#f2e35a'; g.lineWidth = 4; g.beginPath();
  g.moveTo(cx + 70, 10); g.lineTo(cx + 40, 90); g.lineTo(cx + 70, 100); g.lineTo(cx + 30, cy - R + 20); g.stroke();

  fs.writeFileSync(path.join(__dirname, 'seven-wheel-mock.png'), c.toBuffer('image/png'));
})();
