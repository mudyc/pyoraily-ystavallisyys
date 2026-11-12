#!/usr/bin/env python3
"""
Sovita tools/reitit.py:n reitit Digiroadin linkkeihin.

Suunta on reitistä linkkiin, ei toisin päin. Reitti näytteistetään 2 metrin
välein, ja jokainen näyte annetaan lähimmälle Digiroad-linkille, jonka
suunta poikkeaa enintään KULMA astetta. Näin samansuuntainen ajorata ja
pyörätie eivät molemmat saa reittiä: lähempi voittaa. Kulmaehto estää
poikittaista katua saamasta reittiä risteyksessä.

Linkki saa luokan, jos reittinäytteitä osuu vähintään OSUUS sen pituudesta.

Ensimmäinen tuloste on sovituksen laatu: kuinka suuri osa kunkin lähteen
reittipituudesta löysi linkin 5 / 10 / 15 / 25 metrin sisältä. Osuus lasketaan
vain kunnan sisältä (300 m kunnan Digiroad-verkosta); kunnan ulkopuolinen
pituus tulostetaan erikseen, koska esim. Turun aineisto kattaa koko seudun. Jos osuus jää
pieneksi, vika on koordinaatistossa tai lähteen piirtotavassa eikä
Digiroadissa - ja se pitää nähdä ennen kuin lukuja käytetään.

  tools/reitit_linkit.py [--etaisyys 15] [koodi ...] -> data/reitit/linkit.json
"""
import collections
import glob
import gzip
import json
import math
import os
import sys

import numpy as np
from shapely import STRtree, points

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALI = 2.0
KULMA = 35.0
OSUUS = 0.5
KEVYT = {8}   # toiminn_lk: kevyen liikenteen väylä
ULKO = 300.0  # m; kuntarajan likiarvo Digiroad-verkosta
ARVO = {'baana': 3, 'paareitti': 2, 'aluereitti': 1}


def segmentit(feats):
    a, b, li = [], [], []
    for i, f in enumerate(feats):
        c = f['geometry']['coordinates']
        for p, q in zip(c, c[1:]):
            a.append(p[:2]); b.append(q[:2]); li.append(i)
    return np.array(a), np.array(b), np.array(li)


def naytteet(lines):
    """Pisteet VALI metrin välein + paikallinen suunta (rad)."""
    xy, ang = [], []
    for c in lines:
        for p, q in zip(c, c[1:]):
            d = math.dist(p, q)
            if d == 0:
                continue
            n = max(1, int(d // VALI))
            t = (np.arange(n) + 0.5) / n
            xy.append(np.column_stack([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]))
            ang.append(np.full(n, math.atan2(q[1] - p[1], q[0] - p[0])))
    if not xy:
        return np.zeros((0, 2)), np.zeros(0)
    xy = np.vstack(xy)
    ang = np.concatenate(ang)
    return xy, ang


def lahin(xy, ang, A, B, tree, maxd):
    """Jokaiselle näytteelle lähin samansuuntainen segmentti: (etäisyys, segmentti)."""
    pi, si = tree.query(points(xy), predicate='dwithin', distance=maxd)
    d = np.full(len(xy), np.inf)
    s = np.full(len(xy), -1)
    if len(pi) == 0:
        return d, s
    P, a, b = xy[pi], A[si], B[si]
    ab = b - a
    L2 = (ab ** 2).sum(1)
    t = np.clip(((P - a) * ab).sum(1) / np.where(L2 == 0, 1, L2), 0, 1)
    dist = np.hypot(*(P - (a + t[:, None] * ab)).T)
    sa = np.arctan2(ab[:, 1], ab[:, 0])
    da = np.abs((ang[pi] - sa + np.pi / 2) % np.pi - np.pi / 2)   # suunnaton ero
    ok = da <= math.radians(KULMA)
    pi, si, dist = pi[ok], si[ok], dist[ok]
    if len(pi) == 0:
        return d, s
    o = np.lexsort((dist, pi))
    pi, si, dist = pi[o], si[o], dist[o]
    eka = np.r_[True, pi[1:] != pi[:-1]]
    d[pi[eka]] = dist[eka]
    s[pi[eka]] = si[eka]
    return d, s


def kunta(polku, maxd, tulos):
    koodi = int(os.path.basename(polku)[:3])
    rd = json.load(gzip.open(polku))
    reitit = rd['features']
    # Karkeasta karttakuvasta georeferoidut reitit (tools/reitit.py) kantavat
    # oman sovitusetäisyytensä: pikselin tarkkuus voi olla yli 15 m.
    maxd = max(maxd, rd.get('sovitusetaisyys', 0))
    dr = json.load(gzip.open(f'{JUURI}/data/kunnat/{koodi:03d}.geojson.gz'))
    feats = dr['features']
    A, B, LI = segmentit(feats)
    from shapely import linestrings
    tree = STRtree(linestrings(np.stack([A, B], 1)))
    pituus = np.array([sum(math.dist(p[:2], q[:2]) for p, q in zip(c, c[1:]))
                       for c in (f['geometry']['coordinates'] for f in feats)])

    # lähde: [n kunnassa, <5, <10, <15, <25, n kunnan ulkopuolella]
    laatu = collections.defaultdict(lambda: np.zeros(6))
    peitto = collections.defaultdict(lambda: collections.Counter())   # linkki -> (luokka, tila) -> m
    for r in reitit:
        p = r['properties']
        xy, ang = naytteet(r['geometry']['coordinates'])
        if not len(xy):
            continue
        d, s = lahin(xy, ang, A, B, tree, max(25.0, maxd))
        # Digiroad on leikattu kuntarajalta, osa lähteistä ei (Turun seutu).
        # Näyte on kunnassa, jos jokin kunnan linkki on ULKO metrin sisällä.
        sis = np.zeros(len(xy), bool)
        sis[np.unique(tree.query(points(xy), predicate='dwithin', distance=ULKO)[0])] = True
        q = laatu['osm_rcn' if p['lahde'].startswith('osm_') else p['lahde']]
        di = d[sis]
        q += [len(di), (di < 5).sum(), (di < 10).sum(), (di < 15).sum(), (di < 25).sum(), (~sis).sum()]
        for li in LI[s[d <= maxd]]:
            peitto[li][(p['luokka'], p['tila'])] += VALI

    print(f'\n{dr.get("nimi", koodi)} ({koodi:03d})')
    print(f'  {"lähde":<26}{"km":>7}{"<5m":>6}{"<10m":>6}{"<15m":>6}{"<25m":>6}{"ulkona km":>11}')
    for l, q in sorted(laatu.items()):
        n = max(q[0], 1)
        print(f'  {l:<26}{q[0] * VALI / 1000:>7.0f}' + ''.join(f'{100 * v / n:>5.0f}%' for v in q[1:5])
              + f'{q[5] * VALI / 1000:>11.0f}')

    luokitus = {}
    km = collections.Counter()
    for li, c in peitto.items():
        hyv = {k: v for k, v in c.items() if v >= OSUUS * pituus[li]}
        if not hyv:
            continue
        # Korkein luokka; saman luokan sisällä olemassa > tavoite > suunniteltu.
        tilat = {'olemassa': 2, 'tavoite': 1, 'suunniteltu': 0}
        (lk, tila) = max(hyv, key=lambda k: (ARVO[k[0]], tilat[k[1]]))
        f = feats[li]['properties']
        kevyt = f.get('toiminn_lk') in KEVYT
        luokitus[f['link_id']] = {'luokka': lk, 'tila': tila,
                                  'osuus': round(min(1.0, hyv[(lk, tila)] / max(pituus[li], 1e-9)), 2)}
        km[(lk, tila, 'kevyt' if kevyt else 'ajorata')] += pituus[li] / 1000
    print('  Digiroad-linkit:', '  '.join(f'{lk}/{t}/{k} {v:.0f} km' for (lk, t, k), v in sorted(km.items())))
    tulos[f'{koodi:03d}'] = luokitus


if __name__ == '__main__':
    a = sys.argv[1:]
    maxd = float(a[a.index('--etaisyys') + 1]) if '--etaisyys' in a else 15.0
    # Kuntakoodit argumentteina: päivitetään vain ne, muut säilyvät.
    valitut = {f'{int(x):03d}' for x in a if x.isdigit() and '--etaisyys' not in a[a.index(x) - 1:a.index(x)]}
    ulos = f'{JUURI}/data/reitit/linkit.json'
    tulos = json.load(open(ulos)) if valitut and os.path.exists(ulos) else {}
    for polku in sorted(glob.glob(f'{JUURI}/data/reitit/*.geojson.gz')):
        if not valitut or os.path.basename(polku)[:3] in valitut:
            kunta(polku, maxd, tulos)
    json.dump(tulos, open(f'{JUURI}/data/reitit/linkit.json', 'w'))
    print(f'\n{sum(len(v) for v in tulos.values())} linkkiä luokiteltu -> data/reitit/linkit.json')
