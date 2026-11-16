// /tournament: everything an organizer does to run a Deadlock tournament (create, close, start, teams, seed, roster-add / roster-remove, schedule,
// result, end, cleanup), plus `bracket` and `history` for everyone.
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it; `autocomplete` lists tournaments, teams and matches.
// Sign-up and teams: utils/server/tournaments.js. Brackets, matches, ending: utils/server/tournamentPlay.js. Who is an organizer: /tournament-config.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const { privateReply, replyEmbed } = require('../../utils/embeds');
const { RANKS } = require('../../utils/server/lfg');
const T = require('../../utils/server/tournaments');
const P = require('../../utils/server/tournamentPlay');
const B = require('../../utils/server/bracket');

const choices = (map) => Object.entries(map).map(([value, name]) => ({ name, value }));
const rankChoices = RANKS.map((r) => ({ name: r, value: r }));
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const EVERYONE = new Set(['bracket', 'history']); // the subcommands that need no organizer role
const PAST = new Set(['history', 'cleanup']); // the subcommands about ended tournaments

const which = (s) => s.addStringOption((o) => o.setName('tournament').setDescription('Which tournament (only needed when more than one is running)').setAutocomplete(true));
const team = (s, name = 'team', about = 'The team') => s.addStringOption((o) => o.setName(name).setDescription(about).setRequired(true).setAutocomplete(true));
const match = (s) => s.addStringOption((o) => o.setName('match').setDescription('The match code, like R1-2').setRequired(true).setAutocomplete(true));
const member = (s) => s.addUserOption((o) => o.setName('member').setDescription('The member').setRequired(true));
const offset = (s) => s.addNumberOption((o) => o.setName('utc-offset').setDescription("Your time zone as hours from UTC, like -5 or 1 (default: the tournament's)").setMinValue(-12).setMaxValue(14));
const bestOf = (s, about) => s.addIntegerOption((o) => o.setName('best-of').setDescription(about).addChoices(...P.BEST_OF.map((n) => ({ name: `Best of ${n}`, value: n }))));

// The tournaments a subcommand can be about.
const listFor = (guildId, sub) => (PAST.has(sub) ? P.ended(guildId) : T.running(guildId));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Run a Deadlock tournament')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Organizers: set a tournament up and post its sign-up embed')
        .addStringOption((o) => o.setName('name').setDescription("The tournament's name").setRequired(true).setMaxLength(T.MAX_NAME))
        .addStringOption((o) => o.setName('format').setDescription('Bracket format').setRequired(true).addChoices(...choices(T.FORMATS)))
        .addStringOption((o) => o.setName('seeding').setDescription('How teams are placed in the bracket').setRequired(true).addChoices(...choices(T.SEEDINGS)))
        .addIntegerOption((o) => o.setName('team-size').setDescription('Players on a team (Deadlock is 6, Street Brawl is 4)').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((o) => o.setName('team-cap').setDescription('How many teams fit; more wait on the waiting list').setRequired(true).setMinValue(2).setMaxValue(64))
        .addStringOption((o) => o.setName('closes').setDescription('When sign-ups close, like 2026-11-20 18:00 (or a Discord timestamp)').setRequired(true))
        .addChannelOption((o) => o.setName('review-channel').setDescription('Where player verifications are reviewed').setRequired(true).addChannelTypes(...TEXT))
        .addNumberOption((o) => o.setName('utc-offset').setDescription('Your time zone as hours from UTC, like -5 or 1 (default 0)').setMinValue(-12).setMaxValue(14))
        .addIntegerOption((o) => o.setName('substitutes').setDescription('Substitutes a team can have (default 0)').setMinValue(0).setMaxValue(6))
        .addStringOption((o) => o.setName('highest-rank').setDescription('No player above this rank').addChoices(...rankChoices))
        .addStringOption((o) => o.setName('lowest-rank').setDescription('No player below this rank').addChoices(...rankChoices))
        .addBooleanOption((o) => o.setName('team-channels').setDescription('Make each team a text channel and a voice channel (default no)'))
        .addChannelOption((o) => o.setName('signup-channel').setDescription('Where the sign-up embed is posted (default: this channel)').addChannelTypes(...TEXT))
        .addChannelOption((o) => o.setName('match-channel').setDescription('Where match messages go when teams have no channel (default: the sign-up channel)').addChannelTypes(...TEXT))
        .addIntegerOption((o) => o.setName('ping-minutes').setDescription(`Minutes before a match both teams are pinged (default ${T.DEFAULT_PING_MINUTES})`).setMinValue(1).setMaxValue(1440)),
    )
    .addSubcommand((s) => which(s.setName('close').setDescription('Organizers: close sign-ups now and lock the rosters')))
    .addSubcommand((s) => which(bestOf(s.setName('start').setDescription('Organizers: make the bracket from the ready teams'), 'How long a match is (default Best of 1)')))
    .addSubcommand((s) => which(s.setName('teams').setDescription('Organizers: every team, who is ready and who is not')))
    .addSubcommand((s) => which(team(s.setName('seed').setDescription('Organizers: give a team its seed (for Staff Set It seeding)'))
      .addIntegerOption((o) => o.setName('seed').setDescription('1 is the top seed').setRequired(true).setMinValue(1).setMaxValue(64))))
    .addSubcommand((s) => which(member(team(s.setName('roster-add').setDescription('Organizers: put a member on a team, also after rosters lock')))
      .addBooleanOption((o) => o.setName('substitute').setDescription('As a Substitute (default: a Player)'))))
    .addSubcommand((s) => which(member(team(s.setName('roster-remove').setDescription('Organizers: take a member off a team, also after rosters lock')))))
    .addSubcommand((s) => which(bestOf(offset(match(s.setName('schedule').setDescription("Organizers: set a match's time"))
      .addStringOption((o) => o.setName('time').setDescription('Like 2026-11-22 19:00 (or a Discord timestamp)').setRequired(true))), 'How long this match is (default: the tournament\'s)')))
    .addSubcommand((s) => which(team(match(s.setName('result').setDescription('Organizers: enter or correct a result (forfeits and disputes too)')), 'winner', 'The team that won')
      .addStringOption((o) => o.setName('score').setDescription('Wins first, like 2-1 (leave empty for a forfeit)'))))
    .addSubcommand((s) => s.setName('simulate').setDescription('Organizers: try a practice tournament with fake teams. Nothing real is touched'))
    .addSubcommand((s) => which(s.setName('bracket').setDescription('The bracket: every match, its time and its result')))
    .addSubcommand((s) => which(s.setName('end').setDescription('Organizers: end the tournament and save its final places')
      .addRoleOption((o) => o.setName('winner-role').setDescription("A role for the winning team's players"))))
    .addSubcommand((s) => which(s.setName('history').setDescription('Past tournaments and their final places')))
    .addSubcommand((s) => which(s.setName('cleanup').setDescription('Organizers: delete every team channel and role of an ended tournament')
      .addChannelOption((o) => o.setName('export-channel').setDescription('Post every team chat here as a text file first').addChannelTypes(...TEXT)))),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused(true);
    const typed = focused.value.toLowerCase();
    const list = await listFor(interaction.guildId, sub);
    const respond = (options) => interaction.respond(options.filter((o) => o.name.toLowerCase().includes(typed)).slice(0, 25));
    if (focused.name === 'tournament') return respond(list.filter((t) => sub !== 'cleanup' || !t.cleanedAt).map((t) => ({ name: t.name, value: t.id })));
    const { t } = P.pick(list, interaction.options.getString('tournament'));
    if (!t) return interaction.respond([]);
    if (focused.name === 'team' || focused.name === 'winner') {
      const only = focused.name === 'winner' ? matchSides(t, interaction.options.getString('match')) : null;
      return respond(Object.values(t.teams).filter((x) => !only || only.includes(x.id)).map((x) => ({ name: x.name, value: x.id })));
    }
    if (!t.bracket) return interaction.respond([]);
    const now = B.resolve(t.bracket);
    const open = t.bracket.order.filter((id) => (sub === 'result' ? ['ready', 'done'] : ['ready', 'waiting']).includes(now[id].state));
    const side = (x) => (x === undefined ? 'To Be Decided' : P.teamName(t, x));
    return respond(open.map((id) => ({ name: `${id}: ${side(now[id].a)} vs ${side(now[id].b)}`.slice(0, 100), value: id })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!EVERYONE.has(sub) && !(await T.isOrganizer(interaction))) return privateReply(interaction, 'Only tournament organizers can use this.');
    if (sub === 'create') return create(interaction);
    if (sub === 'simulate') return require('../../utils/server/tournamentSim').simulate(interaction);

    const o = interaction.options;
    const { guild } = interaction;
    const list = await listFor(interaction.guildId, sub);
    if (sub === 'history' && !o.getString('tournament')) return interaction.reply({ embeds: [P.historyView(list)] });
    const found = P.pick(list, o.getString('tournament'));
    if (found.error) return privateReply(interaction, found.error);
    const { t } = found;
    const refuse = (result) => privateReply(interaction, P.WHY_NOT[result.reason]);
    const say = (text) => interaction.editReply({ embeds: [replyEmbed(text)] });
    const later = () => interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'history') return interaction.reply({ embeds: [P.historyView(list, t)] });
    if (sub === 'bracket') return interaction.reply({ embeds: [P.bracketView(t)] });
    if (sub === 'teams') return interaction.reply({ embeds: [P.teamsView(t)], flags: MessageFlags.Ephemeral });

    if (sub === 'close') {
      const result = await P.closeNow(t.id);
      if (!result.ok) return refuse(result);
      await later();
      await P.sweep(guild, t.id); // updates the embed and posts the teams list for the organizers
      return say(`Sign-ups for **${t.name}** are closed and rosters are locked. The teams list is in <#${t.reviewChannelId}>. Make the bracket with \`/tournament start\`.`);
    }

    if (sub === 'start') {
      const result = await P.start(t.id, { bestOf: o.getInteger('best-of') ?? 1 });
      if (!result.ok) return refuse(result);
      await later();
      const now = result.t;
      const playing = new Set(P.readyIds(now.bracket).flatMap((id) => { const m = B.resolve(now.bracket)[id]; return [m.a, m.b]; }));
      await P.announceReady(guild, now, P.readyIds(now.bracket));
      for (const id of now.bracket.seeds) if (!playing.has(id)) await P.tellMatch(guild, now, now.teams[id], `The bracket for **${now.name}** is made. **${now.teams[id].name}** has a bye in the first round.`);
      for (const left of result.left) await P.tellMatch(guild, now, left, `The bracket for **${now.name}** is made and **${left.name}** is not in it. The team was not ready, or the tournament was full.`);
      await P.tellPublic(guild, now, `The bracket for **${now.name}** is made with **${now.bracket.seeds.length}** teams. \`/tournament bracket\` shows it.`);
      const out = result.left.length ? `\n\nLeft out: ${result.left.map((x) => `**${x.name}**`).join(', ')}.` : '';
      return say(`The bracket is made with **${now.bracket.seeds.length}** teams, ${P.bestOfText(now.bestOf)}. Every team was told its first match. Set the times with \`/tournament schedule\`.${out}`);
    }

    if (sub === 'schedule') {
      const time = T.parseTime(o.getString('time'), o.getNumber('utc-offset') ?? t.utcOffset ?? 0);
      const key = t.bracket?.order.find((id) => id.toLowerCase() === o.getString('match').toLowerCase());
      if (t.bracket && !key) return refuse({ reason: 'noMatch' });
      const result = await P.schedule(t.id, key, time, o.getInteger('best-of'));
      if (!result.ok) return refuse(result);
      await later();
      if (result.state === 'ready') await P.announceReady(guild, result.t, [key]);
      const told = result.state === 'ready' ? 'Both teams were told.' : 'Its teams are told once they are known.';
      return say(`**${P.matchTitle(result.t, key)}** is set for ${P.stamp(time)}. ${told}`);
    }

    if (sub === 'result') {
      const winner = P.findTeam(t, o.getString('winner'));
      if (!winner) return refuse({ reason: 'noTeam' });
      const result = await P.organizerResult(t.id, o.getString('match'), winner.id, o.getString('score'));
      if (!result.ok) return refuse(result);
      await later();
      await P.afterResult(guild, result.t, result.matchId, result);
      return say(`**${P.matchTitle(result.t, result.matchId)}:** **${winner.name}** won. Both teams were told.`);
    }

    if (sub === 'end') {
      await later();
      const role = o.getRole('winner-role');
      const result = await P.end(guild, t.id, role?.id ?? null);
      if (!result.ok) return say(P.WHY_NOT[result.reason]);
      const won = result.champion ? `**${result.champion.name}** won.` : 'It ended with no winner.';
      const roleLine = role && result.champion ? ` ${role} was given to **${result.given}** of its players.` : '';
      if (result.champion) await P.tellPublic(guild, result.t, `**${t.name}** is over. **${result.champion.name}** won.`);
      return say(`**${t.name}** is over. ${won}${roleLine}\n\n\`/tournament history\` shows the final places. \`/tournament cleanup\` deletes the team channels and roles.`);
    }

    if (sub === 'cleanup') {
      if (t.cleanedAt) return refuse({ reason: 'cleaned' });
      const channel = o.getChannel('export-channel');
      const count = Object.keys(t.teams).length;
      const button = new ButtonBuilder().setCustomId(`${P.CLEANUP_ID}:${t.id}:${interaction.user.id}:${channel?.id ?? 0}`).setLabel('Delete Everything').setStyle(ButtonStyle.Danger);
      const saved = channel ? `Every team chat is posted in ${channel} as a text file first.` : 'The team chats are **not** saved. Give `export-channel` to save them.';
      return interaction.reply({ embeds: [replyEmbed(`This deletes the role and channels of all **${count}** teams of **${t.name}**. It can't be undone.\n\n${saved}`)], components: [new ActionRowBuilder().addComponents(button)], flags: MessageFlags.Ephemeral });
    }

    // seed, roster-add, roster-remove: about one team
    const picked = P.findTeam(t, o.getString('team'));
    if (!picked) return refuse({ reason: 'noTeam' });
    if (sub === 'seed') {
      const result = await P.setSeed(t.id, picked.id, o.getInteger('seed'));
      if (!result.ok) return refuse(result);
      const note = t.seeding === 'staff' ? '' : `\n\nThis tournament seeds **${T.SEEDINGS[t.seeding]}**, so the seed is not used.`;
      return privateReply(interaction, `**${picked.name}** is seed **${result.team.seed}**.${note}`);
    }
    const user = o.getUser('member');
    if (sub === 'roster-add') {
      if (user.bot) return privateReply(interaction, "A bot can't play.");
      const asSub = o.getBoolean('substitute') ?? false;
      const result = await P.organizerAdd(t.id, picked.id, user.id, asSub);
      if (!result.ok) return refuse(result);
      await P.tellCaptain(guild, picked, `An organizer put ${user} on the team as a ${asSub ? 'Substitute' : 'Player'}. They have to verify with \`/team verify\`.`);
      return privateReply(interaction, `${user} is on **${picked.name}** as a ${asSub ? 'Substitute' : 'Player'}. They still have to verify with \`/team verify\`.`);
    }
    const result = await P.organizerRemove(t.id, picked.id, user.id);
    if (!result.ok) return refuse(result);
    await later();
    await P.afterDrop(guild, result, user.id, `An organizer took ${user} off the team.`);
    return say(`${user} is off **${picked.name}**.${result.disbanded ? ' Nobody was left on it, so the team is removed.' : ''}`);
  },
};

// The two teams of a match (for the `winner` autocomplete), or null when the match is not known.
function matchSides(t, matchId) {
  const key = t.bracket?.order.find((id) => id.toLowerCase() === (matchId ?? '').toLowerCase());
  if (!key) return null;
  const now = B.resolve(t.bracket)[key];
  return [now.a, now.b];
}

async function create(interaction) {
  const o = interaction.options;
  const channel = o.getChannel('signup-channel') ?? interaction.channel;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const utcOffset = o.getNumber('utc-offset') ?? 0;

  const made = await T.createTournament(interaction.guildId, {
    name: o.getString('name'),
    format: o.getString('format'),
    seeding: o.getString('seeding'),
    teamSize: o.getInteger('team-size'),
    substitutes: o.getInteger('substitutes'),
    teamCap: o.getInteger('team-cap'),
    closesAt: T.parseTime(o.getString('closes'), utcOffset),
    utcOffset,
    minRank: o.getString('lowest-rank'),
    maxRank: o.getString('highest-rank'),
    teamChannels: o.getBoolean('team-channels'),
    reviewChannelId: o.getChannel('review-channel').id,
    signupChannelId: channel.id,
    matchChannelId: o.getChannel('match-channel')?.id,
    pingMinutes: o.getInteger('ping-minutes'),
    createdBy: interaction.user.id,
  });
  if (!made.ok) return interaction.editReply({ embeds: [replyEmbed(T.WHY_NOT[made.reason])] });

  // No post, no tournament.
  const t = made.tournament;
  const message = await channel.send(T.signupView(t)).catch((error) => console.error('[tournament] Sign-up post failed:', error.message));
  if (!message) {
    await T.deleteTournament(t.id);
    return interaction.editReply({ embeds: [replyEmbed(`I could not post in ${channel}. Check that I can send messages there, then run it again.`)] });
  }
  await T.updateTournament(t.id, (saved) => { saved.messageId = message.id; });

  const summary = replyEmbed(`**${t.name}** is set up. Its sign-up embed is in ${channel}.`).addFields(
    { name: 'Format', value: T.FORMATS[t.format], inline: true },
    { name: 'Seeding', value: T.SEEDINGS[t.seeding], inline: true },
    { name: 'Team Size', value: T.teamSizeText(t), inline: true },
    { name: 'Team Cap', value: `**${t.teamCap}**`, inline: true },
    { name: 'Rank Limit', value: T.rankLimitText(t), inline: true },
    { name: 'Team Channels', value: t.teamChannels ? 'On' : 'Off', inline: true },
    { name: 'Sign-Ups Close', value: `<t:${Math.floor(t.closesAt / 1000)}:F>`, inline: true },
    { name: 'Reviews', value: `<#${t.reviewChannelId}>`, inline: true },
    { name: 'Match Ping', value: `**${t.pingMinutes}** minutes before`, inline: true },
  );
  return interaction.editReply({ embeds: [summary] });
}
