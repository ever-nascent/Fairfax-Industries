const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'remling');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const icon = await loadImage(path.join(root, 'assets/trivia/abilities/lil_helpers.png'));
  const colours = [['red', '#ff5a5f'], ['blue', '#4da3ff'], ['green', '#5fe08a'], ['yellow', '#ffd84d'], ['pink', '#ff8ad8']];
  const S = 128;
  const emoji = {};
  for (const [name, col] of colours) {
    const c = createCanvas(S, S), g = c.getContext('2d');
    g.drawImage(icon, 0, 0, S, S);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col; g.fillRect(0, 0, S, S);
    fs.writeFileSync(path.join(out, `remling_${name}.png`), c.toBuffer('image/png'));
    emoji[name] = c;
  }

  // Discord-like embed mock, phone-ish proportions
  const W = 720, H = 560, e = 44;
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#313338'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2d31'; g.fillRect(20, 20, W - 40, H - 40);
  g.fillStyle = '#9b6bff'; g.fillRect(20, 20, 5, H - 40);
  g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.fillText("Rem's Remling Race", 48, 62);
  g.fillStyle = '#dbdee1'; g.font = '20px sans-serif';
  g.fillText('Pick your Remling, then watch them go!', 48, 96);

  const pos = [0.62, 0.45, 0.8, 0.3, 0.55];
  const x0 = 100, x1 = W - 110;
  colours.forEach(([name], i) => {
    const y = 130 + i * 62;
    g.fillStyle = '#404249'; g.font = 'bold 20px monospace'; g.fillStyle = '#b5bac1';
    g.fillText(String(i + 1), 50, y + 32);
    g.fillStyle = '#3a3c43'; g.fillRect(x0, y + 22, x1 - x0, 3);
    g.drawImage(emoji[name], x0 + pos[i] * (x1 - x0 - e), y, e, e);
    // finish flag on the right
    for (let k = 0; k < 4; k++) for (let m = 0; m < 2; m++) {
      g.fillStyle = (k + m) % 2 ? '#fff' : '#111'; g.fillRect(x1 + 10 + m * 12, y + 4 + k * 9, 12, 9);
    }
  });
  // buttons
  ['1', '2', '3', '4', '5'].forEach((n, i) => {
    const bx = 48 + i * 86;
    g.fillStyle = '#4e5058'; g.beginPath(); g.roundRect(bx, 462, 76, 40, 6); g.fill();
    g.drawImage(emoji[colours[i][0]], bx + 6, 468, 28, 28);
    g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText(n, bx + 44, 489);
  });
  fs.writeFileSync(path.join(__dirname, 'remling-race-mock.png'), c.toBuffer('image/png'));
})();
