#!/usr/bin/env node
/**
 * Digiroadin tielinkit -> L0-dokumentteja, kahta lajia samassa artefaktissa.
 *
 *   linkki   geometria ja ominaisuudet sellaisenaan
 *   risteys  solmu johon liittyy kolme tai useampi linkinpää
 *
 * Risteykset lasketaan tässä eikä kyselyssä. Syy on sama kuin kaikessa muussakin
 * tämän indeksin suunnittelussa: solmuasteen johtaminen vaatii koko verkon
 * lukemisen, ja koko verkon lukeminen on se mitä klusterointiavain on olemassa
 * välttämään. Kun risteys on dokumentti, "kuinka kaukana on seuraava risteys"
 * on tavuväli eikä graafikävely.
 *
 * Klusterointiavain on `(kunta, laji) * 4^order + hilbert(keskipiste)`. Korkeat
 * bitit tekevät yhdestä kaupungista ja yhdestä lajista yhtenäisen lohkon, koska
 * tutkielma tehdään kaupunki kerrallaan; matalat bitit pitävät naapurit vierekkäin,
 * jolloin "lähin risteys tästä pisteestä" on kourallinen peräkkäisiä välejä.
 *
 * Solmujen yhdistämistarkkuus on 0,6 m. Digiroadin linkinpäät eivät ole
 * bittitarkasti samoja, mutta ne eivät myöskään ole yli puolen metrin päässä
 * toisistaan silloin kun ne tarkoittavat samaa solmua.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { encodeParts } from '../src/geom.js';
import { gridder } from '../src/hilbert.js';

export const ORDER = 18;                                   // ~2,7 m ruutu Suomen laajuudella
export const EXTENT = { minx: 50000, miny: 6570000, maxx: 760000, maxy: 7800000 };
export const SPAN = 2 ** (2 * ORDER);
const TARK = 0.6;                                          // solmujen yhdistämistarkkuus, m

const grid = gridder(ORDER, EXTENT);
const solmuAvain = (x, y) => `${Math.round(x / TARK)}_${Math.round(y / TARK)}`;

export function* lue(hakemisto) {
  const tiedostot = readdirSync(hakemisto).filter(f => f.endsWith('.geojson.gz')).sort();
  let ci = 0;
  for (const t of tiedostot) {
    const d = JSON.parse(gunzipSync(readFileSync(`${hakemisto}/${t}`), 'utf8'));
    const kunta = d.kuntakoodi, nimi = d.nimi;
    const linkkiCi = ci++, risteysCi = ci++;

    // Ensimmäinen kierros: linkit ulos ja solmuasteet kasaan samalla.
    const asteet = new Map();                              // solmu -> { n, kevyita, z }
    for (const f of d.features) {
      const g = f.geometry;
      if (!g || g.type !== 'LineString' || g.coordinates.length < 2) continue;
      const c = g.coordinates;
      const p = f.properties;
      for (const pää of [c[0], c[c.length - 1]]) {
        const k = solmuAvain(pää[0], pää[1]);
        const a = asteet.get(k) ?? { n: 0, kevyita: 0, x: pää[0], y: pää[1], z: pää[2] ?? null };
        a.n++; if (p.linkkityyp === 8) a.kevyita++;
        asteet.set(k, a);
      }
      // Keskipiste avainta varten: geometrian keskimmäinen piste riittää ja on halpa.
      const m = c[Math.floor(c.length / 2)];
      yield {
        laji: 'linkki', kunta, kuntanimi: nimi,
        avain: linkkiCi * SPAN + grid(m[0], m[1]),
        link_id: p.link_id,
        linkkityyp: p.linkkityyp, silta_alik: p.silta_alik,
        toiminn_lk: p.toiminn_lk, hallinn_lk: p.hallinn_lk, ajosuunta: p.ajosuunta,
        tienimi: p.tienimi_su || null,
        // Geometria 2D delta-varinttina; Z erikseen, koska koodekki on tasogeometrialle
        // ja pystynäkemä tarvitsee korkeudet pisteittäin.
        geom: encodeParts([c.map(q => [q[0], q[1]])]),
        z: c.map(q => Math.round((q[2] ?? 0) * 10)),        // desimetriä, kokonaislukuna
        pituus: Math.round(pituus(c) * 10) / 10,
      };
    }
    // Toinen kierros: risteykset omina dokumentteinaan.
    for (const [, a] of asteet) {
      if (a.n < 3) continue;                               // kahden linkin jatko ei ole risteys
      yield {
        laji: 'risteys', kunta, kuntanimi: nimi,
        avain: risteysCi * SPAN + grid(a.x, a.y),
        x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10,
        z: a.z == null ? null : Math.round(a.z * 10) / 10,
        aste: a.n,                                          // liittyviä linkinpäitä
        kevyita: a.kevyita,                                 // niistä kevyen liikenteen väyliä
      };
    }
  }
}

function pituus(c) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i-1][0], c[i][1] - c[i-1][1]);
  return s;
}
