// Shared by the soul-betting games (/mini-game: Guess the Door, Blackjack, Rabbit in the Hat, Borrowed Time,
// Bebop's Bombs, Powder Keg): taking the bet, the game message, the slash command and the buttons. Each game's
// rules and picture live in its own file (doorman.js, blackjack.js, sinclair.js, paradox.js, bebop.js, holliday.js).
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { changeSouls } = require('./xp');
const { fmt, soulsText, boldSouls } = require('./format');
const { replyEmbed, privateReply } = require('./embeds');
const { shortId, pickRandom } = require('./random');

const { SCALE } = require('./economy');
const MIN_BET = 10 * SCALE;
const TIME_LIMIT_MINUTES = 5; // a game with no click for this long is called off and the bet goes back

// Every game moves souls through these four, nothing else:
//   takeBet(userId, bet)   the opening bet, with the minimum check. Returns an error message, or null once taken.
//   stake(userId, amount)  any other money in (double down, split). Returns the user, or null if they can't afford it.
//   pay(userId, amount) winnings, a refund or a pot. Returns the user (amount 0 just reads the balance).
//   openGame(...)          takeBet + saving the new game, refunding the bet if the save fails.
// `reason` goes in the souls ledger ('game:<id>', see forGame); pay's `meta` is a reason or { reason, with } (a duel's pot).
const stake = (userId, amount, reason = 'game') => changeSouls(userId, -amount, reason);
const pay = (userId, amount, meta = 'game') => changeSouls(userId, amount, meta);

// A game module's own takeBet / stake / pay / openGame, tagged with its name for the ledger: `forGame(BUTTON_ID)`.
// pay's third argument is the other member when a duel's pot goes to the winner.
function forGame(name) {
  const reason = `game:${name}`;
  return {
    takeBet: (userId, bet) => takeBet(userId, bet, reason),
    stake: (userId, amount) => stake(userId, amount, reason),
    pay: (userId, amount, other) => pay(userId, amount, other ? { reason, with: other } : reason),
    openGame: (store, userId, bet, build) => openGame(store, userId, bet, build, reason),
  };
}

async function takeBet(userId, bet, reason) {
  if (!Number.isInteger(bet) || bet < MIN_BET) return `The minimum bet is ${fmt(MIN_BET)} Souls.`;
  if (!(await stake(userId, bet, reason))) return `You don't have ${soulsText(bet)} to bet.`;
  return null;
}

// Takes the bet and saves the new game (`build()` returns it; `at` is added). Returns { error } or { id, game }.
async function openGame(store, userId, bet, build, reason) {
  const error = await takeBet(userId, bet, reason);
  if (error) return { error };
  const id = shortId();
  try {
    const game = { ...build(), at: Date.now() };
    await store.set(id, game);
    return { id, game };
  } catch (e) {
    await pay(userId, bet, reason); // nothing was saved, so the timeout refund can't cover it
    throw e;
  }
}

// Once a game is over: the Bet / Won / Balance fields and a Play Again button for the same bet (only its player can press it).
// Shared by the member-vs-member games (Duel of Stances, Shotgun Roulette).
const GREEN = 0x248046;
const RED = 0xda373c;
const mention = (id) => `<@${id}>`;
const pot = (game) => game.bet * 2;
const versusLine = (game) => `${mention(game.userId)} vs ${mention(game.opponentId)}, ${boldSouls(game.bet)} each.`;

const resultFields = (bet, won, balance) => [['Bet', bet], ['Won', won], ['Balance', balance]];
const playAgainButton = (againId, bet, userId) => [`${againId}:${bet}:${userId}`, `Play Again (${fmt(bet)})`, ButtonStyle.Success];

// A game message. host: { color, name, icon (ability icon file, top left), art (folder with the host's
// portrait.png / gloat.png / injured.png), prefix (their attachment names) }.
// image: { name, data } (a new name each step, so Discord doesn't reuse the old picture), optional;
// fields: [[label, souls]]; footer: shown as given (footers can't be italic).
// buttons: one row of [customId, label, style, { emoji, disabled }?] (label may be null when there's an emoji),
// or rows: several such rows (up to 5), each either that list or a finished ActionRowBuilder (the Bookwyrm game's dropdowns).
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
    components: rows.map((row) => (row instanceof ActionRowBuilder ? row : new ActionRowBuilder().addComponents(row.map(button)))), // a finished row (dropdowns) passes through
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
  const duels = Object.values(games).filter((g) => g.game.PVP).map((g) => g.label);
  const list = (type) => new Intl.ListFormat('en', { type }).format(duels);
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
      .addUserOption((o) => o.setName('opponent').setDescription(`${list('disjunction')}: play this member instead of the host`)),
    execute(interaction) {
      const g = games[interaction.options.getString('game')];
      const opponent = interaction.options.getUser('opponent');
      if (opponent && !g.game.PVP) {
        return interaction.reply({ content: `${g.label} is played alone. Only ${list('conjunction')} can be played against a member.`, flags: MessageFlags.Ephemeral });
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

// For a solo game: the bet is all that was staked, and a time's-up view with no picture.
const staked = (game) => game.bet;
const plainTimeout = (host, lines, againId) => async (id, game, balance) =>
  timeoutMessage(host, { staked: game.bet, balance, againId, bet: game.bet, userId: game.userId, line: `"${pickRandom(lines)}"` });

// The top of a game's last message when time ran out and it was finished for the player.
function markTimedOut(payload) {
  const embed = payload.embeds?.[0];
  if (embed) embed.setDescription(`**Time ran out, so the game was finished.**\n\n${embed.data.description ?? ''}`);
  return payload;
}

// Every game with no click for TIME_LIMIT_MINUTES (also ones that ran out while the bot was off) ends.
// **A timeout finishes the game, it doesn't undo it** (his call, Oct 5: waiting out a losing hand was a free refund):
// a module's `finishOnTimeout(id, game)` returns { pays: [[user id, souls, other member (a duel's loser)?]], view: (balance) => message }
// (no side effects; this function pays), or null when nothing has been revealed yet. Only then is everything staked
// given back, with the host's time's-up message.
async function expireGames(client, gameModules, now = Date.now()) {
  const stale = (g) => !g.done && now - (g.at ?? 0) >= TIME_LIMIT_MINUTES * 60_000;
  for (const game of gameModules) {
    for (const id of Object.keys(await game.games().all())) {
      const g = await game.games().take(id, stale); // taken inside the lock, so a click at the same moment can't also play it
      if (!g) continue;
      const reason = `game:${game.BUTTON_ID}`;
      const edit = async (payload) => {
        if (!g.messageId) return;
        const channel = await client.channels.fetch(g.channelId).catch(() => null);
        await channel?.messages
          .edit(g.messageId, { ...payload, attachments: [] })
          .catch((error) => console.error('[games] Could not edit a timed-out game:', error.message));
      };
      const settled = game.finishOnTimeout?.(id, g);
      if (settled) {
        let balance = 0;
        for (const [userId, amount, other] of settled.pays) {
          const paid = await pay(userId, amount, other ? { reason, with: other } : reason);
          if (userId === g.userId) balance = paid?.souls ?? 0;
        }
        console.log(`[games] ${game.BUTTON_ID} ${id} timed out and was finished: paid ${settled.pays.map(([, amount]) => amount).join(' + ')} Souls`);
        await edit(markTimedOut(await settled.view(balance)));
        continue;
      }
      // refunds(g): [[user id, souls]] when more than the first player staked (a duel)
      let user;
      for (const [userId, amount] of game.refunds?.(g) ?? [[g.userId, game.staked(g)]]) {
        const refunded = await pay(userId, amount, reason);
        if (userId === g.userId) user = refunded;
      }
      console.log(`[games] ${game.BUTTON_ID} ${id} timed out, returned ${game.staked(g)} Souls`);
      if (g.messageId) await edit(await game.timeoutView(id, g, user?.souls ?? 0));
    }
  }
}

module.exports = { MIN_BET, TIME_LIMIT_MINUTES, forGame, takeBet, stake, pay, openGame, GREEN, RED, mention, pot, versusLine, resultFields, playAgainButton, gameMessage, betCommand, gameButtons, timeoutMessage, staked, plainTimeout, expireGames };
