// /lockle: guess the hero from a real Ascendant+ ranked build (match data from deadlock-api.com, unofficial).
// 6 guesses: the first shows 2 items (in buy order), each wrong guess shows 2 more; the Time field is the match
// clock when the last one shown was bought; the 6th also shows the player's souls. Daily = one build a day for everyone, private, pays DAILY_PAY by guess.
// Practice = a new build each time, public, pays nothing. Rules: server-plan.md ("Lockle").
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('node:fs');
const path = require('node:path');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { HEROES, getHero, heroEmoji } = require('./heroes');
const { MENUS } = require('./shop');
const { ASSETS } = require('./art');
const { fmt, soulsIcon } = require('./format');
const { shuffle, shortId } = require('./random');
const { RANKS } = require('./lfg');

const API = 'https://api.deadlock-api.com';
const MAX_GUESSES = 6;
const PER_GUESS = 2; // items shown per guess
const MIN_ITEMS = MAX_GUESSES * PER_GUESS;
const DAILY_PAY = [200, 170, 140, 110, 80, 50]; // by the guess it was got on
const MIN_BADGE = 101; // Ascendant I (badge = rank * 10 + subrank)
const COLOR = 0xe0b560;
const GUESS_ID = 'lockle'; // custom id: lockle:<game id ('daily' for the daily)>:<menu index>
const AGAIN_ID = 'lockle_again';

const store = () => getStore('lockle'); // 'daily' -> { day, build }; <user id> -> their daily game
const today = (now = new Date()) => now.toISOString().slice(0, 10);

// ---- builds ------------------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

// Item + hero lists, refreshed once a day (patches add items). { items: Map id -> item, heroes: Map id -> slug }
let assets;
async function getAssets() {
  if (assets?.day !== today()) {
    const [items, heroes] = await Promise.all([getJson(`${API}/v1/assets/items`), getJson(`${API}/v1/assets/heroes`)]);
    assets = {
      day: today(),
      items: new Map(items.filter((i) => i.type === 'upgrade' && i.shopable).map((i) => [i.id, i])),
      heroes: new Map(heroes.map((h) => [h.id, HEROES.find((x) => x.name === h.name)?.slug]).filter(([, slug]) => slug)),
    };
  }
  return assets;
}

// Recent Ascendant+ ranked matches with every player's items. Cached 30 min so Practice doesn't refetch each time.
// ponytail: one pool of 50 matches (~600 builds); widen the time window if the API returns too few.
let pool;
async function recentMatches() {
  if (!pool || Date.now() - pool.at > 30 * 60 * 1000) {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const matches = await getJson(
      `${API}/v1/matches/metadata?match_mode=ranked&game_mode=normal&min_average_badge=${MIN_BADGE}&min_duration_s=1500` +
        `&min_unix_timestamp=${since}&include_player_items=true&include_player_info=true&order_by=match_id&order_direction=desc&limit=50`,
    );
    pool = { at: Date.now(), matches };
  }
  return pool.matches;
}

// One player's shop purchases in buy order, or null if they don't make a puzzle (unknown hero, under MIN_ITEMS items).
function toBuild(match, player, { items, heroes }) {
  const hero = heroes.get(player.hero_id);
  const bought = (player.items ?? [])
    .filter((it) => items.has(it.item_id))
    .map((it) => {
      const item = items.get(it.item_id);
      return { name: item.name, art: item.shop_image, cost: item.cost, time: it.game_time_s, sold: it.sold_time_s || 0 };
    });
  if (!hero || bought.length < MIN_ITEMS) return null;
  return { matchId: match.match_id, hero, rank: player.player_rank_initial_display_rank || 0, souls: player.net_worth, duration: match.duration_s, items: bought };
}

async function randomBuild(rnd) {
  const [a, matches] = await Promise.all([getAssets(), recentMatches()]);
  for (const { m, p } of shuffle(matches.flatMap((m) => m.players.map((p) => ({ m, p }))), rnd)) {
    const build = toBuild(m, p, a);
    if (build) return build;
  }
  throw new Error('no usable builds in the recent matches');
}

// Today's daily build: picked by the first player of the (UTC) day and saved, so everyone gets the same one.
let dailyPick; // { day, promise } so two players starting at once don't pick two builds
async function dailyBuild(now = new Date()) {
  const day = today(now);
  const saved = await store().get('daily');
  if (saved?.day === day) return saved.build;
  if (dailyPick?.day !== day) {
    dailyPick = {
      day,
      promise: randomBuild().then(async (build) => {
        await store().set('daily', { day, build });
        return build;
      }),
    };
    dailyPick.promise.catch(() => (dailyPick = null)); // let the next player retry
  }
  return dailyPick.promise;
}

// ---- games -------------------------------------------------------------------------------------
// A game: { id, userId, build, guesses: [slug], over, won }. Practice games live in memory (no souls at stake,
// a restart just drops them); daily games are saved per player.

const practice = new Map();

async function startPractice(userId) {
  const game = { id: shortId(), userId, build: await randomBuild(), guesses: [], over: false, won: false };
  practice.set(game.id, game);
  return game;
}

// This player's daily game (made on their first look of the day).
async function startDaily(userId, now = new Date()) {
  const build = await dailyBuild(now);
  const saved = await store().get(userId);
  if (saved?.day === today(now)) return { ...saved, id: 'daily', build };
  const game = { day: today(now), userId, guesses: [], over: false, won: false };
  await store().set(userId, game);
  return { ...game, id: 'daily', build };
}

function applyGuess(game, slug) {
  if (game.over || game.guesses.includes(slug)) return false;
  game.guesses.push(slug);
  game.won = slug === game.build.hero;
  game.over = game.won || game.guesses.length >= MAX_GUESSES;
  return true;
}

// A pick from the hero dropdowns. Returns { reply } (only the clicker sees it) or { game } (redraw the message).
async function guess(gameId, userId, slug, now = new Date()) {
  if (gameId !== 'daily') {
    const game = practice.get(gameId);
    if (!game) return { reply: 'This game is over. Start a new one with `/lockle practice`.' };
    if (userId !== game.userId) return { reply: `That's <@${game.userId}>'s game. Start your own with \`/lockle practice\`.` };
    applyGuess(game, slug);
    if (game.over) practice.delete(gameId);
    return { game };
  }
  const saved = await store().get('daily');
  if (saved?.day !== today(now)) return { reply: "That was yesterday's Lockle. Run `/lockle daily` for today's." };
  let game = null;
  let changed = false;
  // inside the store lock, so a double pick can't pay twice
  await store().update(userId, (current) => {
    if (current?.day !== today(now)) return current;
    game = { ...current, guesses: [...current.guesses], build: saved.build };
    changed = applyGuess(game, slug);
    if (changed && game.won) game.souls = DAILY_PAY[game.guesses.length - 1];
    const { build, ...toSave } = game;
    return changed ? toSave : current;
  });
  if (!game) return { reply: 'Run `/lockle daily` first.' };
  if (changed && game.won) await changeSouls(userId, game.souls);
  return { game: { ...game, id: 'daily' } };
}

// ---- picture -----------------------------------------------------------------------------------
// Drawn like lockle.app: a cream panel with the build's item art in a 6-wide grid (dark empty slots for the
// ones not shown yet), then a row of guess slots with the guessed heroes (wrong ones crossed out in red),
// and "Guess n / 6" under it.

const ITEM_DIR = path.join(ASSETS, 'lockle', 'items');
const COLS = 6; // while guessing: 6 x 2, like lockle.app
const MAX_COLS = 8; // the whole build at the end: even rows, up to 8 wide
const TILE = 96;
const GAP = 12;
const SLOT = 76;
const PANEL = { x: 80, w: 740, pad: 40, margin: 52 }; // w = narrowest panel; margin = around the grid
const CREAM = '#d4c9b3';
const INK = '#3d362c';

const artCache = new Map(); // file -> Image
// The item's in-game shop art, saved to assets/lockle/items the first time it's needed.
async function itemArt(item) {
  const file = path.join(ITEM_DIR, `${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.png`);
  if (!artCache.has(file)) {
    artCache.set(file, (async () => {
      if (!fs.existsSync(file)) {
        const res = await fetch(item.art, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.mkdirSync(ITEM_DIR, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      return loadImage(file);
    })().catch((error) => {
      console.error(`[lockle] No art for ${item.name}:`, error.message);
      artCache.delete(file); // try again next time
      return null;
    }));
  }
  return artCache.get(file);
}

const heroIcons = new Map();
const heroIcon = (slug) => heroIcons.get(slug) ?? heroIcons.set(slug, loadImage(path.join(ASSETS, 'heroes', `${slug}.png`))).get(slug);

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function shadowed(g, draw, blur = 8) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = blur;
  g.shadowOffsetY = 3;
  draw();
  g.restore();
}

// shown: items revealed (in buy order); souls: the pill top right (or null).
async function renderBuild({ items, shown, guesses, answer, over, souls }) {
  const slots = Math.max(shown, MIN_ITEMS);
  // the whole build (over): even rows no wider than MAX_COLS, e.g. 14 = 2 x 7, 21 = 3 x 7; else 6 wide
  const rows = over ? Math.max(2, Math.ceil(slots / MAX_COLS)) : Math.ceil(slots / COLS);
  const cols = over ? Math.ceil(slots / rows) : COLS;
  const rowH = TILE + 16;
  const gridW = cols * TILE + (cols - 1) * GAP;
  const panelW = Math.max(PANEL.w, gridW + 2 * PANEL.margin);
  const W = panelW + 2 * PANEL.x;
  const gridX = PANEL.x + (panelW - gridW) / 2;
  const gridY = 30 + 70;
  const slotsY = gridY + rows * rowH + 24;
  const panelH = slotsY + SLOT + 34 - 30;
  const H = 30 + panelH + 90;

  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.75);
  bg.addColorStop(0, '#2c2b29');
  bg.addColorStop(1, '#151514');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  shadowed(g, () => {
    g.fillStyle = CREAM;
    g.beginPath();
    g.roundRect(PANEL.x, 30, panelW, panelH, 6);
    g.fill();
  }, 24);

  // souls pill, top right (on the last guess and after)
  if (souls != null) {
    g.font = '20px Retail';
    const text = `${fmt(souls)} Souls`;
    const w = g.measureText(text).width + 36;
    const x = PANEL.x + panelW - PANEL.pad - w;
    g.fillStyle = '#2b2a28';
    g.beginPath();
    g.roundRect(x, 48, w, 38, 4);
    g.fill();
    g.strokeStyle = '#6d675c';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#f1ead9';
    g.textAlign = 'center';
    g.fillText(text, x + w / 2, 74);
  }

  g.textAlign = 'center';
  for (let i = 0; i < slots; i++) {
    const x = gridX + (i % cols) * (TILE + GAP);
    const y = gridY + Math.floor(i / cols) * rowH;
    const item = i < shown ? items[i] : null;
    const art = item && (await itemArt(item));
    shadowed(g, () => {
      if (art) g.drawImage(art, x, y, TILE, TILE);
      else {
        g.fillStyle = item ? '#b9ad96' : '#363432';
        g.beginPath();
        g.roundRect(x, y, TILE, TILE, 3);
        g.fill();
      }
    });
    if (item && !art) { // art download failed: at least say what it is
      g.fillStyle = INK;
      g.font = '15px Retail';
      g.fillText(item.name, x + TILE / 2, y + TILE / 2 + 5, TILE - 8);
    }
  }

  // guess slots
  const slotsX = PANEL.x + (panelW - (MAX_GUESSES * SLOT + (MAX_GUESSES - 1) * 12)) / 2;
  for (let i = 0; i < MAX_GUESSES; i++) {
    const x = slotsX + i * (SLOT + 12);
    const slug = guesses[i];
    const right = slug === answer;
    g.fillStyle = '#9a9383';
    g.beginPath();
    g.roundRect(x, slotsY, SLOT, SLOT, 6);
    g.fill();
    g.strokeStyle = !slug ? '#6e685b' : right ? '#3f9b4f' : '#c8322a'; // wrong guesses get a red outline
    g.lineWidth = slug ? 5 : 3;
    g.stroke();
    if (!slug) continue;
    g.save();
    if (!right) g.globalAlpha = 0.55;
    g.drawImage(await heroIcon(slug), x + 5, slotsY + 5, SLOT - 10, SLOT - 10);
    g.restore();
  }

  // caption under the panel
  const won = guesses.at(-1) === answer;
  // Retail (the in-game font) draws ':' and '/' as a souls icon, so no times or slashes in the picture
  const caption = !over ? `Guess ${guesses.length + 1} of ${MAX_GUESSES}` : won ? `Solved in ${guesses.length} of ${MAX_GUESSES}` : 'Out of guesses';
  g.font = '44px Retail';
  g.fillStyle = !over ? '#d8cdb6' : won ? '#7fd08a' : '#e0766c';
  shadowed(g, () => g.fillText(caption, W / 2, 30 + panelH + 62), 6);
  return c.toBuffer('image/png');
}

// ---- message -----------------------------------------------------------------------------------

// heroEmoji gives { id, name } (for dropdowns), so write it out as <:name:id> for text
// The player's rank from their badge (tier * 10 + subrank, e.g. 106 = Ascendant VI) with its :rank_<name>: emoji.
// null for no rank (uncalibrated, or a build saved before ranks were kept).
function rankLabel(guild, badge) {
  const name = RANKS[Math.floor(badge / 10) - 1];
  if (!name) return null;
  const e = guild?.emojis.cache.find((x) => x.name === `rank_${name.toLowerCase()}`);
  return `${e ? `${e} ` : ''}${name} ${['I', 'II', 'III', 'IV', 'V', 'VI'][(badge % 10) - 1] ?? ''}`.trim();
}

const heroLabel = (guild, slug) => {
  const e = heroEmoji(guild, slug);
  return `${e ? `<:${e.name}:${e.id}> ` : ''}${getHero(slug).name}`;
};

async function view(game, guild, now = new Date()) {
  const { build } = game;
  const daily = game.id === 'daily';
  const round = Math.min(game.guesses.length + 1, MAX_GUESSES);
  const shown = game.over ? build.items.length : round * PER_GUESS;
  const late = game.over || round === MAX_GUESSES; // souls show from the last guess on

  const lines = [];
  const fields = [];
  // Match Time: when the last item shown was bought (the whole match once it's over).
  // Souls Spent: the shop prices of the items shown, added up (upgrades really cost less: their parts count off).
  const rank = rankLabel(guild, build.rank);
  fields.push({ name: 'Match Time', value: clock(game.over ? build.duration : build.items[shown - 1].time), inline: true });
  if (rank) fields.push({ name: 'Rank', value: rank, inline: true });
  const spent = build.items.slice(0, shown).reduce((sum, it) => sum + (it.cost ?? 0), 0);
  if (spent) fields.push({ name: 'Souls Spent', value: `${soulsIcon()}${fmt(spent)}`, inline: true });
  if (!game.over) {
    lines.push('**Whose Build Is This?**');
  } else {
    lines.push(`It was **${heroLabel(guild, build.hero)}**!`);
    const n = game.guesses.length;
    const paid = daily && game.won ? ` ${soulsIcon()}**+${fmt(game.souls ?? DAILY_PAY[n - 1])} Souls**` : '';
    lines.push(game.won ? `<@${game.userId}> got it in **${n}** ${n === 1 ? 'guess' : 'guesses'}!${paid}` : `Out of guesses, <@${game.userId}>.`);
    if (daily) {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      lines.push(`Next Lockle <t:${Math.floor(tomorrow / 1000)}:R>.`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(!game.over ? COLOR : game.won ? 0x57f287 : 0xed4245)
    .setTitle(daily ? `Lockle: ${today(now)}` : 'Lockle: Practice')
    .setDescription(lines.join('\n\n'))
    .addFields(fields)
    .setImage('attachment://build.png')
    .setFooter({ text: `Match ${build.matchId} (deadlock-api.com)` });
  const files = [new AttachmentBuilder(await renderBuild({ items: build.items, shown, guesses: game.guesses, answer: build.hero, over: game.over, souls: late ? build.souls : null }), { name: 'build.png' })];
  if (game.over) {
    embed.setThumbnail('attachment://hero.png');
    files.push(new AttachmentBuilder(path.join(ASSETS, 'heroes', `${build.hero}.png`), { name: 'hero.png' }));
  }

  const components = [];
  if (!game.over) {
    for (const [i, heroes] of MENUS.entries()) {
      const left = heroes.filter((h) => !game.guesses.includes(h.slug));
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${GUESS_ID}:${game.id}:${i}`)
            .setPlaceholder(`Guess: ${heroes[0].name} – ${heroes[heroes.length - 1].name}`)
            .addOptions(left.map((h) => ({ label: h.name, value: h.slug, emoji: heroEmoji(guild, h.slug) }))),
        ),
      );
    }
  } else if (!daily) {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(AGAIN_ID).setLabel('Play Again').setStyle(ButtonStyle.Primary)));
  }
  return { embeds: [embed], files, components };
}

module.exports = { startPractice, startDaily, guess, view, renderBuild, toBuild, applyGuess, DAILY_PAY, MAX_GUESSES, MIN_ITEMS, GUESS_ID, AGAIN_ID };
