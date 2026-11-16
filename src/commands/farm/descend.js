// /descend run [hero] [ascension] | stats | leaderboard: the roguelite mode. A slash command. `data` is what Discord shows (name, description, options);
// `execute` runs when someone uses it; `autocomplete` lists the member's unlocked heroes as they type.
// Rules: utils/farm/descent.js; screens: utils/farm/descentViews.js; buttons: components/farm.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getFarmUser, hasHero } = require('../../utils/farm/play');
const { pickView } = require('../../utils/farm/views');
const { roster } = require('../../utils/farm/hero');
const { screen, leaderboardView, statsView } = require('../../utils/farm/descentViews');
const { leaderboard, startRun, ascensionOf, MAX_ASCENSION } = require('../../utils/farm/descent');

// /descend: Hero Farming's roguelite mode (utils/farm/descent.js). Public like the farm's commands; only the runner can press its buttons.
// /descend run with a hero starts the run at once, no dropdown; ascension defaults to the highest unlocked, like the start screen.
module.exports = {
  data: new SlashCommandBuilder().setName('descend').setDescription('Take a hero down room after room, from level 0, picking items as you go')
    .addSubcommand((s) => s.setName('run').setDescription('Start a run, or carry on with the one you have')
      .addStringOption((o) => o.setName('hero').setDescription('Start at once with this hero (one you have unlocked)').setAutocomplete(true))
      .addIntegerOption((o) => o.setName('ascension').setDescription('The Ascension to start at (default: your highest)').setMinValue(0).setMaxValue(MAX_ASCENSION)))
    .addSubcommand((s) => s.setName('stats').setDescription('Your Descend records and run counters (only you see them)'))
    .addSubcommand((s) => s.setName('leaderboard').setDescription("The server's deepest runs")),

  async autocomplete(interaction) {
    const record = await getFarmUser(interaction.user.id);
    const typed = interaction.options.getFocused().toLowerCase();
    const mine = roster().filter((n) => hasHero(record, n) && n.toLowerCase().includes(typed));
    return interaction.respond(mine.slice(0, 25).map((n) => ({ name: n, value: n })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'stats') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const record = await getFarmUser(interaction.user.id);
      return interaction.editReply(statsView(interaction.member, record, await leaderboard()));
    }
    const record = await getFarmUser(interaction.user.id);
    const typed = sub === 'run' ? interaction.options.getString('hero') : null;
    const asked = sub === 'run' ? interaction.options.getInteger('ascension') : null;
    // a hero (or an ascension) asked for that can't be used: a private line, nothing posted
    const hero = typed && roster().find((n) => n.toLowerCase() === typed.trim().toLowerCase());
    const refuse = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (typed && !record.descent) {
      if (!hero) return refuse(`There is no hero called **${typed}**.`);
      if (!hasHero(record, hero)) return refuse(`You haven't unlocked **${hero}** yet.`);
      if (asked != null && asked > ascensionOf(record)) return refuse(`You have unlocked up to **Ascension ${ascensionOf(record)}**.`);
    }
    await interaction.deferReply();
    if (sub === 'leaderboard') return interaction.editReply(leaderboardView(interaction.member, await leaderboard(), record));
    if (!record.hero) return interaction.editReply(await pickView(interaction.member)); // a first hero comes from the farm (/base)
    if (hero && !record.descent) await startRun(interaction.user.id, hero, undefined, asked ?? ascensionOf(record));
    else if (record.descent && (typed || asked != null)) await interaction.followUp({ content: 'You already have a run going. Here it is.', flags: MessageFlags.Ephemeral });
    return interaction.editReply(await screen(interaction.member, await getFarmUser(interaction.user.id)));
  },
};
