#!/usr/bin/env python3
"""
Hae Ryhdistä (SYKE, CC BY 4.0) kaupunkien asuinrakennukset.

Lähde: OGC API Features, kokoelma avoimet_rakennukset (valmiit rakennukset).
Mukaan otetaan käytössä olevat Pientalot ja Kerrostalot; vapaa-ajan
asunnot jäävät pois. Paino on huoneistoala (m²); jos se puuttuu, kerrosala.

  tools/ryhti.py [koodi ...] -> data/rakennukset/<koodi>.json.gz
    [[x, y, ala, k], ...]  EPSG:3067, k = 1 kerrostalo, 0 pientalo
"""
import glob
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request

from pyproj import Transformer

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = ('https://paikkatiedot.ymparisto.fi/geoserver/ryhti_building/ogc/features/v1/'
       'collections/avoimet_rakennukset/items')
SIVU = 10000
TR = Transformer.from_crs(4326, 3067, always_xy=True)


def hae(nimi):
    suodin = (f"kunta='{nimi}' AND elinkaaren_tila='Käytössä' AND "
              "paaasiallinen_kayttotarkoitus IN ('Pientalo','Kerrostalo')")
    out, alku = [], 0
    while True:
        q = urllib.parse.urlencode({'f': 'json', 'limit': SIVU, 'startIndex': alku,
                                    'filter': suodin, 'filter-lang': 'cql-text'})
        d = json.load(urllib.request.urlopen(f'{URL}?{q}', timeout=300))
        for f in d['features']:
            p, g = f['properties'], f.get('geometry')
            if not g:
                continue
            ala = p.get('huoneistoala') or p.get('kerrosala') or 0
            x, y = TR.transform(*g['coordinates'][:2])
            out.append([round(x, 1), round(y, 1), round(ala),
                        int(p['paaasiallinen_kayttotarkoitus'] == 'Kerrostalo')])
        alku += len(d['features'])
        if len(d['features']) < SIVU:
            return out


if __name__ == '__main__':
    koodit = [int(a) for a in sys.argv[1:]] or None
    os.makedirs(f'{JUURI}/data/rakennukset', exist_ok=True)
    for polku in sorted(glob.glob(f'{JUURI}/data/kunnat/*.geojson.gz')):
        koodi = int(os.path.basename(polku)[:3])
        if koodit and koodi not in koodit:
            continue
        with gzip.open(polku) as fh:   # nimi on tiedoston alussa, ei tarvita koko verkkoa
            alku = fh.read(300).decode('utf-8', 'replace')
        nimi = json.loads(alku[:alku.index('"features"')].rstrip(', ') + '}')['nimi']
        r = hae(nimi)
        json.dump(r, gzip.open(f'{JUURI}/data/rakennukset/{koodi:03d}.json.gz', 'wt'))
        print(f'{nimi:<14}{len(r):>7} rakennusta {sum(x[2] for x in r) / 1e6:6.1f} milj. m²'
              f'  (ala puuttuu {sum(1 for x in r if not x[2])})')
