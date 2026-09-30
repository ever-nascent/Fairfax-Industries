const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const A = p => path.join(root, 'assets/heroes', p);

(async () => {
  const W = 1120, H = 640;
  const c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a1533'); bg.addColorStop(1, '#4a1f3d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const cal = await loadImage(A('full body/calico.png'));
  const ch = 520, cw = cal.width * ch / cal.height;
  g.drawImage(cal, 0, H - ch - 10, cw, ch);

  // track
  const tx = 470, tw = 610, ty = 60, lh = 96, lanes = 5;
  const racers = [
    ['haze', 'Haze', '3.2x', 0.62], ['mirage', 'Mirage', '2.1x', 0.55],
    ['shiv', 'Shiv', '4.5x', 0.94], ['lash', 'Lash', '5.0x', 0.70], ['viscous', 'Viscous', '8.0x', 0.40],
  ];
  const winner = 2;
  g.fillStyle = '#1a0f22'; g.fillRect(tx - 8, ty - 8, tw + 16, lh * lanes + 16);
  for (let i = 0; i < lanes; i++) {
    g.fillStyle = i % 2 ? '#3b2447' : '#33203e';
    g.fillRect(tx, ty + i * lh, tw, lh);
  }
  // finish line
  const fx = tx + tw - 30;
  for (let y = 0; y < lh * lanes; y += 16) for (let k = 0; k < 2; k++) {
    g.fillStyle = ((y / 16 + k) % 2) ? '#fff' : '#111';
    g.fillRect(fx + k * 16, ty + y, 16, 16);
  }
  g.textAlign = 'left';
  for (let i = 0; i < lanes; i++) {
    const [slug, name, odds, prog] = racers[i];
    const img = await loadImage(A(slug + '.png'));
    const x = tx + 20 + prog * (tw - 100), y = ty + i * lh + lh / 2;
    // speed streak
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(tx + 20, y - 3, x - tx - 20, 6);
    g.save(); g.beginPath(); g.arc(x + 32, y, 32, 0, 7); g.clip();
    g.drawImage(img, x, y - 32, 64, 64); g.restore();
    g.lineWidth = 4; g.strokeStyle = i === winner ? '#f2c14e' : '#8a6a9a';
    g.beginPath(); g.arc(x + 32, y, 32, 0, 7); g.stroke();
    g.fillStyle = '#e9d9f2'; g.font = 'bold 18px sans-serif';
    g.fillText(`${i + 1}. ${name}  ${odds}`, tx + 12, ty + i * lh + 22);
  }
  // pick marker
  g.fillStyle = '#f2c14e'; g.font = 'bold 20px sans-serif';
  g.fillText('YOUR PICK', tx + tw - 130, ty + winner * lh + 22);
  g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif';
  g.fillText('1st: Shiv!', tx, ty + lh * lanes + 50);

  fs.writeFileSync(path.join(__dirname, 'calico-race-mock.png'), c.toBuffer('image/png'));
})();
