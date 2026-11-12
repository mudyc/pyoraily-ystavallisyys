"""
Rasterikartasta reittiviivoiksi: värin tunnistus, ohennus ja jäljitys.

Kun kaupunki julkaisee pääverkon vain kuvana (karttapalvelun tiilet, WMS,
PDF), viivat tunnistetaan värin perusteella, ohennetaan yhden pikselin
levyisiksi keskilinjoiksi ja jäljitetään murtoviivoiksi. Tulos on samassa
muodossa kuin vektorilähteet, joten tools/reitit_linkit.py sovittaa sen
Digiroadiin samalla tavalla: kulmaehto ja lähin linkki toimivat, koska
viivoilla on suunta.

Tarkkuus on pikselikoon luokkaa (2 m/px tiilillä), sovitusetäisyys 15 m.
"""
import numpy as np
from PIL import Image
from shapely import LineString
from skimage.morphology import skeletonize, binary_closing, disk


def mosaiikki(tiilet, koko_m, px=256):
    """tiilet: {(tx, ty): polku}, tiili kattaa [tx*koko_m, (tx+1)*koko_m] x
    [ty*koko_m, (ty+1)*koko_m]; kuvan rivi 0 on pohjoisreuna.
    -> (RGBA-taulukko, vasen x, yläreuna y, m/px)"""
    xs = [t[0] for t in tiilet]
    ys = [t[1] for t in tiilet]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    A = np.zeros(((y1 - y0 + 1) * px, (x1 - x0 + 1) * px, 4), np.uint8)
    for (tx, ty), p in tiilet.items():
        try:
            im = np.asarray(Image.open(p).convert('RGBA'))
        except Exception:
            continue
        r = (y1 - ty) * px
        c = (tx - x0) * px
        A[r:r + px, c:c + px] = im
    return A, x0 * koko_m, (y1 + 1) * koko_m, koko_m / px


def maski(A, rgb, tol=60, alfa=128):
    d = np.abs(A[..., :3].astype(int) - np.array(rgb)).sum(-1)
    return (d <= tol) & (A[..., 3] >= alfa)


def viivat(m, vasen, yla, res, sulje=1, yksinkertaista=1.0, min_pituus=3):
    """Maski -> keskilinjat murtoviivoina karttakoordinaateissa."""
    if sulje:
        m = binary_closing(m, disk(sulje))          # antialiasoinnin aukot umpeen
    S = skeletonize(m)
    rr, cc = np.nonzero(S)
    pis = set(zip(rr.tolist(), cc.tolist()))
    N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    def naap(p):
        return [(p[0] + a, p[1] + b) for a, b in N8 if (p[0] + a, p[1] + b) in pis]

    aste = {p: len(naap(p)) for p in pis}
    kayty = set()                                    # käytetyt reunat (p, q)
    polut = []

    def kulje(a, b):
        polku = [a, b]
        kayty.add((a, b)); kayty.add((b, a))
        while aste[polku[-1]] == 2:
            seur = [q for q in naap(polku[-1]) if (polku[-1], q) not in kayty]
            if not seur:
                break
            q = seur[0]
            kayty.add((polku[-1], q)); kayty.add((q, polku[-1]))
            polku.append(q)
        return polku

    for p in pis:                                    # solmuista alkaen
        if aste[p] != 2:
            for q in naap(p):
                if (p, q) not in kayty:
                    polut.append(kulje(p, q))
    for p in pis:                                    # suljetut silmukat
        for q in naap(p):
            if (p, q) not in kayty:
                polut.append(kulje(p, q))

    out = []
    for pl in polut:
        if len(pl) < min_pituus:
            continue
        c = [(vasen + (j + 0.5) * res, yla - (i + 0.5) * res) for i, j in pl]
        ls = LineString(c).simplify(yksinkertaista * res)
        out.append([tuple(p) for p in ls.coords])
    return out


def hsv_maski(rgb, h0, h1, s0=0.45, v0=0.3, v1=1.0):
    """Sävyväli asteina (h0 > h1 = kiertää nollan yli), kylläisyys ja kirkkaus 0-1."""
    a = rgb[..., :3].astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1)
    d = np.where(mx - mn == 0, 1e-9, mx - mn)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1e-9))
    hm = (h >= h0) & (h <= h1) if h0 <= h1 else (h >= h0) | (h <= h1)
    return hm & (s >= s0) & (mx >= v0) & (mx <= v1)


def jaa_katko(m, ala):
    """Katkoviiva = pienet erilliset palat. -> (yhtenäinen, katkoviiva).
    Katkoviivan palat yhdistetään sulkemalla, jotta ohennus tuottaa viivan."""
    from scipy.ndimage import label
    L, n = label(m, structure=np.ones((3, 3)))
    koko = np.bincount(L.ravel())
    pieni = koko < ala
    pieni[0] = False
    k = pieni[L]
    return m & ~k, binary_closing(k, disk(4))
