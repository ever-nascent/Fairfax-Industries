const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');
require('../src/utils/art.js');
const root = path.join(__dirname, '..');
(async () => {
  const W = 1120, H = 640, c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#3b2a1e'); bg.addColorStop(1, '#150e09');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const mk = await loadImage(path.join(root, 'assets/heroes/full body/mo_krill.png')), mh = 520, mw = mk.width * mh / mk.height;
  g.drawImage(mk, 0, H - mh, mw, mh);
  const souls = await loadImage(path.join(root, 'assets/card/souls.png'));
  g.textAlign = 'center'; g.fillStyle = '#f2c14e'; g.font = '40px Radiance';
  g.fillText("MO & KRILL'S DIG DEEPER", 800, 55);
  // 6 depths, bottom = depth 1. state: 'safe' picked, 'rock' hidden, null unrevealed
  const mult = ['1.4x', '2.0x', '2.9x', '4.2x', '6.1x', '9.0x'];
  const tw = 120, th = 62, gap = 10, gx = 800 - (tw * 3 + gap * 2) / 2, gy = 85;
  const picked = [1, 0, 2]; // depth 1..3 columns dug (safe)
  for (let d = 5; d >= 0; d--) {
    const y = gy + (5 - d) * (th + gap);
    g.fillStyle = d === 3 ? '#f2c14e' : '#8a7a68'; g.font = 'bold 20px sans-serif'; g.textAlign = 'right';
    g.fillText(mult[d], gx - 20, y + th / 2 + 7);
    for (let col = 0; col < 3; col++) {
      const x = gx + col * (tw + gap);
      const dug = d < 3 && picked[d] === col;
      const skipped = d < 3 && !dug;
      g.fillStyle = dug ? '#0e0905' : skipped ? '#4a3a2c' : (d === 3 ? '#a67c52' : '#6b5238');
      g.fillRect(x, y, tw, th);
      if (d === 3) { g.strokeStyle = '#f2c14e'; g.lineWidth = 3; g.strokeRect(x + 1, y + 1, tw - 2, th - 2); }
      g.textAlign = 'center'; g.fillStyle = '#f2c14e';
      if (dug) g.drawImage(souls, x + tw / 2 - 12, y + 10, 22, 40);
      else if (skipped) { g.fillStyle = '#7a6a58'; g.font = '16px sans-serif'; g.fillText('rock', x + tw / 2, y + th / 2 + 6); }
      else { g.fillStyle = d === 3 ? '#2a1a0a' : '#3a2a1a'; g.font = 'bold 30px sans-serif'; g.fillText('?', x + tw / 2, y + th / 2 + 10); }
    }
  }
  g.textAlign = "center"; g.fillStyle = "#3fbf5f"; g.font = "bold 24px sans-serif";
  g.fillText('Depth 3 of 6: Cash Out for 2,900 souls', 800, 585);
  g.textAlign = 'center'; g.fillStyle = '#d9c39a'; g.font = '18px sans-serif';
  g.fillText('[ Dig Left ] [ Dig Middle ] [ Dig Right ]   [ Cash Out ]', 800, 618);
  fs.writeFileSync(path.join(__dirname, 'mokrill-dig-mock.png'), c.toBuffer('image/png'));
})();
