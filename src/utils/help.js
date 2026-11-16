// /help: every page of the help menu, and the message that shows one ("an in-depth, interactive help menu that goes over every
// command, and what it does and how to use the bot", with tutorials for Hero Farming, Descend and the Shop).
// A category is a list of pages; the dropdowns pick a category and a page, Back / Next step through it (a tutorial is just a category whose
// first pages are steps). A page with `command` also gets "How To Use" fields built from that command's own options (its `data`), so a new
// option shows up here by itself. Every number is read from the code's constants, so the help stays right when they change.
// Commands a member can't use are left out: staff commands (default_member_permissions), Fairfax-only ones outside Fairfax (`homeOnly`), and
// /souls' "Staff:" subcommands for members without Manage Server. To add a command: give it a page below (test/help.test.js checks every one has one).
// The command: commands/general/help.js; the dropdowns and buttons: components/help.js.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, PermissionsBitField, ApplicationCommandOptionType: T } = require('discord.js');
const { replyEmbed } = require('./embeds');
const { emojiNamed } = require('./guild');
const { fmt, soulsText } = require('./format');
const { SCALE } = require('./economy/economy');
const xp = require('./economy/xp');
const { DAILY_SOULS, WEEKLY_SOULS } = require('./economy/quests');
const jackpot = require('./economy/jackpot');
const { STYLES } = require('./shop/shop');
const { DEAL_OFF } = require('./shop/dailyDeal');
const { HIDEOUT_PRICE, HIDEOUT_LEVEL, MAX_MEMBERS } = require('./shop/hideout');
const { MIN_BET, TIME_LIMIT_MINUTES } = require('./games/casino');
const { DAILY_PAY } = require('./games/lockle');
const targets = require('./farm/targets');
const levels = require('./farm/levels');
const descent = require('./farm/descent');
const rebirth = require('./farm/rebirth');
const { ENCOUNTER_CHANCE } = require('./farm/encounter');
const { COOLDOWN: ROAM_COOLDOWN } = require('./farm/roam');
const { BRIDGE } = require('./farm/buffs');
const { MAX_REJUVS, OFFER_MS } = require('./farm/play');
const games = {
  doorman: require('./games/doorman'), blackjack: require('./games/blackjack'), sinclair: require('./games/sinclair'), bebop: require('./games/bebop'),
  yamato: require('./games/yamato'), silver: require('./games/silver'), rem: require('./games/rem'), pocket: require('./games/pocket'),
  paige: require('./games/paige'), abrams: require('./games/abrams'),
};

const CATEGORY_ID = 'help_cat'; // select: help_cat:<user id>, value = a category key
const PAGE_ID = 'help_page'; // select: help_page:<user id>:<category>, value = a page index
const TURN_ID = 'help_go'; // buttons: help_go:<user id>:<category>:<page index>:<b|n> (b / n keep Back and Next apart when both go nowhere)

// ---- little formatters ----
const pct = (x) => `${+(x * 100).toFixed(2)}%`;
const times = (x) => `${+x.toFixed(3)}×`;
const dur = (seconds) => (seconds >= 3600 ? `${+(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`);
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const multOf = (game) => times(game.winnings(1000) / 1000); // the games whose win pays one multiple of the bet
const permName = (flag) => (flag === 'ManageGuild' ? 'Manage Server' : flag.replace(/([a-z])([A-Z])/g, '$1 $2'));

// The member's view of the bot: what they may see. Built from an interaction, or by hand in tests.
function contextOf(interaction) {
  return {
    guild: interaction.guild,
    home: require('./guild').isHomeGuild(interaction.guildId),
    perms: interaction.memberPermissions ?? new PermissionsBitField(),
    commands: interaction.client.commands,
  };
}
const canUse = (command, ctx) => {
  if (!command) return false;
  if (command.homeOnly && !ctx.home) return false;
  const needs = command.data.toJSON().default_member_permissions;
  return !needs || ctx.perms.has(BigInt(needs));
};
const staffSub = (description) => description.startsWith('Staff:'); // /souls' staff subcommands sit beside the members' ones

// ---- "How To Use": built from a command's own options ----
function optionLine(o) {
  const kind = o.choices?.length ? `one of: ${o.choices.map((c) => c.name).join(', ')}` : o.autocomplete ? 'start typing, then pick from the list'
    : { [T.Boolean]: 'true or false', [T.User]: 'a member', [T.Channel]: 'a channel', [T.Role]: 'a role', [T.Attachment]: 'a file' }[o.type]
      ?? (o.min_value !== undefined && o.max_value !== undefined ? `${fmt(o.min_value)}-${fmt(o.max_value)}` : o.type === T.String ? 'text' : 'a number');
  return `- \`${o.name}\`${o.required ? '' : ' (optional)'}: ${o.description} (${kind})`;
}
function usageEntries(json, ctx) {
  const out = [];
  const add = (path, description, options = []) => {
    if (staffSub(description) && !ctx.perms.has(PermissionFlagsBits.ManageGuild)) return;
    const args = options.map((o) => (o.required ? `${o.name}:` : `[${o.name}:]`)).join(' ');
    out.push([`**\`/${path}${args ? ` ${args}` : ''}\`**  ${description}`, ...options.map(optionLine)].join('\n'));
  };
  const subs = (json.options ?? []).filter((o) => o.type === T.Subcommand || o.type === T.SubcommandGroup);
  if (!subs.length) add(json.name, json.description, json.options);
  for (const s of subs) {
    if (s.type === T.Subcommand) add(`${json.name} ${s.name}`, s.description, s.options);
    else for (const g of s.options ?? []) add(`${json.name} ${s.name} ${g.name}`, g.description, g.options);
  }
  return out;
}
// The entries packed into fields of at most 1,024 characters (Discord's limit).
function usageFields(command, ctx) {
  const json = command.data.toJSON();
  const fields = [];
  const who = [];
  if (json.default_member_permissions) who.push(`Needs ${list(new PermissionsBitField(BigInt(json.default_member_permissions)).toArray().map(permName))}.`);
  if (command.homeOnly) who.push('Only in the Fairfax server.');
  if (who.length) fields.push({ name: 'Who Can Use It', value: who.join(' ') });
  let chunk = '';
  for (const entry of usageEntries(json, ctx).map((e) => e.slice(0, 1024))) {
    if (chunk && chunk.length + entry.length + 2 > 1024) { fields.push({ name: fields.some((f) => f.name.startsWith('How')) ? 'How To Use (more)' : 'How To Use', value: chunk }); chunk = ''; }
    chunk = chunk ? `${chunk}\n\n${entry}` : entry;
  }
  if (chunk) fields.push({ name: fields.some((f) => f.name.startsWith('How')) ? 'How To Use (more)' : 'How To Use', value: chunk });
  return fields;
}

// ---- the pages ----
// Every page is { title, text, command?, home? }; `home` pages only show in the Fairfax server.
function book(ctx) {
  const ic = (name) => { const e = emojiNamed(ctx.guild, name); return e ? `${e} ` : ''; };
  const { TARGETS, SIEGE, WAVES, LANES, WALKER_STEP, CLEAR_CAP } = targets;
  const lanes = list(Object.values(LANES).map((l) => `${l.name} (${l.color})`));
  const unlockAt = Array.from({ length: levels.MAX_LEVEL + 1 }, (_, l) => l).filter((l) => l === 0 || levels.UNLOCKS(l) > levels.UNLOCKS(l - 1));
  const { doorman, blackjack, sinclair, bebop, yamato, silver, rem, pocket, paige, abrams } = games;
  const pays = (result) => times(blackjack.payout({ result, bet: 1000 }) / 1000);
  const ascensions = descent.ASCENSIONS.slice(1).map((a, i) => `**${i + 1}.** ${a.text}`);

  const categories = [
    {
      key: 'start', label: 'Getting Started', about: 'What the bot is and where to begin', emoji: 'souls',
      pages: [
        {
          title: 'Welcome to the Shop',
          text: [
            "Come on in, pal. I'm The Shopkeeper. I run the souls economy around here, the games in the back room, and I keep the heroes sharp.",
            '',
            '**How this menu works**',
            '- The first dropdown picks a **category**, the second picks a **page** in it.',
            '- **Back** and **Next** step through a category page by page. Hero Farming, Descend and the Shop open with a step-by-step tutorial.',
            '- Every command page ends with **How To Use**: each option, what it does and what to type.',
            '',
            "Start with **Souls** on the next page: everything else runs on them.",
          ].join('\n'),
        },
        {
          title: 'Souls: The One Currency',
          text: [
            `${ic('souls')}**Souls** are the money of this server. Each server has its own balance, so what you earn here stays here.`,
            '',
            '**Earn them**',
            '- Chatting: every level you reach pays souls (see Souls & XP).',
            `- \`/urn\` once a day, \`/quests\` (dailies pay ${soulsText(DAILY_SOULS)}, weeklies ${soulsText(WEEKLY_SOULS)}), \`/trivia\` and \`/lockle daily\`.`,
            '- Soul Bags that drop in chat now and then: first to press **Grab** keeps it.',
            '- Winning bets in `/mini-game`.',
            '',
            '**Spend them**',
            '- `/shop`: hero cards for your `/rank` card, Soul Boosts, Rejuvs and Hideouts.',
            '- Bets in `/mini-game`.',
            '',
            "**Hero Farming is apart:** each farm hero earns and spends its **own** souls. They never touch your balance, and your balance never buys farm items.",
            '',
            'Check your balance with `/souls balance` (only you see it).',
          ].join('\n'),
        },
        {
          title: 'Your First Day',
          text: [
            'A good first run through the joint:',
            '',
            `**1.** \`/urn\`: your free daily souls. Come back every day to grow the streak (up to ${xp.URN_MAX_DAYS} days).`,
            "**2.** `/quests`: today's and this week's goals. They pay the moment you finish them.",
            '**3.** `/trivia` and `/lockle daily`: a few right answers pay well.',
            '**4.** `/rank`: your level card. Buy a hero for it in `/shop`.',
            '**5.** `/base`: pick a hero and start **Hero Farming** (its tutorial is in this menu).',
            '**6.** `/descend run`: once you have a hero, take it down the roguelite (tutorial in this menu too).',
            `**7.** \`/mini-game\`: feeling lucky? The minimum bet is ${soulsText(MIN_BET)}.`,
          ].join('\n'),
        },
      ],
    },
    {
      key: 'xp', label: 'Souls & XP', about: 'Levels, the daily urn, quests, your balance, leaderboards', emoji: 'souls',
      pages: [
        {
          title: 'Chat XP and Levels',
          text: [
            'You earn **XP** by chatting. A counted message gives a random handful of XP, at most one message per cooldown (staff set the numbers with `/xp-config`).',
            '',
            "**What doesn't count:** bot and system messages, censored messages, repeating your last message, very short messages (if staff set a minimum length) and channels staff told me to ignore.",
            '',
            '**Voice XP** (if staff turned it on): XP every minute in a voice channel with at least one other person, as long as you are not deafened.',
            '',
            `**Levels** go up to ${xp.MAX_LEVEL}. Every level-up pays souls, more for each higher level. A ${ic('souls')}Soul Boost from \`/shop\` doubles both the XP and those souls for an hour.`,
            '',
            "**Soul Bags:** a counted chat message now and then drops a bag of souls in that channel. The first member to press **Grab** keeps it.",
          ].join('\n'),
        },
        {
          title: '/rank', command: 'rank',
          text: 'Draws your **level card**: level, XP to the next level, your rank on the server and your total XP. Name another member to see theirs.\n\nThe card shows the hero card you have equipped (bought in `/shop`, Hero Cards).',
        },
        {
          title: '/urn', command: 'urn',
          text: [
            'Claim the **daily Soul Urn**. It pays more each day in a row:',
            `- Day 1 pays ${soulsText(xp.URN_BASE)}, each day in a row adds ${soulsText(xp.URN_PER_DAY)}, up to day ${xp.URN_MAX_DAYS} (${soulsText(xp.URN_BASE + xp.URN_PER_DAY * (xp.URN_MAX_DAYS - 1))}).`,
            '- The message tells you when the next one is ready.',
            `- Miss a day and the streak breaks. If you carry a ${ic('rejuv')}**Rejuv** (from \`/shop\`), I ask whether to use it to save the streak or start over and keep it.`,
            '- A Soul Boost doubles the urn.',
          ].join('\n'),
        },
        {
          title: '/souls', command: 'souls',
          text: [
            '**`/souls balance`**: your souls, Soul Boost, Rejuvs, your urn and trivia, and your last few souls changes. Only you see it.',
            '',
            "**`/souls hero`**: one of your Hero Farming heroes' **own** souls, level, Rejuvs and permanent buffs, and its recent souls changes. Leave `hero` empty for your current hero.",
          ].join('\n'),
        },
        {
          title: '/quests', command: 'quests',
          text: [
            "Today's **daily** quests and this week's **weekly** quests, the same for everyone, with how far along you are. Only you see it.",
            '',
            `- A daily pays ${soulsText(DAILY_SOULS)}; new ones every day at midnight UTC.`,
            `- A weekly pays ${soulsText(WEEKLY_SOULS)}; new ones every Monday.`,
            '- They count chat messages, mini-game bets, won farm fights, Descend rooms, trivia answers, the urn and Lockle.',
            "- **Paid the moment you finish one.** If you finish it with a command or button, I tell you privately; otherwise `/quests` shows it.",
          ].join('\n'),
        },
        {
          title: '/jackpot', command: 'jackpot',
          text: [
            'The **Weekly Jackpot**. One Ticket is one chance, and one Ticket is drawn every Monday at midnight UTC. Its owner takes the pot.',
            '',
            `- A Ticket costs ${soulsText(jackpot.TICKET)}. You can hold **${jackpot.MAX_TICKETS}** a week.`,
            `- **${Math.round((1 - jackpot.HOUSE) * 100)}%** of every Ticket goes into the pot.`,
            '- The screen shows the pot, how many Tickets are sold, yours, and last week\'s winner.',
            '- Only you can press the Buy buttons on your screen. Every buy answers you privately.',
          ].join('\n'),
        },
        {
          title: '/leaderboard', command: 'leaderboard',
          text: "The server's **top 10** as a picture, by level and XP or by souls, with your own place underneath.",
        },
      ],
    },
    {
      key: 'shop', label: 'Shop', about: 'Tutorial: Daily Deal, hero cards, Soul Boost, Rejuv, Hideout, Color Role', emoji: 'rejuv',
      pages: [
        {
          title: 'Shop Tutorial 1: Opening the Shop',
          text: [
            '`/shop` opens **The Curiosity Shop**: the first screen shows your level, your souls and the shelf.',
            '',
            `- **Daily Deal** is the first section: one thing a day at **${Math.round(DEAL_OFF * 100)}%** off (a Hero Card, a Soul Boost or a Rejuv). One per member. It changes at midnight UTC.`,
            '- The **section dropdown** sits on top of every Shop page: Daily Deal, Hero Cards, Soul Boost, Rejuv, Hideout and Color Role.',
            "- Staff can turn sections off or change prices with `/shop-config`, so what you see may differ from these pages.",
            '- The Shop message is public, but only you can press its buttons.',
            "- Every buy answers you **privately**: a receipt, or why not (not enough souls, you already own it, you carry the most you can).",
            '- Prices are in your server souls (`/souls balance`), never your farm heroes\' souls.',
            '',
            'Press **Next** for each section.',
          ].join('\n'),
        },
        {
          title: 'Shop Tutorial 2: Hero Cards',
          text: [
            'Put a hero on your `/rank` card.',
            '',
            '**1.** Pick **Hero Cards** in the section dropdown.',
            '**2.** Pick a hero from one of the two hero dropdowns: the card redraws with that hero and your own stats.',
            `**3.** Switch the style with the buttons under the card: **${STYLES.icon.label}** (${soulsText(STYLES.icon.price)}) or **${STYLES.portrait.label}** (${soulsText(STYLES.portrait.price)}). They are sold separately.`,
            "**4.** Press **Buy**: it's greyed out if you can't afford it. Buying equips the card.",
            '**5.** Cards you own show **Equip** (or **Equipped**). **Use Plain Card** goes back to no hero.',
          ].join('\n'),
        },
        {
          title: 'Shop Tutorial 3: Soul Boost',
          text: [
            `${ic('souls')}**Soul Boost**: ${soulsText(xp.BOOST_PRICE)} for ${dur(xp.BOOST_MS / 1000)}. Buying again while one is running adds another ${dur(xp.BOOST_MS / 1000)}.`,
            '',
            '**Doubles:** chat and voice XP, the souls a level-up pays, `/urn` and `/trivia`.',
            "**Doesn't double:** mini-game winnings, quests, Lockle or anything in Hero Farming.",
            '',
            '`/souls balance` shows how long your boost has left.',
          ].join('\n'),
        },
        {
          title: 'Shop Tutorial 4: Rejuv',
          text: [
            `${ic('rejuv')}**Rejuv**: ${soulsText(xp.REJUV_PRICE)}, carry up to ${xp.REJUV_MAX}.`,
            '',
            "It saves a broken `/urn` streak: when you miss a day, `/urn` asks **Use Rejuv** (the streak carries on) or **Start Over** (you keep the Rejuv).",
            '',
            "These are the server's Rejuvs. Hero Farming Rejuvs are separate: they come from the Mid-Boss and Descend's bosses.",
          ].join('\n'),
        },
        {
          title: 'Shop Tutorial 5: Hideout',
          text: [
            `${ic('hideout')}**Hideout**: ${soulsText(HIDEOUT_PRICE)}, needs level ${HIDEOUT_LEVEL}, one per member.`,
            '',
            "Your own private **voice channel and text channel** in the Hideouts category. A control panel is pinned in the text channel:",
            '- **Rename** it (once a day; names go through the censor).',
            `- **Add / Remove Member**: up to ${MAX_MEMBERS} members can come in.`,
            '- **User Limit** for the voice channel.',
            '',
            'It hides itself while you are away from the server and opens again when you come back.',
          ].join('\n'),
        },
        {
          title: 'Shop Tutorial 6: Color Role',
          text: [
            'A role of your own, with the **name** and **color** you pick.',
            '',
            '**1.** Pick **Color Role** in the section dropdown and press **Buy**.',
            '**2.** A pop-up asks for a name and a hex color, like `#e39a3b`.',
            '**3.** I make the role and give it to you. Your name shows in that color.',
            '',
            'To change it, press **Recolor**. That costs less than the first buy.',
            'Names go through the censor. Staff set the prices with `/shop-config`.',
          ].join('\n'),
        },
        { title: '/shop', command: 'shop', text: 'Opens The Curiosity Shop. The tutorial pages before this one walk through every section.' },
      ],
    },
    {
      key: 'games', label: 'Mini-Games', about: 'Bet souls on 12 games, each hosted by a hero', emoji: 'the_doorman',
      pages: [
        {
          title: 'How Betting Works',
          text: [
            '`/mini-game game:<name> bet:<souls>` starts one game. Every game is hosted by a hero, in their own voice.',
            '',
            `- **Minimum bet** ${soulsText(MIN_BET)}, **no maximum**: bet your whole balance if you dare.`,
            '- The bet is taken when the game starts. The message is public, but only you can play it.',
            '- The payouts are the fair odds minus a small house cut.',
            `- **Time limit:** no click for ${TIME_LIMIT_MINUTES} minutes and the game is finished for you as it stands (Blackjack stands, a cash-out game cashes out what you banked). If nothing was revealed yet, you get the bet back.`,
            '- **Play Again** under a finished game starts the same game with the same bet.',
            '- **Duels:** Duel of Stances, Shotgun Roulette and Abrams\' Interrogation take an `opponent:`. They get **Accept / Decline** and stake the same bet; the winner takes the pot.',
            '',
            'Each game has its own page in this category.',
          ].join('\n'),
        },
        { title: '/mini-game', command: 'mini-game', text: 'One command for all the games. Pick the game, then the bet.' },
        {
          title: 'Guess the Door',
          text: `${ic('the_doorman')}**The Doorman's game.** Pick one of 3 rooms in The Baroness Hotel: one holds the souls. The Doorman opens an empty one, then you **Stay** or **Switch**.\n\nA win pays **${multOf(doorman)}** your bet. (Hint: think about why he opened that door.)`,
        },
        {
          title: 'Blackjack',
          text: `${ic('wraith')}**Wraith's table.** Get closer to 21 than the dealer without going over. **Hit**, **Stand**, **Double Down** or **Split**.\n\nA win pays **${pays('win')}** your bet, a blackjack **${pays('blackjack')}**. There's one **Joker** in the deck: whoever draws it wins the hand.`,
        },
        {
          title: 'Rabbit in the Hat',
          text: `${ic('sinclair')}**Sinclair's trick.** Watch the hats shuffle, then pick Hat 1, 2 or 3. Find the rabbit and win **${multOf(sinclair)}** your bet.`,
        },
        {
          title: 'Borrowed Time',
          text: `${ic('paradox')}**Paradox's clock.** Call whether the next hour is **Higher** or **Lower**. Each right call multiplies the prize by its odds (a long shot pays more). **Cash Out** any time; one wrong call loses it all.`,
        },
        {
          title: "Bebop's Bombs",
          text: `${ic('bebop')}**Bebop's minefield.** ${bebop.TILES} tiles hide ${bebop.BOMBS} ${ic('sticky_bomb')}sticky bombs. Every safe tile you open raises the prize. **Cash Out** whenever you like; hit a bomb and you lose the bet.`,
        },
        {
          title: 'Powder Keg',
          text: `${ic('holliday')}**Holliday's fuse.** The fuse burns and the multiplier climbs from 1×. Press **Cash Out** before the keg blows and you win your bet times the multiplier at that moment. Nobody knows when it blows, not even Holliday.`,
        },
        {
          title: 'Duel of Stances',
          text: `${ic('yamato')}**Yamato's rock-paper-scissors.** ${ic('power_slash')}Power Slash beats ${ic('flying_strike')}Flying Strike, Flying Strike beats ${ic('crimson_slash')}Crimson Slash, Crimson Slash beats Power Slash.\n\n- **Against Yamato:** a win pays **${multOf(yamato)}**, a tie gives the bet back.\n- **With \`opponent:\`** both pick in secret; the winner takes the pot, a tie refunds both. **Rematch** after.`,
        },
        {
          title: 'Shotgun Roulette',
          text: `${ic('silver')}**Silver's shotgun.** It's loaded with ${ic('shell_live')}live and ${ic('shell_blank')}blank shells: you see how many of each, not the order. You each have ${silver.CHARGES} ${ic('charge')}charges.\n\n- **Shoot** the other, or **Shoot Yourself**: a blank on yourself means you shoot again.\n- An empty gun reloads. Last one standing wins.\n- **Against Silver:** a win pays **${multOf(silver)}**. **With \`opponent:\`** the winner takes the pot.`,
        },
        {
          title: 'Remling Race',
          text: `${ic('rem')}**Rem's race.** Five ${ic('remling_red')}Remlings, each with its own chance to win (${list(rem.SHARES.map((s) => `${s}%`))}, dealt to the lanes at random every race). Back one from the dropdown: it shows each Remling's payout. A win pays from **${times(rem.oddsFor(Math.max(...rem.SHARES)))}** for the favourite to **${times(rem.oddsFor(Math.min(...rem.SHARES)))}** for the long shot.`,
        },
        {
          title: 'Deal or No Deal',
          text: `${ic('pocket')}**Pocket's suitcases.** ${pocket.CASES} cases hold from ${times(Math.min(...pocket.VALUES))} to ${times(Math.max(...pocket.VALUES))} your bet. Pick one to keep, then open the rest in rounds (${pocket.ROUNDS.join(', ')}). After each round Pocket makes an offer: **Deal** takes it, **No Deal** plays on. At the end, **Keep** your case or **Swap** it for the last one.`,
        },
        {
          title: "Don't Wake the Bookwyrm",
          text: `${ic('paige')}**Paige's hangman.** Guess a Deadlock name (a hero, ability or item) letter by letter from the two letter dropdowns, or press **Solve It** to type the whole thing (a wrong solve counts as a wrong guess).\n\n${paige.MAX_WRONG} wrong guesses wake the Bookwyrm and lose the bet. Solving pays **${times(paige.PAYOUT[0])}** with no wrong guesses, less for each one, down to **${times(paige.PAYOUT.at(-1))}**. The message shows what solving pays right now.`,
        },
        {
          title: "Abrams' Interrogation",
          text: `${ic('abrams')}**Abrams' Guess Who.** The culprit is one of the heroes. Each turn you get ${abrams.HAND} yes/no questions to pick from; the case board crosses off who it can't be. When you know, press **Accuse...** and name them.\n\n- **Solo:** at most ${abrams.MAX_QUESTIONS} questions. The right name pays **${times(abrams.PAYOUT[0])}** with no questions asked, less for each question, down to **${times(abrams.PAYOUT[abrams.MAX_QUESTIONS])}**. A wrong name loses.\n- **With \`opponent:\`** you each pick a secret hero and take turns. The first right accusation takes the pot; a wrong one hands it over.`,
        },
      ],
    },
    {
      key: 'trivia', label: 'Trivia & Lockle', about: "Dynamo's quiz and the daily guess-the-hero", emoji: 'dynamo',
      pages: [
        {
          title: '/trivia', command: 'trivia',
          text: [
            `${ic('dynamo')}**Dynamo's Classroom.** One question about heroes or items, one guess, only you can answer. No mode = any question.`,
            '',
            `- A right answer pays ${soulsText(xp.TRIVIA_BASE)}, plus ${soulsText(xp.TRIVIA_STEP)} for every right answer in a row before it (up to ${xp.TRIVIA_MAX_STREAK} in a row). A wrong answer or running out of time resets the streak.`,
            `- Only ${xp.TRIVIA_DAILY} right answers a day pay (midnight UTC); after that it's for fun.`,
            '- Some questions are buttons, some a dropdown, some you type in a pop-up; those get more time.',
            '- A Soul Boost doubles the pay.',
          ].join('\n'),
        },
        {
          title: '/lockle', command: 'lockle',
          text: [
            'Guess the hero from a **real high-rank build** (Ascendant and up). Pick your guess from the hero dropdowns; every wrong guess shows more of the build.',
            '',
            `- **\`/lockle daily\`:** the same build for everyone, new at midnight UTC. Private. Pays ${list(DAILY_PAY.map((p, i) => `${soulsText(p)} on guess ${i + 1}`))}.`,
            '- **`/lockle practice`:** a random build, public, no souls. Play as many as you like.',
          ].join('\n'),
        },
      ],
    },
    {
      key: 'farm', label: 'Hero Farming', about: 'Tutorial: heroes, targets, items, levels, rivals, the Broker', emoji: 'haze',
      pages: [
        {
          title: 'Farming Tutorial 1: Pick Your Hero',
          text: [
            "**Hero Farming** is a game of its own: you send a Deadlock hero after camps, lane bosses and the enemy base, and it grows stronger with every trip.",
            '',
            '**1.** Run `/base`. The first time, it opens the **hero pick**: your first hero is free.',
            '**2.** Everything is saved **per hero**: its own souls, level, items, ability points, cooldowns, buffs and Rejuvs.',
            '**3.** More heroes are unlocked with **Character Unlock Tokens** (step 10). Switching between unlocked heroes is free (**Switch Hero** on `/base`).',
            '',
            "Farm messages are public, but only you can press the buttons that act. Anyone can press **Hero**, the build buttons or **Damage Breakdown** to see yours privately.",
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 2: The Base and Its Targets',
          text: [
            '`/base` shows your hero and a dropdown of every target with **Ready** or the time left. Each one has its own cooldown:',
            '',
            ...Object.values(TARGETS).map((t) => `- **${t.name}**: every ${dur(t.cooldown)}`),
            `- **Roam**: every ${dur(ROAM_COOLDOWN)}`,
            `- **Waves**: once every ${dur(WAVES.cooldown)} per lane`,
            `- **Base Siege**: every ${dur(SIEGE.cooldown)}`,
            '',
            'The other commands jump straight to a target: `/jungle`, `/lane`, `/siege`.',
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 3: Sending a Fight',
          text: [
            '**1.** Pick a target: its details screen shows the enemies and what they pay.',
            '**2.** Press **Send**. The fight plays out in the message, updating every few seconds with health bars and a battle log.',
            "**3.** Win and your hero's **own souls** go up. Lose and you get nothing.",
            "**4.** Either way the target's cooldown starts.",
            '',
            '**Damage Breakdown** (under every result) has five pages: your damage by gun, melee, each ability and each item; the enemies\' damage; your healing; your build and the enemies\' build as the fight started.',
            '',
            `**Targets grow:** every clear makes that target stronger for you, up to ${CLEAR_CAP} clears. A lost fight takes one clear back, so it settles where you can still beat it.`,
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 4: Levels and Ability Points',
          text: [
            `A hero **levels up** from the souls its trips have paid, up to level ${levels.MAX_LEVEL}. Each level is a boon: more health, damage and spirit.`,
            '',
            `- **Abilities unlock** at levels ${list(unlockAt.map(String))}, in slot order.`,
            `- **Ability points** come with levels (${levels.POINTS(levels.MAX_LEVEL)} at the max). Upgrading an ability costs ${list(levels.TIER_COSTS.map((c, i) => `${c} for tier ${i + 1}`))}.`,
            '- Spend them from `/hero view` (or **Hero** on `/base`): the dropdown under the hero card.',
            '',
            "`/hero view` draws the hero card: level, the three stat panels, items and the ability bar.",
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 5: Items and the Item Shop',
          text: [
            `Open the **Item Shop** from the \`/base\` dropdown or the hero screen. It's drawn like the in-game shop, paid with your hero's own souls.`,
            '',
            `- Tabs: **Weapon**, **Vitality**, **Spirit**, plus the **Broker** and **Sell**. The price buttons switch tiers; buy from the dropdown.`,
            `- **${levels.MAX_ITEMS} item slots**, any mix. Buying with a full build asks which item to sell for it.`,
            '- **Upgrades:** owning a component makes its upgrade cost only the difference (the component is used up).',
            `- **Selling** gives back ${pct(levels.sellPrice({ Cost: 1000 }) / 1000)} of the price.`,
            '- Items that **imbue** an ability ask which one; change it free on the hero screen.',
            '',
            "Every item's real effect is simulated in fights. Look any item up with `/item`.",
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 6: Roaming and Buffs',
          text: [
            `\`/jungle roam\` (every ${dur(ROAM_COOLDOWN)}) sends your hero around the map. No fight: it brings back a haul of crates, Sinner's Sacrifices and Golden Statues, drawn on one card.`,
            '',
            '- **Permanent buffs:** a roam can find them. They are kept on that hero for good. Which buffs can be found changes every day.',
            `- **Bridge buffs:** a roam may also find this hour's bridge buff (${list(Object.values(BRIDGE).map((b) => b.name))}). It's held until your next fight, which uses it up.`,
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 7: Lanes, Walkers and Waves',
          text: [
            `There are three lanes: ${lanes}. Each has its own **Guardian** and **Walker**.`,
            '',
            `- \`/lane guardian\`: beat it and it stays down for its cooldown (${dur(TARGETS.guardian.cooldown)}).`,
            `- \`/lane walker\`: only while that lane's Guardian is down. It has ${fmt(WALKER_STEP)} more health for every other Walker already down, and stays down ${dur(TARGETS.walker.cooldown)}.`,
            `- \`/lane wave\`: an endless run of lane troopers, once every ${dur(WAVES.cooldown)} per lane. Every wave cleared pays (${soulsText(targets.wavePay(1))} for the first, more for each after) and each wave is stronger. Falling loses nothing you earned.`,
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 8: Mid-Boss, Rejuvs and the Siege',
          text: [
            `- **Mid-Boss** (\`/jungle midboss\`, every ${dur(TARGETS['mid-boss'].cooldown)}): a hard fight that drops a **Rejuv**. A hero carries up to ${MAX_REJUVS}.`,
            '- **Rejuvs** are used in the siege: when your hero dies, it gets back up at full health.',
            `- **Base Siege** (\`/siege\`, every ${dur(SIEGE.cooldown)}): needs **all three Walkers down**. The Base Guardians, both Shrines and the Patron in one go, health carrying through. It needs a full, well-chosen build and your Rejuvs.`,
            '',
            "A hero's **first siege win** pays a Character Unlock Token (step 10), and a siege win is what makes Rebirth possible (see Descend).",
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 9: Legendaries',
          text: [
            `There are ${levels.LEGENDARY_NAMES.length} **legendaries**: the game's Tier 5 items. They can't be bought, only found.`,
            '',
            `- Every enemy killed in a won fight has a small chance to drop one; a won siege rolls ${pct(levels.SIEGE_LEGENDARY_CHANCE)} once.`,
            '- A legendary gets its **own slot**, on top of the normal ones.',
            '- Every legendary a hero finds is kept. Change which one is in the slot from the hero screen (**Change your legendary**).',
            '- Legendaries are never sold.',
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 10: Rivals and New Heroes',
          text: [
            `**Rivals:** after a won fight there's a ${pct(ENCOUNTER_CHANCE)} chance a rival hero shows up. **Fight** for a full hero-versus-hero duel, or **Walk Away**. A rival waits ${dur(OFFER_MS / 1000)} from when the result shows.`,
            '',
            '**Character Unlock Tokens** unlock more heroes (no souls price). You earn one:',
            "- for each hero's first siege win,",
            `- for clearing Descend room ${descent.TOKEN_ROOM} (once),`,
            '- for each Descend Ascension cleared the first time.',
            '',
            "Spend a token with `/hero unlock` (or **Switch Hero** on `/base`). Tokens are only paid while you have more heroes left to unlock than tokens.",
          ].join('\n'),
        },
        {
          title: 'Farming Tutorial 11: The Broker',
          text: [
            `**The Broker** opens for ${dur(levels.BROKER.open / 1000)} every ${dur(levels.BROKER.every / 1000)} (UTC). Find him in the Item Shop's Broker tab.`,
            '',
            '- He **corrupts** one owned tier 3 or 4 item per hero, for its price again.',
            "- A corrupted item gets extra bonuses, and your hero gets one random **drawback**.",
            "- It sells for half of both prices and can't be used up by an upgrade.",
            '',
            "See what an item turns into with `/item` and its **Corrupted** button.",
          ].join('\n'),
        },
        { title: '/base', command: 'base', text: "Hero Farming's home: the hero pick the first time, then your hero, every target with its cooldown, the Item Shop, Hero and Switch Hero." },
        { title: '/jungle', command: 'jungle', text: 'Camps of Haunts (each Haunt rolls a trait like Armored or Brittle), the roam, and the Mid-Boss. Opens the target\'s details screen with **Send**.' },
        { title: '/lane', command: 'lane', text: "A lane's Guardian, its Walker, or its trooper waves. Pick the lane in the `lane` option." },
        { title: '/siege', command: 'siege', text: 'The Base Siege details screen, drawn as a card. It unlocks once all three Walkers are down.' },
        { title: '/hero', command: 'hero', text: '`view`: your hero card, with the ability point and legendary dropdowns and the Item Shop button. `unlock`: spend a Character Unlock Token on a new hero.' },
      ],
    },
    {
      key: 'descend', label: 'Descend', about: 'Tutorial: the roguelite, ascensions, Rebirth', emoji: 'rank_eternus',
      pages: [
        {
          title: 'Descend Tutorial 1: Starting a Run',
          text: [
            '**Descend** is Hero Farming\'s roguelite: one hero goes down room after room, starting from **level 0 with no items**.',
            '',
            '**1.** `/descend run`, pick one of your unlocked heroes and an **Ascension** (0 to start; see step 10).',
            '**2.** Press **Fight** on the room screen.',
            '',
            "- A run never touches that hero's farm souls, items or level.",
            '- One run at a time. `/descend run` carries on the one you have.',
            '- **Build** shows your run build; **Abandon Run** ends it.',
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 2: Floors and Rooms',
          text: [
            `${descent.FLOORS} Floors of ${descent.ROOMS_PER_FLOOR} rooms: ${descent.LAST_ROOM} rooms in all. The last room of every Floor is a **boss**.`,
            '',
            '**The Floors:**',
            ...descent.FLOOR_NAMES.map((n, i) => `${i + 1}. ${n}`),
            '',
            `**Doors:** after a room you pick the next one from **${descent.DOORS}** doors. A boss is the only way forward.`,
            '- **Fight Room:** the door shows its enemies. A Level and a pick for winning.',
            '- **Mystery Room:** a Rival, a hero with a deal, a Wounded Rival or the Broker. What is inside is not shown.',
            '- **Rest Stop, A Quiet Corner, The Rift, The Soul Urn, The Curiosity Dealer, A Teleporter:** a Level and what is inside. No pick, unless you win the Rift.',
            '',
            "- The room screen tells you what's in the room before you fight.",
            '- Deeper in, enemies can carry **affixes**, shown like **[Plated]** on their name (tougher, cursing, stunning, healing...).',
            '- Enemies get stronger room by room.',
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 3: Health and Dying',
          text: [
            `- **Health carries** from room to room. ${descent.REST ? `A won room gives back ${pct(descent.REST)} of your max health` : 'Winning a room heals nothing'}; a won boss heals you back up.`,
            '- **One death ends the run**, unless you hold a **Rejuv**: bosses give them, and one gets you back up mid-fight.',
            '- Your best run is kept for the leaderboard.',
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 4: Picks, Skip and Reroll',
          text: [
            'Every won room is **+1 level** and a pick:',
            '',
            "- **Pick 1 of 3 items** (weapon, vitality or spirit), the tiers rising as you go down. Look at each with the **View Item** dropdown first.",
            '- An offered upgrade of an item you hold replaces it in place.',
            `- **${levels.MAX_ITEMS} slots.** With a full build, taking an item asks which one to give up (no sell-back).`,
            `- **Reroll:** new choices, ${descent.REROLLS_PER_FLOOR} per Floor.`,
            `- **Skip:** take nothing, heal ${pct(descent.SKIP_HEAL)} and get ${descent.SKIP_BUFFS} random buffs for the rest of the run. Skipping a legendary gives ${descent.LEGEND_SKIP_BUFFS} random buffs instead, no heal (the boss already healed you).`,
            '',
            `A won fight also has a ${pct(descent.LITTLE_BUFF_CHANCE)} chance to turn up a permanent buff.`,
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 5: Levels and Ability Points',
          text: [
            `Each level in a run works like the farm: a boon, ability points, and abilities unlocking at levels ${list(unlockAt.map(String))}.`,
            '',
            '- Spend points from the **ability point dropdown** on the room screen, before you press Fight.',
            `- Upgrades cost ${list(levels.TIER_COSTS.map((c, i) => `${c} for tier ${i + 1}`))}.`,
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 6: Rivals, Heroes and the Rift',
          text: [
            'Behind a **Mystery Room** door a **hero** can be waiting. Sometimes a **rival** to fight, sometimes a **wounded hero** to assist, sometimes a hero with an **offer**.',
            '',
            `- **A rival:** a full hero duel. Its build is rolled around yours, ${descent.RIVAL.levels} levels lower, at ${pct(descent.RIVAL.health)} health. **Fight** or **Walk Away** (pass with nothing). **Win** and you get +1 level, the usual buff chance and your pick of **any one item from its build**, or **Recruit** it as a temporary ally for a few fights.`,
            "- **A wounded hero:** **Recruit** them and they fight beside you for a few fights, then leave you any one Item from their build; or leave them.",
            "- **An offer:** **Accept** (or pick the Item their deal takes) or **Turn Down**. Either way you gain a level and a pick.",
            "  - Violet copies an Item.",
            "  - McGinnis upgrades one (or trades one for her Mini Turret).",
            "  - Graves lends Ghouls.",
            "  - Solomon castles an Item.",
            "  - Sinclair lends his Assistant.",
            "  - Paige writes you Plot Armor.",
            "  - Victor stitches two of your Items into one (they take one slot; if he fails both turn Fragile).",
            "  - Paradox seals an Item with a cooldown in a Time Capsule (back before the Floor ends, its cooldown shorter for every room it was away).",
            "  - Mirage's Traveler takes you to a room type you pick for the next room.",
            "  - Rem tucks in a Lil Helper you feed Items (it fights, and its resist helps you).",
            "  - Dynamo grades your hero and coaches you on one enemy of the next Floor.",
            "  - Infernus tempers an Item in his fire (each Stoke adds to its stats, and each one after the first can burn it to ash), the Doorman places a Doorway (at your next choice of doors, the door you did not pick stays open and you can play both rooms).",
            "  - Ivy promises to pluck you out of the next fight that would kill you and set you down at a Rest Stop **3** rooms back (the rooms from there are fought again for no Level and no pick).",
            `- **The Rift:** an event room where 1 to ${descent.RIFT.heroes[1]} heroes fight over an Unstable Rift, everyone against everyone. Win it and **${descent.MINIONS.rift.count} Rift Troopers** fight beside you for the rest of the Floor. Lose it and you flee with what health you have left, at least ${pct(descent.RIFT.flee)}: it can't end your run.`,
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 7: Bosses',
          text: [
            'The last room of each Floor is a **boss**: a real Deadlock boss sized to the depth (Guardian, Walker, Mid-Boss, Base Guardian, Shrine).',
            '',
            '- A boss gives a **Rejuv**.',
            `- Then a pick of 3 **permanent buffs** (each worth ${descent.BOSS_BUFFS} stacks), or on some Floors a pick of 3 **legendaries**.`,
            `- **Room ${descent.LAST_ROOM}** is the Patron, then the Weakened Patron, in one fight. Beat it and the descent is **cleared**.`,
          ].join('\n'),
        },
        {
          title: "Descend Tutorial 8: The Broker's Stall",
          text: [
            `From room ${descent.BROKER_FROM} a **Mystery Room** is sometimes **the Broker's stall** (at most ${descent.BROKER_MAX} a run). No fight, no level, no pick.`,
            '',
            `- **Corrupt** a tier 3 or 4 item you hold: it gets the corrupted bonuses and your hero a drawback. The price is ${pct(descent.BROKER_COST)} of your max health.`,
            "- **View Item** shows what an item turns into first. **Leave** is free.",
            "- **Fragile Items:** meet him with no tier 3 or 4 item and he pushes a weaker, cracked item on you. It shatters if you use a Rejuv in a won fight or drop very low mid-fight. A later stall mends it into an Enhanced item, free.",
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 9: Tokens and the Leaderboard',
          text: [
            `- Clearing room **${descent.TOKEN_ROOM}** pays a **Character Unlock Token**, once per member.`,
            '- Clearing each **Ascension** the first time pays one too.',
            '- `/descend leaderboard`: the server\'s deepest runs, the highest Ascension first, then the most rooms.',
          ].join('\n'),
        },
        {
          title: 'Descend Tutorial 10: Ascensions',
          text: [
            `Clear a descent and the next **Ascension** unlocks, up to ${descent.MAX_ASCENSION}. Clearing Ascension N unlocks N + 1 for **every** hero you have.`,
            '',
            '- You pick the Ascension on the start screen; it stays the same for the whole run.',
            '- **They stack:** Ascension 5 has the rules of 1 to 5.',
            '',
            "The next page lists every Ascension's rule.",
          ].join('\n'),
        },
        { title: 'The Ascension List', text: ascensions.join('\n') },
        {
          title: 'Descend Tutorial 11: Rebirth',
          text: [
            `A hero that has **won a siege** and then clears Descend on **Ascension ${rebirth.FIRST} or higher** is **reborn** with a permanent rank:`,
            '',
            ...rebirth.RANKS.map((r, i) => `${ic(`rank_${r.toLowerCase()}`)}**${r}**: Ascension ${rebirth.FIRST + i}`),
            '',
            `Each rank is **+${pct(rebirth.BONUS)}** health, weapon damage and spirit power, in Hero Farming and in Descend. The rank follows the highest Ascension that hero cleared.`,
          ].join('\n'),
        },
        { title: '/descend', command: 'descend', text: '`run` starts or carries on your descent. `leaderboard` shows the deepest runs on this server.' },
      ],
    },
    {
      key: 'lfg', label: 'LFG', about: 'Find people to play Deadlock with', emoji: 'seven',
      pages: [
        {
          title: '/lfg', command: 'lfg',
          text: [
            'Looking for a game? Run `/lfg` **inside an LFG region channel** (like #lfg-na).',
            '',
            '- I ping the LFG role for that mode and open a **voice lobby** for you.',
            '- **Ranked** uses your rank role and locks the lobby to players within one rank of you (Eternus plays only with Eternus).',
            '- One open lobby per person. An empty lobby deletes itself after a few minutes, and its post with it.',
            '- Pick which LFG pings you get from the **LFG Pings** dropdown your server staff posted.',
          ].join('\n'),
        },
      ],
    },
    {
      key: 'tickets', label: 'Tickets', about: 'Support tickets: panels, claiming, transcripts', emoji: 'warden',
      pages: [
        {
          title: 'Using Tickets',
          text: [
            '**1. Open**',
            'Press the button on a ticket panel, or run `/ticket open`. You get a private channel with the staff. You can have **1** ticket open per panel.',
            '',
            '**2. Talk**',
            'Some panels ask a few questions first. Your answers are posted in the ticket. Staff can **Claim** the ticket. Once claimed, only the staff member who took it writes in it. Thread tickets have no claiming. They close by locking the thread, and staff can `/ticket reopen` them. `/ticket add` and `/ticket remove` let other people in or out.',
            '',
            '**Close Requests**',
            'Staff can run `/ticket closerequest` to ask you if your issue is resolved. Press **Accept** to close the ticket or **Deny** to keep it open. If a delay was set and nobody answers, it closes by itself.',
            '',
            '**3. Close**',
            'Press **Close** or run `/ticket close`. The whole chat is saved as an HTML file in the transcript channel and sent to you privately, then the channel is deleted. You are then asked in a DM to rate the ticket from **1** to **5** and can add a comment. Staff see it in the transcript channel.',
          ].join('\n'),
        },
        { title: '/ticket', command: 'ticket', text: 'Everyone can `open` a ticket and `close` their own. Ticket staff can `reopen` a closed thread ticket by its number, go `on-call` for thread tickets, `closerequest` (with an optional `close_delay` in hours), `add`, `remove`, `rename`, `claim`, `unclaim`, `transfer`, `switchpanel` and `autoclose-exclude` (this ticket never closes by itself) inside a ticket.' },
        { title: '/tag', command: 'tag', text: 'Ticket staff send a saved text snippet in the channel. Start typing the tag id and pick it from the list.' },
        { title: '/managetags', command: 'managetags', text: 'Ticket admins make the tags: `add` opens a pop-up for the text (adding an existing id changes it), `delete` removes one, `list` shows them all. A server can have up to **100** tags.' },
        { title: '/stats', command: 'stats', text: 'Ticket staff see numbers for a member (`user`: tickets opened, tickets claimed, first answer time, the ratings of the tickets they claimed) or the whole server (`server`: tickets opened, open, closed, first answer time, ticket length, rating, who claimed the most). They count tickets closed since tickets were switched on.' },
        { title: '/ticket-config', command: 'ticket-config', text: '`setup` makes the **Ticket Admin** and **Ticket Support** roles, a transcripts channel and a Tickets category.\n\n`panel-create` posts a panel with its button, `panel-delete` and `panel-list` manage them.\n\n`form-set` gives a panel up to **5** questions that members answer before a ticket opens, `form-clear` removes them.\n\n`panel-create thread:true` and `panel-mode` make a panel open **private threads** in its channel instead of channels (give your support role Manage Threads in that channel so staff can see them, or have staff go `/ticket on-call`).\n\n`feedback` turns the rating DM after a ticket closes on or off.\n\n`autoclose` closes tickets after hours with no message or no staff answer, or when the opener leaves.\n\n`addadmin`, `removeadmin`, `addsupport`, `removesupport` and `viewstaff` choose the staff, `blacklist` stops someone opening tickets, and `transcripts` sets where transcripts go.\n\nStaff with Manage Server always count as ticket admins.' },
      ],
    },
    {
      key: 'tournaments', label: 'Tournaments', about: 'Tutorial: teams, verification, matches, scrims', emoji: 'yamato',
      pages: [
        {
          title: 'Playing in a Tournament',
          text: [
            '**1. Sign Up**',
            'Press **Sign Up** on a tournament and name your team. You are its Captain. The team gets a role, and its own channels if the organizers turned them on.',
            '',
            '**2. Build Your Team**',
            'The Captain invites Players and Substitutes with `/team invite`. An invite is posted in the sign-up channel with **Accept** and **Decline**.',
            '',
            '**3. Verify**',
            'Everyone on the team presses **Verify** (or runs `/team verify`) and pastes their Steam profile link. Your Steam profile and game details have to be public. An organizer approves or denies you. You get the team role once you are approved.',
            '',
            '**4. Get Ready**',
            'A team is ready when every player on it is verified and it has enough Players. Rosters lock when sign-ups close. Teams that are not ready are left out of the bracket.',
            '',
            '**5. Play**',
            'Your team is told each match, its time and its length. Before a match your team is pinged and the Captain presses **Check In**. The winning Captain reports the score with `/team report`, and the other Captain presses **Confirm** or **Dispute**.',
            '',
            '`/tournament bracket` shows every match. `/tournament history` shows past tournaments.',
          ].join('\n'),
        },
        {
          title: 'Running a Tournament',
          text: [
            'For organizers. Staff with Manage Server pick the organizer roles with `/tournament-config`.',
            '',
            '**1.** `/tournament create` sets it up and posts the sign-up embed.',
            '**2.** Reviews arrive in the review channel as players verify: hours, rank, main, most played heroes and win rates, with anything wrong flagged. Press **Approve**, **Deny** (you give a reason) or **Needs Investigation**.',
            '**3.** Sign-ups close on time, or now with `/tournament close`. `/tournament teams` shows who is ready.',
            '**4.** `/tournament start` makes the bracket from the ready teams.',
            '**5.** `/tournament schedule` sets each match\'s time. Teams are pinged before it and Check In. A team that does not is flagged for you.',
            '**6.** Captains report results. `/tournament result` enters or corrects one, and settles disputes and forfeits.',
            '**7.** `/tournament end` saves the final places and can give the winners a role.',
            '**8.** `/tournament cleanup` deletes every team role and channel, and can save the team chats as text files first.',
          ].join('\n'),
        },
        {
          title: '/tournament', command: 'tournament',
          text: [
            'Everyone can use `bracket` and `history`. The rest is for tournament organizers.',
            '',
            '- `create`, `close`, `start`, `end` and `cleanup` run the tournament.',
            '- `simulate` is a practice run with fake teams. You get the real bracket and buttons for the commands, and it asks if you want team channels.',
            '- `teams`, `seed`, `roster-add` and `roster-remove` manage its teams. The roster commands also work after rosters lock.',
            '- `schedule` and `result` run its matches. A match is named by its code, like `R1-2`.',
            '- Write a time like `2026-11-20 18:00` in the time zone you gave as `utc-offset`, or paste a Discord timestamp.',
          ].join('\n'),
        },
        {
          title: '/team', command: 'team',
          text: [
            'Your tournament team. Press **Sign Up** on a tournament to make one. You become its Captain.',
            '',
            '**Captain**',
            '- `invite` invites a member as a Player or a Substitute.',
            '- `remove` takes a player off the team or takes an invite back.',
            '- `transfer` hands the team to another player on it.',
            '- `disband` removes the team from the tournament. Its role and channels are deleted.',
            '- `report` reports a match your team won. Write the score wins first, like `2-1`.',
            '',
            '**Everyone**',
            '- `verify` opens the Steam link pop-up.',
            '- `roster` shows the players, Substitutes and open invites.',
            '- `leave` leaves the team.',
          ].join('\n'),
        },
        {
          title: '/scrim', command: 'scrim',
          text: [
            'A practice match between two teams of a running tournament. Captains only.',
            '',
            '- `challenge` asks one team. Their Captain presses **Accept** or **Decline**.',
            '- `open` posts a scrim in the sign-up channel. The first Captain of another team to press **Accept** gets it.',
            '- Both teams are pinged before it starts. A scrim has no result and is not part of the bracket.',
          ].join('\n'),
        },
      ],
    },
    {
      key: 'more', label: 'Other Commands', about: 'Item lookup, invite link, this menu', emoji: 'pocket',
      pages: [
        {
          title: '/voice', command: 'voice',
          text: [
            'Join a **Creator Channel** and you get your own voice channel. It is deleted when it is empty. You can use the buttons in the controls channel or `/voice`.',
            '',
            '**Channel**',
            '`name`, `limit`, `bitrate`, `region`, `nsfw`, `thread`',
            '**Access**',
            '`lock`, `hide`, `waiting-room` (you choose who gets in), `trust`, `untrust`, `invite`, `block`, `unblock`, `kick`',
            '**Ownership**',
            '`claim` (when the owner left), `transfer`, `delete`',
            '',
            'Your name, limit and bitrate are remembered for your next channel.',
          ].join('\n'),
        },
        {
          title: '/item', command: 'item',
          text: [
            "Look up **any shop item** (and the legendaries). Start typing: the list finds it even with typos.",
            '',
            "- **Details:** what it does, its in-game cost, what it's built from and upgrades into (with a **View Upgrade Tree** dropdown).",
            '- **Enhanced** and **Corrupted:** what those versions do.',
            "- Anyone else who presses the buttons gets the page privately.",
          ].join('\n'),
        },
        { title: '/invite', command: 'invite', text: 'A button to add The Shopkeeper to another server. Souls, levels and heroes there are its own.' },
        { title: '/help', command: 'help', text: 'This menu.' },
      ],
    },
    {
      key: 'staff', label: 'Staff & Config', about: 'Setup and moderation commands', emoji: 'abrams',
      pages: [
        { title: '/xp-config', command: 'xp-config', text: 'Chat XP per message and its cooldown, voice XP, where level-ups are announced (off until a channel is set), channels with no XP, and how often Soul Bags drop.' },
        { title: '/xp', command: 'xp', text: "Change a member's XP or level. Level follows XP; no souls are paid for levels given this way. Every edit goes to the audit log and the member's history." },
        {
          title: '/souls (staff)', command: 'souls',
          text: "The staff side of `/souls`: add, take, set or reset a member's souls, see their **history**, a **report** of what paid souls in and out, and **reset-all** (every member's server balance to 0 after a confirm; hero souls stay, a backup is saved first).",
        },
        { title: '/lfg-config', command: 'lfg-config', text: "Set LFG up (`setup` makes the roles, an LFG category and a first region), post the **LFG Pings** dropdown, close lobbies, the empty-lobby timeout, game modes, and the region channels and their roles." },
        { title: '/reaction-roles', command: 'reaction-roles', text: 'Build an emoji-to-role menu as a draft (`new`, `add`, `remove`, `preview`, then post it), or edit one already posted by its message ID (`menu-add`, `menu-remove`, `menu-edit`, `menu-change`, `delete`). Give a menu an `unlock-role` to make it a gate for the server: picking anything on it also gives that role, and you decide what the role can see.' },
        { title: '/auto-mod', command: 'auto-mod', text: 'Censored phrases: a message with one (as a whole word, any case or accent) is deleted and the author is warned. Members with Manage Messages are exempt.' },
        { title: '/export-chat', command: 'export-chat', text: 'Saves a whole channel as one HTML file and sends it to you privately. Download it and open it in a browser. You can only export a channel you can read. A very long channel is cut to its newest messages.' },
        { title: '/audit-log-config', command: 'audit-log-config', text: "What #audit-log records (every event can be turned on or off), ignored channels and members, the channel, the new-account warning, and a member's full history." },
        { title: '/setup', command: 'setup', text: 'Walks you through setting this server up, one step at a time: the welcome message, the audit log, go-live alerts, level-up announcements, Hideouts, LFG, the Weekly Jackpot and tournament organizers. Every step has a **Skip** button. Run it again to change something.' },
        { title: '/welcome-config', command: 'welcome-config', text: 'The welcome message for new members: on or off, the channel, and the text (`{member}`, `{server}` and `{count}` are filled in).' },
        { title: '/stream-config', command: 'stream-config', text: "The Twitch and TikTok go-live alerts: the channel, the streamer names, who gets pinged (everyone, here, a role or nobody) and the text under the stream title." },
        { title: '/shop-config', command: 'shop-config', text: "Sets up this server's Shop: sections on or off, every price, the Hideout level, and where Color Roles are made." },
        { title: '/tournament-config', command: 'tournament-config', text: 'The roles that can run tournaments (`organizer-add`, `organizer-remove`, `show`). Staff with Manage Server always can.' },
        { title: '/jackpot-config', command: 'jackpot-config', text: "The channel the Weekly Jackpot's winner is announced in. Leave it empty to turn the post off." },
        { title: '/hideout-config', command: 'hideout-config', text: "The category Hideouts are made in, and removing a member's Hideout for good. Turn Hideouts on or off for the Shop with `/shop-config section`." },
        { title: '/tempvoice', command: 'tempvoice', text: 'Temporary voice channels. `setup` makes a category with a **Create Channel** and a controls channel. `add` / `remove` / `edit` manage Creator Channels (the name, with `{user}` and `{number}`, the starting user limit and bitrate), `panel` posts the controls, `show` lists them.' },
        { title: '/farm-config', command: 'farm-config', text: 'Bot owner only: turns Hero Farming cooldowns off for testing. A restart turns them back on.' },
      ],
    },
  ];

  // What this member may see: pages of commands they can't use, Fairfax-only pages elsewhere, and empty categories are left out.
  const member = !ctx.perms.has(PermissionFlagsBits.ManageGuild);
  return categories
    .map((c) => ({ ...c, pages: c.pages.filter((p) => (!p.home || ctx.home) && (!p.command || canUse(ctx.commands.get(p.command), ctx)) && !(c.key === 'staff' && p.command === 'souls' && member)) }))
    .filter((c) => c.pages.length);
}

// ---- the message ----
const POOL = ['haze', 'abrams', 'mina', 'celeste', 'paige', 'apollo', 'billy', 'calico', 'the_doorman', 'drifter', 'dynamo', 'graves', 'grey_talon', 'holliday', 'infernus', 'ivy', 'kelvin', 'lady_geist', 'lash', 'mcginnis', 'mirage', 'mo_krill', 'paradox', 'pocket', 'rem', 'seven', 'shiv', 'silver', 'sinclair', 'venator', 'victor', 'vindicta', 'viscous', 'vyper', 'warden', 'wraith', 'yamato', 'baba', 'rat_king', 'solomon', 'deadman_danny', 'nurse_harrow', 'violet'];
function emojiOf(ctx, name) {
  const e = name && emojiNamed(ctx.guild, name);
  return e ? { id: e.id, name: e.name } : undefined;
}

// The help message for `userId` at category `key`, page `index` (clamped). Returns { embeds, components }.
function helpView(ctx, userId, key = 'start', index = 0) {
  const categories = book(ctx);
  const cat = categories.find((c) => c.key === key) ?? categories[0];
  const i = Math.max(0, Math.min(cat.pages.length - 1, Number(index) || 0));
  const page = cat.pages[i];
  const embed = replyEmbed(page.text).setTitle(page.title).setFooter({ text: `${cat.label}  |  Page ${i + 1} of ${cat.pages.length}` });
  const command = page.command && ctx.commands.get(page.command);
  if (command) embed.addFields(usageFields(command, ctx));

  const cats = new StringSelectMenuBuilder().setCustomId(`${CATEGORY_ID}:${userId}`).setPlaceholder('Pick a category').addOptions(
    categories.map((c) => ({ label: c.label, value: c.key, description: c.about, emoji: emojiOf(ctx, c.emoji), default: c.key === cat.key })),
  );
  const pages = new StringSelectMenuBuilder().setCustomId(`${PAGE_ID}:${userId}:${cat.key}`).setPlaceholder('Pick a page').addOptions(
    // Every page gets a coloured hero emoji (never a plain white one); a page's own `emoji` wins, else one is dealt in order from POOL.
    cat.pages.map((p, n) => ({ label: p.title.slice(0, 100), value: String(n), default: n === i, emoji: emojiOf(ctx, p.emoji ?? POOL[(n + categories.indexOf(cat) * 5) % POOL.length]) })),
  );
  const turn = (to, tag, label, style) => new ButtonBuilder().setCustomId(`${TURN_ID}:${userId}:${cat.key}:${to}:${tag}`).setLabel(label).setStyle(style);
  const nav = new ActionRowBuilder().addComponents(
    turn(i - 1, 'b', 'Back', ButtonStyle.Secondary).setDisabled(i === 0),
    turn(i + 1, 'n', 'Next', ButtonStyle.Primary).setDisabled(i === cat.pages.length - 1),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(cats), new ActionRowBuilder().addComponents(pages), nav] };
}

module.exports = { CATEGORY_ID, PAGE_ID, TURN_ID, book, helpView, contextOf, usageFields, canUse };
