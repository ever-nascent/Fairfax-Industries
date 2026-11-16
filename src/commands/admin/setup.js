// /setup (Manage Server): walks the person who ran it through everything a new server can switch on, one step at a time: welcome message, audit log,
// go-live alerts, level-up announcements, Hideouts, LFG, the Weekly Jackpot and tournament organizers. Every step can be skipped, and each does what
// its own config command does (/welcome-config, /audit-log-config, /stream-config, /xp-config, /shop-config, /lfg-config, /jackpot-config, /tournament-config).
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it, and the buttons and menus are
// answered by a collector on its own message (a wizard left for 10 minutes, or a restart, just stops: run /setup again, it never undoes anything).
const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType,
} = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { replyEmbed } = require('../../utils/embeds');
const { runInGuild } = require('../../utils/guildContext');
const { updateWelcome } = require('../../utils/server/welcome');
const audit = require('../../utils/audit/auditLog');
const streams = require('../../utils/server/streams');
const xp = require('../../utils/economy/xp');
const jackpot = require('../../utils/economy/jackpot');
const hideout = require('../../utils/shop/hideout');
const { updateShopConfig } = require('../../utils/shop/shopSettings');
const lfg = require('../../utils/server/lfg');
const tournaments = require('../../utils/server/tournaments');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const ID = 'setup';

// Each step: what it is, what it asks for (`pick`: a channel, a category, a role, or only buttons) and what it does with the answer.
// `apply` returns the line for the summary. Anything that throws is reported in the summary instead of stopping the wizard.
const STEPS = [
  {
    key: 'welcome',
    title: 'Welcome Message',
    text: 'New members get a welcome message in a channel you pick. You can change the text any time with `/welcome-config message`.\n\n**Pick the channel for it.**',
    pick: 'channel',
    apply: async (guild, channelId) => {
      await updateWelcome(guild.id, { on: true, channelId });
      return `Welcome message: on, in <#${channelId}>.`;
    },
  },
  {
    key: 'audit',
    title: 'Audit Log',
    text: 'The bot can record deleted and edited messages, joins and leaves, role changes, voice activity, mod actions and more, in one channel. Make it private for your staff.\n\n**Pick the channel for it.** Nothing is recorded until you do.',
    pick: 'channel',
    apply: async (guild, channelId) => {
      await audit.updateSettings(guild.id, (s) => { s.channelId = channelId; });
      await audit.snapshotInvites(guild);
      await audit.findDeleter(guild);
      return `Audit log: on, in <#${channelId}>. Turn single events off with \`/audit-log-config event\`.`;
    },
  },
  {
    key: 'streams',
    title: 'Go-Live Alerts',
    text: 'The bot can post when a streamer goes live on Twitch or TikTok.\n\n**Pick the channel for the alerts.** Then it asks for the streamer names. Alerts ping @everyone until you change it with `/stream-config ping`.',
    pick: 'channel',
    modal: {
      title: 'Who Do You Watch?',
      fields: [
        { id: 'twitch', label: 'Twitch Channel Name (optional)', max: 25 },
        { id: 'tiktok', label: 'TikTok Name, Without The @ (optional)', max: 24 },
      ],
    },
    apply: async (guild, channelId, values) => {
      const twitch = (values.twitch ?? '').trim().replace(/^@/, '');
      const tiktok = (values.tiktok ?? '').trim().replace(/^@/, '');
      const bad = [twitch && !/^\w{3,25}$/.test(twitch) && 'Twitch', tiktok && !/^[\w.]{2,24}$/.test(tiktok) && 'TikTok'].filter(Boolean);
      if (bad.length) throw new Error(`the ${bad.join(' and ')} name isn't valid. Use /stream-config`);
      await streams.updateConfig(guild.id, { channelId, twitch: twitch || null, tiktok: tiktok || null });
      for (const p of ['twitch', 'tiktok']) await streams.forgetStream(guild.id, p);
      const who = [twitch && `Twitch **${twitch}**`, tiktok && `TikTok **${tiktok}**`].filter(Boolean).join(' and ');
      return who ? `Go-live alerts: ${who}, in <#${channelId}>.` : `Go-live alerts: channel <#${channelId}>, no streamer yet. Add one with \`/stream-config twitch\` or \`/stream-config tiktok\`.`;
    },
  },
  {
    key: 'levels',
    title: 'Level-Up Announcements',
    text: 'Members earn XP for chatting and level up for Souls. A channel announces each level-up. Without one, nobody sees them.\n\n**Pick the channel for them.**',
    pick: 'channel',
    apply: async (guild, channelId) => {
      await xp.updateSettings(guild.id, (s) => { s.levelUpChannelId = channelId; });
      return `Level-ups: announced in <#${channelId}>.`;
    },
  },
  {
    key: 'hideouts',
    title: 'Hideouts',
    text: 'In the Shop, members level **20** and up can buy a private voice and text channel for **64,000** Souls. You can change the price and level with `/shop-config`.\n\n**Pick the category** they are made in, or let me make one called **Hideouts**.',
    pick: 'category',
    buttons: [
      { id: 'make', label: 'Make A Hideouts Category', style: ButtonStyle.Primary },
      { id: 'off', label: 'Turn Hideouts Off', style: ButtonStyle.Danger },
    ],
    apply: async (guild, categoryId, _values, button) => {
      if (button === 'off') {
        await updateShopConfig(guild.id, (s) => ({ ...s, off: [...new Set([...(s.off ?? []), 'hideout'])] }));
        return 'Hideouts: off. Turn them on with `/shop-config section`.';
      }
      await updateShopConfig(guild.id, (s) => ({ ...s, off: (s.off ?? []).filter((k) => k !== 'hideout') }));
      if (button === 'make') categoryId = await hideout.ensureCategory(guild);
      else await hideout.setCategory(guild, guild.channels.cache.get(categoryId));
      return `Hideouts: on, made in <#${categoryId}>.`;
    },
  },
  {
    key: 'lfg',
    title: 'Looking For Group',
    text: 'LFG lets members start a Deadlock lobby: it pings the ones looking for a game and makes a voice channel. Setting it up creates the **rank roles**, the **LFG ping roles**, an **LFG** category and a first region channel. I need **Manage Roles** and **Manage Channels** for that.',
    buttons: [{ id: 'go', label: 'Set Up LFG', style: ButtonStyle.Primary }],
    apply: async (guild) => {
      await lfg.ensureInfrastructure(guild, { regions: { [lfg.regionKey('Any', {})]: { label: 'Any', name: lfg.regionChannelName('Any') } } });
      return 'LFG: set up. Post the ping menu with `/lfg-config pings-menu`, add regions with `/lfg-config region-add`.';
    },
  },
  {
    key: 'jackpot',
    title: 'Weekly Jackpot',
    text: 'Members buy tickets for **1,000** Souls with `/jackpot`, and every Monday one ticket wins the pot. A channel announces the winner.\n\n**Pick the channel for it.** Without one the winner is still paid, nobody is told.',
    pick: 'channel',
    apply: async (guild, channelId) => {
      await jackpot.setChannel(guild.id, channelId);
      return `Weekly Jackpot: winners announced in <#${channelId}>.`;
    },
  },
  {
    key: 'tournaments',
    title: 'Tournament Organizers',
    text: 'People with **Manage Server** can always run tournaments. You can also let a role do it. Try it out first with `/tournament simulate`, which runs a fake tournament and touches nothing real.\n\n**Pick the organizer role.**',
    pick: 'role',
    apply: async (guild, roleId) => {
      await tournaments.setOrganizerRole(guild.id, roleId, true);
      return `Tournaments: <@&${roleId}> can run them.`;
    },
  },
];

const customId = (run, ...parts) => [ID, run, ...parts].join(':');

// The wizard's message: the step, its menu, its buttons, and what has been done so far.
function stepView(run, index, done) {
  const step = STEPS[index];
  const rows = [];
  if (step.pick === 'channel' || step.pick === 'category') {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(customId(run, 'pick')).setPlaceholder(step.pick === 'category' ? 'Choose A Category' : 'Choose A Channel')
        .setChannelTypes(step.pick === 'category' ? [ChannelType.GuildCategory] : TEXT),
    ));
  }
  if (step.pick === 'role') {
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(customId(run, 'pick')).setPlaceholder('Choose A Role')));
  }
  const buttons = (step.buttons ?? []).map((b) => new ButtonBuilder().setCustomId(customId(run, 'button', b.id)).setLabel(b.label).setStyle(b.style));
  buttons.push(new ButtonBuilder().setCustomId(customId(run, 'skip')).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(customId(run, 'stop')).setLabel('Finish').setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(buttons));
  const embed = replyEmbed(step.text).setTitle(`Setup, Step **${index + 1}** of **${STEPS.length}**: ${step.title}`);
  if (done.length) embed.addFields({ name: 'Done So Far', value: done.slice(-8).join('\n').slice(0, 1024) });
  return { embeds: [embed], components: rows };
}

const summary = (done) => ({
  embeds: [replyEmbed(done.length ? done.join('\n') : 'Nothing was changed.').setTitle('Setup Finished')
    .setFooter({ text: 'Run /setup again any time. It never undoes anything. /help lists every command.' })],
  components: [],
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Staff: set this server up step by step')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    if (!interaction.guild) return interaction.reply({ content: 'Run this in a server.', flags: MessageFlags.Ephemeral });
    const { guild } = interaction;
    const run = interaction.id;
    const done = [];
    let index = 0;

    const message = await interaction.reply({
      embeds: [replyEmbed('I will go through the things this server can switch on. Each step has a **Skip** button, and **Finish** ends it early. Nothing here deletes anything.').setTitle('Server Setup')],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId(run, 'begin')).setLabel('Start').setStyle(ButtonStyle.Primary))],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    }).then((r) => r.resource.message);

    const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(`${ID}:${run}:`), idle: 10 * 60_000 });

    // Runs a step's apply for this server (storage needs to know which one), notes the result, moves on.
    const finishStep = async (apply, i) => {
      const step = STEPS[index];
      done.push(await runInGuild(guild.id, apply).then((line) => `${line}`, (e) => `${step.title}: **not done**, ${e.message}`));
      index += 1;
      const view = index >= STEPS.length ? summary(done) : stepView(run, index, done);
      if (index >= STEPS.length) collector.stop('finished');
      return i.update(view);
    };

    collector.on('collect', async (i) => {
      try {
        const [, , action, arg] = i.customId.split(':');
        const step = STEPS[index];
        if (action === 'begin') return i.update(stepView(run, 0, done));
        if (action === 'stop') { collector.stop('finished'); return i.update(summary(done)); }
        if (action === 'skip') {
          index += 1;
          if (index >= STEPS.length) { collector.stop('finished'); return i.update(summary(done)); }
          return i.update(stepView(run, index, done));
        }
        if (action === 'button') return finishStep(() => step.apply(guild, null, {}, arg), i);
        if (action === 'pick') {
          const id = i.values[0];
          if (!step.modal) return finishStep(() => step.apply(guild, id, {}), i);
          // A step that needs words as well (the streamer names): ask in a pop-up, then apply with both.
          const modalId = `${ID}:${run}:modal`;
          await i.showModal(new ModalBuilder().setCustomId(modalId).setTitle(step.modal.title).addComponents(
            ...step.modal.fields.map((f) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(f.max))),
          ));
          const submit = await i.awaitModalSubmit({ filter: (m) => m.customId === modalId && m.user.id === i.user.id, time: 5 * 60_000 }).catch(() => null);
          if (!submit) return; // closed it: the step stays open
          const values = Object.fromEntries(step.modal.fields.map((f) => [f.id, submit.fields.getTextInputValue(f.id)]));
          return finishStep(() => step.apply(guild, id, values), submit);
        }
      } catch (error) {
        console.error('[setup] A step failed:', error);
      }
    });

    collector.on('end', (_c, reason) => {
      if (reason !== 'finished') interaction.editReply({ embeds: [replyEmbed(`Setup stopped waiting.${done.length ? `\n\n${done.join('\n')}` : ''}\nRun \`/setup\` again to carry on.`)], components: [] }).catch(() => {});
    });
  },
};
