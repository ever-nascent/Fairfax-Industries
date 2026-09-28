# Fairfax Industries — Server Plan

The source of truth for how the server looks and works. The bot/scripts build from this.

## Decisions (locked)

| # | Decision | Answer |
|---|----------|--------|
| 1 | What the server centers on | **Both equally**: your content (TikTok Live + Twitch) and Deadlock LFG/community |
| 2 | First bot feature | **Reaction roles**, ported from Velvets-Discord-Bot |
| 3 | Rank emojis | 11 current Deadlock rank icons (post–July 30, 2026 Ranked Mode) as `:rank_<name>:` emojis |
| 4 | Hero emojis | All 38 heroes' chat icons from deadlock.wiki as `:<hero>:` emojis (e.g. `:grey_talon:`, `:mo_krill:`). Uses 38 slots: 49/50 static slots now full |

## LFG system (`/lfg`)

| Rule | Decision |
|------|----------|
| Who can run it | Anyone |
| Modes | Standard, Street Brawl, Ranked |
| Ranked rank | Taken from the runner's **rank role** (can't claim a rank you don't have) |
| Ping | Standard → @LFG Standard · Street Brawl → @LFG Street Brawl · Ranked → only @LFG <that rank> |
| Post | Embed in #lfg: mentions the runner, links the voice lobby |
| Voice lobby | Created in "LFG Lobbies" category, deleted after 5 min empty, stays while occupied |
| Ranked lock | Only runner's rank ±1 can join (Deadlock's duo rule). **Eternus: Eternus only** (game rule) |
| Ranked size | No limit (friends can hang out) |
| Spam guard | One open lobby per person |
| Roles created by the bot | 11 rank roles, LFG Standard, LFG Street Brawl, 11 LFG <rank> roles |

### `/lfg-config` (staff = anyone with **Manage Channels**)

| Subcommand | Does |
|------------|------|
| `close lobby [reason]` | Closes a lobby now, even if occupied; reason goes to the server audit log |
| `timeout minutes` | Empty-lobby delete time, 1–120 min (default 5) |
| `channels [post-channel] [lobby-category]` | Where posts go / where lobbies are created |
| `mode mode enabled` | Turn Standard / Street Brawl / Ranked on or off |
| `show` | Current settings |

When a lobby closes for any reason (empty timeout, staff close, deleted by hand) its #lfg post is deleted.

Not enforceable by roles: Eternus' "within 3 subranks" rule (subranks aren't tracked).

## XP / levels (step 1 built: XP, souls, /rank, /urn, /leaderboard, /xp-config; Shop: hero card preview built, buying not built)

| Rule | Decision |
|------|----------|
| How XP is earned | Chatting: 15–25 XP per message, 60 s cooldown. Voice-time XP exists but is off by default |
| XP config | Staff can configure XP (amounts, cooldown, voice on/off, level-up channel) |
| Max level | 99 |
| Level up | Earns **souls** (the server currency). Souls per level rise on a curve. No extra milestone jackpots |
| Level-up message | Green embed in one channel (`/xp-config level-up-channel`; off until set). No ping. Wording is a placeholder |
| /urn look | Teal embed: urn icon + "Soul Urn" author, urn render thumbnail, Streak/Balance fields, urn voice line in the footer (footers can't be italic) |
| Curves | XP to next level = 5n² + 50n + 100 (MEE6 curve). Souls for reaching level n = 25 × n^1.5 (lvl 1 = 25, lvl 10 = 791, lvl 99 = 24,626) |
| Soul Urn amounts | 100 on day 1, +20 per day in a row, max 220 from day 7. Days reset at midnight UTC |
| Voice XP | 10 XP/min when on; needs 2+ people in the channel, not deafened, not the AFK channel |
| Daily Soul Urn | `/urn` once a day for souls; streak bonus grows each day in a row, resets on a missed day |
| Leaderboard | `/leaderboard`: top 10, no prize. Image in the rank-card style (flask per row, gold/silver/bronze top 3, souls), subtitle = server name |
| Souls emoji | `:souls:` (wiki souls icon) before every soul count in messages; the bot uploads it on startup if missing |
| /xp-config, /lfg replies | Green embeds (`REPLY_COLOR`), plain wording (no Shopkeeper voice for staff config). /lfg no-rank reply links #roles. The /lfg post itself stays as is (purple) |
| Bot replies | Always previewed (Discord mock) and approved before building. /rank on a bot = Shopkeeper line (own line for himself, 3 rotating for other bots) |
| Title roles | Parked (no names yet) |
| Perks (images, emojis, threads, nickname…) | Bought in the Shop, not earned by level |
| Level-gated channels | No. Only via Shop items (custom VCs/channels) |
| Stream XP bonus, LFG souls bonus | No |

### Rank card

| Rule | Decision |
|------|----------|
| Layout | Level flask (left), name, level line, souls count, big XP bar |
| Badge | Matches the in-game level flask exactly: hex codes and shape traced from the game. Fonts: Retail (number, souls), Radiance (text), from deadlock.wiki |
| Default card | Same plain card for everyone, **no hero** |
| Hero cards | Bought in the Shop, one per hero, **3,200 souls** each. Uses the hero's main art from deadlock.wiki (`File:<Hero>_Render.png`) and the hero's own colours on the XP bar, flask liquid, background tint and text accents |
| Shop preview | Dropdown to pick a hero; the embed image updates to preview that hero's card before buying |
| Preview details (built, awaiting check) | `/shop` reply is only visible to the person who ran it. Two dropdowns (38 heroes, 25 max per dropdown): Abrams – McGinnis, Mina – Yamato, each option with the hero's `:<hero>:` emoji. Picking a hero redraws the card with **your own** name, level and souls. Embed colour = hero colour. Wording is a placeholder (not approved) |
| Hero art files | `setup.py hero-renders` downloads the renders into `assets/hero_renders` (trimmed, 600 px tall). Until a hero's render is there, the card uses their chat icon |
| Hero colours | **Sampled from the art** (the most common strong hue), not hand-picked. Any hero can be overridden in `COLOR_OVERRIDES` in `src/utils/heroes.js`. Colours change once the renders replace the chat icons |

### The Shop

Build order: **XP + a small Shop with hero cards together**; everything else in the Shop later.

Future Shop items (not now): custom VC, a role you control, perks (images, emojis, threads, nickname…), Shopkeeper gambling with souls (coin flip, slot pull; fake currency only). Some items need a minimum level to buy.

## Deadlock ranks (current, lowest → highest)

Initiate, Seeker, Acolyte, Sentinel, Mystic, Ritualist, Emissary, Oracle, Phantom, Ascendant, Eternus.
Each has subranks I–VI. Obscurus = uncalibrated (no icon used).
The old names Alchemist, Arcanist and Archon were retired in the July 30, 2026 update.

## Done

- Server created, bot invited with Administrator, bot role on top
- `setup.py check` passed
- `setup.py community`: #rules, #mod-updates (staff only), Community mode on

## Open questions (next)

- LFG pings: test whether they notify (LFG roles are not mentionable; see CLAUDE.md task 6)
- Which roles members can pick (e.g. ping roles, rank, region, platform)
- Channel layout
- Server colors (bot embeds currently use a placeholder blurple)

## Bot features

| Feature | Status | Source |
|---------|--------|--------|
| Reaction roles (`/reaction-roles`) | Ported | Velvets-Discord-Bot |
| LFG (`/lfg`, `/lfg-config`) | Built | New |
| Welcome / goodbye (`/welcome`, `/goodbye`) | Removed (Sept 28, 2026) | Velvets-Discord-Bot |
| XP / souls (`/rank`, `/urn`, `/leaderboard`, `/xp-config`) | Built (step 1) | New |
| Shop: hero card preview (`/shop`) | Built, awaiting check. Buying/equipping not built | New |
