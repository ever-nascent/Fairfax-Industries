const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');
const { halftone } = require('../src/utils/art.js');
const root = path.join(__dirname, '..');
(async () => {
  const W = 1120, H = 680, c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#1a110b'; g.fillRect(0, 0, W, H);
  const mk = await loadImage(path.join(root, 'assets/heroes/full body/mo_krill.png')), mh = 540, mw = mk.width * mh / mk.height;
  g.drawImage(mk, 0, H - mh, mw, mh);
  const souls = await loadImage(path.join(root, 'assets/card/souls.png'));
  const icon = await loadImage(path.join(root, 'assets/heroes/mo_krill.png'));
  g.textAlign = 'center'; g.fillStyle = '#f2c14e'; g.font = '40px Radiance'; g.fillText("MO & KRILL'S DIG DEEPER", 790, 52);
  g.fillStyle = '#c9b08a'; g.font = '19px sans-serif'; g.fillText('One column per depth is a cave-in. Bet 1,000 souls.', 790, 82);
  const mult = ['1.4x', '2.0x', '2.9x', '4.2x', '6.1x', '9.0x'];
  const tw = 128, th = 66, gap = 8, gx = 790 - (tw * 3 + gap * 2) / 2, gy = 104, cur = 3;
  const dug = [1, 0, 2];
  // shaft backing with dirt dots
  g.fillStyle = '#5a3f28'; g.fillRect(gx - 16, gy - 12, tw * 3 + gap * 2 + 32, 6 * (th + gap) + 8);
  halftone(g, gx - 16, gy - 12, tw * 3 + gap * 2 + 32, 6 * (th + gap) + 8, 14, (u, v) => 0.35 + 0.3 * v, '#3c2818');
  // surface strip
  g.fillStyle = '#6a8f3a'; g.fillRect(gx - 16, gy - 22, tw * 3 + gap * 2 + 32, 10);
  for (let d = 5; d >= 0; d--) {
    const y = gy + (5 - d) * (th + gap);
    g.textAlign = 'right'; g.font = 'bold 22px sans-serif'; g.fillStyle = d === cur ? '#f2c14e' : '#8f7a5f';
    g.fillText(mult[d], gx - 32, y + th / 2 + 8);
    if (d === 2) { g.textAlign = 'left'; g.fillStyle = '#3fbf5f'; g.font = 'bold 15px sans-serif'; g.fillText('DEPTH 3', gx + tw * 3 + gap * 2 + 26, y + th / 2 + 5); }
    for (let col = 0; col < 3; col++) {
      const x = gx + col * (tw + gap);
      g.textAlign = 'center';
      if (d < cur) {
        const isDug = dug[d] === col;
        g.fillStyle = isDug ? '#0b0705' : '#3a2a1c'; g.fillRect(x, y, tw, th);
        if (isDug) {
          g.fillStyle = 'rgba(255,220,120,0.10)'; g.fillRect(x, y, tw, th);
          g.drawImage(souls, x + tw / 2 - 12, y + 12, 22, 40);
        } else {
          g.fillStyle = '#6b5a48';
          [[.25,.6,9],[.5,.35,12],[.7,.65,10],[.4,.75,7]].forEach(([a,b,r]) => { g.beginPath(); g.arc(x + tw * a, y + th * b, r, 0, 7); g.fill(); });
        }
      } else {
        g.fillStyle = d === cur ? '#b98a55' : '#7d5d3b'; g.fillRect(x, y, tw, th);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, tw, 6);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 20, y + th); g.lineTo(x + 36, y + th - 22); g.lineTo(x + 30, y + th - 34); g.stroke();
        if (d === cur) { g.strokeStyle = '#f2c14e'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, tw - 4, th - 4); }
        g.fillStyle = d === cur ? '#2a1a0a' : '#4a3520'; g.font = 'bold 32px sans-serif'; g.fillText('?', x + tw / 2, y + th / 2 + 11);
      }
    }
  }
  // Krill marker in the last dug tile
  const lx = gx + dug[2] * (tw + gap), ly = gy + 3 * (th + gap);
  g.save(); g.beginPath(); g.arc(lx + tw - 22, ly + 22, 20, 0, 7); g.clip(); g.drawImage(icon, lx + tw - 42, ly + 2, 40, 40); g.restore();
  g.strokeStyle = '#f2c14e'; g.lineWidth = 3; g.beginPath(); g.arc(lx + tw - 22, ly + 22, 20, 0, 7); g.stroke();
  g.textAlign = 'center'; g.fillStyle = '#3fbf5f'; g.font = 'bold 26px sans-serif';
  g.fillText('Cash Out now: 2,900 souls   |   Next dig: 4.2x', 790, 620);
  g.fillStyle = '#c9b08a'; g.font = '18px sans-serif'; g.fillText('[ Dig Left ]  [ Dig Middle ]  [ Dig Right ]  [ Cash Out ]', 790, 652);
  fs.writeFileSync(path.join(__dirname, 'mokrill-dig-mock2.png'), c.toBuffer('image/png'));
})();
