# Region emojis in the style of Deadlock's item cards: dusty colour tile with worn
# paper grain, a flat cream pictogram (the region's landmass), and the dark
# "ACTIVE"-style pill carrying the region code in Radiance Bold.
import json, math, random
import pycountry, pycountry_convert as pcc
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import unary_union
from shapely import affinity
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

S = 512
FONT = "/tmp/dl/radiance-bold.otf"
CREAM, INK = (246, 243, 236), (38, 37, 38)
topo = json.load(open("/tmp/geo/package/countries-50m.json"))

# ---- decode TopoJSON arcs ----
sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
arcs = []
for arc in topo["arcs"]:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def ring(idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts

def geom(g):
    polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"] if g["type"] == "MultiPolygon" else []
    out = []
    for p in polys:
        shell = ring(p[0])
        xs = [x for x, _ in shell]
        if len(shell) < 4:
            continue
        if max(xs) - min(xs) > 180:  # crosses the antimeridian: unwrap to 0..360
            unwrap = lambda pts: [(x + 360 if x < 0 else x, y) for x, y in pts]
            out.append(Polygon(unwrap(shell), [unwrap(ring(h)) for h in p[1:] if len(ring(h)) >= 4]).buffer(0))
        else:
            out.append(Polygon(shell, [ring(h) for h in p[1:] if len(ring(h)) >= 4]).buffer(0))
    return unary_union(out) if out else None

def continent(num):
    try:
        a2 = pycountry.countries.get(numeric=num).alpha_2
        return pcc.country_alpha2_to_continent_code(a2)
    except Exception:
        return None

groups = {}
for g in topo["objects"]["countries"]["geometries"]:
    num = g.get("id")
    shape = geom(g)
    if not num or shape is None:
        continue
    key = "RU" if num == "643" else continent(num)
    groups.setdefault(key, []).append(shape)

REGIONS = [  # key, pill text, continent key, crop box (lon/lat), tile colour
    ("na", "NA", "NA", (-170, 7, -50, 75), (111, 143, 176)),
    ("sa", "SA", "SA", (-85, -56, -33, 13), (118, 154, 102)),
    ("eu", "EU", "EU", (-25, 35, 42, 71), (163, 139, 177)),
    ("ru", "RU", "RU", (26, 41, 192, 78), (176, 96, 90)),
    ("asia", "ASIA", "AS", (26, -11, 146, 56), (201, 147, 74)),
    ("oce", "OCE", "OC", (112, -48, 179.5, -9), (95, 156, 154)),
    ("africa", "AF", "AF", (-18, -35, 52, 38), (194, 162, 78)),
]

def grain(size, amount, seed, blur=0.8):
    rnd = random.Random(seed)
    g = Image.new("L", (size, size))
    g.putdata([rnd.randint(128 - amount, 128 + amount) for _ in range(size * size)])
    return g.filter(ImageFilter.GaussianBlur(blur))

def shape_mask(shape, area):
    """Project (equirectangular, lat-corrected) and fit shape into area=(x0,y0,x1,y1)."""
    minx, miny, maxx, maxy = shape.bounds
    k = math.cos(math.radians((miny + maxy) / 2))
    shape = affinity.scale(shape, xfact=k, yfact=-1, origin=(0, 0))  # flip y: north up
    minx, miny, maxx, maxy = shape.bounds
    x0, y0, x1, y1 = area
    s = min((x1 - x0) / (maxx - minx), (y1 - y0) / (maxy - miny))
    ox = x0 + ((x1 - x0) - (maxx - minx) * s) / 2 - minx * s
    oy = y0 + ((y1 - y0) - (maxy - miny) * s) / 2 - miny * s
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    polys = shape.geoms if isinstance(shape, MultiPolygon) else [shape]
    for p in polys:
        if p.area * s * s < 60:  # drop specks that vanish at emoji size
            continue
        d.polygon([(x * s + ox, y * s + oy) for x, y in p.exterior.coords], fill=255)
        for h in p.interiors:
            d.polygon([(x * s + ox, y * s + oy) for x, y in h.coords], fill=0)
    return m

def tile(key, text, cont, crop, color, seed):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    corner = Image.new("L", (S, S), 0)
    ImageDraw.Draw(corner).rounded_rectangle([8, 8, S - 8, S - 8], radius=46, fill=255)

    # dusty colour field, lighter toward the top (like the cards), with grain + wear
    field = Image.new("RGB", (S, S), color)
    light = Image.linear_gradient("L").rotate(180).resize((S, S)).point(lambda v: int(v * 0.22))
    field = Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), field, light)
    g = grain(S, 22, seed)
    field = Image.merge("RGB", [ImageChops.add(c, g, 1, -128) for c in field.split()])
    wear = grain(S, 127, seed + 9, blur=6).point(lambda v: 40 if v > 170 else 0)
    field = Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), field, wear)
    img.paste(field, (0, 0), corner)

    # landmass pictogram with a soft darker drop shadow
    land = unary_union(groups[cont]).intersection(box(*crop))
    m = shape_mask(land, (60, 44, S - 60, S - 150))
    shadow = m.filter(ImageFilter.GaussianBlur(6))
    img.paste(Image.new("RGBA", (S, S), tuple(int(v * 0.55) for v in color) + (200,)), (0, 10), shadow)
    img.paste(Image.new("RGBA", (S, S), CREAM + (255,)), (0, 0), m)

    # dark pill with the region code, like the cards' ACTIVE / IMBUE tag
    f = ImageFont.truetype(FONT, 118 if len(text) <= 2 else 96 if len(text) == 3 else 82)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
    w, h = x1 - x0, y1 - y0
    px0, py0 = (S - w) / 2 - 34, S - 150
    d.rounded_rectangle([px0, py0, px0 + w + 68, py0 + h + 44], radius=26, fill=INK)
    d.text(((S - w) / 2 - x0, py0 + 22 - y0), text, font=f, fill=CREAM)
    return img.resize((128, 128), Image.LANCZOS)

if __name__ == "__main__":
    sheet = Image.new("RGBA", (len(REGIONS) * 150 + 10, 330), (49, 51, 56, 255))
    light = Image.new("RGBA", (sheet.width, 60), (255, 255, 255, 255))
    for i, r in enumerate(REGIONS):
        t = tile(*r, seed=i * 31 + 5)
        t.save(f"region_{r[0]}.png", optimize=True)
        sheet.alpha_composite(t, (10 + i * 150, 10))
        sheet.alpha_composite(t.resize((48, 48), Image.LANCZOS), (50 + i * 150, 150))
        sheet.alpha_composite(t.resize((22, 22), Image.LANCZOS), (63 + i * 150, 220))
        light.alpha_composite(t.resize((48, 48), Image.LANCZOS), (50 + i * 150, 6))
    sheet.alpha_composite(light, (0, 262))
    sheet.save("preview3.png")
