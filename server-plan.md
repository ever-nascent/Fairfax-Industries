# Fairfax Industries — Server Plan

The source of truth for how the server looks and works. The bot/scripts build from this.

## Decisions (locked)

| # | Decision | Answer |
|---|----------|--------|
| 1 | What the server centers on | **Both equally**: your content (TikTok Live + Twitch) and Deadlock LFG/community |
| 2 | First bot feature | **Reaction roles**, ported from Velvets-Discord-Bot |
| 3 | Rank emojis | 11 current Deadlock rank icons (post–July 30, 2026 Ranked Mode) as `:rank_<name>:` emojis |
| 4 | Hero emojis | All 38 heroes' chat icons from deadlock.wiki as `:<hero>:` emojis (e.g. `:grey_talon:`, `:mo_krill:`). Uses 38 slots (boost level 1 now gives 100 static slots; 73 used, checked Sept 30) |

## LFG system (`/lfg`)

| Rule | Decision |
|------|----------|
| Who can run it | Anyone |
| Modes | Standard, Street Brawl, Ranked |
| Ranked rank | Taken from the runner's **rank role** (can't claim a rank you don't have) |
| Ping | Standard → @LFG Standard · Street Brawl → @LFG Street Brawl · Ranked → only @LFG <that rank> |
| Post | Embed in the region's channel (`#lfg-na`, `#lfg-sa`, `#lfg-eu`, `#lfg-ru`, `#lfg-asia`, `#lfg-oce`, `#lfg-africa`; `/lfg` posts in the one it is run in): mentions the runner, links the voice lobby |
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
| `lobby-category category` | Where the voice lobbies are created (posts go in the region channel `/lfg` was run in) |
| `mode mode enabled` | Turn Standard / Street Brawl / Ranked on or off |
| `show` | Current settings |

When a lobby closes for any reason (empty timeout, staff close, deleted by hand) its #lfg post is deleted.

Not enforceable by roles: Eternus' "within 3 subranks" rule (subranks aren't tracked).

## XP / levels (built: XP, souls, /rank, /urn, /leaderboard, /xp-config, the Shop with all four sections; awaiting his Discord check)

| Rule | Decision |
|------|----------|
| How XP is earned | Chatting: 15–25 XP per message, 60 s cooldown. Voice-time XP exists but is off by default |
| XP config | Staff can configure XP (amounts, cooldown, voice on/off, level-up channel) |
| Staff edits | `/xp` and `/souls` → `add`, `subtract`, `set` (amount, then member) or `reset` (member) (Manage Server, reply only staff sees). Level follows XP; levels gained this way pay no souls. Neither goes below 0 |
| Max level | 99 |
| Level up | Earns **souls** (the server currency). Souls per level rise on a curve. No extra milestone jackpots |
| Level-up message | Green embed in one channel (`/xp-config level-up-channel`; off until set). No ping. Wording (approved Sept 28): one of 5 Shopkeeper lines at random ("Look who's movin' up in the world! @name just hit **level 5**." etc., in `LEVEL_UP_LINES` in `xp.js`) + Level / Earned fields. Channel not picked yet |
| /urn look | Teal embed: urn icon + "Soul Urn" author, urn render thumbnail, Streak/Balance fields, urn voice line in the footer (footers can't be italic) |
| Curves | XP to next level = 5n² + 50n + 100 (MEE6 curve). Souls for reaching level n = 25 × n^1.5 (lvl 1 = 25, lvl 10 = 791, lvl 99 = 24,626) |
| Soul Urn amounts | 100 on day 1, +20 per day in a row, max 220 from day 7. Days reset at midnight UTC |
| Voice XP | 10 XP/min when on; needs 2+ people in the channel, not deafened, not the AFK channel |
| Daily Soul Urn | `/urn` once a day for souls; streak bonus grows each day in a row, resets on a missed day |
| Leaderboard | `/leaderboard`: top 10, no prize. Image in the rank-card style (flask per row, gold/silver/bronze top 3, souls), subtitle = server name. Command description: "The 10 biggest high rollers in the joint, ranked by level. Think you made the cut?" |
| Souls emoji | `:souls:` (wiki souls icon) before every soul count in messages; the bot looks it up by name on startup (emojis live in the server; the bot never uploads them) |
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
| Hero cards | Bought in the Shop. Two styles per hero, **sold separately** (priced like in-game item tiers): **Icon** card (hero chat icon) **800 souls**, **Full Portrait** card (hero's full-body render from deadlock.wiki, `File:<Hero>_Render.png`) **3,200 souls**. The hero's own colours on the XP bar, flask liquid, background tint and text accents |
| Style preview | In `/shop`, after picking a hero: two buttons under the card, **Icon** and **Full Portrait**, switch the card between the two looks; the Price field shows the price of the one on screen |
| Shop preview | Dropdown to pick a hero; the embed image updates to preview that hero's card before buying |
| Preview details (built, awaiting check) | `/shop` reply is only visible to the person who ran it. Two dropdowns (38 heroes, 25 max per dropdown): Abrams – McGinnis, Mina – Yamato, each option with the hero's `:<hero>:` emoji. Picking a hero redraws the card with **your own** name, level and souls. Embed colour = hero colour. Wording (approved Sept 28, Shopkeeper voice): no hero "Pick a face, any face. Every hero in the city, framed and ready for your `/rank`." / preview "The **Haze** card (Full Portrait). Looks good on ya. Want it?" / owned "You already own the ... Hit Equip and show it off." / equipped "Your ... is on your `/rank`. Wearin' it well, pal." Fields Price / Your Balance |
| Hero art files | Full-body renders in `assets/heroes/full body` (from `Get-DeadlockFullBody.ps1`, original size; the bot shrinks them in memory). If a hero's render is missing, the card uses their chat icon |
| Hero colours | **Sampled from the art** (the most common strong hue), not hand-picked. Any hero can be overridden in `COLOR_OVERRIDES` in `src/utils/heroes.js`. Colours change once the renders replace the chat icons |

### The Shop

Build order: **XP + a small Shop with hero cards together**; everything else in the Shop later.

Future Shop items (not now): custom VC, a role you control, perks (images, emojis, threads, nickname…), Shopkeeper gambling with souls (coin flip, slot pull; fake currency only). Some items need a minimum level to buy.

#### Hideout (custom VC + text channel), decided Sept 28, 2026, built Sept 28 (awaiting his Discord check)

| Rule | Decision |
|------|----------|
| What you get | **One purchase = a voice channel + a matching text channel** (a pair) |
| Price | **6,400 souls**, bought once, **kept forever** |
| Who can buy | **Level 20+** |
| Limit | **One pair per member** |
| Default name | **<name>'s Hideout** (e.g. 🔊 Zechariah's Hideout + #zechariahs-hideout) |
| Access | **Always private**: only the owner and members they add can see/join. Staff (Administrator / Manage Channels) can see inside |
| Owner controls | **Buttons in their own text channel** (pinned control panel): Rename, Add / Remove members, VC user limit. No lock/unlock (always private) |
| Renames | **One rename per day** |
| Category | The bot makes a **Hideouts** category on startup; staff can switch it with **`/hideout-config category`** (Manage Channels; existing Hideouts move too) |
| Owner leaves the server | Ownership is saved. **The channels stay (with their chat), hidden from everyone but staff** (owner and added members lose access); the owner and their members get access back when the owner rejoins |
| Bot was off (Sept 28) | On startup the bot catches up: remakes channels deleted while it was off, hides Hideouts whose owner left, reopens ones whose owner came back |
| Deleted by hand (Sept 28) | **Remade**: if a Hideout's voice or text channel is deleted, the bot makes it again right away (saved name, members, access; a new text channel gets a freshly pinned panel). To end one for good: **`/hideout-config remove member`** (no refund) |
| Renames | Once per **24 hours** (rolling). The text channel follows the voice name (lowercase, hyphens) |
| Code | `src/utils/hideout.js`, panel handlers `src/components/hideout.js`, leave/rejoin `src/events/hideout.js`, data `data/hideouts.json` |
| Shop screen | `/shop` opens on a section dropdown (Hero Cards, Soul Boost, Rejuv, Hideout). The dropdown stays on top in every section |

#### Rejuv and Soul Boost (decided Sept 28, 2026; both built, awaiting his Discord check)

| Rule | Decision |
|------|----------|
| Rejuv | Saves a broken `/urn` streak (in-game the Rejuvenator revives you after death). **3,200 souls**, carry **up to 3** (like the in-game 3 credits). When `/urn` finds the streak broken and you carry one, it offers a **Use Rejuv** button; **one Rejuv saves the streak however many days were missed** |
| Rejuv at `/urn` (Sept 28) | **Two buttons**: **Use Rejuv** (keeps the streak, uses one) and **Start Over** (streak back to 1, Rejuv kept); nothing is claimed until they pick; only they can press. Public message (Soul Urn author), footer = one of the Urn's own "left behind" voice lines (deadlock.wiki "Soul Urn/Voice lines": "I was beginning to feel abandoned." / "I can't believe I've been left here to rot!" / "I was worried I was forgotten." / "Hmph, it's about time!"). Only asks when the broken streak was **2+ days** (my call; saving a 1-day streak changes nothing worth 3,200). Layout (approved Sept 28): "@name, your **Streak** broke!" + blank line + "Use a Rejuv to save it, or start over and keep your Rejuv.", fields **Streak** / **Missed** / **Rejuvs** (with the `:rejuv:` icon), Use Rejuv button with the icon. After Use Rejuv: the normal claim message + a **Rejuv Used** field (icon + "n left") |
| Rejuv page (built and approved Sept 28) | Tier 3 panel, title REJUV, subtitle "A SECOND LIFE FOR YOUR STREAK". Lines: "Saves a broken /urn streak" / "One Rejuv saves it, however many days you missed" / "/urn asks first: Use Rejuv or Start Over" / "Carry up to 3 at a time". Box: your souls of 3,200, CARRYING n / 3. Shopkeeper line: "Miss a day, lose the streak. Unless you got one of these in your pocket. Call it insurance, pal." Button **Buy (3,200)**, greyed out if short or carrying 3 |
| Rejuv icon | The **gold** winged icon with a halo (deadlock.wiki `Mid-Boss.png`, 164 px; the same symbol glows inside the Rejuvenator crystal), the server's `:rejuv:` emoji (like `:souls:`). Not the green crystal |
| Soul Boost | **2× XP and souls for 1 hour**, **1,600 souls**. Doubles chat/voice XP, level-up souls, `/urn` souls and `/trivia` winnings. **Never** game winnings (blackjack, doors, hats, clock). The "no stream XP / LFG souls bonus" rule still stands; this is a bought item |
| Soul Boost page (built Sept 28, approved Sept 28) | Same layout as the Hideout page, Tier 2 panel. Title SOUL BOOST, subtitle "DOUBLE EVERYTHING FOR AN HOUR". Lines: "2× XP from chat and voice" / "2× souls from level-ups, /urn and /trivia" / "Lasts 1 hour from when you buy it" / "Buy another while it runs to add an hour" / "Doesn't double game winnings". Box: your souls of 1,600 (tick/cross), BOOST: NOT ACTIVE or N MIN LEFT. Shopkeeper line: "One hour, double everything. Don't waste it standin' around admirin' yourself." + "Your boost runs out <relative time>." while active. Button **Buy (1,600)**, or **Add an Hour (1,600)** while active; greyed out if short on souls. No confirm step |
| Other ideas (not picked yet) | Name Dye (name colour role), Title on `/rank`, Card Frame, Emoji Slot, Soundboard Slot |

#### `/shop` first screen (approved Sept 28, 2026; built, awaiting his Discord check)

| Rule | Decision |
|------|----------|
| Embed | Author **The Curiosity Shop** (the in-game shop's name) with the wiki's minimap shop icon (`MinimapShopIcon.png`); amber (sign glow); one rotating Shopkeeper line; banner image; section dropdown under it (Hero Cards, Soul Boost, Rejuv, Hideout) |
| Banner, top | Left: the in-game Curiosity Shop art (deadlock.wiki `The_Curiosity_Shop_in-game.png`). Right: CUSTOMER + name, the **level flask** from `/rank` as the level icon (no separate level icon), souls (souls glyph always at its real 44×77 shape) |
| Banner, shop page | A replica of the **in-game shop screen** (deadlock.wiki `Weapon_shop.png`): worn greyish-tan paper, diagonal hatching, ragged edge, **no bullet hole**. Top left: black **FAIRFAX** header plate (cream ribbon outline, orange offset letters) with **"SOULS BOUGHT AND SOLD"** under it (in-game: "Artillery Bought and Sold") |
| Tiers | Every price is a real in-game tier price. Tiers 1–3 in a row under the header, each fancier like in-game: **Tier 1 $800 Icon Card** (plain tilted black plate, double orange lines, cream card); **Tier 2 $1600 Soul Boost** (gold-outlined plate, faint circles, golden card, tag "2× · 1 HR"); **Tier 3 $3200 Full Portrait Card + Rejuv** (ticket plate with dotted gold border, beaded frame + halftone, brown cards, **smaller cards than the other tiers**, Rejuv tag "MAX 3") |
| Tier 4 | **$6400 Hideout**: dark panel on the right (bronze double lines, notched corners, corner stars), straight octagon plate with a star above and below hanging off its top-left corner, "TIER 4" (tan) over "EXPERTS ONLY" (bronze italic), dark card with tag "LV 20+", **bigger than the other tiers' cards** and centred in the panel. Its bottom lines up with the other tier panels. **No "All's Fair!"** (tried, removed) |
| Hero cards on the shelf | **Split by style**: Icon Card in Tier 1, Full Portrait Card in Tier 3, both showing the member's equipped hero (Haze if none). Replaces the fanned-hand idea |
| Cards | Tan item cards like in-game: square art on top, name on a worn paper band, small print marks in the corners, tags styled like the in-game black ACTIVE tag. Cards are ~85% size so panels have room around them |
| Hideout icon | The minimap **Stairs** icon (stairs down to the secret shops, deadlock.wiki), **redrawn as vector** so it stays sharp (the wiki file is 24 px). Uploaded as the **`:hideout:`** emoji (Sept 28, `setup.py shop-emojis`, file `assets/shop/hideout.png`); used in the section dropdown |

#### `/shop` Hideout page (preview approved Sept 28, 2026; built Sept 28)

| Rule | Decision |
|------|----------|
| Embed | Same author/colour as the first screen. Shopkeeper line: "Every regular needs a place to lay low. Four walls, a lock, and nobody gets in unless you say so." |
| Image | Shop-page paper. Left: close-up of the Tier 4 panel ($6400 plate, TIER 4 / EXPERTS ONLY, big Hideout card). Right: **HIDEOUT** (Fairfax header lettering) + "A PLACE TO LAY LOW", then: "A private voice channel + a matching text channel" / "Named **"<name>'s Hideout"** (rename once a day)" (quotes added Sept 28; <name> = their server display name) / "Only you, staff and members you add get in" / "Control panel pinned in your text channel" / "Yours for good, even if you leave and come back" |
| Requirements box | Level flask + "LEVEL NEEDED 20", souls + "<balance> OF 6,400"; green tick when met, red cross when not |
| Components | Section dropdown (Hideout picked, `:hideout:` emoji) + **Buy (6,400)** (greyed if under level 20 or short on souls; **Owned** + link to the channel once bought) |
| Shopkeeper lines | Original, **no Knicks mentions at all** (Sept 28: "stop mentioning it"; the old `/rank` Knicks line was replaced too). Current four: "Come on in! Everything on the shelf's got a price, and I only take souls. No IOUs." / "Finest merchandise this side of the river. You touch it, you bought it." / "Browse all you want, pal. Just don't fog up the glass." / "Back again? I knew you had taste. Let's see what's burnin' a hole in your pocket." |

#### Hideout control panel (preview approved Sept 28, 2026; built Sept 28)

| Rule | Decision |
|------|----------|
| Where | Posted and **pinned** by the bot in the owner's Hideout text channel; only the owner can use the buttons |
| Style | **Plain Discord embed** (a Fairfax-paper banner version was compared and rejected: names not clickable, small text). Author "Hideout" with the `:hideout:` icon, `:hideout:` thumbnail, bronze colour. Title "<name>'s Hideout". Line: "Your keys, pal. Only you, staff and the people you add can get in here." |
| Fields | Owner (mention), Members (count + mentions), Voice limit, Rename (available now / when next) |
| Controls (approved Sept 28) | **Everything on the panel** (his call): an **Add Members** member picker (up to 10), a **Remove Members** dropdown of current members (greyed out, "Remove Members (Nobody Added Yet)", when empty), then **Rename** (pop-up "Rename Your Hideout", "New Name (Both Channels)", pre-filled, once per 24 h) and **User Limit** (pop-up "Voice User Limit", "0-99 (0 = No Limit)") buttons. Title Case labels. Private green replies: "Let in: @A, @B", "Removed: @A", "Renamed to **name**.", "Voice limit set to **n**." / "Voice limit removed.". The panel updates after every change. Pinned by the bot when the Hideout is made |


### Games (souls; ten betting games live under `/mini-game`: Guess the Door checked, the rest awaiting his Discord check; Slots still planned, not built)

All the betting games run from one command: **`/mini-game game:<Guess the Door | Blackjack | Rabbit in the Hat | Borrowed Time | Bebop's Bombs | Powder Keg | Duel of Stances | Shotgun Roulette | Remling Race | Deal or No Deal> bet:<souls>`** (decided Sept 28, 2026; replaces the separate commands named below, e.g. `/guess-the-door`, `/blackjack`, `/rabbit-in-the-hat`, `/borrowed-time` and `/whack-a-mo` (never built) are not commands). Code: one money flow for every game, in `src/utils/casino.js` (`takeBet`, `openGame`, `stake`, `pay`; a failed save refunds the bet). `/trivia` stays its own command (decided Sept 28, 2026).

Idea: a game per character. Fake currency only (souls).

| Decision | Choice |
|----------|--------|
| Visibility | Every `/mini-game` game is **public** (everyone in the channel sees it) |
| Bets | The player **types any amount**: minimum **10 souls**, maximum **their whole balance** (no cap) |
| Time limit (Sept 28) | A game with **no click for 5 minutes** is called off: **everything they put in comes back** (Blackjack Double Down / Split included; Borrowed Time: the bet, the prize built up is lost). The message turns into a time's-up message: the host's **gloat** portrait, "**Time's up.**" / "Your <souls> came back." (approved Sept 28), Bet / Returned / Balance, a time's-up line in the host's voice (`TIMEOUT_LINES` in each game file, all approved Sept 28; Henry's "Intermission is over." not in capitals; Paradox's "You had all the time in the world, and you wasted it."), Play Again. Checked every 30 s, and on startup (games that ran out while the bot was off) |
| Duel of Stances (Sept 29; Yamato's game, rock paper scissors; awaiting his check) | `/mini-game game:Duel of Stances bet:<souls> [opponent:@member]`. Stances: Power Slash beats Flying Strike beats Crimson Slash beats Power Slash. **No opponent = vs Yamato**: he picks at the start, win pays **1.85x** (95% back), tie returns the bet, loss pays nothing. **With an opponent**: challenge pings them; Accept (they stake the same bet) or Decline (bet returned); picks are secret (private green reply, the message shows ready / choosing...); winner takes the pot, tie refunds both; Rematch button for either duelist. No pick / answer within 5 min: called off, everyone who staked is refunded. Stance icons are server emojis (`:power_slash:`, `:flying_strike:`, `:crimson_slash:`, looked up on startup). Mock-ups approved Sept 29; footer lines are his own voice (original) |
| Shotgun Roulette (Sept 29; Silver's game, Buckshot Roulette core loop, no items yet; awaiting his check) | `/mini-game game:Shotgun Roulette bet:<souls> [opponent:@member]`. Shotgun with 2-8 shells (1-3 live, at least 1 blank); the **live/blank counts are shown, the order is hidden**. **3 charges each**; on your turn **Shoot <other>** or **Shoot Yourself** (blank on yourself = shoot again, live on yourself = turn passes, blank on the other = turn passes); empty chamber reloads with new counts; last one with charges wins. **No opponent = vs Silver**: you shoot first, she answers automatically in the same message, and she only shoots herself when no live shell is left (any riskier rule lost to always-shooting-her in simulation); a win pays **1.85x** (his call), a loss pays nothing, no ties. **With an opponent**: Accept / Decline, both stake, winner takes the pot, Rematch. The shots of the last turn show as a `>` quote. Emojis (his call, white like the in-game ability icons, drawn by `assets/silver/make_shells.js`): `:shell_live:` solid shell, `:shell_blank:` hollow shell, `:charge:` white outline heart, `:charge_lost:` dim grey cracked outline heart. Footer = a random Silver line each turn. Items (handsaw, beer, cigarettes, magnifying glass, handcuffs) and multiple rounds: not built (possible step 2). |
| Remling Race (Sept 29; Rem's game, a horse race; his idea after Calico's Derby, Seven's Wheel, Viscous Plinko and Pocket Slots mockups didn't land; awaiting his check) | `/mini-game game:Remling Race bet:<souls>`, solo. Five Remlings (red, blue, green, yellow, pink; his approved flat emoji, the Lil Helpers icon recoloured, `:remling_<colour>:`, looked up on startup) race **left to right, finish flag on the right**, drawn as text lanes (`> **1.** - - 🔴 - - 🏁`, a bold number after a blockquote bar, one dash per cell with spaces between, 10 cells, no picture), the message **edited every 2 s**. Pick 1 of 5 buttons (each shows its odds); win chances 36 / 26 / 20 / 11 / 7 % handed to the lanes at random each race, a win pays 95% / chance (2.63×, 3.65×, 4.75×, 8.63×, 13.57×). The winner is drawn first, then a random race is re-run until they win it, so chances are exact. Winner gets a trophy in place of the flag. Rem gloats when you lose and is hurt when you win. Bot restart mid-race: refunded at startup (`gamesReady.js`), like Powder Keg. `src/utils/rem.js`, art `assets/rem/` (portraits + Lil Helpers icon from deadlock.wiki), test `test/rem.test.js`. |
| Deal or No Deal (Sept 29; Pocket's game, his idea; awaiting his check) | `/mini-game game:Deal or No Deal bet:<souls>`, solo. **20 suitcases** as a 4x5 button grid (his call). Pick one to keep, then open cases in rounds of 5, 4, 3, 3, 2, 1 (18 in all); after each round Pocket makes an offer (Deal / No Deal), and with two cases left it's Keep or Swap. The 20 cases hold multiples of the bet from 0.05x to 6x, averaging exactly 0.95x (95%); offers are 55% to 94% of the average of what's left, so a deal never beats playing on. The prize board (in souls, opened ones struck through) sits in the message; your case is blue, opened ones show what they held. Pocket is hurt when you win (prize at least the bet) and gloats when you lose. Games in `data/pocketGames.json`. `src/utils/pocket.js`, art `assets/pocket/`, test `test/pocket.test.js`. |
| Play Again (Sept 28) | **Only the player of that game** can press it; anyone else gets a private green embed "Only the player can play again. Start your own with `/mini-game`." |
| `/lfg` post fails (Sept 28) | The lobby it made is deleted; the runner gets a private **red** embed titled **LFG Not Created**: "An error occurred while posting your LFG. The lobby has been removed. Please run `/lfg` again." + Mode / Region / Lobby (Removed) fields + time |
| Buttons | Title Case ("Pull Again (100)", "Change Bet", "Play Again (100)") |
| Bebop's Bombs (Bebop's game, built Sept 28; previews approved Sept 28: start lines "@user bet <souls>" / "Bebop hid **4 Sticky Bombs** under **20** tiles!", "**Boom!** That tile was a Sticky Bomb.", all his lines; awaiting his live check) | **Casino-style Mines** (his pick over real minesweeper with numbers), a `/mini-game` choice. **20 tiles as emoji buttons** (4 rows of 5, ❔ hidden) + a row with **Cash Out**; **4 sticky bombs** hidden at random. Each safe tile turns green with the `:souls:` emoji and raises the prize; prize = bet × **95% of the fair odds** of surviving that many picks (1 safe ×1.18, 2 ×1.50, 3 ×1.93 ... all 16 ×4,602.75, which cashes out on its own). Cash Out any time after the first safe tile; a bomb loses the bet (that tile turns red 💥, the other bombs show his `:sticky_bomb:` emoji, looked up on startup). Fields Bet / Prize / Next Tile while playing, Bet / Won / Balance after. No picture (the board is the buttons). Author icon **Sticky Bomb**, copper embed, thumbnail portrait → **gloat** (bomb) / **injured** (cash out). Footer: original Bebop-style lines (scrappy junkyard robot, "mate", "Didn' see that one comin', did ya?") in `WIN_LINES` / `LOSE_LINES` / `TIMEOUT_LINES` in `src/utils/bebop.js`. Same bet rules, 5-minute time limit and Play Again lock as the others. Games in progress in `data/minesGames.json` |
| Slots, Sinner's Sacrifice (still planned Sept 28; will be a `/mini-game` choice; parked Sept 28 for Bebop's Bombs) | References found Sept 28: the machine (brass cabinet, bulb marquee, "Pain for Gain" plaques, glass box of green souls, lever); the wiki's quote for it is **Victor**'s ("In the end, the pain will pay dividends."), a candidate host. Nothing downloaded yet. |
| Slots details | Sinner's Sacrifice sign (deadlock.wiki) on top, 3 reels in a brass housing. Symbols: Souls, Soul Urn, Seeker, Oracle, Eternus (jackpot). Animated GIF, reels stop one by one, plays once. Payouts not decided (suggested 3 Eternus 25×, 3 Oracle 10×, 3 Urns 5×, 3 Souls 3×, 3 Seekers 2×) |
| `/guess-the-door` The Baroness Hotel (the Doorman's game) | Three rooms (101–103), the Doorman's real double door (Doorman Reference Sheet, deadlock.wiki) in a **Baroness Hotel corridor**: deep green striped wallpaper with a gold art-deco diamond motif, brass wall lamps between the doors, dark wood panelling with a gold rail, burgundy carpet runner; halftone shading and grain for the Deadlock look. Pick a room → the Doorman opens an empty one → **Stay** or **Switch** → all doors open. **A win pays 1.5× the bet.** Empty rooms show the Baroness Hotel void (in-game art); the winning room is the same void with **one centred soul** and a green glow. **No lightning frames.** "YOUR ROOM" label in plaque gold under your pick. Embed colour Doorman burgundy, Doorman portrait thumbnail; once the game is over the thumbnail switches to his **gloat** portrait when you lose, or his **injured** (Critical) portrait when you win and the footer shows one random **Doorman-style line** (original, not his in-game lines; 4 for a win, 4 for a loss, in `WIN_LINES` / `LOSE_LINES` in `src/utils/doorman.js`) |
| `/guess-the-door` top-left icon | The Doorman's ult icon (Hotel Guest) next to "The Baroness Hotel" (embed author) |
| `/blackjack` Wraith's Table (Wraith's game) | **Wraith deals** (she runs NY's underground card games). Her own deck from the Wraith Reference Sheet: lavender Card Trick cards (red hearts, black spades, blue clubs, orange diamonds) with rank corners; face-down card = her dark plum ace style with a gold spade. Plum felt table, gold + magenta lines, "BLACKJACK PAYS 3 TO 2 / DEALER STANDS ON 17", leather rail, halftone + grain. Her portrait thumbnail → **gloat** when you lose, **injured** (Critical) when you win, normal on a push; **Card Trick** icon top left; magenta embed. Moves: **Hit, Stand, Double Down, Split**. **Joker in the deck: whoever draws it wins the hand outright** (a Joker win pays like a normal win, 2× back; Wraith's Joker beats everything, even a blackjack). Standard payouts: win 2× back, natural blackjack 3:2, push returns the bet, dealer draws to 17 (stands on all 17s), she checks for blackjack at the deal. One split (same rank), split aces get one card each; Double Down and Split cost another bet. Table restyle: Deadlock ritual circle + gold spade in the felt, her suits along the arc, gold art-deco frame, souls chip stack for the bet, name plates and big totals. Footer: one random **Wraith-style line** (original, written from her voice lines: cocky NY racketeer, bets, ledgers, markers) for a win, loss or push, in `WIN_LINES` / `LOSE_LINES` / `PUSH_LINES` in `src/utils/blackjack.js`. Same bet rules as the other games |
| `/whack-a-mo` Whack a Mo (Mo & Krill's game, **parked**: carnival booth preview shown, he wants to circle back later; not built) | Mo (Maurice) is the big mole, Krill the talker riding him. **1920s carnival booth** (first try, a brick tunnel with dirt mounds, was rejected): cream marquee sign "WHACK A MO" with bulbs (Sinner's Sacrifice sign style) + "THE TUNNEL RATS PRESENT", red/cream striped scalloped awning, wooden plank board with bulb-lined posts, 5 holes with brass rings and number tags, chalk signs for WHACKS (3 pips) and NEXT HIT payout; halftone + grain. Mo hides under one hole; **up to 3 whacks: a hit on the 1st pays 2.5×, 2nd 1.5×, 3rd gives the bet back**, 3 misses lose. Miss = MISS stamp in the hole; hit = his Critical portrait in the hole + BONK burst; loss = his Gloat portrait in his real hole + HA HA burst. Buttons Mound 1–5. Author icon **Burrow**, thumbnail portrait → gloat / injured, brown embed. Footer: Krill-style lines (cheerful, theatrical, proud of "Maurice"/"Momo") |
| `/rabbit-in-the-hat` Sinclair (built, awaiting his Discord check) | Shell game: 3 top hats, the rabbit is under one. Backdrop = **his real hero-select art** ("Sinclair select background": navy, pale moon, halftone, subway map, rabbit silhouette); hats drawn as black top hats in **comic halftone** (design D: moonlit dots at the top fading to solid black, brass band like his pocket watch, brim curled with a pale edge), the rabbit (Rabbit Hex) flattened into the art's pale colour. Title "THE AMAZING SINCLAIR" in pale Retail on the dark side. Author icon Rabbit Hex, thumbnail card → gloat / injured. **A win pays 2.5×.** The start message is an **animated shuffle GIF** (hats arc past each other, plays once; decorative, the rabbit is placed at random so tracking hats doesn't help; made once and reused). Buttons Hat 1–3. Reveal: your hat and the rabbit's hat lift. Footer: one line from **either Henry or Savannah (50/50)** (Sinclair is two people in one body: Henry the Magnificent + his spectral assistant Savannah), in `WIN_LINES` / `LOSE_LINES` in `src/utils/sinclair.js` |
| `/borrowed-time` Paradox (built, awaiting his Discord check) | **Higher or lower on a clock**, push your luck: the hand lands on an hour I–XII, you call Higher or Lower for the next spin; each right call multiplies the prize (multiplier from the real odds, small house cut, shown on the buttons, e.g. from IX: Higher ×3.8, Lower ×1.2); **Cash Out** any time; a wrong call loses the bet. **The hand never lands on the same hour twice**; at I or XII there's nothing to call, so it's **Spin Again** (free) or Cash Out. Cash Out appears after the first right call. **No limit** on calls. Multiplier = 95% of fair odds (11 / hours that win), rounded down to 2 decimals. Footer: Paradox-style lines (cocky, heist talk, time puns) in `WIN_LINES` / `LOSE_LINES` in `src/utils/paradox.js`. Look: **her hero-select art** (shattered clock, plum/teal/pink) behind a clock dial with an ornate plum hand, the hour as a big Roman numeral in her art's style, TIMELINE panel (calls so far) and PRIZE panel. **Animated (GIF, plays once, ~2.5 s)**: each spin the hand whips round at least one full turn and settles on the new hour (small overshoot, never past half an hour), the numeral flicks through the hours as it passes; 3 small tilted **background clocks** tick the whole time; cashing out doesn't spin. Author icon **Pulse Grenade** (hourglass), thumbnail portrait → gloat / injured, magenta embed |
| `/trivia` Deadlock Trivia (built, awaiting his Discord check) | **Solo**: public message, but **only the person who ran it can answer**, **one guess**, 20 s to answer (no time shown on the question: his call, Sept 28). **Pay (Sept 28): a streak**: each right answer in a row pays more, **25, 30, 35 ... 70 at 10 in a row** (streak caps at 10, then stays at 70); a wrong answer or time's up resets it; the streak carries over between days. **Only 10 right answers pay per UTC day**, after that no souls until midnight UTC. **No rules text on an open question** (his call, Sept 28: the "@user, one guess. Get it right for X souls" / "No souls left today" line is gone; the result still shows souls won or "No souls left today"). Soul Boost still doubles. Every round shows **Streak** + a 10-emoji bar drawn like the /rank XP bar (`:streak_left/mid/right_on/off:`, the server's emojis) + "n/10". Rules in `xp.js` (`triviaAnswer`), then the answer is revealed (right = green, their wrong guess = red, + time; answers stay **buttons**: tried a dropdown, buttons looked better; **except all 4 hero questions** (whose voice line, finish the line, what is this ability called, whose ability): a dropdown of the same 4 choices, heroes with their emojis, 20 s, his call Sept 28; so only cost / tier / fill in the blank keep buttons) with a **Next Question** button (starts a new solo round for whoever clicks it). **No cooldown**, no multiplayer. **Modes** (`/trivia mode:`): **Heroes**, **Items**, empty = any question. Item questions (from the wiki's item data, tiers 1–4, Sept 2026 patch): **how many souls does X cost** (800 / 1,600 / 3,200 / 6,400), **what tier is X**, **fill in the blank** (one % stat from the item's card blanked out, e.g. "+??% Fire Rate", pick the number; wrong numbers are the same stat on other items). **Added Sept 28 (his ask):** **which item is this** (blurred item art, pick from a dropdown of 5 item names (his call, first built with 25), mostly the same slot, A-Z; art unblurred at the end), **name this item** (clear art, a **Type Your Answer** button opens a pop-up; capitals, spaces and punctuation don't matter, spelling does; footer "Capitals and spaces don't matter" while the round is open, his call), **what does X upgrade into** (dropdown of 5 higher-tier items with one right upgrade; items that build into several show one and the end says "Additionally, it builds into ..." (his wording); the result swaps the item art for a **build graph**: the item on top, arrows down to everything it builds into, colour-coded by slot (Weapon orange, Vitality green, Spirit purple): each tile's outline and the whole path to it (along the bar and down to its arrow) in that item's colour, the stem from the top item in its colour; a small gap between each arrow tip and its item (his calls, Sept 28); upgrades from the wiki's item `Components`). Those three get **30 s** (20 s is tight for reading a list or typing). A wrong dropdown pick or typed answer is named in the result ("you said ..."). Item art shown on every item question. Next Question keeps the mode. No surprise questions for now. 4 question types, random: **whose voice line** (text only, **no audio**: voices are too recognisable), **finish the voice line** (wrong endings cut from the same hero's other lines), **what is this ability called**, **whose ability is this**. Data from deadlock.wiki via `setup.py trivia` → `assets/trivia/` (each hero's own lines only: no conversations/other characters/removed lines, no lines that name the hero; Yamato's Japanese lines use the wiki's English translations; 4 abilities + icons per hero). **Host: Dynamo** (his call, Sept 28: he's a professor; stays `/trivia` with the same pay, not a betting game): author "Dynamo's Classroom" + Singularity icon, thumbnail = his portrait while open, **gloat** when you're right, **injured** when you're wrong or time's up (his call, Sept 28: he's an encouraging teacher who wants you to get it right, the reverse of the betting hosts); footer = one original line in his voice, encouraging, never mocking (12 right, 12 wrong, 8 time's up; modelled on his wiki voice lines: "Oooh", stretched words, his class, term papers, tenure, Marla). The answer's hero (was the thumbnail) is now its emoji in the text |
| Rejected concepts (Sept 27) | Holliday quick-draw (emoji), Kelvin thin ice (emoji grid), first Sinclair stage (red curtains): "too generic, not Deadlock enough" |
| Holliday's Powder Keg (built Sept 28, 2026, awaiting his Discord check; `/mini-game game:Powder Keg`) | **Crash game**, a `/mini-game` choice: the fuse burns, the multiplier climbs (message updated every ~2 s), **Cash Out** before the keg blows at a random point. Look: her hero-select background (teal, orange sheriff star, halftone, grain), the white Powder Keg ability icon on the left, multiplier on a cream-edged plate (FUSE LIT / CASHED OUT / BOOM, Radiance font). **The fuse continues out of the icon's own fuse stub** (his call: same width and colour, the icon's baked-in spark cut off, the spark rides the burning end). Screens: start (1.00×), burning, cashed out (green, injured portrait, fuse snuffed with smoke, shows where it would have blown), boom (red, gloat portrait). **Explosion = "Shatter"** (his pick, Sept 28: the keg icon cut into wedges flying apart over a layered orange/amber/cream fireball with halftone dot gradients, grunge from her background, cream light shards, teal smoke, sparks, BOOM plate knocked crooked). Portraits + background from deadlock-api.com (`astro_*`). **Steady burn, as a GIF** (his call, Sept 28): a **20 s** GIF (his call, Sept 29: 30 s felt slow; 8 frames a second, plays once, ~1.8 MB, drawn per bet in ~1 s, the last 20 bets kept) of the fuse burning at a steady pace while the multiplier counts up; the multiplier grows the same share every second, 1× → **10× cap** as the fuse hits the keg (×2 at 6 s, ×3 at 9.5 s, ×5 at 14 s). **Fuse (Sept 29, his picks):** plain white like the icon's fuse (no rope lines, no ash trail: his call), thrown in **one big lasso loop** then a wave to its end above the plate; **fire = "Flame"**: a comic flame with three swaying tongues, layered orange / amber / cream / white with halftone dots, grunge, cream shards, halftone glow, embers rising (the explosion's style). The plate's top line while burning shows **the souls a Cash Out pays now** (souls icon + bet × multiplier; his ask), the multiplier under it. Known: the flame's tip goes past the top edge for about a second as it crosses the top of the loop (~4.2×–4.6×). **GIF lag fix (Sept 29, his call):** kegs seemed to blow before the GIF got there (the GIF only starts once it's downloaded), so the bot's clock starts **1 s after the message goes up** (`GIF_DELAY_MS`, a guess to tune), and the GIF was slimmed (3.3 → 1.8 MB: 8 fps, smaller glow, grain under the flame). Odds unchanged (he chose not to soften them): 52.5% of kegs blow before 2×. The GIF only shows time; **the bot's clock decides**: Cash Out pays bet × the multiplier at the click (rounded down to 2 decimals), the keg blows on a timer started when the message goes up. Button just "Cash Out" (the amount can't update live under a GIF). **Odds like Crash** (my call, he said "do what matches crash"): the chance the keg lasts past m is **95% / m**, so any cash-out target returns 95% on average (same cut as Bebop's Bombs / Borrowed Time); 5% of kegs blow at 1.00×; every keg blows at 10×. Cash Out after the keg's moment = loss. Result: Bet / Won / Balance, "would have blown at" on a cash out. Footer lines (original, her voice: blunt Midwestern sheriff from Macomb, hates New York): start, win, lose, time's-up in `src/utils/holliday.js`. A restart mid-game loses the timer, so leftover games are refunded at startup (time's-up message). |
| Later game ideas | Shopkeeper coin flip |
| `/lockle` Lockle (decided + built Sept 28, 2026, awaiting his Discord check) | Wordle-style: guess the hero from a **real Ascendant+ ranked build** (recent matches from deadlock-api.com, unofficial; the real Lockle at lockle.app does the same). **6 guesses**, picked from two hero dropdowns with hero emojis (guessed heroes drop out). Guess 1 shows the first **2 items** in buy order, each wrong guess shows **2 more**, an inline **Time** field (his call, Sept 28) shows the match clock when the last item shown was bought (no times under the items); guess 6 also shows the player's **souls at the end**. Picture (his call, Sept 28: look like lockle.app): cream panel, the in-game shop item art (no names), dark empty slots for the rest, souls in a dark pill top right on guess 6, a row of 6 guess slots with hero icons (wrong = faded with a red outline, no X: his call Sept 28; right = green outline), "Guess n of 6" under the panel (Retail font, his call Sept 28: Forevs declined; Retail draws `/` as a souls icon); the answer shows the whole build in even rows up to 8 wide (his call, Sept 28: 14 items = 2 x 7, 16 = 2 x 8, 21 = 3 x 7, 24 = 3 x 8; the panel widens to fit), while guessing it stays 6 x 2. Embed text while playing (his wording, Sept 28): **Whose Build Is This?**, then 3 inline fields on both daily and practice (his call Sept 28; Guess and Prize fields removed, the picture says "Guess n of 6"): **Match Time** (when the last item shown was bought; the match length once over), **Rank** (the player's own rank with its `:rank_<name>:` emoji, e.g. Ascendant VI; can be one rank below the match average), **Souls Spent** (shop prices of the items shown added up; upgrades really cost less). |

## Member roles (decided Sept 28, 2026; built, awaiting his Discord check)

| Who | Role |
|-----|------|
| Owner | Don of the Cursed Apple (bot gives it to the server owner) |
| Admins | Shrine Keeper |
| Mods | Base Guardian |
| Everyone | Citizen of the Cursed Apple (bot gives it on join; existing members get it on bot startup) |

Shown separately in the member list, not @mentionable, no colour. Permissions: Shrine Keeper = Administrator; Base Guardian = Kick, Timeout, Mute + Deafen + Move Members (voice), Manage Nicknames, Manage Messages; Don and Citizen = none. Set only when the bot creates the role. Created by the bot just under its own role, in that order. Rejected names: Grand Occultist, The Patron, Walker, Guardian, Consigliere.

## Server unlock (decided + built Sept 29, 2026, awaiting his Discord check)

New members see only #welcome, #rules and #roles. **Picking a Patron** (The Archmother / The Hidden King) in #roles gives Citizen of the Cursed Apple, which carries View Channel and unlocks the rest (his call). @everyone no longer has View Channel at role level; #welcome, #rules, #roles allow it for @everyone. The Patron menu text: "Select Your Patron to unlock the rest of the server:". Which menus to pick will be written in #rules (not drafted yet). Members who joined before Sept 29 keep Citizen; un-picking a Patron doesn't lock again. Staff roles also unlock.

### #roles Customs menu (posted Sept 29, 2026)

Pick any (one option): the `:souls:` emoji (his call) gives the existing Customs role (violet, no pings, his call). Title "Customs", text "Select if you would like to join Customs:".

## Channel permissions (set Sept 28, 2026 by Claude, his call to let Claude decide)

| Channels | Who can talk |
|----------|--------------|
| #welcome, #rules, #announcements, #deadlock-updates, #streams-and-uploads | Read-only for everyone (no messages or threads); staff with Administrator and the bot can post |
| #roles | Read-only, and members can't add new reactions (they can still click the bot's reactions) |
| Text Channels (#off-topic, #deadlock-*, #bots), LFG channels, General voice | Open to everyone |
| #mods, Staff category (#community-updates) | Hidden from everyone; Base Guardian can see and talk; Shrine Keeper/Don see everything via Administrator/owner |
| #audit-log (Staff) | Hidden from everyone; Base Guardian can see but not type, react or make threads; only the bot posts (set Sept 28). Shrine Keeper can still type there (Administrator overrides channel permissions) |

## Voice channels (created Sept 28, 2026 by Claude through the bot)

All in the Voice Channels category, in this order under General:

| Channel | Who | User limit |
|---------|-----|------------|
| Stream | Hidden from everyone; Base Guardian can see/join/talk; Shrine Keeper + owner via Administrator/owner | none |
| Customs | Everyone | none |
| Ranked | Everyone | 2 (Ranked is solo/duo) |
| Standard | Everyone | 6 (no party cap in Standard, so a full team) |
| Streetbrawl | Everyone | 4 (Street Brawl is 4v4) |

## Role colours (applied Sept 28, 2026 by the bot)

| Roles | Colour |
|-------|--------|
| Rank roles, each from its in-game badge | Initiate `#c66b4e`, Seeker `#a89284`, Acolyte `#8fa3a3`, Sentinel `#de8f4e`, Mystic `#b8c2d6`, Ritualist `#e8b640`, Emissary `#8fd3d6`, Oracle `#c3c3f5`, Phantom `#8a6be0`, Ascendant `#ff9a3c`, Eternus `#4fe3e0` |
| LFG <rank> ping roles | Same colour as their rank |
| LFG Standard, LFG Street Brawl | `#6aa98a` flask green, `#e2574c` brawl red |
| Hero roles (added Sept 29) | Sampled from each hero's chat icon (same colour as the Shop hero card) |
| Region roles (Sept 29) | Europe `#5b8def`, North America `#e2574c`, South America `#3fbf7f`, Asia `#f2c94c`, Oceania `#2fc4c4`, Africa `#e8873a`, Russia `#b0b7c3` |
| Patrons (Sept 29) | The Archmother `#e8c15a`, The Hidden King `#5b6bd6` |
| Don / Shrine Keeper / Base Guardian (Sept 29) | `#f2c94c` gold, `#d9534f` red, `#4a90d9` blue. |
| Citizen of the Cursed Apple (Sept 29) | `#b5495b` apple red. Sits just below Eternus, above the LFG and Server Booster roles (his call, Sept 29), so it is the default name colour for anyone without staff, Customs or a rank role, and never paints over a rank colour; still shown separately in the member list |
| Customs | `#b36bff` patron violet. Sits above the ranks, so it overrides the rank colour for anyone who has it |

## Audit log (decided Sept 28, 2026; built, awaiting his Discord check)

Channel 1554246639760318524. Admins + mods (Base Guardian) can see it; read-only, only the bot posts. One colour-coded embed per event (red = deleted/removed, green = added/joined, yellow = edited), plain factual titles, Discord timestamps. Layout copied from Velvet's bot (his call, Sept 28): one labelled field per fact (Member, Added, Removed, Before, After, Channel, By, Reason, ...), people shown as `@mention` `username` (`ID`), deleted things as `name` (`ID`), footer "User ID: ..." (or Message/Channel/Role ID), new avatar as thumbnail. Who did it + reason taken from Discord's audit log.

| Area | Logged |
|------|--------|
| Messages | Deleted (text + image/GIF copies), edited (before/after), bulk deletes (.txt of what was removed), pins/unpins. Ghost ping flag on deleted/edited messages that had @mentions |
| Join/leave | Joins: account age (new-account warning, age set in config, default 7 days), invite used, member number, rejoin notice with their last roles (roles are not given back). Leaves: time in server, roles |
| Mod actions | Kicks, bans, unbans, timeouts. Missing reason shown as "No reason given" in red |
| Member edits | Roles added/removed (menu/dropdown picks logged, marked self-picked), nicknames, username/avatar |
| Voice | Join/leave/switch (incl. LFG lobbies), server mute/deafen/disconnect/move, streaming/camera |
| Server | Channels, roles, server settings, emojis/stickers, invites, threads/forum posts, scheduled events, webhooks/bots/integrations, AutoMod actions, reactions added + removed, stage/soundboard, polls |
| Not logged | Boosts; anything the bot itself does (its messages, LFG lobby channels, emoji uploads), except role picks members make through it; the bot's economy/games/staff commands; everyday commands. Other bots are logged like members |

Message memory: last 7 days saved to disk (text + image/GIF copies; videos/other files by name only), so restarts don't lose it. Member history (names, nicknames, joins/leaves, mod actions) kept forever.

`/audit-log-config` (Administrator only): toggle each event on/off by slash option (`event:` search, `on:` true/false; all start on), ignored channels, ignored members, change log channel, new-account age, `history member:` lookup.

## Deadlock ranks (current, lowest → highest)

Initiate, Seeker, Acolyte, Sentinel, Mystic, Ritualist, Emissary, Oracle, Phantom, Ascendant, Eternus.
Each has subranks I–VI. Obscurus = uncalibrated (no icon used).
The old names Alchemist, Arcanist and Archon were retired in the July 30, 2026 update.

## Done

- Server created, bot invited with Administrator, bot role on top
- `setup.py check` passed
- `setup.py community` (first phase): #rules, #mod-updates (staff only), Community mode on. The channel layout has since been set by `setup.py layout` and later changes (see Channel permissions; `#mod-updates` no longer exists: staff use #mods and #community-updates)
- Hosting: runs on his PC for now, a VPS later (`npm ci && npm start`; the bot registers its slash commands itself)

## Open questions (next)

- Before opening (Sept 28 audit): fill #rules and #welcome (later); Rejuv + Hideout built Sept 28 (awaiting check); Rank and LFG Pings menus posted Sept 28, Stream pings skipped (alerts stay @everyone, his call). Pinned: LFG ping test, level-up channel
- Repo review (Sept 30): audit images and mock-ups stopped being committed; storage cached in memory (chat XP batched); games share one money flow; emoji uploads removed (emojis are looked up by name); fetch timeouts, error logging and an atomic audit-memory write added; `Start Bot.bat` no longer blocks on a failed `npm install`
- Second review (Sept 28, going through one at a time): (done: a Hideout channel deleted by hand is remade, `/hideout-config remove` ends one; the startup catch-up check is built); level-up message and Hero Cards text now in the Shopkeeper voice (approved); game story lines stay the host characters' (his call, not the Shopkeeper); Soul Boost page and go-live alert text approved as they are; Slots still planned (will join `/mini-game`, payouts still to decide)
- LFG pings: test whether they notify (LFG roles are not mentionable; see CLAUDE.md task 6)
- Which roles members can pick: done in #roles (Region, Heroes, Patron, Rank, Customs menus and the LFG Pings dropdown; see CLAUDE.md task 1)
- Server colors (bot embeds currently use a placeholder blurple)

## Bot features

| Feature | Status | Source |
|---------|--------|--------|
| Reaction roles (`/reaction-roles`) | Ported | Velvets-Discord-Bot |
| LFG (`/lfg`, `/lfg-config`) | Built | New |
| Welcome / goodbye (`/welcome`, `/goodbye`) | Removed (Sept 28, 2026) | Velvets-Discord-Bot |
| XP / souls (`/rank`, `/urn`, `/leaderboard`, `/xp-config`) | Built (step 1) | New |
| Shop: first screen (banner + section dropdown) | Built Sept 28, awaiting check. All four sections work (Rejuv + Hideout built Sept 28) | New |
| Shop: Soul Boost | Built Sept 28, awaiting check (page wording not previewed before building: see "Rejuv and Soul Boost") | New |
| Shop: hero card preview (`/shop` → Hero Cards) | Built, awaiting check. Buying/equipping built (Sept 28), awaiting check: **Buy (price)** button next to the style buttons (greyed out if you can't afford it), one click, no confirm; buying equips it; owned cards show **Equip** / **Equipped**; **Use Plain Card** on the no-hero view; `/rank` shows the equipped card to everyone. Wording is a placeholder | New |
| Go-live alerts (Twitch + TikTok) | Twitch built Sept 28, 2026, **confirmed working** (posted for a real stream Sept 28). TikTok built Sept 28, awaiting check. Twitch channel **charmedvt**, TikTok **@charmed.dl**; posts in **#streams-and-uploads** (read-only; channel id `STREAM_CHANNEL_ID` in `src/config.js`); pings **@everyone**; once per stream per platform (a drop + reconnect within 10 min doesn't ping again; a restart never re-pings); checks every minute. Twitch keys via `setup.py twitch`. TikTok is unofficial (no TikTok API available), may break without warning. **Customizable description** under the title (shared by both): `/stream-config description` (Manage Server), a text box, empty = none, private preview after saving. Wording approved as is (Sept 28) |

### #roles Region menu (posted Sept 28, 2026)

Pick one. Standard flag emojis (custom continent flags were made, then dropped as too much): 🇪🇺 Europe, 🇺🇸 North America, 🇧🇷 South America, 🇯🇵 Asia, 🇦🇺 Oceania, 🇿🇦 Africa, 🇷🇺 Russia. Embed title "Region", text "Select your respective Region:", bot reacts in that order.

### #roles Heroes menus (posted Sept 28, 2026)

Pick any. All 38 heroes A-Z (The Doorman under T), max 6 per post (7 posts), hero emojis as reactions, one role per hero (named after the hero, no colour). First post: title "Heroes", text "Select Your Preferred Hero's".

### #roles Patron menu (posted Sept 28, 2026)

Pick one: The Archmother, The Hidden King. Emojis from his images (`assets/patrons/`). Title "Patron", text "Select Your Patron:".

## Censor (decided Sept 29, 2026; built, awaiting his Discord check)

- `/auto-mod censor add|remove|list` (Manage Server; `/auto-mod` is the umbrella for future auto-mod tools). Messages and edits containing a phrase are deleted; the author gets a warning in the Shopkeeper's voice (self-deletes after 15 s, never quotes the phrase).
- Whole-word matching, case and accents ignored. Staff with Manage Messages are exempt.
