# The Shopkeeper

A Discord bot for the Fairfax Industries Deadlock community, and for any other server that invites it. It runs a souls economy (XP, levels, a daily urn, a shop), 12 betting mini-games, trivia and Lockle, two Hero Farming modes (`/base` and `/descend`), LFG lobbies, support tickets, tournaments, temporary voice channels, reaction roles, go-live alerts for Twitch and TikTok, and an audit log.

Written in Node.js with [discord.js](https://discord.js.org) v14. Saved data is plain JSON files in `data/`. There is no database.

## Run it

You need Node.js 20.12 or newer.

1. `npm install`
2. Make a `.env` file in this folder:

   ```
   DISCORD_TOKEN=your bot token
   TWITCH_CLIENT_ID=optional, for Twitch go-live alerts
   TWITCH_CLIENT_SECRET=optional, for Twitch go-live alerts
   STEAM_API_KEY=optional, tournaments use it to read Deadlock hours
   ```

   `.env` is git-ignored. Never commit it.
3. `npm start`. On Windows, `Start Bot.bat` does the same and also pulls the latest `main`, installs packages and runs the startup check first.

The bot registers its own slash commands when it starts. `npm run deploy` does it by hand.

## Other commands

| Command | What it does |
|---------|--------------|
| `npm test` | Runs the tests. They use a temporary data folder, never `data/`. |
| `npm run farm-data` | Downloads Hero Farming data from the Deadlock wiki into `assets/farm/`. |
| `npm run trivia-data` | Rebuilds the `/trivia` question data. |
| `npm run farm-sim` | Balance simulations (see `tools/farm-sim.js`). |
| `setup.py` | One-off server setup over Discord's REST API (emojis, stickers, channel layout). Needs Python and `requirements.txt`. |

## Where things are

`HOW-IT-WORKS.md` is the guide: the folder map, what happens at startup, how commands, events and buttons are wired, one full worked example, and how to change something safely. Every command and component file starts with a comment saying what it is and where its logic lives.

```
src/commands/   one file per slash command
src/events/     one file per Discord event the bot listens to
src/components/ what buttons, dropdowns and pop-ups do
src/utils/      the logic (economy, games, shop, server tools, farm, audit)
src/storage/    JSON file storage
test/           automated tests
tools/          simulations, bug sweeps and the startup check
assets/         pictures, fonts and downloaded game data
data/           live bot data (git-ignored; never delete or overwrite while the bot runs)
```

## Credits

Pictures, fonts and game data come from Deadlock and its community. See `assets/CREDITS.txt`.
