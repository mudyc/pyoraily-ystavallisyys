#!/usr/bin/env python3
"""
Talvihoidon ohjeiden vertailu -> viz/kaupungit.json.

Lähde on käsin koottu data/talvi.json: jokaiselle kaupungille yhdeksän
kriteerin arvio (kyllä / osittain / ei / ei tietoa), lyhyt perustelu ja
viitteet. Pisteet: kyllä 1, osittain 0,5, muut 0; prosentti = summa / 9.
Oulun malli antaa kriteerit mutta ei pisteitä: Oulu arvioidaan omista julkisista
asiakirjoistaan kuten muut. Hyvän käytännön pitää olla myös julkinen.

"Ei tietoa" on 0, koska mittari arvioi kaupungin JULKISTA sitoutumista:
laatuvaatimus, jota ei julkaista, ei sido ketään eikä sitä voi tarkistaa.

  tools/talvi.py -> viz/kaupungit.json (kentät talvi, talviK)
"""
import json
import os

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PISTE = {'kyllä': 1.0, 'osittain': 0.5, 'ei': 0.0, 'ei tietoa': 0.0}

if __name__ == '__main__':
    T = json.load(open(f'{JUURI}/data/talvi.json'))
    n = len(T['kriteerit'])
    kpol = f'{JUURI}/viz/kaupungit.json'
    K = json.load(open(kpol))
    for k in K:
        c = T['kaupungit'].get(k['nimi'])
        if not c:
            k['talvi'], k['talviK'] = None, None
            continue
        s = sum(PISTE[v[0]] for v in c['K'].values())
        k['talvi'] = round(s / n * 100, 1)
        k['talviK'] = {kr: v[0] for kr, v in sorted(c['K'].items(), key=lambda kv: int(kv[0][1:]))}
        print(f"{k['nimi']:<14}{k['talvi']:>6.1f} %")
    json.dump(K, open(kpol, 'w'), ensure_ascii=False, separators=(',', ':'))
