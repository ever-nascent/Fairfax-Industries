// Shared by the soul-betting games (/mini-game: Guess the Door, Blackjack, Rabbit in the Hat, Borrowed Time,
// Bebop's Bombs, Powder Keg): taking the bet, the game message, the slash command and the buttons. Each game's
// rules and picture live in its own file (doorman.js, blackjack.js, sinclair.js, paradox.js, bebop.js, holliday.js).
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { changeSouls } = require('./xp');
const { fmt, soulsText } = require('./format');
const { replyEmbed, privateReply } = require('./embeds');

const MIN_BET = 10;
const TIME_LIMIT_MINUTES = 5; // a game with no click for this long is called off and the bet goes back

// Takes the bet. Returns an error message, or null once the souls are taken.
async function takeBet(userId, bet) {
  if (!Number.isInteger(bet) || bet < MIN_BET) return `The minimum bet is ${fmt(MIN_BET)} Souls.`;
  if (!(await changeSouls(userId, -bet))) return `You don't have ${soulsText(bet)} to bet.`;
  return null;
}

// Once a game is over: the Bet / Won / Balance fields and a Play Again button for the same bet (only its player can press it).
const resultFields = (bet, won, balance) => [['Bet', bet], ['Won', won], ['Balance', balance]];
const playAgainButton = (againId, bet, userId) => [`${againId}:${bet}:${userId}`, `Play Again (${fmt(bet)})`, ButtonStyle.Success];

// A game message. host: { color, name, icon (ability icon file, top left), art (folder with the host's
// portrait.png / gloat.png / injured.png), prefix (their attachment names) }.
// image: { name, data } (a new name each step, so Discord doesn't reuse the old picture), optional;
// fields: [[label, souls]]; footer: shown as given (footers can't be italic).
// buttons: one row of [customId, label, style, { emoji, disabled }?] (label may be null when there's an emoji),
// or rows: several such rows (up to 5).
// Optional: title, color (instead of the host's), rows: [] for no buttons.
function gameMessage(host, { lines, image, buttons, rows = [buttons], fields, footer, mood = 'portrait', title, color = host.color }) {
  const icon = path.basename(host.icon);
  const portrait = `${host.prefix}_${mood}.png`;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: host.name, iconURL: `attachment://${icon}` })
    .setThumbnail(`attachment://${portrait}`)
    .setDescription(lines.join('\n'));
  if (title) embed.setTitle(title);
  if (image) embed.setImage(`attachment://${image.name}`);
  if (fields) embed.addFields(fields.map(([name, souls]) => ({ name, value: soulsText(souls), inline: true })));
  if (footer) embed.setFooter({ text: footer });
  const button = ([customId, label, style, { emoji, disabled } = {}]) => {
    const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(Boolean(disabled));
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  return {
    embeds: [embed],
    files: [
      new AttachmentBuilder(host.icon, { name: icon }),
      new AttachmentBuilder(path.join(host.art, `${mood}.png`), { name: portrait }),
      ...(image ? [new AttachmentBuilder(image.data, { name: image.name })] : []),
    ],
    components: rows.map((row) => new ActionRowBuilder().addComponents(row.map(button))),
  };
}

// A game module (doorman.js, blackjack.js, sinclair.js, paradox.js, bebop.js, holliday.js) gives: BUTTON_ID, AGAIN_ID, games (its store),
// startGame(user, name, bet), staked(game) (every soul they put in) and timeoutView(id, game, balance);
// optionally posted(id, message), called once the start message is up (Powder Keg starts its clock there).

// The game id in a message's first button ('<buttonId>:<game id>:...'), or null if it's already over.
function gameIdOf(game, payload) {
  const [prefix, id] = payload.components?.[0]?.components?.[0]?.data?.custom_id?.split(':') ?? [];
  return prefix === game.BUTTON_ID ? id : null;
}

// Restarts a game's clock after a click; `extra` is saved with it (the message it's in).
const touch = (game, id, extra = {}) =>
  game.games().update(id, (g) => (g && !g.done ? { ...g, ...extra, at: Date.now() } : g));

// Starts a game for whoever ran the command or pressed Play Again, in public. `slow`: the first picture
// takes a moment to draw, so the reply is deferred (and swapped for a private error if they can't play).
// `opponent`: a User to duel (games with PVP = true only).
async function startAndPost(interaction, game, bet, slow, opponent = null) {
  if (slow) await interaction.deferReply();
  // the opponent goes last and only when there is one: games take other optional 4th arguments (a deck, a race...) and null would replace their defaults
  const result = await game.startGame(interaction.user, interaction.member.displayName, bet, ...(opponent ? [opponent] : []));
  if (!result.error) {
    const message = slow ? await interaction.editReply(result) : (await interaction.reply({ ...result, withResponse: true }))?.resource?.message;
    const id = gameIdOf(game, result);
    // remembered so the game can be called off in this message if it times out
    if (id && message) {
      await touch(game, id, { channelId: message.channelId, messageId: message.id });
      await game.posted?.(id, message);
    }
    return;
  }
  const error = { content: result.error, flags: MessageFlags.Ephemeral };
  if (!slow) return interaction.reply(error);
  await interaction.deleteReply();
  return interaction.followUp(error);
}

// One slash command for all the games: /<name> game:<choice> bet:<souls>.
// games: { value: { label, game (module), slow } }.
function betCommand(name, description, games) {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Which game')
          .setRequired(true)
          .addChoices(...Object.entries(games).map(([value, g]) => ({ name: g.label, value }))),
      )
      .addIntegerOption((o) =>
        o.setName('bet').setDescription(`Souls to bet (at least ${MIN_BET}, up to your whole balance)`).setMinValue(MIN_BET).setRequired(true),
      )
      .addUserOption((o) => o.setName('opponent').setDescription('Duel of Stances or Shotgun Roulette: play this member instead of the host')),
    execute(interaction) {
      const g = games[interaction.options.getString('game')];
      const opponent = interaction.options.getUser('opponent');
      if (opponent && !g.game.PVP) {
        return interaction.reply({ content: `${g.label} is played alone. Only Duel of Stances and Shotgun Roulette can be played against a member.`, flags: MessageFlags.Ephemeral });
      }
      return startAndPost(interaction, g.game, interaction.options.getInteger('bet'), g.slow, opponent);
    },
  };
}

// A game's button routes (see components/index.js). Game buttons are '<buttonId>:<game id>:<args...>';
// play(id, userId, args) returns a message payload, { error } (only the clicker sees it) or null (a stale
// click, ignored). Play Again is '<againId>:<bet>:<player id>' and only that player can press it.
function gameButtons(name, game, { play, slow = false }) {
  const pressed = (prefix) => (interaction) => interaction.isButton() && interaction.customId.startsWith(`${prefix}:`);
  return [
    {
      name,
      label: 'Game button',
      matches: pressed(game.BUTTON_ID),
      async execute(interaction) {
        const [, id, ...args] = interaction.customId.split(':');
        const result = await play(id, interaction.user.id, args);
        if (!result) return interaction.deferUpdate();
        if (result.error) return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        if (result.private) {
          // a secret pick: only the clicker sees the answer, the game's message is edited for everyone
          await privateReply(interaction, result.private);
          await interaction.message.edit({ ...result.update, attachments: [] });
          return touch(game, id);
        }
        await interaction.update({ ...result, attachments: [] }); // attachments: [] drops the old pictures
        return touch(game, id);
      },
    },
    {
      name,
      label: 'Play Again button',
      matches: pressed(game.AGAIN_ID),
      async execute(interaction) {
        // '<againId>:<bet>:<player id>[:<other player id>]'; a duel's rematch can be pressed by either duelist
        const [, bet, userId, otherId] = interaction.customId.split(':');
        const me = interaction.user.id;
        if (me !== userId && me !== otherId) {
          return interaction.reply({ embeds: [replyEmbed('Only the player can play again. Start your own with `/mini-game`.')], flags: MessageFlags.Ephemeral });
        }
        const opponent = otherId ? await interaction.client.users.fetch(me === userId ? otherId : userId) : null;
        return startAndPost(interaction, game, Number(bet), slow, opponent);
      },
    },
  ];
}

// A called-off game: the host gloats, the bet goes back. `line`: the host's time's-up line, shown as given.
function timeoutMessage(host, { image, staked, balance, againId, bet, userId, line }) {
  return gameMessage(host, {
    lines: ["**Time's up.**", `Your ${soulsText(staked)} came back.`],
    image,
    fields: [['Bet', staked], ['Returned', staked], ['Balance', balance]],
    buttons: [playAgainButton(againId, bet, userId)],
    footer: line,
    mood: 'gloat',
  });
}

// Calls off every game with no click for TIME_LIMIT_MINUTES (also ones that ran out while the bot was off):
// gives back everything staked and shows the host's time's-up message in the game's message.
async function expireGames(client, gameModules, now = Date.now()) {
  const stale = (g) => !g.done && now - (g.at ?? 0) >= TIME_LIMIT_MINUTES * 60_000;
  for (const game of gameModules) {
    for (const id of Object.keys(await game.games().all())) {
      const g = await game.games().take(id, stale); // taken inside the lock, so a click at the same moment can't also play it
      if (!g) continue;
      // refunds(g): [[user id, souls]] when more than the first player staked (a duel)
      let user;
      for (const [userId, amount] of game.refunds?.(g) ?? [[g.userId, game.staked(g)]]) {
        const refunded = await changeSouls(userId, amount);
        if (userId === g.userId) user = refunded;
      }
      console.log(`[games] ${game.BUTTON_ID} ${id} timed out, returned ${game.staked(g)} Souls`);
      if (!g.messageId) continue;
      const channel = await client.channels.fetch(g.channelId).catch(() => null);
      await channel?.messages
        .edit(g.messageId, { ...(await game.timeoutView(id, g, user.souls)), attachments: [] })
        .catch((error) => console.error('[games] Could not edit a timed-out game:', error.message));
    }
  }
}

module.exports = { MIN_BET, TIME_LIMIT_MINUTES, takeBet, resultFields, playAgainButton, gameMessage, betCommand, gameButtons, timeoutMessage, expireGames };
