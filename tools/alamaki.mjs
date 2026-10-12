#!/usr/bin/env node
/**
 * Onko alamaen pohjalla risteys, ja onko pyorailijalla siina etuajo-oikeus?
 *
 * KYSYMYS. Pyorailija saapuu alamaesta vauhdilla risteykseen. Jos han on
 * etuajo-oikeutettu, han voi ajaa lapi pysahtymatta - mika on sujuvaa mutta
 * edellyttaa etta autoilija nakee hanet. Jos han on vaistamisvelvollinen, hanen
 * on jarrutettava vauhdista. Kumpi tahansa, risteyksen tyyppi maaraa.
 *
 * ETUAJO-OIKEUS EI LUE PYORATIEN MERKISTA vaan risteavan ajoradan merkista.
 * Tieliikennelain (2020) mukaan kuljettaja vaistaa pyorailijaa pyoratien
 * jatkeella kaantyessaan; suoraan ajettaessa pyorailija vaistaa, PAITSI jos
 * ajoradalla on B5 (kolmio) tai B6 (STOP). Siksi mittaus etsii kolmion
 * risteavalta autotielta eika merkkia pyoratielta.
 *
 * Tama ratkaisi aineisto-ongelman. B7 "vaistamisvelvollisuus pyorailijan
 * tienylityspaikassa" on uusi merkki ja sita on kirjattu vahan - Jyvaskylassa
 * 19 kappaletta. B5 sen sijaan on vanha ja runsas: samassa kunnassa 1 845,
 * joista 1 531 muokattu 2026. Rekisteri ei siis ole vanhentunut, B7 on
 * harvinainen - ja kysymykseen ei tarvita sita.
 *
 * KATTAVUUS RAJAA TAMAN KAHDEKSAAN KAUPUNKIIN. Digiroadin oma
 * dr_liikennemerkit_kattavuus luokittelee kunnat: luokka 1 tarkoittaa kattavaa
 * aineistoa. Vertailun 20 kaupungista luokassa 1 ovat Helsinki (44 merkkia/km),
 * Jyvaskyla 28, Vaasa 27, Joensuu 22, Mikkeli 20, Salo 20, Rovaniemi 19 ja
 * Pori 17. Loput 12 ovat luokassa 3 eli 0-1 merkkia/km: niista ei saa mitaan.
 * Koko maassa luokassa 1 on 137 kuntaa 294:sta.
 *
 *   node tools/alamaki.mjs [--raja 25] [--min-h 2]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ketjuta, nousut, sol, d2 } from './korkeus.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : +process.argv[i + 1]; };
const RAJA  = arg('--raja', 25);     // nain lahella pohjaa risteys on "maen jalkeen"
const MIN_H = arg('--min-h', 2);     // merkitseva alamaki, m
const MERKKI_ET = 30;                // merkki kuuluu risteykseen nain lahella
const juuri = new URL('..', import.meta.url).pathname;

const KAUPUNGIT = { '091': 'Helsinki', '179': 'Jyväskylä', '905': 'Vaasa', '167': 'Joensuu',
                    '491': 'Mikkeli', '734': 'Salo', '698': 'Rovaniemi', '609': 'Pori' };

function ruudukko(pisteet, solu = 40) {
  const R = new Map();
  for (const p of pisteet) {
    const k = `${Math.floor(p.x / solu)}_${Math.floor(p.y / solu)}`;
    if (!R.has(k)) R.set(k, []); R.get(k).push(p);
  }
  return (x, y, sade) => {
    const cx = Math.floor(x / solu), cy = Math.floor(y / solu), r = Math.ceil(sade / solu);
    const osumat = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++)
      for (const p of R.get(`${cx+i}_${cy+j}`) ?? [])
        if (Math.hypot(p.x - x, p.y - y) <= sade) osumat.push(p);
    return osumat;
  };
}

function kaupunki(koodi, nimi) {
  const d = JSON.parse(gunzipSync(readFileSync(`${juuri}data/kunnat/${koodi}.geojson.gz`), 'utf8'));
  const merkit = JSON.parse(gunzipSync(readFileSync(`${juuri}data/merkit/${koodi}.json.gz`), 'utf8'));
  let valot = [];
  try { valot = JSON.parse(gunzipSync(readFileSync(`${juuri}data/valot/${koodi}.json.gz`), 'utf8')); } catch {}

  const tyyppi = new Map();                 // link_id -> linkkityyp
  const kevyt = [], solmu = new Map();      // solmu -> { kevyita, autoja }
  for (const f of d.features) {
    if (f.geometry?.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
    const pr = f.properties, c = f.geometry.coordinates;
    tyyppi.set(pr.link_id, pr.linkkityyp);
    for (const e of [c[0], c[c.length - 1]]) {
      const n = sol(e);
      if (!solmu.has(n)) solmu.set(n, { x: e[0], y: e[1], kevyita: 0, autoja: 0 });
      const s = solmu.get(n); pr.linkkityyp === 8 ? s.kevyita++ : s.autoja++;
    }
    if (pr.linkkityyp === 8 && c.every(q => q.length >= 3 && q[2] != null))
      kevyt.push({ id: pr.link_id, c });
  }
  // Risteys = solmu jossa kevytvayla kohtaa autotien. Se on se paikka jossa
  // etuajo-oikeudesta ylipaataan on kysymys.
  const ylitykset = [...solmu.values()].filter(s => s.kevyita >= 1 && s.autoja >= 1);
  const ylitysEt = ruudukko(ylitykset);
  const valoEt = ruudukko(valot);

  // Vain autotiella olevat vaistamismerkit: kolmio on risteavalla ajoradalla.
  const kolmiot = merkit.filter(m => (m.tyyppi === 'B5' || m.tyyppi === 'B6')
                                  && tyyppi.get(m.link_id) !== 8);
  const b7 = merkit.filter(m => (m.tyyppi || '').startsWith('B7'));
  const kolmioEt = ruudukko(kolmiot), b7Et = ruudukko(b7);

  const luokita = (x, y) => {
    if (kolmioEt(x, y, MERKKI_ET).length) return 'etuajo';     // autoilija vaistaa
    if (valoEt(x, y, RAJA).length)        return 'valo';
    if (b7Et(x, y, MERKKI_ET).length)     return 'vaista';     // pyorailija vaistaa, merkitty
    return 'merkitsematon';
  };

  // Alamaki = nousu kaannetyssa ketjussa. Sen ALKU (ax, ay) on pohja.
  const ketjut = ketjuta(kevyt);
  const alamaet = ketjut.flatMap(c => nousut(c.slice().reverse()))
                        .filter(n => n.H >= MIN_H);
  const t = { nimi, alamaet: alamaet.length, risteyksia: 0,
              etuajo: 0, valo: 0, vaista: 0, merkitsematon: 0, kohteet: [] };
  for (const n of alamaet) {
    const lahi = ylitysEt(n.ax, n.ay, RAJA);
    if (!lahi.length) continue;
    t.risteyksia++;
    const lk = luokita(n.ax, n.ay);
    t[lk]++;
    t.kohteet.push({ x: Math.round(n.ax), y: Math.round(n.ay), H: +n.H.toFixed(1),
                     L: Math.round(n.L), lk, g: n.g });
  }

  // KONTROLLI: sama luokitus satunnaisilla ylityksilla. Ilman tata ei tieda
  // onko alamaen pohja erilainen vai onko koko kaupunki sellainen.
  const otos = ylitykset.length > 600
    ? ylitykset.filter((_, i) => i % Math.ceil(ylitykset.length / 600) === 0) : ylitykset;
  const k = { etuajo: 0, valo: 0, vaista: 0, merkitsematon: 0 };
  for (const s of otos) k[luokita(s.x, s.y)]++;
  t.kontrolli = { n: otos.length, ...k };
  t.ylityksia = ylitykset.length;
  t.kolmioita = kolmiot.length;
  return t;
}

const rivit = Object.entries(KAUPUNGIT).map(([k, n]) => kaupunki(k, n));
const pros = (a, b) => b ? (a / b * 100).toFixed(0).padStart(5) + ' %' : '      —';
console.log(`alamaki >= ${MIN_H} m, risteys <= ${RAJA} m pohjasta\n`);
console.log(`${'kaupunki'.padEnd(12)}${'alamakia'.padStart(10)}${'risteys'.padStart(9)}` +
  `${'ETUAJO'.padStart(9)}${'valo'.padStart(9)}${'väistä'.padStart(9)}${'merkitsemätön'.padStart(15)}`);
console.log('-'.repeat(73));
for (const r of rivit.sort((a, b) => b.etuajo / b.risteyksia - a.etuajo / a.risteyksia))
  console.log(`${r.nimi.padEnd(12)}${String(r.alamaet).padStart(10)}${String(r.risteyksia).padStart(9)}` +
    `${pros(r.etuajo, r.risteyksia)}${pros(r.valo, r.risteyksia)}${pros(r.vaista, r.risteyksia)}` +
    `${pros(r.merkitsematon, r.risteyksia)}`);
const S = k => rivit.reduce((a, r) => a + r[k], 0);
console.log('-'.repeat(73));
console.log(`${'YHTEENSÄ'.padEnd(12)}${String(S('alamaet')).padStart(10)}${String(S('risteyksia')).padStart(9)}` +
  `${pros(S('etuajo'), S('risteyksia'))}${pros(S('valo'), S('risteyksia'))}` +
  `${pros(S('vaista'), S('risteyksia'))}${pros(S('merkitsematon'), S('risteyksia'))}`);

console.log('\nKONTROLLI — sama luokitus satunnaisilla kevytväylän ylityksillä');
console.log(`${'kaupunki'.padEnd(12)}${'otos'.padStart(7)}${'etuajo'.padStart(9)}` +
  `${'alamäessä'.padStart(11)}${'rikastuma'.padStart(11)}`);
console.log('-'.repeat(50));
for (const r of rivit) {
  const a = r.etuajo / (r.risteyksia || 1), b = r.kontrolli.etuajo / (r.kontrolli.n || 1);
  console.log(`${r.nimi.padEnd(12)}${String(r.kontrolli.n).padStart(7)}` +
    `${(b * 100).toFixed(0).padStart(8)} %${(a * 100).toFixed(0).padStart(10)} %` +
    `${b ? (a / b).toFixed(2).padStart(11) : '          —'}`);
}
writeFileSync(`${juuri}data/alamaki.json`, JSON.stringify(rivit));
console.log(`\n-> data/alamaki.json`);
