const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');
require('../src/utils/art.js');
const root = path.join(__dirname, '..');
(async () => {
  const W = 1120, H = 620, c = createCanvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#1a2a2a'); bg.addColorStop(1, '#0c1414');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const hz = await loadImage(path.join(root, 'assets/heroes/full body/haze.png')), mh = 590, mw = hz.width * mh / hz.height;
  g.drawImage(hz, 10, H - mh, mw, mh);
  g.textAlign = 'center'; g.fillStyle = '#e8e2c4'; g.font = '40px Radiance';
  g.fillText("HAZE'S BACK-ALLEY POKER", 730, 60);
  g.fillStyle = '#9fb8b0'; g.font = '20px sans-serif'; g.fillText('Five-Card Draw. Hold what you like, one redraw. Bet 500 souls.', 730, 92);
  const cards = [['K', '♠', 0], ['K', '♥', 1], ['7', '♣', 0], ['K', '♦', 1], ['2', '♠', 0]];
  const hold = [1, 1, 0, 1, 0];
  const cw = 120, ch = 170, gap = 18, gx = 730 - (cw * 5 + gap * 4) / 2, gy = 150;
  cards.forEach(([r, s, red], i) => {
    const x = gx + i * (cw + gap), y = gy - (hold[i] ? 18 : 0);
    g.fillStyle = '#f5f0e0'; g.fillRect(x, y, cw, ch);
    g.strokeStyle = hold[i] ? '#f2c14e' : '#555'; g.lineWidth = hold[i] ? 6 : 2; g.strokeRect(x, y, cw, ch);
    g.fillStyle = red ? '#b3202a' : '#111'; g.font = 'bold 44px sans-serif'; g.textAlign = 'left'; g.fillText(r, x + 10, y + 46);
    g.textAlign = 'center'; g.font = '70px sans-serif'; g.fillText(s, x + cw / 2, y + 112);
    if (hold[i]) { g.fillStyle = '#f2c14e'; g.font = 'bold 22px sans-serif'; g.fillText('HELD', x + cw / 2, y + ch + 30); }
  });
  g.fillStyle = '#3fbf5f'; g.font = 'bold 30px sans-serif'; g.fillText('Three of a Kind: pays 3x', 730, 420);
  g.fillStyle = '#9fb8b0'; g.font = '18px sans-serif';
  g.fillText('Pair of Jacks+ 1x | Two Pair 2x | Three 3x | Straight 4x | Flush 6x', 730, 462);
  g.fillText('Full House 9x | Four 25x | Straight Flush 50x | Royal 250x', 730, 490);
  g.fillStyle = '#e8e2c4'; g.font = 'bold 20px sans-serif';
  g.fillText('[ Hold 1 ] [ Hold 2 ] [ Hold 3 ] [ Hold 4 ] [ Hold 5 ]   [ Draw ]', 730, 545);
  fs.writeFileSync(path.join(__dirname, 'haze-poker-mock.png'), c.toBuffer('image/png'));
})();
