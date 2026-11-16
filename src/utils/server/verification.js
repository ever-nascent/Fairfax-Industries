// Tournament player verification: what the bot can look up about a Steam account, what is wrong with it, and the review staff see.
// Sources: steamcommunity.com (the profile, is it public), the Steam Web API (Deadlock hours; needs STEAM_API_KEY in.env and public game details),
// deadlock-api.com (rank, most played heroes, win rates; unofficial, the data Statlocker and the other trackers build on).
// The team side (who is pending, approving, denying): utils/server/tournaments.js. Buttons: components/tournament.js.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { BRAND_COLOR } = require('../../config');
const { HEROES } = require('../heroes');
const { emojiNamed } = require('../guild');
const { fmt } = require('../format');
const { RANKS } = require('./lfg');

const DEADLOCK_APP = 1422450;
const STEAM64_BASE = 76561197960265728n; // a Steam64 id minus this is the account id Deadlock uses
const API = 'https://api.deadlock-api.com';
const TOP_HEROES = 5;
const RED = 0xed4245;
const GREEN = 0x57f287;
const YELLOW = 0xfee75c;

const VERIFY_ID = 'tournament_verify'; // button: tournament_verify:<tournament id>
const STEAM_MODAL_ID = 'tournament_steam'; // pop-up: tournament_steam:<tournament id>
const REVIEW_ID = 'tournament_review'; // buttons: tournament_review:<tournament id>:<team id>:<user id>:<a|d|i>
const DENY_MODAL_ID = 'tournament_deny'; // pop-up: tournament_deny:<tournament id>:<team id>:<user id>

// What a member pasted, as { id } (a 17-digit Steam64 id) or { vanity } (a custom profile name). Null if it is not a Steam profile.
function parseSteam(text) {
  const t = (text ?? '').trim();
  const id = /^(\d{17})$/.exec(t) ?? /steamcommunity\.com\/profiles\/(\d{17})/i.exec(t);
  if (id) return { id: id[1] };
  const vanity = /steamcommunity\.com\/id\/([\w-]{2,64})/i.exec(t);
  return vanity ? { vanity: vanity[1] } : null;
}

const accountIdOf = (steamId) => String(BigInt(steamId) - STEAM64_BASE);

async function get(url, fetcher, as = 'json') {
  const res = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return as === 'json' ? res.json() : res.text();
}

// Hero id -> name from deadlock-api.com, kept for a day.
let heroNames = { day: null, map: new Map() };
async function heroMap(fetcher) {
  const day = new Date().toISOString().slice(0, 10);
  if (heroNames.day !== day) heroNames = { day, map: new Map((await get(`${API}/v1/assets/heroes`, fetcher)).map((h) => [h.id, h.name])) };
  return heroNames.map;
}

// Everything the review shows about a Steam account. Returns null when there is no such profile; otherwise
// { steamId, accountId, name, url, public, hours, hoursWhy, rank, subrank, badge, matches, wins, heroes: [{ name, matches, wins }], failed: [what could not be read] }.
// hours: a number, or null with hoursWhy 'noKey' | 'private' | 'failed'. rank: a RANKS name, or null when no rank is known.
async function lookup(steam, { fetcher = fetch, key = process.env.STEAM_API_KEY } = {}) {
  const profileUrl = steam.id ? `https://steamcommunity.com/profiles/${steam.id}` : `https://steamcommunity.com/id/${steam.vanity}`;
  const xml = await get(`${profileUrl}/?xml=1`, fetcher, 'text');
  const tag = (name) => new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, 's').exec(xml)?.[1] ?? null;
  const steamId = tag('steamID64');
  if (!steamId) return null;
  const report = {
    steamId, accountId: accountIdOf(steamId), name: tag('steamID') ?? 'Unknown', url: `https://steamcommunity.com/profiles/${steamId}`,
    public: tag('privacyState') === 'public', hours: null, hoursWhy: null, rank: null, subrank: 0, badge: 0, matches: 0, wins: 0, heroes: [], failed: [],
  };

  if (!key) report.hoursWhy = 'noKey';
  else {
    try {
      const owned = (await get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_played_free_games=1&appids_filter[0]=${DEADLOCK_APP}`, fetcher)).response ?? {};
      if (!('game_count' in owned)) report.hoursWhy = 'private'; // Steam answers with nothing when game details are hidden
      else report.hours = Math.round(((owned.games ?? [])[0]?.playtime_forever ?? 0) / 60);
    } catch (error) {
      console.error('[verification] Steam hours failed:', error.message.replace(key, 'KEY')); // never log the key
      report.hoursWhy = 'failed';
      report.failed.push('Steam hours');
    }
  }

  try {
    const [rank] = await get(`${API}/v1/players/rank?account_ids=${report.accountId}`, fetcher);
    if (rank?.rank) Object.assign(report, { rank: RANKS[rank.rank - 1] ?? null, subrank: rank.subrank ?? 0, badge: rank.badge ?? 0 });
  } catch (error) {
    console.error('[verification] Rank failed:', error.message);
    report.failed.push('rank');
  }
  try {
    const [stats, names] = await Promise.all([get(`${API}/v1/players/hero-stats?account_ids=${report.accountId}`, fetcher), heroMap(fetcher)]);
    report.matches = stats.reduce((n, h) => n + h.matches_played, 0);
    report.wins = stats.reduce((n, h) => n + h.wins, 0);
    report.heroes = stats.sort((a, b) => b.matches_played - a.matches_played).slice(0, TOP_HEROES).map((h) => ({ name: names.get(h.hero_id) ?? `Hero ${h.hero_id}`, matches: h.matches_played, wins: h.wins }));
  } catch (error) {
    console.error('[verification] Hero stats failed:', error.message);
    report.failed.push('hero stats');
  }
  return report;
}

// What staff should look at, as lines. `usedBy`: another member of this tournament already verified with this Steam account.
function flagsOf(t, report, usedBy = null) {
  const flags = [];
  if (!report.public) flags.push('The Steam profile is private.');
  if (report.hoursWhy === 'private') flags.push('Deadlock hours are hidden. Their game details are private.');
  if (report.hoursWhy === 'noKey') flags.push('Hours were not checked. No Steam key is set for the bot.');
  if (!report.rank && !report.failed.includes('rank')) flags.push('No rank found for this account.');
  const at = RANKS.indexOf(report.rank);
  if (report.rank && t.maxRank && at > RANKS.indexOf(t.maxRank)) flags.push(`Rank is above the limit (${t.maxRank}).`);
  if (report.rank && t.minRank && at < RANKS.indexOf(t.minRank)) flags.push(`Rank is below the limit (${t.minRank}).`);
  if (usedBy) flags.push(`<@${usedBy}> already verified with this Steam account in this tournament.`);
  for (const what of report.failed) flags.push(`I could not read the ${what}. Try again later or check by hand.`);
  return flags;
}

const percent = (wins, matches) => (matches ? `**${Math.round((wins / matches) * 100)}%**` : '**0%**');
const rankText = (report) => (report.rank ? `${report.rank} ${report.subrank || ''}`.trim() : 'None');
function heroLine(guild, hero) {
  const slug = HEROES.find((h) => h.name === hero.name)?.slug;
  const emoji = slug && emojiNamed(guild, slug);
  return `${emoji ? `${emoji} ` : ''}${hero.name}`;
}

// The review posted for staff. `decision`: { kind: 'approved' | 'denied' | 'investigating', by, reason } once a button was pressed.
function reviewView(guild, t, team, userId, report, flags, decision = null) {
  const role = team.captainId === userId ? 'Captain' : team.members[userId]?.sub ? 'Substitute' : 'Player';
  const hours = report.hours == null ? (report.hoursWhy === 'private' ? 'Hidden' : 'Not Checked') : `**${fmt(report.hours)}**`;
  const [main] = report.heroes;
  const embed = new EmbedBuilder()
    .setColor(decision?.kind === 'approved' ? GREEN : decision?.kind === 'denied' ? RED : decision?.kind === 'investigating' ? YELLOW : flags.length ? RED : BRAND_COLOR)
    .setTitle(`Verification: ${team.name}`)
    .setDescription(`<@${userId}>, ${role} of **${team.name}** in **${t.name}**.`)
    .addFields(
      { name: 'Steam', value: `[${report.name.replace(/[[\]]/g, '')}](${report.url})`, inline: true },
      { name: 'Deadlock Hours', value: hours, inline: true },
      { name: 'Rank', value: rankText(report), inline: true },
      { name: 'Matches', value: `**${fmt(report.matches)}**`, inline: true },
      { name: 'Win Rate', value: percent(report.wins, report.matches), inline: true },
      { name: 'Main', value: main ? heroLine(guild, main) : 'None', inline: true },
    );
  if (report.heroes.length) {
    embed.addFields({ name: 'Most Played Heroes', value: report.heroes.map((h) => `${heroLine(guild, h)}: **${fmt(h.matches)}** Matches, ${percent(h.wins, h.matches)} Win Rate`).join('\n') });
  }
  if (flags.length) embed.addFields({ name: 'Flags', value: flags.map((f) => `- ${f}`).join('\n').slice(0, 1024) });
  if (decision) {
    const what = { approved: 'Approved', denied: 'Denied', investigating: 'Needs Investigation' }[decision.kind];
    embed.addFields({ name: what, value: `By <@${decision.by}>${decision.reason ? `\nReason: ${decision.reason}` : ''}` });
  }
  const done = decision?.kind === 'approved' || decision?.kind === 'denied';
  const id = (answer) => `${REVIEW_ID}:${t.id}:${team.id}:${userId}:${answer}`;
  const buttons = [
    new ButtonBuilder().setCustomId(id('a')).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(id('d')).setLabel('Deny').setStyle(ButtonStyle.Danger),
  ];
  if (!decision) buttons.push(new ButtonBuilder().setCustomId(id('i')).setLabel('Needs Investigation').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: done ? [] : [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}

const verifyButton = (tournamentId) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${VERIFY_ID}:${tournamentId}`).setLabel('Verify').setStyle(ButtonStyle.Primary));

function steamModal(tournamentId) {
  return new ModalBuilder().setCustomId(`${STEAM_MODAL_ID}:${tournamentId}`).setTitle('Verify Your Steam Account').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('steam').setLabel('Your Steam Profile Link').setPlaceholder('https://steamcommunity.com/id/yourname').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true),
    ),
  );
}

function denyModal(tournamentId, teamId, userId) {
  return new ModalBuilder().setCustomId(`${DENY_MODAL_ID}:${tournamentId}:${teamId}:${userId}`).setTitle('Deny This Player').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason (The Team Sees It)').setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(true),
    ),
  );
}

module.exports = { VERIFY_ID, STEAM_MODAL_ID, REVIEW_ID, DENY_MODAL_ID, TOP_HEROES, parseSteam, accountIdOf, lookup, flagsOf, rankText, reviewView, verifyButton, steamModal, denyModal };
