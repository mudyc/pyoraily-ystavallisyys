#!/usr/bin/env python3
"""
Pyöräilyn baanat, pääreitit ja aluereitit kaupunkien omista aineistoista.

Kaupungit luokittelevat verkkonsa eri tavoin: baana on omana luokkanaan vain
Helsingissä, Espoossa, Vantaalla ja Oulussa, Tampereella ylin taso on
"seudullinen pääreitti" ja Turussa "lähireitti" on alin. Yhteinen kieli on
siksi kolme luokkaa (baana / paareitti / aluereitti) ja alkuperäinen luokka
kulkee mukana kentässä `alkup`, jotta kartoituksen voi tarkistaa.

Tila on yhtä tärkeä kuin luokka. Moni aineisto on *tavoiteverkko*, ja siinä on
rakentamattomia osuuksia. Ilman erottelua mittari palkitsisi suunnitelmista:
  olemassa     - aineisto kuvaa nykyverkkoa tai osuus on merkitty nykytilaksi
  suunniteltu  - aineisto merkitsee osuuden uudeksi / suunnitteilla olevaksi
  tavoite      - tavoiteverkko, jossa rakennettua ja suunniteltua ei eroteta

Tuloste: data/reitit/<kuntakoodi>.geojson.gz, EPSG:3067.
Raakadata: data/reitit/raw/ (ei versionhallinnassa).

Vaasa tulee OpenStreetMapista (rcn-reitit 1-7 "Keskusta - X", jotka vastaavat
kaupungin opastettuja pääreittejä) ja vaatii Suomen OSM-otteen:
  tools/reitit.py --osm finland.osm.pbf
Vaasan tiedosto on ODbL-lisensoitu (© OpenStreetMapin tekijät) ja pidetään
erillään muusta aineistosta: data/reitit/905.osm.geojson.gz.

Jyväskylän pää- ja aluereitit ovat vain karttapalvelun kuvatiilinä ja
Ouluun, Kuopioon, Lahteen ja PDF-kaupunkeihin ei ole koneluettavaa lähdettä;
ks. README.

Riippuvuudet: pyproj, pyshp; Vaasaan lisäksi osmium (pyosmium).
"""
import gzip
import io
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from pyproj import Transformer

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = f'{JUURI}/data/reitit/raw'
ULOS = f'{JUURI}/data/reitit'
GML = '{http://www.opengis.net/gml}'
# Oulun pää- ja aluereitit ovat GK26:ssa ilman kaistanumeroa (x_0 = 500000),
# joten EPSG:3880 (x_0 = 26 500 000) heittäisi ne 26 000 km sivuun.
GK26_ILMAN_KAISTAA = '+proj=tmerc +lat_0=0 +lon_0=26 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'


def wfs2(base, layer):
    q = {'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': layer,
         'outputFormat': 'application/json', 'srsName': 'EPSG:3067'}
    return f'{base}?{urllib.parse.urlencode(q)}'


def tekla(base, layer):
    # Teklan WFS katkaisee oletuksena 1 000 kohteeseen (Turku) - raja nostetaan.
    q = {'service': 'WFS', 'version': '1.1.0', 'request': 'GetFeature', 'typeName': layer,
         'maxFeatures': 500000}
    return f'{base}?{urllib.parse.urlencode(q)}'


HEL = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs'
LAHTEET = {
    'hel_paa': wfs2(HEL, 'avoindata:Pyorailykartta_2026_paapyorareitti'),
    'hel_paa_ajorata': wfs2(HEL, 'avoindata:Pyorailykartta_2026_paapyorareitti_ajorataa_pitkin'),
    'hel_muu': wfs2(HEL, 'avoindata:Pyorailykartta_2026_muu_pyorareitti'),
    'hel_muu_ajorata': wfs2(HEL, 'avoindata:Pyorailykartta_2026_muu_pyorareitti_ajorataa_pitkin'),
    'hel_baanat.zip': 'https://www.hel.fi/hel2/tietokeskus/data/helsinki/ksv/baanat.zip',
    'esp.gml': tekla('https://kartat.espoo.fi/teklaogcweb/wfs.ashx', 'GIS:Keskilinjat'),
    'van': wfs2('https://gis.vantaa.fi/geoserver/wfs', 'liikenne:liikenne_pyoratiet_tavoiteverkko'),
    'tre': wfs2('https://geodata.tampere.fi/geoserver/wfs',
                'liikenneverkot:pyorailyn_tavoiteverkko_line_gk24_julk_gsview'),
    'tku_paa.gml': tekla('https://turku.asiointi.fi/TeklaOGCWeb/WFS.ashx', 'GIS:Pyorailyverkoston_paareitti'),
    'tku_seutu.gml': tekla('https://turku.asiointi.fi/TeklaOGCWeb/WFS.ashx', 'GIS:Seudullinen_pyorailyreitti'),
    'tku_lahi.gml': tekla('https://turku.asiointi.fi/TeklaOGCWeb/WFS.ashx', 'GIS:Pyorailyverkoston_lahireitti'),
    'oulu_baana.zip': 'https://avoindata.suomi.fi/data/dataset/74d3f0b2-7f67-4089-95e0-c2174aa256c8/resource/003807a2-75fd-404f-b73c-ee4d8c438e05/download/baanaverkko.shp.zip',
    'oulu_paa.zip': 'https://avoindata.suomi.fi/data/dataset/d2ba0440-1bee-47d9-9e7a-8c33a4eb879b/resource/f1812df3-6b9b-43d1-a6b5-ea5efb0b4772/download/paa_ja_aluereitit.zip',
    'joe': wfs2('https://geoserver.joensuu.fi/geoserver/ows', 'pyoraily:paaverkko2023'),
    'lpr.geojson': 'https://avoindata.suomi.fi/data/dataset/e13d0ddd-3b77-4ce2-954c-9ca06508470e/resource/58597085-afcf-407e-8a3a-6b1cdfa743d1/download/pyorailyreitit_lpr.geojson',
}


def hae(nimi):
    polku = f'{RAW}/{nimi}' + ('' if '.' in nimi else '.json')
    if not os.path.exists(polku):
        print(f'  haetaan {nimi}', flush=True)
        try:
            with urllib.request.urlopen(LAHTEET[nimi], timeout=900) as r, open(polku + '.osa', 'wb') as f:
                while b := r.read(1 << 20):
                    f.write(b)
        except urllib.error.HTTPError as e:
            # Trimblen asiointi.fi-palvelut (Turku, Jyväskylä) hylkäävät
            # Pythonin oletustunnisteen. Tunnistetta ei naamioida; haku käsin.
            sys.exit(f'{nimi}: HTTP {e.code}. Hae käsin ja aja uudelleen:\n'
                     f'  curl -sL -o "{polku}" "{LAHTEET[nimi]}"')
        os.replace(polku + '.osa', polku)
    return polku


# ---- lukijat -> [(props, [[(x, y), ...], ...])] EPSG:3067 ------------------

_tr = {}


def proj(lines, crs):
    if crs in (3067, None):
        return [[tuple(p[:2]) for p in c] for c in lines]
    if crs not in _tr:
        _tr[crs] = Transformer.from_crs(crs, 3067, always_xy=True)
    out = []
    for c in lines:
        xs, ys = _tr[crs].transform([p[0] for p in c], [p[1] for p in c])
        out.append(list(zip(xs, ys)))
    return out


def lue_geojson(polku, crs=None):
    d = json.load(open(polku, encoding='utf-8'))
    if crs is None:
        n = (d.get('crs') or {}).get('properties', {}).get('name', '')
        crs = int(re.findall(r'(\d+)$', n)[0]) if n else 4326
    for f in d['features']:
        g = f.get('geometry')
        if not g:
            continue
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates'] \
            if g['type'] == 'MultiLineString' else []
        lines = [c for c in lines if len(c) > 1]
        if lines:
            yield f['properties'], proj(lines, crs)


def _gml_viivat(geom):
    out = []
    for ls in geom.iter():
        if ls.tag not in (GML + 'LineString', GML + 'LineStringSegment'):
            continue
        pl = ls.find(GML + 'posList')
        if pl is not None:
            v = [float(a) for a in pl.text.split()]
            dim = int(pl.get('srsDimension', 2))
            c = [(v[i], v[i + 1]) for i in range(0, len(v), dim)]
        else:  # Espoo: pos-jono
            c = [tuple(float(a) for a in p.text.split()[:2]) for p in ls.findall(GML + 'pos')]
        if len(c) > 1:
            out.append(c)
    return out


def lue_gml(polku, keep=None):
    """Tekla-GML. Koordinaatisto dokumentin ensimmäisestä srsName-attribuutista."""
    crs = None
    for ev, el in ET.iterparse(polku, events=('start', 'end')):
        if crs is None and ev == 'start' and el.get('srsName'):
            crs = int(re.findall(r'(\d+)$', el.get('srsName'))[0])
        if ev != 'end' or el.tag != GML + 'featureMember':
            continue
        props, lines = {}, []
        for ch in el[0]:
            if len(ch):
                lines.extend(_gml_viivat(ch))
            else:
                props[ch.tag.split('}')[1]] = ch.text
        el.clear()
        if lines and (keep is None or keep(props)):
            yield props, proj(lines, crs)


def lue_shp(zpolku, crs, enc='utf-8'):
    import shapefile
    z = zipfile.ZipFile(zpolku)
    nimet = {n.rsplit('.', 1)[-1].lower(): n for n in z.namelist()}
    r = shapefile.Reader(shp=io.BytesIO(z.read(nimet['shp'])), shx=io.BytesIO(z.read(nimet['shx'])),
                         dbf=io.BytesIO(z.read(nimet['dbf'])), encoding=enc)
    kentat = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        pts, osat = sr.shape.points, list(sr.shape.parts) + [len(sr.shape.points)]
        lines = [pts[a:b] for a, b in zip(osat, osat[1:]) if b - a > 1]
        yield dict(zip(kentat, sr.record)), proj(lines, crs)


# ---- kaupunkikohtainen luokittelu -------------------------------------------
# Jokainen palauttaa (luokka, tila, alkup) tai None (ei mukaan).

def helsinki():
    for nimi, luokka in (('hel_paa', 'paareitti'), ('hel_paa_ajorata', 'paareitti'),
                         ('hel_muu', 'aluereitti'), ('hel_muu_ajorata', 'aluereitti')):
        for p, ls in lue_geojson(hae(nimi)):
            # Pyöräilykartta 2026 kuvaa nykyverkkoa. "Muu pyöräreitti" on
            # Helsingin alin luokka; lähin vastine muiden aluereitille.
            yield ls, luokka, 'olemassa', p['reittiluokka'], 'hel_pyorailykartta_2026'
    # Baanaverkko on tavoiteverkko: rakennettu ja suunniteltu samassa luokassa.
    for p, ls in lue_shp(hae('hel_baanat.zip'), 3879, 'latin1'):
        t = p['teksti']
        if t == 'Baana':
            yield ls, 'baana', 'tavoite', t, 'hel_baanat'
        elif t in ('Baanavaraus',):
            yield ls, 'baana', 'suunniteltu', t, 'hel_baanat'
        # 'Baana - vaihtoehtoinen väylä' ja 'täydentävä yhteys' jätetään pois


def espoo():
    luokat = {'Baana': 'baana', 'Laatureitti': 'paareitti', 'Pääreitti': 'paareitti',
              'Aluereitti': 'aluereitti'}
    # Keskilinjat ovat olemassa olevia katuosia; hierarkia on niiden ominaisuus.
    for p, ls in lue_gml(hae('esp.gml'), keep=lambda p: p.get('PyorareittiHierarkia') in luokat):
        h = p['PyorareittiHierarkia']
        yield ls, luokat[h], 'olemassa', h, 'esp_keskilinjat'


def vantaa():
    luokat = {'Baana': 'baana', 'Pääreitti I': 'paareitti', 'Pääreitti II': 'paareitti'}
    for p, ls in lue_geojson(hae('van')):
        h = p['hierarkia']
        sulut = h.startswith('(')
        h0 = h.strip('()')
        if h0 not in luokat:
            continue
        uusi = sulut or (p.get('puute_lev') or '').strip() in ('Uusi puuttuva yhteys', 'Yhteystarve',
                                                               'Vaihtoehtoinen linjaus')
        yield ls, luokat[h0], 'suunniteltu' if uusi else 'olemassa', p['hierarkia_selite'], 'van_tavoiteverkko'


def tampere():
    luokat = {'Seudullinen pääreitti': 'paareitti', 'Pääreitti': 'paareitti', 'Aluereitti': 'aluereitti'}
    for p, ls in lue_geojson(hae('tre')):
        k = p['toiminnallinen_luokka']
        if k not in luokat:
            continue
        muutos = p.get('luokan_muutos') or ''
        toimenpide = p.get('vaylan_toimenpide') or ''
        # "Uusi X" = rakentamaton; "Muutos X:ksi" = väylä on, mutta ei vielä tätä luokkaa.
        uusi = muutos.startswith(('Uusi', 'Muutos')) or toimenpide.startswith('Uusi väylä')
        yield ls, luokat[k], 'suunniteltu' if uusi else 'olemassa', k, 'tre_tavoiteverkko'


def turku():
    for p, ls in lue_gml(hae('tku_paa.gml')):
        yield ls, 'paareitti', 'olemassa', 'Pyöräilyverkoston pääreitti', 'tku_paareitti'
    for p, ls in lue_gml(hae('tku_seutu.gml')):
        yield ls, 'paareitti', 'olemassa', f"Seudullinen {p.get('Nimi')}", 'tku_seudullinen'
    for p, ls in lue_gml(hae('tku_lahi.gml')):
        # Turun alin luokka; lähin vastine muiden aluereitille.
        yield ls, 'aluereitti', 'olemassa', 'Pyöräilyverkoston lähireitti', 'tku_lahireitti'


def oulu():
    # Baanaverkko on Web Mercatorissa (prj), pää- ja aluereitit GK26:ssa ilman kaistaa.
    for p, ls in lue_shp(hae('oulu_baana.zip'), 3857):
        s = p['Symbooli']
        if s == 'Baana':
            yield ls, 'baana', 'olemassa', p['Baana'], 'oulu_baanaverkko'
        elif s == 'Suunnitteilla oleva baana':
            yield ls, 'baana', 'suunniteltu', p['Baana'], 'oulu_baanaverkko'
    for p, ls in lue_shp(hae('oulu_paa.zip'), GK26_ILMAN_KAISTAA):
        k = p['reittiluok']
        luokka = 'paareitti' if 'pääreitti' in k.lower() else 'aluereitti'
        yield ls, luokka, 'suunniteltu' if k.startswith('Uusi') else 'olemassa', k, 'oulu_paa_ja_alue'


def joensuu():
    # Koodit tason SLD-tyylistä: luokittelu 1 = pääreitti, 2 = aluereitti.
    for p, ls in lue_geojson(hae('joe')):
        k = p.get('luokittelu')
        if k in ('1', '2'):
            yield ls, 'paareitti' if k == '1' else 'aluereitti', 'olemassa', \
                'Pääreitti' if k == '1' else 'Aluereitti', 'joe_paaverkko2023'


def lappeenranta():
    # Kunnossapitoluokat, eivät erillinen tavoiteverkko.
    for p, ls in lue_geojson(hae('lpr.geojson'), 4326):
        k = p['Layer']
        yield ls, 'paareitti' if 'pääreitti' in k.lower() else 'aluereitti', 'olemassa', k, 'lpr_pyorailyreitit'


def vaasa_osm(pbf):
    import osmium

    class R(osmium.SimpleHandler):
        def __init__(s):
            super().__init__()
            s.rels = {}

        def relation(s, r):
            t = r.tags
            if t.get('route') == 'bicycle' and t.get('network') == 'rcn' \
                    and (t.get('name') or '').startswith('Keskusta - '):
                s.rels[r.id] = (dict(t), [m.ref for m in r.members if m.type == 'w'])

    r = R()
    r.apply_file(pbf)
    tarve = {w for _, ws in r.rels.values() for w in ws}

    class W(osmium.SimpleHandler):
        def __init__(s):
            super().__init__()
            s.g = {}

        def way(s, w):
            if w.id in tarve:
                s.g[w.id] = [(n.lon, n.lat) for n in w.nodes if n.location.valid()]

    w = W()
    w.apply_file(pbf, locations=True, idx='flex_mem')
    for rid, (t, ws) in r.rels.items():
        lines = [w.g[i] for i in ws if len(w.g.get(i, ())) > 1]
        ls = proj(lines, 4326)
        cx = sum(p[0] for c in ls for p in c) / max(1, sum(len(c) for c in ls))
        if not 200000 < cx < 250000:     # muut "Keskusta - X" -reitit Suomessa
            continue
        yield ls, 'paareitti', 'olemassa', f"{t.get('ref')} {t.get('name')}", f'osm_r{rid}'


KAUPUNGIT = {91: helsinki, 49: espoo, 92: vantaa, 837: tampere, 853: turku, 564: oulu,
             167: joensuu, 405: lappeenranta}


def km(ls):
    return sum(math.dist(a, b) for c in ls for a, b in zip(c, c[1:])) / 1000


def kirjoita(koodi, rivit, nimi=None, lisenssi=None):
    feats = [{'type': 'Feature', 'properties': {'luokka': l, 'tila': t, 'alkup': a, 'lahde': s},
              'geometry': {'type': 'MultiLineString',
                           'coordinates': [[[round(x, 2), round(y, 2)] for x, y in c] for c in ls]}}
             for ls, l, t, a, s in rivit]
    polku = f'{ULOS}/{nimi or f"{koodi:03d}.geojson.gz"}'
    d = {'type': 'FeatureCollection', 'kuntakoodi': koodi,
         'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:EPSG::3067'}}, 'features': feats}
    if lisenssi:
        d['lisenssi'] = lisenssi
    with gzip.open(polku, 'wt', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False)
    yht = {}
    for ls, l, t, *_ in rivit:
        yht[(l, t)] = yht.get((l, t), 0) + km(ls)
    print(f'  {koodi:03d} {len(feats):>6} kohdetta  ' +
          '  '.join(f'{l}/{t} {v:.0f} km' for (l, t), v in sorted(yht.items())))


if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    args = sys.argv[1:]
    if '--osm' in args:
        pbf = args[args.index('--osm') + 1]
        kirjoita(905, list(vaasa_osm(pbf)), '905.osm.geojson.gz',
                 'ODbL 1.0, © OpenStreetMap contributors')
    else:
        for koodi, f in KAUPUNGIT.items():
            kirjoita(koodi, list(f()))
