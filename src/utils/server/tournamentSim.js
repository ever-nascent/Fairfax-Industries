// /tournament simulate: a practice tournament for organizers. Fake teams, a real bracket (the same code as a real tournament: bracket.js and
// tournamentPlay.js's bracketView), and buttons that stand in for the commands an organizer runs (`/tournament result`, `/tournament bracket`, `/tournament end`).
// Nothing is saved: no tournament, no member, no store. The only real things are the team channels, if the organizer says yes, and they are deleted at the end.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
} = require('discord.js');
const { replyEmbed } = require('../embeds');
const { pickRandom } = require('../random');
const B = require('./bracket');
const P = require('./tournamentPlay');
const T = require('./tournaments');

const ID = 'tsim';
const NAMES = ['Cursed Apples', 'Soul Urns', 'Midboss Menace', 'Rejuv Rush', 'Patron Pals', 'Walker Wreckers', 'Guardian Gang', 'Sinner Squad'];
const COUNTS = [4, 6, 8];
const IDLE_MS = 15 * 60_000;

const id = (run, ...parts) => [ID, run, ...parts].join(':');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const row = (...components) => new ActionRowBuilder().addComponents(components);
const button = (run, key, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id(run, key)).setLabel(label).setStyle(style);

// A fake tournament shaped like a real one, as far as the bracket views read it.
function fakeTournament(format, count) {
  const teams = Object.fromEntries(NAMES.slice(0, count).map((name, i) => [`t${i + 1}`, { id: `t${i + 1}`, name }]));
  const seeds = Object.keys(teams);
  return { id: 'sim', name: 'Practice Cup', format, teams, bestOf: 1, bracket: B.build(format, seeds) };
}

// Everything the organizer sees: the bracket, what is up next, and the commands they can "run".
function runView(run, sim) {
  const { t } = sim;
  const now = B.resolve(t.bracket);
  const ready = P.readyIds(t.bracket);
  const embed = P.bracketView(t);
  embed.addFields({ name: 'Up Next', value: ready.length ? ready.map((m) => P.matchLine(t, m, now[m])).join('\n').slice(0, 1000) : 'Nothing is waiting.' });
  if (sim.log.length) embed.addFields({ name: 'Commands You Ran', value: sim.log.slice(-5).join('\n').slice(0, 1000) });
  embed.setFooter({ text: 'Practice only. Nothing here is saved.' });
  const rows = [];
  const done = B.complete(t.bracket);
  if (sim.picked && now[sim.picked]?.state === 'ready') {
    const m = now[sim.picked];
    rows.push(row(
      button(run, `win:${m.a}`, `${P.teamName(t, m.a)} Won`, ButtonStyle.Success).setLabel(`${P.teamName(t, m.a)} Won`.slice(0, 80)),
      button(run, `win:${m.b}`, `${P.teamName(t, m.b)} Won`, ButtonStyle.Success).setLabel(`${P.teamName(t, m.b)} Won`.slice(0, 80)),
      button(run, 'back', 'Back'),
    ));
  } else if (!done && ready.length) {
    rows.push(row(new StringSelectMenuBuilder().setCustomId(id(run, 'match')).setPlaceholder('Run /tournament result: Pick A Match')
      .addOptions(ready.slice(0, 25).map((m) => ({ label: `${m}: ${P.teamName(t, now[m].a)} vs ${P.teamName(t, now[m].b)}`.slice(0, 100), value: m })))));
  }
  const controls = [];
  if (!done) controls.push(button(run, 'next', 'Play Next Match At Random'), button(run, 'all', 'Play Everything At Random'));
  controls.push(button(run, 'end', done ? 'End The Tournament' : 'Stop Practice', done ? ButtonStyle.Success : ButtonStyle.Danger));
  rows.push(row(...controls));
  return { embeds: [embed], components: rows };
}

// Sends `text` to a team's channel (when the organizer chose channels). Never throws.
const say = (sim, teamId, text) => sim.channels.get(teamId)?.send({ embeds: [replyEmbed(text)] }).catch(() => {});

// Tells the teams whose match just became ready.
function announceNew(sim, before) {
  const now = B.resolve(sim.t.bracket);
  for (const m of P.readyIds(sim.t.bracket)) {
    if (before.includes(m)) continue;
    for (const [mine, theirs] of [[now[m].a, now[m].b], [now[m].b, now[m].a]]) {
      say(sim, mine, `**Up Next: ${P.matchTitle(sim.t, m)}**\n**${P.teamName(sim.t, mine)}** vs **${P.teamName(sim.t, theirs)}**\nBest of **1**`);
    }
  }
}

function report(sim, matchId, winner) {
  const before = P.readyIds(sim.t.bracket);
  const now = B.resolve(sim.t.bracket)[matchId];
  const result = B.setResult(sim.t.bracket, matchId, winner);
  if (!result.ok) return;
  sim.log.push(`\`/tournament result match:${matchId} winner:${P.teamName(sim.t, winner)}\``);
  const loser = winner === now.a ? now.b : now.a;
  for (const team of [winner, loser]) say(sim, team, `**${P.matchTitle(sim.t, matchId)}**: **${P.teamName(sim.t, winner)}** won.`);
  announceNew(sim, before.filter((m) => m !== matchId));
}

const randomWinner = (sim, matchId) => { const m = B.resolve(sim.t.bracket)[matchId]; return pickRandom([m.a, m.b]); };

// The final places, as the real /tournament end shows them.
function finalView(sim) {
  const places = B.standings(sim.t.bracket).filter((p) => p.place)
    .map((p) => `**${p.place}.** ${p.teams.map((x) => P.teamName(sim.t, x)).join(', ')}`).join('\n');
  return { embeds: [replyEmbed(`${places || 'No result yet.'}\n\nThat is what \`/tournament end\` posts. Nothing was saved.`).setTitle('Practice Cup: Final Places')], components: [] };
}

async function makeChannels(interaction, sim) {
  const { guild } = interaction;
  const bot = guild.members.me;
  const category = await guild.channels.create({
    name: 'Simulation: Practice Cup', type: ChannelType.GuildCategory, reason: '/tournament simulate',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: bot.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ],
  });
  sim.category = category;
  for (const team of Object.values(sim.t.teams)) {
    sim.channels.set(team.id, await guild.channels.create({ name: `team-${slug(team.name)}`, type: ChannelType.GuildText, parent: category.id, reason: '/tournament simulate' }));
  }
}

async function cleanup(sim) {
  for (const channel of sim.channels.values()) await channel.delete('Simulation over').catch(() => {});
  await sim.category?.delete('Simulation over').catch(() => {});
  sim.channels.clear();
  sim.category = null;
}

async function simulate(interaction) {
  const run = interaction.id;
  const sim = { format: 'single', count: 4, t: null, log: [], channels: new Map(), category: null, picked: null };

  const intro = () => ({
    embeds: [replyEmbed('A practice tournament with fake teams. You get the real bracket and can run the commands an organizer uses, with buttons. Nothing is saved and no member is pinged.\n\nPick a format and how many teams, then press **Start**.').setTitle('Tournament Simulation')],
    components: [
      row(new StringSelectMenuBuilder().setCustomId(id(run, 'format')).setPlaceholder('Format')
        .addOptions(Object.entries(T.FORMATS).map(([value, label]) => ({ label, value, default: value === sim.format })))),
      row(new StringSelectMenuBuilder().setCustomId(id(run, 'count')).setPlaceholder('Teams')
        .addOptions(COUNTS.map((n) => ({ label: `${n} Teams`, value: `${n}`, default: n === sim.count })))),
      row(button(run, 'start', 'Start', ButtonStyle.Primary), button(run, 'stop', 'Cancel')),
    ],
  });
  const question = () => ({
    embeds: [replyEmbed('Real tournaments can give every team its own channel. Do you want to **create team channels** for this practice?\n\nIt makes a private category (only you and the bot see it) with one channel per team. The bot posts each team\'s matches and results there, so you see what teams see. Everything is deleted when you finish.').setTitle('Create Team Channels?')],
    components: [row(button(run, 'channels-yes', 'Yes, Create Them', ButtonStyle.Success), button(run, 'channels-no', 'No, Skip Them'), button(run, 'stop', 'Cancel'))],
  });

  const message = await interaction.reply({ ...intro(), flags: MessageFlags.Ephemeral, withResponse: true }).then((r) => r.resource.message);
  const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(`${ID}:${run}:`), idle: IDLE_MS });

  const begin = async (i, withChannels) => {
    await i.deferUpdate();
    sim.t = fakeTournament(sim.format, sim.count);
    let note = null;
    if (withChannels) {
      try { await makeChannels(interaction, sim); } catch (e) { await cleanup(sim); note = "I couldn't make the channels (I need **Manage Channels**). Going on without them."; }
    }
    announceNew(sim, []);
    if (sim.channels.size) for (const team of Object.values(sim.t.teams)) say(sim, team.id, `**${team.name}**: this is your team channel. Matches and results show up here.`);
    await i.editReply({ ...runView(run, sim), content: note ?? '' });
  };

  collector.on('collect', async (i) => {
    try {
      const [, , key, arg] = i.customId.split(':');
      if (key === 'format') { sim.format = i.values[0]; return i.update(intro()); }
      if (key === 'count') { sim.count = Number(i.values[0]); return i.update(intro()); }
      if (key === 'start') return i.update(question());
      if (key === 'channels-yes') return begin(i, true);
      if (key === 'channels-no') return begin(i, false);
      if (key === 'stop') { collector.stop('finished'); await cleanup(sim); return i.update({ embeds: [replyEmbed('Practice stopped. Nothing was saved.')], components: [] }); }
      if (key === 'match') { sim.picked = i.values[0]; return i.update(runView(run, sim)); }
      if (key === 'back') { sim.picked = null; return i.update(runView(run, sim)); }
      if (key === 'win') { report(sim, sim.picked, arg); sim.picked = null; return i.update(runView(run, sim)); }
      if (key === 'next') {
        const [m] = P.readyIds(sim.t.bracket);
        if (m) report(sim, m, randomWinner(sim, m));
        return i.update(runView(run, sim));
      }
      if (key === 'all') {
        for (let m = P.readyIds(sim.t.bracket)[0]; m; m = P.readyIds(sim.t.bracket)[0]) report(sim, m, randomWinner(sim, m));
        return i.update(runView(run, sim));
      }
      if (key === 'end') {
        const done = B.complete(sim.t.bracket);
        collector.stop('finished');
        sim.log.push('`/tournament end`');
        if (done) for (const team of Object.values(sim.t.teams)) say(sim, team.id, '**Practice Cup** is over.');
        const view = done ? finalView(sim) : { embeds: [replyEmbed('Practice stopped before the end. Nothing was saved.')], components: [] };
        await i.update(view);
        await cleanup(sim);
      }
    } catch (error) {
      console.error('[tournament simulate] A step failed:', error);
    }
  });

  collector.on('end', async (_c, reason) => {
    if (reason === 'finished') return;
    await cleanup(sim);
    interaction.editReply({ embeds: [replyEmbed('The practice stopped waiting, and its channels are gone. Run `/tournament simulate` again.')], components: [] }).catch(() => {});
  });
}

module.exports = { simulate, fakeTournament };
