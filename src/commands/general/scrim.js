// /scrim: a practice match between two teams of a running tournament. `challenge` asks one team, `open` asks any team. Captains only.
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it; `autocomplete` lists teams and tournaments.
// The rules and messages: utils/server/tournamentPlay.js (scrimNew, scrimView, scrimAnswer). Accept / Decline: components/tournament.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { privateReply, replyEmbed } = require('../../utils/embeds');
const T = require('../../utils/server/tournaments');
const P = require('../../utils/server/tournamentPlay');

const common = (s) => s
  .addStringOption((o) => o.setName('time').setDescription('When, like 2026-11-22 19:00 (or a Discord timestamp)').setRequired(true))
  .addNumberOption((o) => o.setName('utc-offset').setDescription("Your time zone as hours from UTC, like -5 or 1 (default: the tournament's)").setMinValue(-12).setMaxValue(14))
  .addStringOption((o) => o.setName('tournament').setDescription('Which tournament (only needed when you are in more than one)').setAutocomplete(true));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scrim')
    .setDescription('A practice match against another tournament team')
    .addSubcommand((s) => common(s.setName('challenge').setDescription('Captain: challenge one team to a scrim')
      .addStringOption((o) => o.setName('team').setDescription('The team to challenge').setRequired(true).setAutocomplete(true))))
    .addSubcommand((s) => common(s.setName('open').setDescription('Captain: post a scrim any other team can accept'))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = focused.value.toLowerCase();
    if (focused.name === 'tournament') {
      const mine = (await T.running(interaction.guildId)).filter((t) => T.teamOf(t, interaction.user.id) && t.name.toLowerCase().includes(typed));
      return interaction.respond(mine.slice(0, 25).map((t) => ({ name: t.name, value: t.id })));
    }
    const { t, team } = await P.findMine(interaction);
    if (!t) return interaction.respond([]);
    return interaction.respond(Object.values(t.teams).filter((x) => x.id !== team.id && x.name.toLowerCase().includes(typed)).slice(0, 25).map((x) => ({ name: x.name, value: x.id })));
  },

  async execute(interaction) {
    const o = interaction.options;
    const found = await P.findMine(interaction);
    if (found.error) return privateReply(interaction, found.error);
    const { t } = found;
    const open = o.getSubcommand() === 'open';
    const other = open ? null : P.findTeam(t, o.getString('team'));
    if (!open && !other) return privateReply(interaction, P.WHY_NOT.noTeam);
    const time = T.parseTime(o.getString('time'), o.getNumber('utc-offset') ?? t.utcOffset ?? 0);
    const result = await P.scrimNew(t.id, interaction.user.id, other?.id ?? null, time);
    if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const view = P.scrimView(result.t, result.scrim);
    const message = open
      ? await interaction.guild.channels.cache.get(t.signupChannelId)?.send({ ...view, allowedMentions: { parse: [] } }).catch((e) => console.error('[tournament] Scrim post failed:', e.message))
      : await P.tellMatch(interaction.guild, result.t, other, view);
    if (!message) {
      await T.change(t.id, (saved) => { delete saved.scrims?.[result.scrim.id]; return { ok: true }; });
      return interaction.editReply({ embeds: [replyEmbed('I could not post the scrim. Tell an organizer.')] });
    }
    await T.change(t.id, (saved) => { if (saved.scrims?.[result.scrim.id]) Object.assign(saved.scrims[result.scrim.id], { channelId: message.channelId ?? message.channel?.id ?? null, messageId: message.id }); return { ok: true }; });
    return interaction.editReply({ embeds: [replyEmbed(open ? `Your scrim is posted in <#${t.signupChannelId}>. The first Captain to press **Accept** gets it.` : `**${other.name}** was asked. Their Captain presses **Accept** or **Decline**.`)] });
  },
};
