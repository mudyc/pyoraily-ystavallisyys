"""
Karttakuvan automaattinen georeferointi Digiroadin verkkoa vasten.

PDF-kaupunkien pääverkko on kuva ilman koordinaatteja. Reittiviivat kulkevat
katuja ja kevytväyliä pitkin, joten kuvan reittipikselit voi sovittaa
Digiroadin linkkeihin:

1. KARKEA: oletetaan pohjoinen ylös. Jokaiselle mittakaavalle (m/px,
   logaritminen haku) reittipikselit pienennetään 20 m ruudukkoon ja
   ristikorreloidaan (FFT) Digiroad-verkon läheisyysrasterin kanssa. Paras
   mittakaava + siirto voittaa. Kartan mittakaavajana ei ole tarpeen.
2. HIENO: affiininen ICP. Reittipisteet viedään karkealla muunnoksella
   kartalle, kullekin haetaan lähin piste Digiroadin linkiltä ja affiini
   sovitetaan pienimmillä neliöillä vain pareille, joiden etäisyys on alle
   kynnyksen (100 -> 50 -> 25 -> 15 m). Affiini kattaa kiertymän
   (meridiaanikonvergenssi, Web Mercator -pohja) ja lievän venymän.

Tulos on muunnos kuvapikselistä (sarake, rivi) EPSG:3067:ään ja jäännös:
osuus reittipisteistä 5 / 10 / 15 m sisällä Digiroadista. Jäännös on
tarkistus: väärä sovitus näkyy siinä heti, ja se tulostetaan aina.
"""
import math

import numpy as np
from scipy.signal import fftconvolve
from scipy.ndimage import gaussian_filter
from shapely import LineString, STRtree, points, line_locate_point, line_interpolate_point

SOLU = 20.0
PUSKURI = 50.0   # m; karkea vaihe sietää mittakaavan askeleen (2 %), ICP tarkentaa


def _verkko(feats, bbox):
    x0, y0, x1, y1 = bbox
    nx, ny = int((x1 - x0) / SOLU) + 1, int((y1 - y0) / SOLU) + 1
    R = np.zeros((ny, nx), np.float32)
    for f in feats:
        # Reitit kulkevat kevytväylillä ja pääkaduilla; metsäautotiet ja
        # yksityistiet vain hämärtävät korrelaation.
        w = 1.0
        c = np.array([p[:2] for p in f['geometry']['coordinates']])
        for p, q in zip(c, c[1:]):
            n = max(2, int(math.dist(p, q) / (SOLU / 2)))
            t = np.linspace(0, 1, n)[:, None]
            s = p + t * (q - p)
            j = ((s[:, 0] - x0) / SOLU).astype(int)
            i = ((y1 - s[:, 1]) / SOLU).astype(int)
            ok = (i >= 0) & (i < ny) & (j >= 0) & (j < nx)
            R[i[ok], j[ok]] = np.maximum(R[i[ok], j[ok]], w)
    from scipy.ndimage import distance_transform_edt
    return (distance_transform_edt(R == 0) * SOLU <= PUSKURI).astype(np.float32), (x0, y1)


def kierrot(bbox):
    """Todennäköiset karttojen pohjoissuunnat TM35-ruudukkoon nähden (astetta).

    Karttakuva on piirretty jossakin näistä: TM35 (0), todellinen pohjoinen
    (OSM- ja Google-pohjat, Web Mercator) tai kaupungin GK-kaista. GK-kaistan
    ruudukkopohjoinen poikkeaa TM35:stä meridiaanikonvergenssin verran, esim.
    Hämeenlinnassa GK25 vs TM35 noin 1,8 astetta -> 10 km kartan reunalla 150 m.
    """
    from pyproj import Transformer
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    lon, lat = Transformer.from_crs(3067, 4326, always_xy=True).transform(cx, cy)

    def suunta(crs):
        t = Transformer.from_crs(4326, crs, always_xy=True)
        x0, y0 = t.transform(lon, lat)
        x1, y1 = t.transform(lon, lat + 0.01)
        return math.degrees(math.atan2(x1 - x0, y1 - y0))   # pohjoisen suunta ruudukossa
    tm = suunta(3067)
    out = {0.0, round(tm, 2)}
    for z in (math.floor(lon), math.ceil(lon)):
        gk = f'+proj=tmerc +lat_0=0 +lon_0={z} +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m'
        out.add(round(tm - suunta(gk), 2))
    return sorted(out | {-a for a in out})          # etumerkki: molemmat, halpa


def _kierra(pix, a):
    c = pix.mean(0)
    r = math.radians(a)
    R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
    return (pix - c) @ R.T + c, R, c


def karkea(pix, feats, bbox, skaalat=None):
    """Kierto + mittakaava + siirto. -> [(pisteet, M), ...] parhaasta alkaen."""
    T, (X0, Y1) = _verkko(feats, bbox)
    out = []
    for a in kierrot(bbox):
        q, R, c = _kierra(pix, a)
        q = q - q.min(0)
        for pisteet, s, x0, y1 in _karkea(q, T, X0, Y1, skaalat):
            # kuva -> kierretty (q) -> kartta: x = x0 + s*qx, y = y1 - s*qy
            # q = R (p - c) + c - qmin
            sh = c - R @ c - (_kierra(pix, a)[0]).min(0)
            A = np.array([[s, 0], [0, -s]]) @ R
            t = np.array([x0, y1]) + np.array([[s, 0], [0, -s]]) @ sh
            out.append((pisteet, np.column_stack([A, t])))
    out.sort(key=lambda e: -e[0])
    return out


def _karkea(pix, T, X0, Y1, skaalat=None):
    """pix: (N, 2) [sarake, rivi]. -> (m/px, x0, y_ylä): x = x0 + s*sarake, y = y_ylä - s*rivi."""
    # Kartan leveys 3-60 km. Ilman alarajaa pienin mittakaava voittaa: koko
    # kuva painuu muutamaan ruutuun, joka osuu mihin tahansa tiheään verkkoon.
    lev = pix[:, 0].max() - pix[:, 0].min() + 1
    skaalat = skaalat if skaalat is not None else np.exp(np.linspace(math.log(3000 / lev), math.log(60000 / lev), 150))
    ehdokkaat = []
    for s in skaalat:
        j = (pix[:, 0] * s / SOLU).astype(int)
        i = (pix[:, 1] * s / SOLU).astype(int)
        h, w = i.max() + 1, j.max() + 1
        if h > T.shape[0] or w > T.shape[1] or h < 10:
            continue
        K = np.zeros((h, w), np.float32)
        np.add.at(K, (i, j), 1)
        K = np.minimum(K, 1)
        C = fftconvolve(T, K[::-1, ::-1], mode='valid')
        k = np.unravel_index(np.argmax(C), C.shape)
        ehdokkaat.append((C[k] / K.sum(), s, X0 + k[1] * SOLU, Y1 - k[0] * SOLU))
    ehdokkaat.sort(key=lambda e: -e[0])
    return ehdokkaat


def sovita(pix, feats, bbox, n=20):
    """Karkean haun n parasta mittakaavaa ICP:hen; voittaja on pienin jäännös."""
    paras = None
    osa = pix[::max(1, len(pix) // 6000)]          # ICP-valinta otoksella
    for _, alku in karkea(pix, feats, bbox)[:n]:
        M, j = hieno(osa, feats, alku)
        if paras is None or (j[15], j[5]) > (paras[1][15], paras[1][5]):
            paras = (M, j, alku)
    M, j = hieno(pix, feats, paras[2])
    return M, j


def _segmentit(feats):
    return np.array([LineString([p[:2] for p in f['geometry']['coordinates']]) for f in feats])


def hieno(pix, feats, alku, kynnykset=(100, 50, 25, 15, 10, 10, 8, 8)):
    """Affiininen ICP. alku: 2x3-matriisi tai (s, x0, y_ylä). -> M (2x3), jäännös."""
    if isinstance(alku, np.ndarray):
        M = alku.astype(float)
    else:
        s, x0, y1 = alku
        M = np.array([[s, 0, x0], [0, -s, y1]], float)
    L = _segmentit(feats)
    tree = STRtree(L)
    P = np.column_stack([pix, np.ones(len(pix))])
    for k in kynnykset:
        Q = P @ M.T
        pts = points(Q)
        ri, li = tree.query_nearest(pts, max_distance=k, all_matches=False)
        lahin = line_interpolate_point(L[li], line_locate_point(L[li], pts[ri]))
        Z = np.array([[p.x, p.y] for p in lahin])
        A = P[ri]
        M = np.linalg.lstsq(A, Z, rcond=None)[0].T
    return M, jaannos(pix, feats, M)


def jaannos(pix, feats, M):
    L = _segmentit(feats)
    tree = STRtree(L)
    Q = np.column_stack([pix, np.ones(len(pix))]) @ M.T
    _, d = tree.query_nearest(points(Q), return_distance=True, all_matches=False)
    return {r: round(float((d <= r).mean()) * 100, 1) for r in (5, 10, 15, 25)}


def kuvaan(M):
    """Muunnosfunktio [(sarake, rivi), ...] -> [(x, y), ...]."""
    return lambda c: [tuple(M @ np.array([a, b, 1.0])) for a, b in c]
