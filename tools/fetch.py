#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Digiroadin tielinkit suurimmista kaupungeista OGC API Features -rajapinnasta.

Yksi pyyntö kaupunkia kohti. Rajapinnan `offset` ei toimi - se palauttaa aina
saman sivun - joten sivutusta ei voi kayttaa, vaan koko kaupunki haetaan
yhdella isolla `limit`-arvolla. Siksi myos kuntaraja on se jakoperuste.

Koordinaatisto on EPSG:3067 (ETRS-TM35FIN), jotta etaisyydet ovat metreja
suoraan. Geometria on 3D: Z tulee mukaan ja sita tarvitaan pystynakemiin.

Yllapito on siirtynyt Fintrafficin PETI-jarjestelmaan; Vaylaviraston avoin
rajapinta on jaadytetty kevaaseen 2026. Tama haku dokumentoi sen tilanteen.

  tools/fetch.py [kaupunkeja]
"""
import gzip, json, os, sys, time, urllib.parse, urllib.request

API = 'https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ogc/features/v1/collections'
# Linkkitaulu (kaikki tielinkkien ominaisuuskokoelmat ovat sama taulu) ja
# liikennevalot, jotka ovat pisteita linkilla - mittari "maen jalkeen ei saisi
# olla valoristeysta" tarvitsee molemmat.
KOKOELMAT = {'linkit': 'dr_tielinkki_silta_alikulku_tunneli', 'valot': 'dr_liikennevalo',
             'pysakit': 'dr_pysakki'}
B = f'{API}/{KOKOELMAT["linkit"]}/items'
JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAESTO = os.path.expanduser('~/proj/oma/ajoneuvorekisteri/viz/data/vaesto2025.json')

def kaupungit(n):
    v = json.load(open(VAESTO))
    top = sorted(v['kunnat'].items(), key=lambda kv: -kv[1])[:n]
    return [(int(k), v['nimet'][k], a) for k, a in top]

def hae(koodi, kokoelma='linkit'):
    # Rajapinnan `offset` ei toimi - se palauttaa aina saman sivun - joten koko
    # kunta haetaan yhdella isolla limitilla eika sivuteta.
    p = {'filter': f'kuntakoodi={koodi}', 'filter-lang': 'cql2-text', 'limit': 200000,
         'crs': 'http://www.opengis.net/def/crs/EPSG/0/3067', 'f': 'application/geo+json'}
    url = f'{API}/{KOKOELMAT[kokoelma]}/items?' + urllib.parse.urlencode(p)
    with urllib.request.urlopen(url, timeout=300) as r:
        return json.load(r)

if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    os.makedirs(f'{JUURI}/data/kunnat', exist_ok=True)
    yht = 0
    for koodi, nimi, asukkaita in kaupungit(n):
        ulos = f'{JUURI}/data/kunnat/{koodi:03d}.geojson.gz'
        if os.path.exists(ulos):
            print(f'  {nimi:<14} ohitettu (on jo)'); continue
        t = time.time(); d = hae(koodi)
        f = d.get('features', [])
        if len(f) != d.get('numberMatched'):
            print(f'  {nimi:<14} VAROITUS {len(f)}/{d.get("numberMatched")} - limit ei riittanyt')
        with gzip.open(ulos, 'wt', encoding='utf-8') as fh:
            json.dump({'kuntakoodi': koodi, 'nimi': nimi, 'asukkaita': asukkaita,
                       'features': f}, fh)
        yht += len(f)
        print(f'  {nimi:<14} {len(f):>7} linkkia  {os.path.getsize(ulos)/1e6:>6.1f} MB  {time.time()-t:>5.1f} s')
    print(f'\nyhteensa {yht:,} linkkia')
