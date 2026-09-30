"""
Fairfax Industries server setup script.

Usage:
    py setup.py check      -> read-only: confirms the token works and the bot has admin
    py setup.py community  -> Phase 1: creates #rules + #mod-updates, turns on Community mode
    py setup.py rank-icons -> downloads the 11 Deadlock rank icons into assets/ranks (no Discord changes)
    py setup.py rank-emojis-> uploads assets/ranks/*.png as server emojis (skips ones that exist)
    py setup.py hero-icons -> downloads each hero's chat icon from deadlock.wiki into assets/heroes
    py setup.py hero-emojis-> uploads assets/heroes/*.png as server emojis (skips ones that exist)
    py setup.py hero-renders-> downloads each hero's full render from deadlock.wiki into assets/heroes/full body (Shop cards)
    py setup.py trivia     -> builds assets/trivia (voice lines + ability icons from deadlock.wiki) for /trivia
    py setup.py stickers   -> copies the stickers listed in STICKERS into the server
    py setup.py shop-emojis-> uploads assets/shop/*.png as server emojis, e.g. :hideout: (skips ones that exist)
    py setup.py layout     -> creates/moves the channels into the LAYOUT order (never deletes anything except the old #lfg setup)
    py setup.py twitch     -> saves your Twitch app keys to .env so the bot can announce when you go live
    (or just double-click and pick from the menu)

More phases (channels, roles, onboarding...) get added as we go.
Talks to Discord's REST API directly: https://docs.discord.com/developers/reference
"""
import os
import re
import sys
import getpass
import time
import base64
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv

API = "https://discord.com/api/v10"
GUILD_ID = "1553860143639167086"
ENV_PATH = Path(__file__).with_name(".env")
ASSETS = Path(__file__).with_name("assets")

ADMINISTRATOR = 1 << 3  # permission bit, see docs: Permissions -> Bitwise Permission Flags


def get_token() -> str:
    """Load the bot token from .env, or ask for it once and save it there."""
    load_dotenv(ENV_PATH)
    token = os.getenv("DISCORD_TOKEN")
    if token:
        return token.strip()
    print("No bot token found yet.")
    token = getpass.getpass("Paste your bot token (input is hidden) and press Enter: ").strip()
    if not token:
        sys.exit("No token entered. Nothing saved.")
    ENV_PATH.write_text(f"DISCORD_TOKEN={token}\n", encoding="utf-8")
    print(f"Saved to {ENV_PATH.name} (this file stays on your computer).\n")
    return token


def api(session: requests.Session, method: str, path: str, **kwargs):
    while True:
        r = session.request(method, API + path, timeout=30, **kwargs)
        if r.status_code != 429:
            break
        wait = float(r.json().get("retry_after", 5))  # Discord rate limit: wait, then retry
        print(f"  (rate limited by Discord, waiting {wait:.0f}s...)")
        time.sleep(wait + 0.5)
    if r.status_code == 401:
        sys.exit("FAIL: Discord rejected the token (401). Reset it in the Developer Portal, "
                 "delete the .env file, and run again.")
    if r.status_code == 403:
        sys.exit(f"FAIL: Missing access (403) on {path}. Is the bot in the server?")
    if r.status_code == 404:
        sys.exit(f"FAIL: Not found (404) on {path}. Check the server ID.")
    if not r.ok:
        sys.exit(f"FAIL: {method} {path} -> {r.status_code}\n{r.text}")
    return r.json() if r.content else None


def check(session: requests.Session):
    me = api(session, "GET", "/users/@me")
    print(f"[ok] Logged in as bot: {me['username']} (id {me['id']})")

    guild = api(session, "GET", f"/guilds/{GUILD_ID}", params={"with_counts": "true"})
    print(f"[ok] Server found: {guild['name']}  (~{guild.get('approximate_member_count', '?')} members)")

    member = api(session, "GET", f"/guilds/{GUILD_ID}/members/{me['id']}")
    roles = {r["id"]: r for r in api(session, "GET", f"/guilds/{GUILD_ID}/roles")}
    perms = int(roles[GUILD_ID]["permissions"])  # @everyone role id == guild id
    for rid in member["roles"]:
        perms |= int(roles[rid]["permissions"])
    has_admin = bool(perms & ADMINISTRATOR)
    print(f"[{'ok' if has_admin else 'FAIL'}] Bot has Administrator: {has_admin}")

    top = max((roles[rid] for rid in member["roles"]), key=lambda r: r["position"], default=None)
    highest = max(r["position"] for r in roles.values())
    if top:
        print(f"[{'ok' if top['position'] == highest else 'WARN'}] Bot's top role: "
              f"{top['name']} (position {top['position']} of {highest})")

    community = "COMMUNITY" in guild.get("features", [])
    print(f"[info] Community mode on: {community}")
    print(f"[info] Verification level: {guild['verification_level']}  |  "
          f"Explicit content filter: {guild['explicit_content_filter']}")

    print("\nCHECKPOINT PASSED" if has_admin else "\nCHECKPOINT FAILED - see FAIL lines above")


VIEW_CHANNEL = 1 << 10


def get_or_create_text_channel(session, name: str, private: bool = False) -> dict:
    """Return the text channel with this name, creating it if it doesn't exist."""
    for ch in api(session, "GET", f"/guilds/{GUILD_ID}/channels"):
        if ch["type"] == 0 and ch["name"] == name:
            print(f"[ok] #{name} already exists")
            return ch
    body = {"name": name, "type": 0}
    if private:  # hide from @everyone (the @everyone role id == guild id)
        body["permission_overwrites"] = [
            {"id": GUILD_ID, "type": 0, "allow": "0", "deny": str(VIEW_CHANNEL)}
        ]
    ch = api(session, "POST", f"/guilds/{GUILD_ID}/channels", json=body)
    print(f"[ok] Created #{name}{' (staff only)' if private else ''}")
    return ch


def community(session: requests.Session):
    """Phase 1: turn on Community mode.
    Docs: Guild resource -> Modify Guild, and Guild Features (COMMUNITY needs Administrator).
    Discord requires these fields to be sent together with the feature."""
    rules = get_or_create_text_channel(session, "rules")
    updates = get_or_create_text_channel(session, "mod-updates", private=True)

    guild = api(session, "GET", f"/guilds/{GUILD_ID}")
    features = set(guild.get("features", []))
    if "COMMUNITY" in features:
        print("[ok] Community mode was already on")
    features.add("COMMUNITY")

    api(session, "PATCH", f"/guilds/{GUILD_ID}", json={
        "features": sorted(features),
        "verification_level": max(guild["verification_level"], 1),  # 1 = verified email
        "explicit_content_filter": 2,        # 2 = scan media from all members
        "default_message_notifications": 1,  # 1 = only @mentions
        "rules_channel_id": rules["id"],
        "public_updates_channel_id": updates["id"],
    })

    guild = api(session, "GET", f"/guilds/{GUILD_ID}")
    on = "COMMUNITY" in guild.get("features", [])
    print(f"[{'ok' if on else 'FAIL'}] Community mode on: {on}")
    print(f"[info] Rules channel: #rules  |  Discord updates channel: #mod-updates")
    print(f"[info] Verification level: {guild['verification_level']}  |  "
          f"Explicit content filter: {guild['explicit_content_filter']}")
    print("\nCHECKPOINT PASSED" if on else "\nCHECKPOINT FAILED - see output above")


# Ranks as of the July 30, 2026 Ranked Mode update (in order, lowest -> highest).
# Icons: Valve's rankNN_lg_psd.png files, as mirrored by deadlock.one
# (https://deadlock.one/en/news/all-new-deadlock-ranks-and-updated-rank-icons).
ICON_BASE = "https://deadlock.one/sites/default/files/inline-images/"
RANKS = [
    ("initiate",  "xrank01_lg_psd.png.pagespeed.ic.OZIPuEPasB.png"),
    ("seeker",    "xrank02_lg_psd.png.pagespeed.ic.yLqtcElaqZ.png"),
    ("acolyte",   "xrank03_lg_psd.png.pagespeed.ic.xGn51Y83zv.png"),
    ("sentinel",  "xrank04_lg_psd.png.pagespeed.ic.3wWSx6AI4L.png"),
    ("mystic",    "xrank05_lg_psd.png.pagespeed.ic.xN5ILJkQ5N.png"),
    ("ritualist", "xrank06_lg_psd.png.pagespeed.ic.L8yMm8iyNw.png"),
    ("emissary",  "xrank07_lg_psd.png.pagespeed.ic.TILa6sGZdI.png"),
    ("oracle",    "xrank08_lg_psd.png.pagespeed.ic.DmeiDhjCCM.png"),
    ("phantom",   "xrank09_lg_psd.png.pagespeed.ic.8liZKQKWt7.png"),
    ("ascendant", "xrank10_lg_psd.png.pagespeed.ic.YolWCYhRR_.png"),
    ("eternus",   "xrank11_lg_psd.png.pagespeed.ic._3b3yCdqIl.png"),
]
RANK_DIR = ASSETS / "ranks"
EMOJI_PREFIX = "rank_"          # emoji names become :rank_initiate:, :rank_seeker:, ...
EMOJI_SIZE = 128                # Discord shows emojis at up to 128x128
EMOJI_MAX_BYTES = 256 * 1024    # Discord's emoji file size limit


def pil_image():
    """Pillow's Image module, installed on first use (imported here so other commands work without it)."""
    try:
        from PIL import Image
    except ImportError:
        import subprocess
        print("Installing Pillow (image library, first time only)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
        from PIL import Image
    return Image


def to_square_png(raw: bytes, size: int, trim: bool = False) -> bytes:
    """Center the image on a transparent size x size canvas (keeps its aspect ratio) and return PNG bytes.
    trim: cut the empty transparent border first, so a badge fills the emoji."""
    Image = pil_image()
    img = Image.open(BytesIO(raw)).convert("RGBA")
    if trim and img.getbbox():
        img = img.crop(img.getbbox())
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    out = BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


def slug(name: str) -> str:
    """File and emoji name for a hero, same as src/utils/heroes.js: "Mo & Krill" -> mo_krill."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def rank_icons(session: requests.Session):
    """Download + convert rank icons into assets/ranks. Touches nothing in Discord."""
    RANK_DIR.mkdir(parents=True, exist_ok=True)
    web = requests.Session()
    web.headers["User-Agent"] = "Mozilla/5.0 (fairfax-setup)"
    ok = 0
    for i, (name, file) in enumerate(RANKS, 1):
        plain = file.split(".pagespeed")[0].lstrip("x")          # rank01_lg_psd.png
        for url in (ICON_BASE + file, ICON_BASE + plain):         # fallback if the mirror renames
            r = web.get(url, timeout=30)
            if r.ok and r.headers.get("content-type", "").startswith("image"):
                break
        else:
            print(f"[FAIL] {name}: couldn't download ({r.status_code})")
            continue
        png = to_square_png(r.content, EMOJI_SIZE, trim=True)
        path = RANK_DIR / f"{i:02d}_{name}.png"
        path.write_bytes(png)
        size_ok = len(png) <= EMOJI_MAX_BYTES
        ok += size_ok
        print(f"[{'ok' if size_ok else 'FAIL'}] {path.name}  ({len(png) // 1024} KB)")
    print(f"\nSaved {ok}/{len(RANKS)} icons to {RANK_DIR}")
    print("CHECKPOINT PASSED - open that folder and check they look right"
          if ok == len(RANKS) else "CHECKPOINT FAILED - see FAIL lines above")


def rank_emojis(session: requests.Session):
    upload_emojis(session, RANK_DIR, EMOJI_PREFIX, "rank-icons")


def upload_emojis(session: requests.Session, folder: Path, prefix: str, download_cmd: str):
    """Upload folder/*.png as server emojis. Docs: Emoji resource -> Create Guild Emoji."""
    files = sorted(folder.glob("*.png"))
    if not files:
        sys.exit(f"No icons found. Run {download_cmd} first.")
    existing = {e["name"]: e for e in api(session, "GET", f"/guilds/{GUILD_ID}/emojis")}
    names = {f: prefix + re.sub(r"^\d+_", "", f.stem) for f in files}  # 01_initiate -> rank_initiate
    for path in files:
        name = names[path]
        if name in existing:
            print(f"[ok] :{name}: already exists")
            continue
        data = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
        e = api(session, "POST", f"/guilds/{GUILD_ID}/emojis", json={"name": name, "image": data})
        existing[name] = e
        print(f"[ok] Uploaded :{name}:")
    missing = [f for f in files if names[f] not in existing]
    print("\nEmoji codes (for reaction-role menus):")
    for path in files:
        e = existing.get(names[path])
        if e:
            print(f"  <:{e['name']}:{e['id']}>")
    print("\nCHECKPOINT PASSED" if not missing else "\nCHECKPOINT FAILED - some emojis missing")


# Shop section icons (e.g. hideout.png = the minimap Stairs icon, redrawn at 128 px).
SHOP_DIR = ASSETS / "shop"


def shop_emojis(session: requests.Session):
    upload_emojis(session, SHOP_DIR, "", "(the icons are already in assets/shop)")


# Heroes (Category:Heroes on deadlock.wiki, Sept 2026). Each hero page shows a 128x128
# "chat icon" in its gallery, which is the wiki file "File:<Hero>.png".
HEROES = [
    "Abrams", "Apollo", "Bebop", "Billy", "Calico", "Celeste", "The Doorman", "Drifter",
    "Dynamo", "Graves", "Grey Talon", "Haze", "Holliday", "Infernus", "Ivy", "Kelvin",
    "Lady Geist", "Lash", "McGinnis", "Mina", "Mirage", "Mo & Krill", "Paige", "Paradox",
    "Pocket", "Rem", "Seven", "Shiv", "Silver", "Sinclair", "Venator", "Victor",
    "Vindicta", "Viscous", "Vyper", "Warden", "Wraith", "Yamato",
]
HERO_DIR = ASSETS / "heroes"
WIKI_API = "https://deadlock.wiki/api.php"


def hero_icons(session: requests.Session):
    """Download each hero's chat icon from deadlock.wiki into assets/heroes. Touches nothing in Discord."""
    HERO_DIR.mkdir(parents=True, exist_ok=True)
    web = requests.Session()
    web.headers["User-Agent"] = "Mozilla/5.0 (fairfax-setup)"
    titles = "|".join(f"File:{h}.png" for h in HEROES)
    pages = web.get(WIKI_API, timeout=30, params={
        "action": "query", "titles": titles, "prop": "imageinfo", "iiprop": "url", "format": "json",
    }).json()["query"]
    alias = {n["to"]: n["from"] for n in pages.get("normalized", [])}   # wiki's title -> ours
    urls = {alias.get(p["title"], p["title"]): p["imageinfo"][0]["url"]
            for p in pages["pages"].values() if "imageinfo" in p}
    ok = 0
    for hero in HEROES:
        url = urls.get(f"File:{hero}.png")
        if not url:
            print(f"[FAIL] {hero}: no chat icon on the wiki")
            continue
        png = to_square_png(web.get(url, timeout=30).content, EMOJI_SIZE, trim=True)
        path = HERO_DIR / f"{slug(hero)}.png"
        path.write_bytes(png)
        size_ok = len(png) <= EMOJI_MAX_BYTES
        ok += size_ok
        print(f"[{'ok' if size_ok else 'FAIL'}] {path.name}  ({len(png) // 1024} KB)")
    print(f"\nSaved {ok}/{len(HEROES)} icons to {HERO_DIR}")
    print("CHECKPOINT PASSED - open that folder and check they look right"
          if ok == len(HEROES) else "CHECKPOINT FAILED - see FAIL lines above")


def hero_emojis(session: requests.Session):
    upload_emojis(session, HERO_DIR, "", "hero-icons")


RENDER_DIR = ASSETS / "heroes" / "full body"   # where the bot looks (same folder Get-DeadlockFullBody.ps1 fills)
RENDER_HEIGHT = 600  # the card is 300 px tall; 2x keeps it sharp without bloating the repo


def hero_renders(session: requests.Session):
    """Download each hero's main art (wiki "File:<Hero>_Render.png") into assets/heroes/full body for the
    Shop's hero cards. Touches nothing in Discord. The bot uses the chat icon for any hero missing here."""
    Image = pil_image()
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    web = requests.Session()
    web.headers["User-Agent"] = "Mozilla/5.0 (fairfax-setup)"
    titles = "|".join(f"File:{h}_Render.png" for h in HEROES)
    pages = web.get(WIKI_API, timeout=30, params={
        "action": "query", "titles": titles, "prop": "imageinfo", "iiprop": "url", "format": "json",
    }).json()["query"]
    alias = {n["to"]: n["from"] for n in pages.get("normalized", [])}   # wiki's title -> ours
    urls = {alias.get(p["title"], p["title"]): p["imageinfo"][0]["url"]
            for p in pages["pages"].values() if "imageinfo" in p}
    ok = 0
    for hero in HEROES:
        url = urls.get(f"File:{hero}_Render.png")
        if not url:
            print(f"[FAIL] {hero}: no File:{hero}_Render.png on the wiki")
            continue
        img = Image.open(BytesIO(web.get(url, timeout=60).content)).convert("RGBA")
        bbox = img.getbbox()  # trim the empty transparent border
        if bbox:
            img = img.crop(bbox)
        if img.height > RENDER_HEIGHT:
            img = img.resize((round(img.width * RENDER_HEIGHT / img.height), RENDER_HEIGHT), Image.LANCZOS)
        path = RENDER_DIR / f"{slug(hero)}.png"
        img.save(path, "PNG", optimize=True)
        ok += 1
        print(f"[ok] {path.name}  ({img.width}x{img.height}, {path.stat().st_size // 1024} KB)")
    print(f"\nSaved {ok}/{len(HEROES)} renders to {RENDER_DIR}")
    print("CHECKPOINT PASSED - restart the bot, then /shop and pick a hero"
          if ok == len(HEROES) else "CHECKPOINT FAILED - see FAIL lines above")


TRIVIA_DIR = ASSETS / "trivia"
# Words that give the answer away if a line contains them (besides the hero's own name).
TRIVIA_ALIASES = {
    "Mo & Krill": ["Maurice", "Momo", "Mo", "Krill"],
    "Sinclair": ["Henry", "Savannah"],
    "Lady Geist": ["Geist"],
    "Grey Talon": ["Talon"],
    "The Doorman": ["Doorman"],
}
# Sections of a "<Hero>/Voice lines" page that aren't the hero talking (or aren't in the game).
TRIVIA_SKIP_SECTIONS = ("conversation", "other character", "removed", "unused", "navigation")


def clean_wiki_text(text: str) -> str:
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)   # [[link|shown]] -> shown
    text = re.sub(r"<[^>]+>", "", text).replace("''", "")          # html tags, ''italics''
    return re.sub(r"\s+", " ", text).strip()


def trivia(session: requests.Session):
    """Build assets/trivia/trivia.json for /trivia: each hero's own voice lines and their 4 abilities (+ icons),
    from deadlock.wiki. Touches nothing in Discord. Re-run after new heroes or patches."""
    import json
    (TRIVIA_DIR / "abilities").mkdir(parents=True, exist_ok=True)
    web = requests.Session()
    web.headers["User-Agent"] = "Mozilla/5.0 (fairfax-setup)"
    heroes = []
    for hero in HEROES:
        page = web.get(WIKI_API, timeout=30, params={
            "action": "parse", "page": f"{hero}/Voice lines", "prop": "wikitext", "format": "json",
        }).json()
        if "parse" not in page:
            print(f"[FAIL] {hero}: no '{hero}/Voice lines' page on the wiki")
            continue
        text = page["parse"]["wikitext"]["*"]
        names = [w for w in re.split(r"[\s&]+", hero) if w and w != "The"] + TRIVIA_ALIASES.get(hero, [])
        giveaway = re.compile(r"\b(" + "|".join(map(re.escape, names)) + r")\b", re.IGNORECASE)
        lines, seen = [], set()
        # level-2 sections ("== Select ==" or "==Select=="); keep only the hero's own lines
        for section in re.split(r"\n(?===\s*[^=\s])", "\n" + text):
            title = section.strip().split("\n", 1)[0].lower()
            if any(skip in title for skip in TRIVIA_SKIP_SECTIONS):
                continue
            rows = section.split("\n")
            for i, row in enumerate(rows):
                found = re.search(r"\{\{Audio link\|[^|}]*\|([^}]*)\}\}", row)
                if not found:
                    continue
                raw = found.group(1)
                # Yamato speaks Japanese: the wiki puts the English translation in the next table cell
                if re.search(r"[぀-ヿ一-鿿]", raw):
                    after = rows[i + 1] if i + 1 < len(rows) else ""
                    if not after.startswith("|") or after.startswith(("|-", "|}")):
                        continue
                    raw = after[1:]
                line = clean_wiki_text(raw)
                if (len(line) < 25 or len(line) > 150 or line[0] in "([" or "[" in line
                        or giveaway.search(line) or line.lower() in seen):
                    continue
                seen.add(line.lower())
                lines.append(line)
        abilities = [clean_wiki_text(a) for a in re.findall(r"===\s*\{\{AbilityIcon\|([^}]+)\}\}\s*===", text)][:4]
        heroes.append({"name": hero, "slug": re.sub(r"[^a-z0-9]+", "_", hero.lower()).strip("_"),
                       "lines": lines, "abilities": abilities})
        print(f"[{'ok' if lines and len(abilities) == 4 else 'FAIL'}] {hero}: {len(lines)} lines, "
              f"abilities: {', '.join(abilities) or 'none found'}")

    # ability icons ("File:<Ability>.png"), 50 titles per wiki query
    wanted = [a for h in heroes for a in h["abilities"]]
    urls = {}
    for i in range(0, len(wanted), 50):
        pages = web.get(WIKI_API, timeout=30, params={
            "action": "query", "titles": "|".join(f"File:{a}.png" for a in wanted[i:i + 50]),
            "prop": "imageinfo", "iiprop": "url", "format": "json",
        }).json()["query"]
        alias = {n["to"]: n["from"] for n in pages.get("normalized", [])}
        urls.update({alias.get(p["title"], p["title"]): p["imageinfo"][0]["url"]
                     for p in pages["pages"].values() if "imageinfo" in p})
    for h in heroes:
        icons = []
        for ability in h["abilities"]:
            url = urls.get(f"File:{ability}.png")
            if not url:
                print(f"[FAIL] no icon for {ability} ({h['name']})")
                continue
            file = re.sub(r"[^a-z0-9]+", "_", ability.lower()).strip("_") + ".png"
            (TRIVIA_DIR / "abilities" / file).write_bytes(web.get(url, timeout=30).content)
            icons.append({"name": ability, "icon": file})
        h["abilities"] = icons
    (TRIVIA_DIR / "trivia.json").write_text(json.dumps(heroes, indent=1, ensure_ascii=False), encoding="utf-8")
    total = sum(len(h["lines"]) for h in heroes)
    icons = sum(len(h["abilities"]) for h in heroes)
    print(f"\nSaved {len(heroes)}/{len(HEROES)} heroes, {total} voice lines, {icons} ability icons to {TRIVIA_DIR}")
    print("CHECKPOINT PASSED - restart the bot, then /trivia"
          if len(heroes) == len(HEROES) and icons == 4 * len(HEROES) else "CHECKPOINT FAILED - see FAIL lines above")
    trivia_items(web)


def trivia_items(web: requests.Session):
    """Build assets/trivia/items.json (+ item art) for /trivia's item questions: every shop item (tiers 1-4)
    with its cost, tier, the % stats on its card and what it upgrades into, from the wiki's item data and English labels."""
    import json
    raw = lambda page: web.get("https://deadlock.wiki/index.php", timeout=60,
                               params={"title": page, "action": "raw"}).json()
    cards, lang = raw("Data:ItemCards.json"), raw("Data:Lang en.json")
    slots = {"Weapon": "Weapon", "Armor": "Vitality", "Tech": "Spirit"}
    items = []
    into = {}  # component key -> names of the items it builds into
    for card in cards.values():
        if card.get("Name") and not card.get("IsDisabled"):
            for key in card.get("Components") or []:
                into.setdefault(key, []).append(card["Name"])
    for card in cards.values():
        if not card.get("Name") or card.get("IsDisabled") or card.get("Tier") not in (1, 2, 3, 4):
            continue
        stats = []
        for key, info in card.items():
            if not key.startswith("Info"):
                continue
            for s in (info.get("Main") or []) + (info.get("Alt") or []):
                label, prefix = lang.get(f"{s['Key']}_label"), lang.get(f"{s['Key']}_prefix")
                if lang.get(f"{s['Key']}_postfix") != "%" or not label or isinstance(s["Value"], str):
                    continue
                sign = "+" if prefix == "+" or (prefix == "{s:sign}" and s["Value"] >= 0) else "-" if prefix == "-" else ""
                stats.append({"label": label, "value": s["Value"], "sign": sign})
        # a label twice on one card (e.g. innate and active Bullet Resist) would make the blank ambiguous
        stats = [s for s in stats if sum(t["label"] == s["label"] for t in stats) == 1]
        items.append({"name": card["Name"], "slot": slots[card["Slot"]], "tier": card["Tier"], "cost": card["Cost"],
                      "icon": re.sub(r"[^a-z0-9]+", "_", card["Name"].lower()).strip("_") + ".png", "stats": stats,
                      "into": sorted(into.get(card["Key"], []))})

    (TRIVIA_DIR / "items").mkdir(parents=True, exist_ok=True)
    urls = {}
    for i in range(0, len(items), 50):
        pages = web.get(WIKI_API, timeout=30, params={
            "action": "query", "titles": "|".join(f"File:{it['name']}.png" for it in items[i:i + 50]),
            "prop": "imageinfo", "iiprop": "url", "format": "json",
        }).json()["query"]
        alias = {n["to"]: n["from"] for n in pages.get("normalized", [])}
        urls.update({alias.get(p["title"], p["title"]): p["imageinfo"][0]["url"]
                     for p in pages["pages"].values() if "imageinfo" in p})
    kept = []
    for it in items:
        url = urls.get(f"File:{it['name']}.png")
        if not url:
            print(f"[FAIL] no art for {it['name']} (left out)")
            continue
        (TRIVIA_DIR / "items" / it["icon"]).write_bytes(web.get(url, timeout=30).content)
        kept.append(it)
    kept.sort(key=lambda it: (it["tier"], it["name"]))
    (TRIVIA_DIR / "items.json").write_text(json.dumps(kept, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved {len(kept)} items ({sum(len(it['stats']) for it in kept)} % stats) to {TRIVIA_DIR / 'items.json'}")


# Stickers copied from other servers: (source sticker id, new name, emoji tag, description, format)
# format "png" = static (resized onto a 320x320 canvas); "gif" = animated (uploaded as-is)
STICKERS = [
    ("1553466707224305825", "smug", "😏", "Smug face", "png"),
    ("1256383105535840350", "whats the plan", "🤔", "Whats the plan?", "png"),
    ("1279407794986160292", "dome bot", "🤖", "Robot with a starry glass dome head", "gif"),
    ("1272607445365297244", "big hammer", "🔨", "Little guy, big hammer", "png"),
    ("1258938857395716116", "glowing eyes", "👀", "Dark mask with glowing eyes", "png"),
    ("1291369258496036866", "laughing at you", "🫵", "Laughing and pointing", "png"),
    ("1426338652933460079", "excited", "🤩", "Wide-eyed excited grin", "png"),
    ("1293210080631853076", "golden staff", "🪄", "Showing off a golden staff", "png"),
]
STICKER_DIR = ASSETS / "stickers"
STICKER_SIZE = 320               # Discord sticker size
STICKER_MAX_BYTES = 512 * 1024   # Discord sticker file limit


def stickers(session: requests.Session):
    """Copy the STICKERS list into this server. Docs: Sticker resource -> Create Guild Sticker."""
    STICKER_DIR.mkdir(parents=True, exist_ok=True)
    existing = {s["name"] for s in api(session, "GET", f"/guilds/{GUILD_ID}/stickers")}
    ok = 0
    for sticker_id, name, tag, description, fmt in STICKERS:
        if name in existing:
            print(f"[ok] '{name}' already exists")
            ok += 1
            continue
        r = requests.get(f"https://media.discordapp.net/stickers/{sticker_id}.{fmt}",
                         params={"size": STICKER_SIZE}, timeout=30)
        if not r.ok:
            print(f"[FAIL] '{name}': couldn't download sticker {sticker_id} ({r.status_code})")
            continue
        # Animated GIFs are uploaded untouched (resizing would drop frames).
        data = r.content if fmt == "gif" else to_square_png(r.content, STICKER_SIZE)
        path = STICKER_DIR / f"{name.replace(' ', '_')}.{fmt}"
        path.write_bytes(data)
        if len(data) > STICKER_MAX_BYTES:
            print(f"[FAIL] '{name}': {len(data) // 1024} KB is over Discord's 512 KB limit")
            continue
        r = session.post(f"{API}/guilds/{GUILD_ID}/stickers", timeout=30,
                         data={"name": name, "tags": tag, "description": description},
                         files={"file": (path.name, data, f"image/{fmt}")})
        if r.status_code == 400 and r.json().get("code") == 30039:  # Maximum number of stickers reached
            print(f"[FAIL] '{name}': the server is out of sticker slots "
                  f"(5 without boosts, 15 at boost level 1). Saved to {path.name} for later.")
            continue
        if not r.ok:
            print(f"[FAIL] '{name}': Discord said {r.status_code} {r.text}")
            continue
        existing.add(name)
        print(f"[ok] Uploaded sticker '{name}' ({len(data) // 1024} KB)")
        ok += 1
    print(f"\n{ok}/{len(STICKERS)} stickers in the server (free servers get 5 sticker slots)")
    print("CHECKPOINT PASSED" if ok == len(STICKERS) else "CHECKPOINT FAILED - see FAIL lines above")


# ---------- channel layout ----------
# Channel types (docs: Channel resource -> Channel Types)
TEXT, VOICE, CATEGORY, ANNOUNCEMENT = 0, 2, 4, 5
SEND_MESSAGES = 1 << 11
CREATE_PUBLIC_THREADS = 1 << 35
CREATE_PRIVATE_THREADS = 1 << 36
SEND_MESSAGES_IN_THREADS = 1 << 38
READ_ONLY_DENY = SEND_MESSAGES | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS | SEND_MESSAGES_IN_THREADS

# Top to bottom. read_only = members can read + react, only staff/bot can post.
LAYOUT = [
    ("Info", [
        ("rules", TEXT, True),
        ("welcome", TEXT, True),
        ("announcements", ANNOUNCEMENT, True),
        ("streams-and-uploads", TEXT, True),  # the bot posts Twitch/TikTok go-live alerts here (STREAM_CHANNEL_ID in src/config.js)
        ("roles", TEXT, True),
    ]),
    ("Text Channels", [
        ("deadlock-general", TEXT, False),
        ("deadlock-ranked", TEXT, False),
        ("deadlock-streetbrawl", TEXT, False),
    ]),
    ("LFG", [  # the bot also creates its lobby voice channels in here
        ("lfg-na", TEXT, False),
        ("lfg-sa", TEXT, False),
        ("lfg-eu", TEXT, False),
        ("lfg-ru", TEXT, False),
        ("lfg-asia", TEXT, False),
        ("lfg-oce", TEXT, False),
        ("lfg-africa", TEXT, False),
    ]),
    ("Staff", [
        ("mod-updates", TEXT, False),  # Community-required channel; already staff-only
    ]),
]
LEGACY = [("lfg", TEXT), ("LFG Lobbies", CATEGORY)]  # replaced by the LFG category


def layout(session: requests.Session):
    """Create/move channels into LAYOUT order. Never deletes anything except the old #lfg setup."""
    chans = api(session, "GET", f"/guilds/{GUILD_ID}/channels")

    def find(name, types, parent=None):
        for c in chans:
            if c["name"] == name and c["type"] in types and (parent is None or c.get("parent_id") == parent):
                return c
        for c in chans:  # anywhere in the server
            if c["name"] == name and c["type"] in types:
                return c
        return None

    positions = []
    wanted_ids = set()
    for cat_pos, (cat_name, children) in enumerate(LAYOUT):
        cat = find(cat_name, {CATEGORY})
        if not cat:
            cat = api(session, "POST", f"/guilds/{GUILD_ID}/channels", json={"name": cat_name, "type": CATEGORY})
            chans.append(cat)
            print(f"[ok] Created category {cat_name}")
        wanted_ids.add(cat["id"])
        positions.append({"id": cat["id"], "position": cat_pos})

        for pos, (name, ctype, read_only) in enumerate(children):
            ch = find(name, {TEXT, ANNOUNCEMENT}, cat["id"])
            if not ch:
                body = {"name": name, "type": ctype, "parent_id": cat["id"]}
                ch = api(session, "POST", f"/guilds/{GUILD_ID}/channels", json=body)
                chans.append(ch)
                print(f"[ok] Created #{name}")
            elif ctype == ANNOUNCEMENT and ch["type"] == TEXT:
                ch = api(session, "PATCH", f"/channels/{ch['id']}", json={"type": ANNOUNCEMENT})
                print(f"[ok] Made #{name} an announcement channel")
            wanted_ids.add(ch["id"])
            positions.append({"id": ch["id"], "position": pos, "parent_id": cat["id"]})
            if read_only:
                # @everyone (role id == guild id) can read + react but not post
                api(session, "PUT", f"/channels/{ch['id']}/permissions/{GUILD_ID}",
                    json={"type": 0, "allow": "0", "deny": str(READ_ONLY_DENY)})

    # Anything not in the layout goes below the layout items (never deleted here).
    others = [c for c in chans if c["id"] not in wanted_ids]
    for i, c in enumerate(o for o in others if o["type"] == CATEGORY):
        positions.append({"id": c["id"], "position": len(LAYOUT) + i})
    for i, c in enumerate(o for o in others if o["type"] != CATEGORY and o.get("parent_id") in wanted_ids):
        positions.append({"id": c["id"], "position": 50 + i})

    api(session, "PATCH", f"/guilds/{GUILD_ID}/channels", json=positions)
    print("[ok] Channels ordered")

    # Old LFG setup (made by an earlier bot version)
    for name, ctype in LEGACY:
        ch = next((c for c in chans if c["name"] == name and c["type"] == ctype and c["id"] not in wanted_ids), None)
        if not ch:
            continue
        kids = [c for c in chans if c.get("parent_id") == ch["id"]]
        if kids:
            print(f"[WARN] Kept '{name}': it still has {len(kids)} channel(s) in it")
            continue
        api(session, "DELETE", f"/channels/{ch['id']}")
        chans = [c for c in chans if c["id"] != ch["id"]]
        print(f"[ok] Deleted old '{name}'")

    extra = [c for c in chans if c["id"] not in wanted_ids
             and not (c["type"] == VOICE and c.get("parent_id") in wanted_ids)]  # skip LFG lobbies
    if extra:
        print("\n[info] Not part of the layout (left alone, sitting below it):")
        for c in extra:
            kind = {VOICE: "voice", CATEGORY: "category"}.get(c["type"], "text")
            print(f"   - {c['name']} ({kind})")
    print("\nCHECKPOINT PASSED - check the channel list in Discord")


def twitch(session: requests.Session):
    """Ask for the Twitch app's Client ID + Secret, check them with Twitch, save them to .env."""
    from dotenv import set_key
    print("Make an app at https://dev.twitch.tv/console/apps (Register Your Application):")
    print("  Name: anything, e.g. Fairfax Bot | OAuth Redirect URL: https://localhost (then Add) | Category: Chat Bot")
    print("  Client Type: Confidential. Then Manage -> copy Client ID, press New Secret, copy it.\n")
    client_id = input("Client ID: ").strip()
    secret = getpass.getpass("Client Secret (input is hidden): ").strip()
    r = requests.post("https://id.twitch.tv/oauth2/token", timeout=30, data={
        "client_id": client_id, "client_secret": secret, "grant_type": "client_credentials"})
    if not r.ok:
        sys.exit(f"FAIL: Twitch didn't accept those ({r.status_code}). Nothing saved. Check both and try again.")
    headers = {"Client-Id": client_id, "Authorization": f"Bearer {r.json()['access_token']}"}
    login = re.search(r"TWITCH_LOGIN: '([^']+)'", Path(__file__).with_name("src").joinpath("config.js").read_text(encoding="utf-8")).group(1)
    users = requests.get(f"https://api.twitch.tv/helix/users?login={login}", headers=headers, timeout=30).json().get("data")
    if not users:
        sys.exit(f"FAIL: Twitch has no channel called '{login}'. Nothing saved.")
    set_key(ENV_PATH, "TWITCH_CLIENT_ID", client_id, quote_mode="never")
    set_key(ENV_PATH, "TWITCH_CLIENT_SECRET", secret, quote_mode="never")
    print(f"[ok] Keys work and found {users[0]['display_name']} on Twitch. Saved to {ENV_PATH.name}.")
    print("\nCHECKPOINT PASSED - restart the bot (Start Bot.bat); alerts are on in #streams-and-uploads")


COMMANDS = {
    "check": check,
    "community": community,
    "rank-icons": rank_icons,
    "rank-emojis": rank_emojis,
    "hero-icons": hero_icons,
    "hero-emojis": hero_emojis,
    "hero-renders": hero_renders,
    "trivia": trivia,
    "stickers": stickers,
    "shop-emojis": shop_emojis,
    "layout": layout,
    "twitch": twitch,
}


def pick_command() -> str:
    """Double-click mode: no command given, so show a menu."""
    print("Fairfax Industries setup\n")
    names = list(COMMANDS)
    for i, name in enumerate(names, 1):
        print(f"  {i}. {name}")
    choice = input("\nPick a number (Enter = 1): ").strip() or "1"
    if not choice.isdigit() or not 1 <= int(choice) <= len(names):
        sys.exit(f"'{choice}' isn't one of the options.")
    print()
    return names[int(choice) - 1]


def main():
    if len(sys.argv) >= 2:
        command = sys.argv[1]
        if command not in COMMANDS:
            sys.exit(__doc__)
    else:
        command = pick_command()
    token = get_token()
    with requests.Session() as s:
        s.headers.update({
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (fairfax-setup, 0.1)",
        })
        COMMANDS[command](s)


if __name__ == "__main__":
    double_clicked = len(sys.argv) < 2
    try:
        main()
    except SystemExit as e:
        if e.code not in (None, 0):
            print(e.code)
    except Exception as e:  # show the error instead of the window vanishing
        print(f"\nERROR: {type(e).__name__}: {e}")
    finally:
        if double_clicked:
            input("\nPress Enter to close...")
