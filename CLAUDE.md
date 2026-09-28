# Fairfax Industries — Discord server + bot

Deadlock community Discord server for Zechariah's content (TikTok Live + Twitch), fans, and LFG.
`server-plan.md` is the source of truth for decisions. Update it whenever a decision is made.

## How Zechariah likes to work

- One step at a time. End each step with a **✅ Checkpoint** he can verify in Discord.
- Ask when information is missing; don't guess. Don't reinterpret his wording.
- Search the web for anything about Deadlock that may have changed (heroes, ranks, rules).
- Test changes before handing them over, and say what was and wasn't tested.
- He prefers double-click workflows (`setup.py`, `Start Bot.bat`), not long terminal commands.

## Layout

| Path | What |
|------|------|
| `setup.py` | One-off server setup over Discord REST (Python). Double-click → numbered menu. Commands: `check`, `community`, `rank-icons`, `rank-emojis`, `hero-icons`, `hero-emojis`, `hero-renders`, `stickers`, `layout`. Idempotent: safe to re-run. |
| `src/` | The bot (Node, discord.js v14). `index.js` entry, `commands/<category>/*.js` auto-loaded, `events/*.js` auto-loaded, `components/` button routes, `storage/` JSON files in `data/`. |
| `src/config.js` | `GUILD_ID` (1553860143639167086) and `BRAND_COLOR` (placeholder blurple). |
| `src/utils/xp.js` | XP curve, souls, Soul Urn, leaderboard, XP settings. `src/utils/rankCard.js` draws the /rank card (`@napi-rs/canvas`). Test: `node --test` (runs in a temp `DATA_DIR`, never the live `data/`). |
| `src/utils/heroes.js`, `src/utils/shop.js` | Hero list (same as `setup.py HEROES`), hero art (render, else chat icon), sampled hero colours; the `/shop` hero card view. Dropdown handler: `src/components/shop.js`. |
| `test/` | `node --test` (XP, storage, reaction roles). Runs in a temp `DATA_DIR`, never the live `data/`. |
| `src/utils/lfg.js` | LFG roles, region channels, lobby lifecycle. Creates missing roles/channels on startup. |
| `Start Bot.bat` | Installs deps on first run, registers slash commands (`npm run deploy`), starts the bot. |
| `assets/` | Hero chat icons (`heroes/`), hero renders for Shop cards (`hero_renders/`, from `setup.py hero-renders`), rank icons, region emoji drafts (`regions/make_regions.py`), stickers. Credits in `assets/CREDITS.txt`. |
| `.env` | `DISCORD_TOKEN`. **Secret: never print, log, or commit it.** |
| `data/` | **Live bot data** (XP, souls, settings). The bot runs on his PC; never delete or overwrite these files. |

Reaction roles, welcome/goodbye, and the storage/loader scaffolding were ported from
`D:\Projects\Discord Bots\Velvets-Discord-Bot` (a separate, larger bot; read-only reference).

## Bot features

- `/reaction-roles` (Manage Roles): emoji → role menus, single or multi mode. Drafts are saved in `data/` (survive restarts); max 20 options per menu; refuses roles the bot can't give (above its role, managed, @everyone).
- `/lfg mode` (anyone, run inside an `#lfg-<region>` channel): pings the LFG role, posts an embed, and creates a voice lobby in the LFG category. Ranked uses the runner's rank role and locks the lobby to rank ±1 (Eternus: Eternus only). One open lobby per person. The lobby is deleted after N min empty, and its post is deleted with it.
- `/lfg-config` (Manage Channels): `close`, `timeout`, `lobby-category`, `mode`, `show`.
- `/welcome`, `/goodbye` (Manage Server): text or embed, placeholders. Off until configured.
- XP: chat XP (cooldown), optional voice XP, level-ups pay souls. `/rank`, `/urn` (daily souls, streaks), `/leaderboard` (image), a `:souls:` emoji the bot uploads on startup, `/xp-config` (Manage Server: `chat`, `voice`, `level-up-channel`, `show`). Level-up announcements are off until a channel is set.
- `/shop` (only the runner sees it): hero card section. Two dropdowns with hero emojis; picking one redraws the embed image as that hero's card with the runner's stats. Buying/equipping not built yet.

## Deadlock facts (verified Sept 2026; re-check before relying on them)

- Ranks since the July 30, 2026 update: Initiate, Seeker, Acolyte, Sentinel, Mystic, Ritualist, Emissary, Oracle, Phantom, Ascendant, Eternus (subranks I–VI; Obscurus = uncalibrated).
- Ranked is solo/duo, max 1 rank apart; Eternus only with Eternus (within 3 subranks).
- 38 heroes (list in the role-menu task below).

## Discord limits that matter here

- Boost level 1 (checked Sept 27, 2026): 100 static emoji slots (49 used: 11 ranks + 38 heroes), 15 sticker slots (5 used), 20 unique reactions per message.
- Footers and embed titles/author names don't render markdown (no italics there).

## Open tasks (in rough priority order)

1. **#roles reaction menus** styled like the DL server: an embed of `emoji - @Role` lines, and the bot reacts in the same order. Emojis only, no buttons. Menus:
   - Region (pick one): Europe, North America, South America, Asia, Oceania, Africa, **Russia**.
   - Heroes (pick any, ~5–6 per message): Abrams, Bebop, Calico, Dynamo, Grey Talon, Holliday / Haze, Infernus, Ivy, Kelvin, Lady Geist / Lash, McGinnis, Mirage, Mo & Krill, Paradox / Pocket, Seven, Shiv, Sinclair, Vindicta / Viscous, Vyper, Warden, Wraith, Yamato / Billy, The Doorman, Drifter, Mina, Paige, Victor / Apollo, Celeste, Graves, Rem, Silver, Venator.
   - Patron (pick one): The Archmother, The Hidden King.
   - Rank (pick one, the existing 11 rank roles), LFG pings (existing 13 roles), Stream pings (new role).
2. **XP / levels / souls + hero-card Shop**: all decisions in `server-plan.md` ("XP / levels"). Step 1 (XP, souls, /rank plain card, /urn, /leaderboard, /xp-config) is built, awaiting his Discord check. Shop hero card preview (`/shop`) is built, awaiting his check (needs `setup.py hero-renders` for the real art; mock in `Claude outputs/shop-preview.png`). Card sits in an embed coloured like the card; flask liquid = XP progress. `/urn` shows the wiki urn icon + one urn voice line. Later: give `/leaderboard` personality. Next: level-up message wording (examples sent), then Shop buying (3,200 souls each) and choosing which owned card `/rank` shows.
3. **Rename the bot to "The Shopkeeper"** (username + server nickname) and give its messages his voice: a chatty New York shop owner, gambler, Knicks fan. Write original lines, not copied voice lines. Applies to `/lfg` posts/replies, welcome/goodbye defaults, and staff replies.
4. Emojis (parked): region emoji drafts v3 are in `assets/regions` (item-card style, not yet approved/uploaded; boost level 1 means plenty of slots now). Hero emojis are done (`:<hero>:`). Patron icons exist in the Deadlock Graphical Library (credit: Lovely).
5. Stickers: 4 more are listed in `setup.py` `STICKERS`. Boost level 1 is reached, so they can go up now (ask first).
6. Unconfirmed runs: `setup.py layout`, `rank-emojis`, `/welcome config`, `/goodbye config`. Default channels (e.g. #general) not in the layout still need a decision.
   - **LFG pings (test later):** the bot creates the LFG roles as not mentionable. Unconfirmed whether a bot with Administrator can still notify a non-mentionable role (an old Discord bug said no). Test: run `/lfg` while a second account holds the LFG role. If it doesn't get notified, options are: make the 13 LFG roles mentionable (any member could ping them), or have the bot make the role mentionable only while it posts the ping.
7. Later: server colours, staff/Mod role, running the bot 24/7, TikTok/Twitch go-live alerts.
