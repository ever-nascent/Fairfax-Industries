const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');
require('../src/utils/art.js');
const root = path.join(__dirname, '..');
const H_ = p => path.join(root, 'assets/heroes', p);
(async () => {
  const W = 1120, H = 620, c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#3a2410'); bg.addColorStop(1, '#1c1208');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const mir = await loadImage(H_('full body/mirage.png')), mh = 590, mw = mir.width * mh / mir.height;
  g.drawImage(mir, 10, H - mh, mw, mh);
  g.textAlign = 'center'; g.fillStyle = '#f2c14e'; g.font = '40px Radiance';
  g.fillText("MIRAGE'S SCARAB SCRATCH", 720, 60);
  g.fillStyle = '#d9c39a'; g.font = '20px sans-serif'; g.fillText('Scratch 9 tiles. Match 3 to win. Bet 500 souls.', 720, 92);
  // symbols: [slug, payout]
  const S = { mo: ['mo_krill', '25x'], geist: ['lady_geist', '8x'], kelvin: ['kelvin', '4x'], ivy: ['ivy', '2x'], dud: null };
  const grid = ['geist','mo','geist','ivy','geist','kelvin','ivy','mo','kelvin'];
  const shown = [1,1,0,1,1,0,0,1,0]; // 1 = scratched
  const ts = 130, gap = 14, gx = 720 - (ts * 3 + gap * 2) / 2, gy = 130;
  g.fillStyle = '#8a5a1e'; g.fillRect(gx - 24, gy - 24, ts * 3 + gap * 2 + 48, ts * 3 + gap * 2 + 48);
  g.fillStyle = '#2a1a0a'; g.fillRect(gx - 12, gy - 12, ts * 3 + gap * 2 + 24, ts * 3 + gap * 2 + 24);
  for (let i = 0; i < 9; i++) {
    const x = gx + (i % 3) * (ts + gap), y = gy + Math.floor(i / 3) * (ts + gap);
    if (shown[i]) {
      g.fillStyle = '#efe2c2'; g.fillRect(x, y, ts, ts);
      const key = grid[i], hero = S[key][0];
      const im = await loadImage(H_(hero + '.png'));
      g.save(); g.beginPath(); g.arc(x + ts / 2, y + ts / 2 - 8, 42, 0, 7); g.clip();
      g.drawImage(im, x + ts / 2 - 42, y + ts / 2 - 50, 84, 84); g.restore();
      g.fillStyle = '#3a2410'; g.font = 'bold 20px sans-serif'; g.fillText(S[key][1], x + ts / 2, y + ts - 12);
      if (key === 'geist') { g.strokeStyle = '#3fbf5f'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, ts - 6, ts - 6); }
    } else {
      const gr = g.createLinearGradient(x, y, x + ts, y + ts);
      gr.addColorStop(0, '#c9a24a'); gr.addColorStop(0.5, '#e8cf85'); gr.addColorStop(1, '#a98232');
      g.fillStyle = gr; g.fillRect(x, y, ts, ts);
      g.fillStyle = '#7a5a1a'; g.font = 'bold 60px sans-serif'; g.fillText('?', x + ts / 2, y + ts / 2 + 20);
    }
  }
  g.fillStyle = '#3fbf5f'; g.font = 'bold 26px sans-serif';
  g.fillText('2 Lady Geists so far. One more wins 8x!', 720, gy + ts * 3 + gap * 2 + 62);
  g.fillStyle = '#d9c39a'; g.font = '18px sans-serif';
  g.fillText('Tiles left: 4   |   Buttons: [ ? ] x9  +  [ Scratch All ]', 720, gy + ts * 3 + gap * 2 + 92);
  fs.writeFileSync(path.join(__dirname, 'mirage-scratch-mock.png'), c.toBuffer('image/png'));
})();
