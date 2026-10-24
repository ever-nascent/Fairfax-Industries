# Plan: a faster, smarter startup check (hand this to Sonnet)

Written Oct 23 by the planning chat, after reading the code and asking the wiki directly. Every number below was measured that day.

**Read first:** `CLAUDE.md` (house rules: one step at a time, each step ends with a **Checkpoint:** he can verify in Discord, test before handing over and say what was and wasn't tested, ask when something is missing, never print or commit `.env`, never `require('src/index.js')`: it starts the live bot).

**Files in play:** `tools/startup-check.js` (most of the work), `src/utils/farm/refresh.js`, `src/utils/reactionRoles.js`, `src/utils/farm/encounter.js`, `src/utils/farm/views.js`, `src/utils/farm/heroes/silver.js`, a new `src/events/reactionRolesReady.js`, a new `test/startupCheck.test.js`, `Start Bot.bat` (one comment line), `CLAUDE.md`, `server-plan.md`, `assets/CREDITS.txt`.

**Do the steps in order, one per turn.** Stop after each one with its Checkpoint and wait for him.

---

## What is wrong today (measured Oct 23)

1. **Every start re-downloads the whole trivia data.** Nurse Harrow has no lines in `trivia.json` (her wiki voice-line page isn't written), and `startup-check.js` runs `tools/trivia-data.js` whenever any hero has no lines. That is about 15 paced wiki requests (≥ 15 s) plus ~2 MB of Data pages **on every start**, and it never succeeds for her. A missing rival portrait does the same with the full Hero Farming refresh (`refresh.js`, five big Data pages).
2. **Two outside requests on every start that only need to happen daily:** the new-hero check (deadlock-api.com) and the Discord emoji list.
3. **Changed images are never noticed.** Icons, full-body renders and rival portraits are only checked with "does the file exist". The daily "what changed" query watches Data and voice-line pages only.
4. **Rival portrait names are guessed, and the guesses are already wrong.** Of the 88 guessed portrait names (`<Hero>_Gloat.png` / `<Hero>_Critical.png` plus the `RIVAL_FILES` table in `refresh.js`), **19 do not exist on the wiki**: Apollo, Baba, Billy, Graves, Infernus, Ivy, Lady Geist, Mirage, Rem, Silver, The Doorman, Venator, Viscous, Nurse Harrow. The local copies only exist because they were fetched before the wiki renamed them. And **about 75 of the 88 local portraits are not the wiki's current file** (same 280x380 size, different bytes; Silver's local ones are 240x320 and match neither of her wiki sets).
5. **An emoji never follows its icon.** `setup.py hero-emojis` skips any emoji whose name exists, so a fixed icon leaves the old emoji in the server (he deleted Harrow's by hand).
6. **Python is still needed at startup** (`setup.py hero-icons` / `hero-emojis` through `spawnSync('py')`), with its own "Python was not found" failure path.

What is fine and stays: `git pull` + `npm install` in `Start Bot.bat` (npm install measured at 0.7 s when nothing changed), `wikiFetch` pacing (1 s gap, retries after 10 s / 30 s), the per-feature `clientReady` handlers in the bot, the "a failed day isn't counted as done" rule.

## What the wiki gives us (checked Oct 23)

- One `action=query` can carry **50 titles of any kind** and ask `prop=revisions|imageinfo&rvprop=ids&iiprop=sha1|url` together: data pages answer with a revision id, `File:` pages with the file's sha1 and download url. Missing files answer `"missing": true`. Use `formatversion=2` and map `query.normalized` back to our titles (as `lastEdits` already does).
- The wiki files rival portraits in two categories, **`Category:Gloat Portraits`** and **`Category:Critical Health Portraits`** (43 files each, no continuation needed). One request each, with sha1 and url included:
  `action=query&generator=categorymembers&gcmtitle=Category:Gloat Portraits&gcmtype=file&gcmlimit=max&prop=imageinfo&iiprop=sha1|url&formatversion=2`
- Their names are messy: `Mirage Gloat .png` (trailing space), `Celeste Critical Health.png`, `Silver Gloat Portrait.png`, `Doorman Gloat.png`, `Bily Critical.png`, `Werewolf Silver Gloat.png`. **Not in either category:** Violet (`File:Violet gloat.png`, `File:Violet ciritcal.png`, both exist) and Nurse Harrow (no portraits on the wiki at all; the two in `assets/farm/rivals/` were put there by hand on Oct 23).
- `list=search` with `srwhat=title` is disabled on this wiki; don't use it.
- `File:<Hero>.png` (chat icon) and `File:<Hero> Render.png` (full body) exist for all 44 heroes.

## His decisions (Oct 23, record them in `server-plan.md`)

- **Emojis follow the icon, and the bot repairs the #roles menus.** When a hero's wiki icon changes, its Discord emoji is replaced; on startup the bot fixes any #roles menu that pointed at the old emoji (new emoji in the text, its reaction re-added, menu data updated). Members who had reacted have to react again to be able to un-pick (their roles stay).
- **`setup.py` stays, unused at startup.** It keeps the one-off commands (layout, rank icons, stickers, Twitch keys, saving the token). Nothing at startup calls Python any more.
- **First run replaces with the wiki's:** every hero image on his PC that differs from the wiki's current file is downloaded fresh, once, and listed in the summary. Files the wiki doesn't have (Harrow's portraits) are never touched.
- **Silver gets both portrait sets.** Human: `Silver Gloat Portrait.png` / `Silver Critical Health.png`. Wolf: `Werewolf Silver Gloat.png` / `Werewolf Silver Critical.png`. A rival Silver shows the wolf face while she is in wolf form (her ultimate, Lycan Curse), the human face otherwise.

## The target

| Start | Requests | Time spent in the check |
|-------|----------|-------------------------|
| Same day, nothing missing | **0** | well under 1 s |
| First start of the day | 5 wiki + 1 deadlock-api + 1 Discord, plus a download per changed file | a few seconds |
| Something missing that was never tried (a newly added hero, a deleted file) | the daily check runs right away | a few seconds |
| Something missing that the wiki doesn't have (Harrow's voice lines, her portraits) | 0; tried again at the next daily check | well under 1 s |
| The very first run of the new check (once) | about 180 file downloads, paced | 3 to 4 minutes, once |

The check never stops the bot from starting, and touches nothing in `data/` except `data/startupCheck.json`.

---

## Step 1. Stop the every-start work (the quick win)

Only `tools/startup-check.js` changes.

1. Guard the entry point: `if (require.main === module) main()...` and export what the test needs (`main`, plus any pure helper you write). Read `STAMP` from `DATA_DIR` as today; add `const ASSETS = process.env.ASSETS_DIR || path.join(ROOT, 'assets')` so a test can point it at a temp folder.
2. **One rule for "missing":** a thing missing on disk triggers the daily check **right now** only when the stamp has never seen it; when the stamp has seen it (the wiki had nothing for it at the last daily check), it waits for the next day. Concretely for this step:
   - Trivia: a hero with no lines whose `"<Hero>/Voice lines"` title is **not a key** in `stamp.edits.trivia` → run the daily check now (that's a hero just added to `HEROES`). If the title is a key, don't run `trivia-data.js` for it; the daily check's revision compare re-runs it when her page is edited.
   - Rival portraits: leave as is for now (Step 3 replaces this part), but **remove `noFace` as a reason to run `refresh.js`**. Portraits move out of `refresh.js` in Step 3.
   - Set `daily = force || stamp.day !== today() || <something never tried>`.
3. Move `newHeroes()` and the Discord emoji list inside the daily part. A same-day start makes no network request at all unless rule 2 fires.
4. Keep everything else as it is (the trivia / farm refresh on a changed page, `--full`, the stamp's `day` only written when the whole day went through).

**Test:** in `test/startupCheck.test.js` (temp `DATA_DIR` and `ASSETS_DIR`, `global.fetch` stubbed and counting calls, `WIKI_GAP_MS=0`, `WIKI_RETRY_WAITS_MS=0`; follow `test/locklePool.test.js` for the pattern; stub `spawnSync` by making the runner injectable or by only testing the decision function): a stamp from today with Harrow's page title recorded and her lines missing → **zero fetches** and no trivia run; a stamp from yesterday → the daily query runs; a hero title not in the stamp → daily runs today. Then run `node tools/startup-check.js` twice by hand: the second run must print no wiki lines and finish in about a second.

**Checkpoint:** restart the bot twice. The second time the "Checking the bot's data..." part finishes almost instantly and no trivia download scrolls by.

## Step 2. Hero icons and full-body renders: download only what changed (no Python)

Only `tools/startup-check.js` (and its test).

1. **Port `setup.py`'s icon conversion to Node** with `@napi-rs/canvas` (already installed): load the image, find the bounding box of pixels with alpha > 0 (`getImageData`), crop to it, scale it to fit 128 x 128 keeping its aspect ratio, centre it on a transparent 128 x 128 canvas (`imageSmoothingQuality = 'high'`), PNG. Refuse (report, don't save) a result over 256 KB. This is the `to_square_png(raw, 128, trim=True)` in `setup.py`.
2. **Fold the files into the daily "what changed" query.** Extend `lastEdits` (rename it if you like) to ask `prop=revisions|imageinfo&rvprop=ids&iiprop=sha1|url` and return `{ title: { rev, sha1, url } }`. The titles are the data pages it already asks (dedupe `Data:ItemCards.json`) plus, for every hero in `HEROES`, `File:<Hero>.png` and `File:<Hero> Render.png`: about 140 titles, 3 requests.
3. **Keep the wiki's sha1 per file** in the stamp: `stamp.files[<path under assets/>] = { title, sha1 }`, or `sha1: null` when the wiki answered "missing". Download a file when the sha1 changed, when there is no record of it, or when the file is missing on disk and the record has a sha1. **Write the new sha1 only after the file is saved.** Icons go through the conversion to `assets/heroes/<slug>.png`; renders are saved as downloaded to `assets/heroes/full body/<slug>.png`.
4. **First run (his call):** there are no records yet, so every icon and render is downloaded once and replaced (renders: you may skip one whose local sha1 already equals the wiki's; icons are converted, so they can't be compared). List them in the summary as "refreshed from the wiki".
5. Remove the `setup('hero-icons')` call and the `renders()` function it replaces (this step covers both). Leave `setup('hero-emojis')` until Step 4.

**Test:** stubbed wiki: unchanged sha1 → no download; changed sha1 → one download and the stamp's sha1 updated; a download that fails → the stamp keeps the old sha1 and the next run tries again; "missing" on the wiki → `sha1: null`, no download, no retry until the next day; the converted icon is 128 x 128 and its corner pixel is transparent.

**Checkpoint:** the first restart takes a minute or two longer and lists the icons and renders it refreshed; open `/shop` Hero Cards and `/rank` and check a few cards look right. The next restart (a day later, or with `node tools/startup-check.js --full`) downloads nothing.

## Step 3. Rival portraits from the wiki's categories (and Silver's wolf)

Files: `tools/startup-check.js`, `src/utils/farm/refresh.js`, `src/utils/farm/encounter.js`, `src/utils/farm/views.js`, `src/utils/farm/heroes/silver.js`, `test/farmcmd.test.js`.

1. In the daily check, ask the two categories (the query above). For each file, the hero is found from its name: drop `File:` and the extension, trim, drop a trailing `Gloat` / `Critical` / `Critical Health` / `Portrait` (any order, any case), lower-case, then look it up among `roster()` names lower-cased, through a small alias table for the wiki's spellings: `{ doorman: 'the doorman', bily: 'billy', 'werewolf silver': 'silver wolf' }`. The mood comes from the category (Gloat Portraits = `gloat`, Critical Health Portraits = `critical`), not the name.
2. Files outside the categories: one small table, `{ Violet: { gloat: 'File:Violet gloat.png', critical: 'File:Violet ciritcal.png' } }`, whose titles go into the Step 2 batch query. That table and the alias table are the only hand-kept names.
3. Save to `assets/farm/rivals/<hero lower case>_<mood>.png` as downloaded (Silver's wolf: `silver wolf_gloat.png` / `silver wolf_critical.png`, matching the `<name>_<mood>` pattern). Same sha1 records and the same "first run replaces" rule as Step 2 (portraits are saved as downloaded, so skip any whose local sha1 already matches).
4. Two files for the same hero and mood: take the newer upload (`iiprop=timestamp`) and mention it in the summary. A roster hero with no portrait for a mood: record `sha1: null` and report it **once** in the summary ("Nurse Harrow: no gloat portrait on the wiki, keeping the one on this PC" when a local file exists). **Never delete or overwrite a local file the wiki has nothing for.** A category file that matches no hero (e.g. a future hero not in the roster yet): list it once, no download.
5. Delete `rivalArt`, `RIVAL_FILES` and the `rivalArt()` call from `refresh.js` (and its export): the startup check now owns every hero image. Update the comment at the top of `refresh.js` that mentions them.
6. **Silver's wolf face:** export the existing `isWolf` from `heroes/silver.js`; in `encounter.js`'s `snapshot()` add `wolf: true` to the rival's entry when the rival is Silver and `isWolf(rival)`. In `views.js`, `rivalFace(name, mood, wolf)` tries `silver wolf_<mood>.png` first when `wolf` is set, then the normal file, then the icon (as today). Pass `rivalFace(run.rival, rivalMood(frame), frame.enemies[0].wolf)` in `duelView` and the last frame's `wolf` in the result view.
7. `test/farmcmd.test.js` checks every roster hero has both faces on disk: keep it, it already passes with Harrow's hand-placed files.

**Test:** the name matching on the real tricky names above (`Mirage Gloat .png`, `Bily Critical.png`, `Doorman Gloat.png`, `Silver Gloat Portrait.png`, `Werewolf Silver Critical.png`, `Celeste Critical Health.png`); a hero with no file keeps its local copy; a snapshot of a duel against a wolf-form Silver has `wolf: true` and picks the wolf file. Then run `node tools/hero-smoke.js silver` (Silver's screens) and `node --test`.

**Checkpoint:** after a restart the summary lists the portraits it refreshed. In Discord, duel a rival (the `/farm-config cooldowns on:false` testing switch helps): the portrait matches the wiki's current one. A Silver rival shows the wolf face while her ultimate is up.

## Step 4. Emojis follow the icon (Node, no Python)

Only `tools/startup-check.js` (and its test). Runs in the daily part, after the icons.

1. Read the server's emojis once (`GET /guilds/{GUILD_ID}/emojis`, `Authorization: Bot <token>`; skip the whole step with one summary line when there is no `DISCORD_TOKEN`).
2. **Missing** hero emoji (no emoji with the hero's slug as its name): upload `assets/heroes/<slug>.png` (`POST /guilds/{id}/emojis` with `{ name, image: 'data:image/png;base64,...' }`).
3. **Replace** a hero's emoji only when this run's records show its wiki icon **changed from an earlier recorded sha1** (Step 2). Never on the first run, when there was no earlier record: that would swap all 44 at once. Replace = create the new one under the same name first, then delete the old one (`DELETE /guilds/{id}/emojis/{emoji id}`); Discord allows two emojis with one name for that moment. If the create fails with Discord's "maximum emojis" error (code 30008), delete first, then create.
4. For icons, write the new sha1 to the stamp only after **both** the file is saved and the emoji was replaced (or there's no token), so a failed replace is tried again next start.
5. On a 429, wait `retry_after` once and try again; any other failure goes in the summary, never stops the check.
6. Remove `setup()`, `run()`'s Python use and the "Python was not found" path. `run()` for `trivia-data.js` / `refresh.js` stays.

Tell him in the summary of this step: to refresh one emoji by hand, delete it in Discord; the next daily check (or `--full`) uploads it again from the icon.

**Test:** stubbed Discord: missing → one POST; icon changed from a recorded sha1 → POST then DELETE, in that order; first run with no record → no POST/DELETE; a failed POST → the icon's sha1 isn't recorded; no token → no Discord calls.

**Checkpoint:** delete one hero emoji in Discord (pick one not on a #roles menu if you like) and run `node tools/startup-check.js --full` (or restart the next day): it comes back. The Step 5 checkpoint covers a real icon change.

## Step 5. The bot repairs #roles menus after an emoji was replaced

Files: `src/utils/reactionRoles.js`, a new `src/events/reactionRolesReady.js` (`clientReady`, `once`), a test in `test/reactionRoles.test.js`.

Menus are saved in `data/reactionRoleMenus.json` as `{ <message id>: { guildId, channelId, mode, roles: { <emoji id or unicode>: <role id> } } }` (11 menus today; 7 of them are the Heroes menus, keyed by hero emoji id). The menu text is the embed description with `<:slug:id> - <@&role>` lines. Nothing stores the emoji's name, so read it from the text.

1. On `clientReady`, for each menu of our guild: the keys that are numeric ids **not** in `guild.emojis.cache` are stale. No stale key → nothing to do, no request (the normal case).
2. For a menu with a stale key: fetch its message; from the embed description read `<a?:(\w+):(\d+)>` to learn each stale id's name; find the emoji with that name now in the server. If there is none, log it and leave that key alone.
3. Swap the key in `menu.roles` keeping the order of the keys, replace `<:name:oldid>` with `<:name:newid>` in the description, edit the message (`EmbedBuilder.from(embed).setDescription(...)`), add the bot's reaction with the new emoji, then save the menu through the store (the bot owns this file; this is the one live-data write in this plan, and it goes through `getStore`).
4. **Ask him before building this step:** Discord puts a newly added reaction at the end of the row, so the replaced hero's reaction moves to the end of its menu. The alternative is to clear every reaction on that one menu message and re-add them all in order (members' reactions on those 6 heroes go, their roles stay). Build whichever he picks.
5. Pure part (find stale keys, swap ids in roles and text) goes in `reactionRoles.js` with a unit test; the event only does the Discord calls. Log one line per repaired menu.

**Checkpoint:** replace one hero's icon on the wiki (or edit its record's sha1 in `data/startupCheck.json` to something else and restart, which makes the check think the icon changed), restart: the emoji in the server is the new picture, the hero's line in the #roles Heroes menu shows the new emoji, the bot's reaction is there, and reacting with it gives the role.

## Step 6. One clear summary, docs

1. The check prints one summary at the end, grouped: **Fetched** (what was downloaded or uploaded, by name), **Changed on the wiki** (data pages refreshed), **Waiting on the wiki** (Harrow's voice lines, a portrait the wiki doesn't have: shown on the daily run only), **Could not reach** (wiki / deadlock-api / Discord), **Needs you** (a new playable hero to add, his call). A quiet same-day start prints one line: "Startup check: nothing to do (the daily check ran today)."
2. Update the `tools/startup-check.js` header comment and the `Start Bot.bat` comment line above `node tools/startup-check.js`.
3. `CLAUDE.md` Layout: the `tools/startup-check.js` row (what runs every start vs daily, images by sha1, emojis replaced, portraits from the categories, Silver's wolf face), the `setup.py` row (no longer used at startup; `hero-icons` / `hero-emojis` kept for manual use), the `Start Bot.bat` row. Also the emoji note "emojis live in Discord and are only looked up by name, never uploaded by the bot" stays true: the startup check uploads, not the bot.
4. `server-plan.md`: the four decisions above, dated Oct 23, and the step 5 reaction-order choice.
5. `assets/CREDITS.txt`: the rival portraits now come from the wiki's two portrait categories; Silver's wolf portraits added.

**Checkpoint:** restart twice and read the summary both times; the second is one line.

---

## Constraints (every step)

- Never touch the live `data/` except `data/startupCheck.json` (Step 5's menu save goes through the bot's own store). Never print `.env` or the token.
- No change to `HEROES` / the roster without him.
- Every deadlock.wiki request (including `cdn.deadlock.wiki` downloads) goes through `wikiFetch`.
- Exit with `process.exitCode`, never `process.exit()` while a download is open (Node on Windows crashes).
- Don't `require` `src/index.js` in tests or scripts.
- Run `node --test` at the end of every step. Say what was and wasn't tested: the Discord parts (emoji upload / replace, the menu repair) can only be fully checked in his server.

## Left out on purpose

- Watching item, ability, Haunt and buff pictures for changes: they come with the Data refreshes and rarely change. The same sha1 records would cover them later by adding their titles to the batch.
- Skipping `npm install` when nothing changed: it takes 0.7 s.
- Making `trivia-data.js` read Data pages through `api.php` like `refresh.js` does: `index.php?action=raw` answered 200 on Oct 23. Switch it if it starts answering 403 again.
- A Node port of the rest of `setup.py` (his call: it stays as is).
