// The 38 heroes for Shop hero cards: names, art, colours and their server emojis.
// Art: the hero's full render (assets/hero_renders, `setup.py hero-renders`); until a render is
// downloaded, the hero's chat icon (assets/heroes) stands in. Colours are sampled from that art.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

// Same list and order as setup.py HEROES (deadlock.wiki Category:Heroes, Sept 2026).
const NAMES = [
  'Abrams', 'Apollo', 'Bebop', 'Billy', 'Calico', 'Celeste', 'The Doorman', 'Drifter',
  'Dynamo', 'Graves', 'Grey Talon', 'Haze', 'Holliday', 'Infernus', 'Ivy', 'Kelvin',
  'Lady Geist', 'Lash', 'McGinnis', 'Mina', 'Mirage', 'Mo & Krill', 'Paige', 'Paradox',
  'Pocket', 'Rem', 'Seven', 'Shiv', 'Silver', 'Sinclair', 'Venator', 'Victor',
  'Vindicta', 'Viscous', 'Vyper', 'Warden', 'Wraith', 'Yamato',
];
// slug = file name and emoji name, like setup.py: "Mo & Krill" -> mo_krill
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const HEROES = NAMES.map((name) => ({ name, slug: slugOf(name) }));
const bySlug = new Map(HEROES.map((h) => [h.slug, h]));
const getHero = (slug) => bySlug.get(slug) ?? null;

// Hand-picked colours win over the sampled ones: { slug: '#rrggbb' }. Empty until one needs fixing.
const COLOR_OVERRIDES = {};

const renderPath = (slug) => path.join(ASSETS, 'hero_renders', `${slug}.png`);
const iconPath = (slug) => path.join(ASSETS, 'heroes', `${slug}.png`);

// Loaded once per hero: { image, isRender, color }.
const cache = new Map();

async function heroArt(slug) {
  if (!cache.has(slug)) {
    const isRender = fs.existsSync(renderPath(slug));
    const image = await loadImage(isRender ? renderPath(slug) : iconPath(slug));
    cache.set(slug, { image, isRender, color: COLOR_OVERRIDES[slug] ?? sampleColor(image) });
  }
  return cache.get(slug);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// The art's main colour: the most common hue among its colourful pixels (greys count little),
// then brightened/saturated enough to read as a bar and flask liquid on the dark card.
function sampleColor(image) {
  const size = 64;
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  const BINS = 36;
  const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue; // transparent background
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    const w = s * s * (1 - Math.abs(2 * l - 1)); // favour saturated mid-tones over greys, black, white
    const bin = bins[Math.floor(h * BINS) % BINS];
    bin.w += w;
    bin.r += px[i] * w;
    bin.g += px[i + 1] * w;
    bin.b += px[i + 2] * w;
  }
  // Smooth over neighbouring hue bins so a hue split across two bins still wins.
  let best = 0;
  let bestScore = -1;
  bins.forEach((_, i) => {
    const score = bins[(i + BINS - 1) % BINS].w / 2 + bins[i].w + bins[(i + 1) % BINS].w / 2;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  const b = bins[best];
  if (!b.w) return '#6aa98a'; // no colour at all: the plain card's green
  const [h, s, l] = rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w);
  return hslToHex(h, Math.max(s, 0.45), Math.min(Math.max(l, 0.5), 0.65));
}

// The hero's server emoji (uploaded by `setup.py hero-emojis`), for select menu options.
function heroEmoji(guild, slug) {
  const e = guild?.emojis.cache.find((x) => x.name === slug);
  return e ? { id: e.id, name: e.name } : undefined;
}

module.exports = { HEROES, getHero, heroArt, heroEmoji, sampleColor, slugOf };
