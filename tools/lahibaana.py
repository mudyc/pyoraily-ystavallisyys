#!/usr/bin/env python3
"""
Lähibaanaprosentti: kuinka lähellä asuinrakennusta on pyöräilyn pääverkko.

Rakennus (Ryhdin keskipiste, tools/ryhti.py) liitetään lähimpään pyöräiltävään
Digiroad-linkkiin. Siitä kävellään verkkoa pitkin lähimmälle linkille, jonka
tools/reitit_linkit.py on luokitellut. Etäisyys on siis reitti eikä linnuntie.

  100 % = rakennuksen lähin linkki on itse reitti
    0 % = reitille on verkkoa pitkin MAKS metriä tai enemmän
  välissä lineaarinen.

Liitosmatka rakennuksesta linkkiin ei kuulu etäisyyteen: "baana on lähin katu"
on 100 % riippumatta tontin koosta. Se tulostetaan erikseen tarkistukseksi.

Tasot lasketaan kumulatiivisesti: baana, pääreitti tai parempi, mikä tahansa
reitti. Suunniteltu verkko ei kelpaa. Kaupungin luku on rakennusten keskiarvo
huoneistoalalla painotettuna (asukkaita ei ole rakennustasolla), ja
painottamaton tulostetaan rinnalle.

Rajaukset: koko kunta, kaikki kunnan taajamat (SYKE YKR-taajamat 2025,
CC BY 4.0) ja keskustaajama = se taajama, jossa on suurin osa kunnan
asuinalasta. Kuntaliitosten kylät (Joensuun Eno, Lappeenrannan Ylämaa)
painavat koko kunnan lukua mutta eivät kerro kaupungin pyöräverkosta;
taajama ottaa ne pois, keskustaajama myös pienet taajamat.

Pois verkosta: moottoritie (linkkityyp 1), moottoriliikennetie (4), ramppi (6)
ja huoltoaukko (13); niillä ei saa pyöräillä. Solmut ovat linkkien päätepisteet,
joten silta ei yhdisty alittavaan katuun.

ETUSIVUN LUKU (viz/kaupungit.json, kenttä lahibaana) on yksi näistä:
taso "pääreitti tai parempi", rajaus koko kunta, huoneistoalalla painotettu.
Baana yksin ei kelpaa, koska baanaluokka on vain neljällä kaupungilla;
"mikä tahansa reitti" taas sekoittaa kaupunkien omat aluereittiluokat.
Taajamarajaus ei muuta lukuja olennaisesti (asuinalasta 0-2 % taajamien
ulkopuolella, Joensuussa ja Lappeenrannassa 13-14 %), joten koko kunta.
Kaupunkisivun kohteet ovat RUUTU-metrin ruutuja: huoneistoalalla painotettu
prosentti, huonoin ensin.

  tools/lahibaana.py -> data/lahibaana/<koodi>.json.gz, data/lahibaana.json,
                        viz/kaupungit.json (liitetään)
"""
import collections
import gzip
import heapq
import json
import math
import os

import urllib.request

import numpy as np
from shapely import STRtree, contains_xy, linestrings, points
from shapely.geometry import shape

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAKS = 2000.0
RUUTU = 250
KIELLETTY = {1, 4, 6, 13}
TAAJAMAT = ('https://paikkatiedot.ymparisto.fi/geoserver/liiteri_taajamat/wfs?service=WFS'
            '&version=2.0.0&request=GetFeature&typeNames=liiteri_taajamat:taajamat25'
            '&outputFormat=application/json&srsName=EPSG:3067')
RAJAUS = ('kunta', 'taajama', 'keskus')
TASOT = {'baana': {'baana'}, 'paa': {'baana', 'paareitti'},
         'alue': {'baana', 'paareitti', 'aluereitti'}}


def dijkstra(vierus, lahteet):
    d = {n: 0.0 for n in lahteet}
    h = [(0.0, n) for n in lahteet]
    heapq.heapify(h)
    while h:
        dn, n = heapq.heappop(h)
        if dn > d.get(n, math.inf) or dn > MAKS:
            continue
        for m, w in vierus[n]:
            nd = dn + w
            if nd < d.get(m, math.inf):
                d[m] = nd
                heapq.heappush(h, (nd, m))
    return d


def taajamat():
    polku = f'{JUURI}/data/taajamat25.geojson.gz'
    if not os.path.exists(polku):
        with urllib.request.urlopen(TAAJAMAT, timeout=300) as r, gzip.open(polku, 'wb') as o:
            o.write(r.read())
    return [(f['properties']['taajnimi'], shape(f['geometry']))
            for f in json.load(gzip.open(polku))['features']]


def tunnusluvut(p, m, w):
    return {'painotettu': round(float((p * w).sum() / w.sum()) * 100, 1),
            'rakennukset': round(float(p.mean()) * 100, 1),
            'mediaaniM': round(float(np.median(np.minimum(m, MAKS)))),
            'kiinni': round(float((m == 0).mean()) * 100, 1),
            'yli2km': round(float((m >= MAKS).mean()) * 100, 1)}


def kunta(koodi, luokitus, taaj):
    dr = json.load(gzip.open(f'{JUURI}/data/kunnat/{koodi}.geojson.gz'))
    rak = np.array(json.load(gzip.open(f'{JUURI}/data/rakennukset/{koodi}.json.gz')), float)

    linkit = [f for f in dr['features'] if f['properties']['linkkityyp'] not in KIELLETTY]
    solmu, vierus = {}, []

    def sid(p):
        k = (round(p[0], 1), round(p[1], 1))
        if k not in solmu:
            solmu[k] = len(vierus)
            vierus.append([])
        return solmu[k]

    pa, pb, pli, kum = [], [], [], []      # segmentit, linkki, matka linkin alusta
    L, ab = [], []
    for i, f in enumerate(linkit):
        c = [p[:2] for p in f['geometry']['coordinates']]
        s = 0.0
        for p, q in zip(c, c[1:]):
            pa.append(p); pb.append(q); pli.append(i); kum.append(s)
            s += math.dist(p, q)
        a, b = sid(c[0]), sid(c[-1])
        vierus[a].append((b, s)); vierus[b].append((a, s))
        L.append(s); ab.append((a, b))
    pa, pb, pli, kum = np.array(pa), np.array(pb), np.array(pli), np.array(kum)

    # Liitos: lähin segmentti ja kohta sen linkillä.
    tree = STRtree(linestrings(np.stack([pa, pb], 1)))
    ri, si = tree.query_nearest(points(rak[:, :2]), return_distance=False, all_matches=False)
    jarj = np.argsort(ri)
    si = si[jarj]
    P, A, B = rak[:, :2], pa[si], pb[si]
    v = B - A
    t = np.clip(((P - A) * v).sum(1) / np.maximum((v ** 2).sum(1), 1e-9), 0, 1)
    liitos = np.hypot(*(P - (A + t[:, None] * v)).T)
    sij = kum[si] + t * np.hypot(*v.T)       # matka linkin alusta
    li = pli[si]

    # 0 = taajaman ulkopuolella, 1 = taajamassa, 2 = keskustaajamassa
    alue = np.zeros(len(rak), int)
    ala_t = {}
    for nimi_t, g in taaj:
        sis = contains_xy(g, rak[:, 0], rak[:, 1])
        if sis.any():
            alue[sis] = 1
            ala_t[nimi_t] = (rak[sis, 2].sum(), sis)
    keskus = max(ala_t, key=lambda k: ala_t[k][0])
    alue[ala_t[keskus][1]] = 2
    maski = {'kunta': alue >= 0, 'taajama': alue >= 1, 'keskus': alue == 2}

    tulos = {'rakennuksia': len(rak), 'ala': round(rak[:, 2].sum()), 'keskustaajama': keskus,
             'rajaus': {r: {'rakennuksia': int(maski[r].sum()),
                            'alaOsuus': round(float(rak[maski[r], 2].sum() / rak[:, 2].sum()) * 100, 1)}
                        for r in RAJAUS},
             'liitosMed': round(float(np.median(liitos)), 1),
             'liitosYli50': round(float((liitos > 50).mean()) * 100, 1)}
    pros = {}
    for taso, luokat in TASOT.items():
        reitti = np.array([(luokitus.get(f['properties']['link_id'], {}).get('luokka') in luokat
                            and luokitus[f['properties']['link_id']]['tila'] != 'suunniteltu')
                           for f in linkit])
        if not reitti.any():
            pros[taso] = np.zeros(len(rak))
            for r in RAJAUS:
                tulos['rajaus'][r][taso] = None
            continue
        d = dijkstra(vierus, {n for i in np.flatnonzero(reitti) for n in ab[i]})
        da = np.array([d.get(a, math.inf) for a, _ in ab])
        db = np.array([d.get(b, math.inf) for _, b in ab])
        Ln = np.array(L)
        m = np.minimum(sij + da[li], Ln[li] - sij + db[li])
        m[reitti[li]] = 0.0
        p = np.clip(1 - m / MAKS, 0, 1)
        pros[taso] = p
        for r in RAJAUS:
            k = maski[r]
            tulos['rajaus'][r][taso] = tunnusluvut(p[k], m[k], rak[k, 2])
    os.makedirs(f'{JUURI}/data/lahibaana', exist_ok=True)
    # Kartta (viz/lahibaana.html): verkko taustaksi, reittilinkit luokittain
    # (0 baana, 1 pää, 2 alue; +3 = suunniteltu) ja rakennukset prosentteineen.
    koodi_l = {'baana': 0, 'paareitti': 1, 'aluereitti': 2}
    verkko, reitit = [], []
    for f in dr['features']:
        c = [[round(p[0]), round(p[1])] for p in f['geometry']['coordinates']]
        r = luokitus.get(f['properties']['link_id'])
        if r:
            reitit.append([koodi_l[r['luokka']] + 3 * (r['tila'] == 'suunniteltu'), c])
        else:
            verkko.append([int(f['properties']['linkkityyp'] == 8), c])
    rivit = [[int(x), int(y), int(a), int(k)] + [round(float(pros[t][j]) * 100) for t in TASOT]
             + [int(alue[j])] for j, (x, y, a, k) in enumerate(rak)]
    json.dump({'nimi': dr['nimi'], 'tasot': [t for t in TASOT if tulos['rajaus']['kunta'][t] is not None],
               'verkko': verkko, 'reitit': reitit, 'rak': rivit},
              gzip.open(f'{JUURI}/data/lahibaana/{koodi}.json.gz', 'wt'), separators=(',', ':'))
    tulos['ruudut'] = ruudut(rak, pros['paa'])
    return dr['nimi'], tulos


def ruudut(rak, p):
    r = collections.defaultdict(lambda: np.zeros(5))   # ala, ala*p, ala*x, ala*y, n
    for (x, y, a, _), v in zip(rak, p):
        a = max(a, 1.0)
        r[(int(x // RUUTU), int(y // RUUTU))] += [a, a * v, a * x, a * y, 1]
    out = [{'x': round(q[2] / q[0]), 'y': round(q[3] / q[0]), 'p': round(q[1] / q[0] * 100, 1),
            'ala': round(q[0]), 'n': int(q[4]), 'rx': i * RUUTU, 'ry': j * RUUTU}
           for (i, j), q in r.items()]
    return sorted(out, key=lambda o: (o['p'], -o['ala']))


if __name__ == '__main__':
    luok = json.load(open(f'{JUURI}/data/reitit/linkit.json'))
    taaj = taajamat()
    kaikki = {}
    for koodi in sorted(luok):
        nimi, r = kunta(koodi, luok[koodi], taaj)
        kaikki[koodi] = {'nimi': nimi, **r}
    ruutu = {k: r.pop('ruudut') for k, r in kaikki.items()}
    json.dump(kaikki, open(f'{JUURI}/data/lahibaana.json', 'w'), ensure_ascii=False, indent=1)

    # Etusivulle: pääreitti tai parempi, koko kunta. Muut kaupungit null.
    kpol = f'{JUURI}/viz/kaupungit.json'
    K = json.load(open(kpol))
    for k in K:
        r = kaikki.get(f"{int(k['koodi']):03d}")
        q = r and r['rajaus']['kunta']['paa']
        k['lahibaana'] = q and q['painotettu']
        k['lahiMed'] = q and q['mediaaniM']
        k['lahiKiinni'] = q and q['kiinni']
        k['lahiYli2'] = q and q['yli2km']
        k['lahiRak'] = r and r['rakennuksia']
        k['lahiRuudut'] = ruutu[f"{int(k['koodi']):03d}"] if r else []
    json.dump(K, open(kpol, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'\nliitetty viz/kaupungit.json ({len(json.dumps(K)) / 1e6:.1f} MB)')

    v = lambda x: '     -' if x is None else f'{x["painotettu"]:>5.0f}%'
    print(f'{"":<14}{"keskustaajama":<22}' + ''.join(f'{r:>22}' for r in RAJAUS))
    print(f'{"":<14}{"":<22}' + '  ala  baana  pää alue' * 3)
    for k, r in sorted(kaikki.items(), key=lambda kv: -kv[1]['rajaus']['keskus']['paa']['painotettu']):
        print(f'{r["nimi"]:<14}{r["keskustaajama"][:21]:<22}' + ''.join(
            f'{q["alaOsuus"]:>4.0f}%' + ''.join(v(q[t]) for t in TASOT)
            for q in (r['rajaus'][x] for x in RAJAUS)))
