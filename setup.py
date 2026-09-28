"""
Fairfax Industries server setup script.

Usage:
    py setup.py check      -> read-only: confirms the token works and the bot has admin
    py setup.py community  -> Phase 1: creates #rules + #mod-updates, turns on Community mode
    py setup.py rank-icons -> downloads the 11 Deadlock rank icons into assets/ranks (no Discord changes)
    py setup.py rank-emojis-> uploads assets/ranks/*.png as server emojis (skips ones that exist)
    py setup.py hero-icons -> downloads each hero's chat icon from deadlock.wiki into assets/heroes
    py setup.py hero-emojis-> uploads assets/heroes/*.png as server emojis (skips ones that exist)
    py setup.py stickers   -> copies the stickers listed in STICKERS into the server
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
RANK_DIR = Path(__file__).with_name("assets") / "ranks"
EMOJI_PREFIX = "rank_"          # emoji names become :rank_initiate:, :rank_seeker:, ...
EMOJI_SIZE = 128                # Discord shows emojis at up to 128x128
EMOJI_MAX_BYTES = 256 * 1024    # Discord's emoji file size limit


def to_emoji_png(raw: bytes) -> bytes:
    """Fit the image into a transparent 128x128 square and return PNG bytes."""
    try:
        from PIL import Image  # imported here so other commands work without Pillow
    except ImportError:
        import subprocess
        print("Installing Pillow (image library, first time only)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
        from PIL import Image
    img = Image.open(BytesIO(raw)).convert("RGBA")
    bbox = img.getbbox()            # trim empty transparent border so the badge fills the emoji
    if bbox:
        img = img.crop(bbox)
    img.thumbnail((EMOJI_SIZE, EMOJI_SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (EMOJI_SIZE, EMOJI_SIZE), (0, 0, 0, 0))
    canvas.paste(img, ((EMOJI_SIZE - img.width) // 2, (EMOJI_SIZE - img.height) // 2), img)
    out = BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


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
        png = to_emoji_png(r.content)
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


# Heroes (Category:Heroes on deadlock.wiki, Sept 2026). Each hero page shows a 128x128
# "chat icon" in its gallery, which is the wiki file "File:<Hero>.png".
HEROES = [
    "Abrams", "Apollo", "Bebop", "Billy", "Calico", "Celeste", "The Doorman", "Drifter",
    "Dynamo", "Graves", "Grey Talon", "Haze", "Holliday", "Infernus", "Ivy", "Kelvin",
    "Lady Geist", "Lash", "McGinnis", "Mina", "Mirage", "Mo & Krill", "Paige", "Paradox",
    "Pocket", "Rem", "Seven", "Shiv", "Silver", "Sinclair", "Venator", "Victor",
    "Vindicta", "Viscous", "Vyper", "Warden", "Wraith", "Yamato",
]
HERO_DIR = Path(__file__).with_name("assets") / "heroes"
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
        png = to_emoji_png(web.get(url, timeout=30).content)
        path = HERO_DIR / (re.sub(r"[^a-z0-9]+", "_", hero.lower()).strip("_") + ".png")  # mo_krill.png
        path.write_bytes(png)
        size_ok = len(png) <= EMOJI_MAX_BYTES
        ok += size_ok
        print(f"[{'ok' if size_ok else 'FAIL'}] {path.name}  ({len(png) // 1024} KB)")
    print(f"\nSaved {ok}/{len(HEROES)} icons to {HERO_DIR}")
    print("CHECKPOINT PASSED - open that folder and check they look right"
          if ok == len(HEROES) else "CHECKPOINT FAILED - see FAIL lines above")


def hero_emojis(session: requests.Session):
    upload_emojis(session, HERO_DIR, "", "hero-icons")


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
STICKER_DIR = Path(__file__).with_name("assets") / "stickers"
STICKER_SIZE = 320               # Discord sticker size
STICKER_MAX_BYTES = 512 * 1024   # Discord sticker file limit


def to_sticker_png(raw: bytes) -> bytes:
    """Center the image on a transparent 320x320 canvas (keeps its aspect ratio)."""
    try:
        from PIL import Image
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
        from PIL import Image
    img = Image.open(BytesIO(raw)).convert("RGBA")
    img.thumbnail((STICKER_SIZE, STICKER_SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (STICKER_SIZE, STICKER_SIZE), (0, 0, 0, 0))
    canvas.paste(img, ((STICKER_SIZE - img.width) // 2, (STICKER_SIZE - img.height) // 2), img)
    out = BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


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
        data = r.content if fmt == "gif" else to_sticker_png(r.content)
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


COMMANDS = {
    "check": check,
    "community": community,
    "rank-icons": rank_icons,
    "rank-emojis": rank_emojis,
    "hero-icons": hero_icons,
    "hero-emojis": hero_emojis,
    "stickers": stickers,
    "layout": layout,
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
