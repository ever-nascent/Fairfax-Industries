# How the bot works

A map for reading and changing The Shopkeeper yourself. Start here, then open the files it points to.
(`CLAUDE.md` and `server-plan.md` are the detailed notes and the history of every decision; this file is the short version.)

## 1. What it is made of

- **Node.js** runs the code. Every `.js` file is a *module*: `require('./x')` loads another file, and `module.exports = { ... }` is what a file hands out.
- **discord.js** (v14) is the library that talks to Discord: slash commands, buttons, messages, roles.
- **@napi-rs/canvas** draws the pictures (cards, boards, the shop), **gifenc** makes the animated GIFs.
- Nothing else. There is no database: saved data is JSON files in `data/`.

## 2. The folders

```
Start Bot.bat         double-click: update from GitHub, install packages, the startup check, then start the bot
setup.py              one-off server setup tools (emojis, stickers, channel layout); not used at startup
src/                  the bot
  index.js            the entry point (section 3)
  config.js           server id, owner id, colours, the streams channel
  deploy-commands.js  tells Discord about the slash commands (runs on its own at startup)
  handlers/           loads every command and event file
  commands/<group>/   one file per slash command (/rank, /shop, /base ...)
  events/             one file per Discord event the bot listens to (a message, a reaction, startup ...)
  components/         what happens when someone clicks a button, picks from a dropdown or sends a pop-up
  storage/            reading and writing the JSON files in data/
  utils/              the actual logic, grouped:
    economy/          XP, levels, souls, the souls ledger, the Soul Urn, Soul Bag, backups, the /rank card
    games/            the 12 betting games (+ casino.js, which they all share), /trivia, /lockle
    shop/             /shop, its banner picture, Hideouts
    server/           LFG, member roles, reaction roles, go-live alerts, the censor
    audit/            #audit-log
    farm/             Hero Farming and Descend (section 7); itemInfo.js is /item (any shop item, by name)
    *.js              small helpers everything uses: format.js (numbers, souls text), embeds.js, guild.js, art.js, random.js ...
test/                 automated checks (section 9); they never touch data/
tools/                simulations and bug sweeps you run by hand (balance, game odds), and the startup check
assets/               pictures, fonts and downloaded game data
data/                 LIVE data: members' XP, souls, heroes. Never edit or delete while the bot runs
```

## 3. What happens when the bot starts

`Start Bot.bat` pulls the latest `main` from GitHub, runs `npm install`, runs `tools/startup-check.js` (new heroes, changed wiki pictures, once a day), then `npm start`, which runs `src/index.js`:

1. Reads the token from `.env` (secret: never share or commit it).
2. Backs up the souls files (`utils/economy/backup.js`) and runs one-time money migrations (`utils/economy/economy.js`).
3. `handlers/loadCommands.js` loads every file in `src/commands/`; `handlers/loadEvents.js` loads every file in `src/events/`.
4. Registers the slash commands with Discord if one changed (`deploy-commands.js`).
5. Logs in. Discord sends `clientReady`, and every event file named `clientReady` runs its startup work (find emojis, create missing roles, start timers ...).

**There are no lists to update:** a new file in `commands/` or `events/` is picked up by itself. Components are the one exception: a new route file is added to the list in `components/index.js`.

## 4. The three ways code gets run

### Slash commands (`src/commands/`)

Every command file looks like this:

```js
module.exports = {
  data: new SlashCommandBuilder().setName('urn').setDescription('Claim your daily Soul Urn'),  // what Discord shows
  async execute(interaction) { ... },                                                         // runs when someone uses it
};
```

`interaction` is everything about that use: who (`interaction.user`), which options they picked (`interaction.options`), and how to answer (`interaction.reply(...)`). Command files are kept short; the real work is in `utils/` (each file's top comment says where).

### Events (`src/events/`)

```js
module.exports = { name: 'messageCreate', async execute(message) { ... } };
```

`name` is the Discord event (`messageCreate` for a new message, `guildMemberAdd` when someone joins, `messageReactionAdd`, `clientReady` at startup ...). `once: true` makes it run a single time. Example: `events/xpMessage.js` gives chat XP on every message.

### Buttons, dropdowns, pop-ups (`src/components/`)

Every button has a hidden **customId**, a string the bot chose when it sent the button (like `urn_rejuv:1234:use`: the action, then whose button it is, then the choice). A click arrives at `events/interactionCreate.js`, which asks every route in `components/` "is this yours?" (`matches`) and runs the first that says yes (`execute`).

**To find what a button does:** find where the button is built (search for `.setCustomId(`), note its id prefix, then search `components/` for that prefix.

## 5. One full example: `/urn`

1. A member types `/urn`. Discord sends an interaction, and `events/interactionCreate.js` finds the command `urn` and runs `commands/xp/urn.js`'s `execute`.
2. That calls `claimUrn` in `utils/economy/xp.js`, which checks the day, works out the streak and souls, and saves the member through `updateUser`.
3. Saving goes through `storage/jsonAdapter.js` into `data/xp.json`, and the souls change is written to the ledger (`data/soulsLedger.jsonl`).
4. `urn.js` replies with an embed. If the streak broke, the reply has Use Rejuv / Start Over buttons, and their clicks go to `components/urn.js`.

Nearly every feature follows this shape: **command, logic in utils, storage, reply, buttons in components**.

## 6. Saved data and souls

- `getStore('xp')` (from `src/storage`) gives you `data/xp.json`. Read with `get`, change with `update`. The file is kept in memory and saved on every change, so never edit it by hand while the bot runs.
- **A member's progress is per server (Oct 30).** The stores `xp`, `farm`, `quests`, `lockle` and `hideouts` keep one copy per server, saved as `<server id>:<user id>`. You never write that key yourself: `getStore('xp')` gives the current server's view, so `get(userId)` and `all()` already mean "in this server". "Current server" is set by `runInGuild(guildId, fn)` (`utils/guildContext.js`); `interactionCreate.js` and the message and voice XP events do it for you, a timer or other new entry point has to do it itself. With none set, a store call throws "no server set" instead of touching the wrong server. `getRawStore` (every server's entries, keys as saved) is only for migrations and backups.
- **Souls are only ever changed through `changeSouls(userId, delta, reason)`** (`utils/economy/xp.js`), or for games through the helpers in `utils/games/casino.js` (`takeBet`, `stake`, `pay`). Each change is one ledger line with its reason, which is how `/souls history` works. Never set `user.souls = ...` directly.
- Every souls amount is multiplied by `SCALE` (`utils/economy/economy.js`), so write prices as `1600 * SCALE`, not `16000`.

## 7. Hero Farming in one page (`src/utils/farm/`)

| File | What it is |
|---|---|
| `engine.js` | the fight simulator: 0.1 s steps, the hero shoots and casts, enemies hit, buffs and debuffs tick. The heart of it |
| `ability.js` + `heroes/<hero>.js` | each hero's four abilities (one file per hero, all built on `ability.js`) |
| `items.js`, `stats.js` | what every shop item does in a fight; a hero's stat sheet |
| `targets.js` | what can be farmed (camps, Guardians, Walkers, the siege) and how hard each is |
| `play.js` | a member's farm record (`data/farm.json`): cooldowns, souls, items, playing one trip |
| `levels.js`, `buffs.js` | levels and boons, item prices, the permanent buffs |
| `encounter.js` | rival heroes who show up after a fight |
| `views.js` | every Hero Farming screen (embeds and buttons) |
| `*Card.js` | the drawn pictures (hero card, shop, siege, roam) |
| `descent.js`, `descentViews.js`, `descentCard.js` | Descend: its rules, its screens, its pick picture. `descentLegacy.js` is a frozen copy that only finishes runs started before Oct 29 |

A trip: the command opens a details screen (`commands.js`), **Send** goes to `components/farm.js`, `play.js` simulates the whole fight with `engine.js` up front, and the result is replayed into the message every few seconds.

## 8. Where the numbers live

| To change | Look in |
|---|---|
| Every souls price and payout at once | `SCALE` in `utils/economy/economy.js` |
| Shop prices (Soul Boost, Rejuv) | `BOOST_PRICE`, `REJUV_PRICE` in `utils/economy/xp.js`; Hideout in `utils/shop/hideout.js` |
| A game's payout | `PAYOUT` near the top of its file in `utils/games/` (each is set to return about 95%; re-run its odds tool or `test/rtp.test.js` after a change) |
| Minimum bet | `MIN_BET` in `utils/games/casino.js` |
| Daily / weekly quests (what, how many, how much) | `DAILY`, `WEEKLY`, `DAILY_SOULS`, `WEEKLY_SOULS` in `utils/economy/quests.js` (`track(userId, kind)` is called where each thing happens) |
| Chat / voice XP | `/xp-config` in Discord (saved settings, no code) |
| Farm enemy strength | `HARDNESS` and `GROWTH` in `utils/farm/targets.js` |
| Descend difficulty | `TUNE`, `ASC`, `ASCENSIONS`, `ARCHETYPES`, `AFFIXES`, `DEBUFFS` in `utils/farm/descent.js` |
| Server ids, colours | `src/config.js` |

Convention: a constant in CAPITALS near the top of a file is a knob meant to be changed.

## 9. Making a change safely

1. Change the file.
2. `node --check path/to/file.js` catches typos without running anything. **Never run `node src/index.js` yourself while the bot is running elsewhere:** that starts a second copy of the bot.
3. `node --test` runs every check in `test/` (a few minutes, in a throwaway data folder). `node --test test/xp.test.js` runs one file.
4. For farm balance: `node tools/farm-sim.js ...`; for Descend bugs: `node tools/descend-smoke.js` (each tool's top comment says how).
5. Restart the bot (close its window, double-click `Start Bot.bat`).
6. Commit and push with GitHub Desktop. `Start Bot.bat` pulls `main`, so whatever is pushed is what runs.

## 10. Reading tips

- **Start with the file's top comment.** Every file says what it is and where the related pieces are.
- **"(his call, Oct 3)"** in a comment means you decided that rule; `server-plan.md` has the full story under that date. They're history, safe to skip while learning.
- **`// ponytail:`** marks a deliberate shortcut and when it would need upgrading.
- Many lines are long. Turn on word wrap (VS Code: `Alt+Z`) and use **Go to Definition** (`F12` on a function name) to jump to where something is defined, and **Find All References** (`Shift+F12`) to see who uses it. That's the fastest way to follow the code.
- In the code, `d` is a Descend run, `e` an enemy, `r` a set of rules, `s` a stat sheet: short names for things used on every line.
