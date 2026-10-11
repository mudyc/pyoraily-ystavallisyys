#!/usr/bin/env node
/**
 * Alikulkujen nakemaalueet, haaran kohteen mukaan luokiteltuna.
 *
 * SAANTO. Risteys lasketaan konfliktipisteeksi vain jos siina kohtaa vahintaan
 * kaksi kevyen liikenteen haaraa. Haara, joka nousee valtatielle (toiminn_lk 1),
 * ei ole Kuvan 4 tarkoittama pyoratieiden keskinainen risteama vaan paatien
 * ylitys, jota koskee eri vaatimus - se jatetaan laskematta.
 *
 * Tama ei ole ramppisaanto. Ramppi, joka vie toiselle kevyen liikenteen
 * vaylalle, ON konfliktipiste ja lasketaan mukaan. Merkitseva on se MIHIN
 * haara johtaa, ei se onko se jyrkka.
 *
 *   node tools/nakemat2.mjs [--vt 1] [--matka 150]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { suodata, kuvaus, saannot, tarkista } from './poikkeukset.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : +process.argv[i + 1]; };
const VT = arg('--vt', 1);            // toiminn_lk <= VT on paatie
const MATKA = arg('--matka', 150);    // kuinka kaukaa haaran kohde etsitaan
const TARK = 0.6;
const juuri = new URL('..', import.meta.url).pathname;

const sol = p => `${Math.round(p[0] / TARK)}_${Math.round(p[1] / TARK)}`;
const pit = c => { let s = 0; for (let i = 1; i < c.length; i++)
  s += Math.hypot(c[i][0] - c[i-1][0], c[i][1] - c[i-1][1]); return s; };

function kaupunki(tiedosto) {
  const d = JSON.parse(gunzipSync(readFileSync(`${juuri}data/kunnat/${tiedosto}`), 'utf8'));
  const L = d.features.filter(f => f.geometry?.type === 'LineString' && f.geometry.coordinates.length >= 2);
  const V = new Map();
  for (const f of L) {
    const g = f.geometry.coordinates;
    for (const [k, e] of [[false, g[0]], [true, g[g.length - 1]]]) {
      const n = sol(e); if (!V.has(n)) V.set(n, []); V.get(n).push([f, k]);
    }
  }
  const ulos = (f, k) => k ? f.geometry.coordinates.slice().reverse() : f.geometry.coordinates;

  /** Johtaako haara paatielle? Seurataan kevytverkkoa kunnes tulee autotie. */
  function paatielle(f0, k0) {
    let f = f0, k = k0, edel = f0.properties.link_id, s = 0;
    for (let i = 0; i < 25; i++) {
      const g = ulos(f, k); s += pit(g);
      const naap = (V.get(sol(g[g.length - 1])) ?? []).filter(([x]) => x.properties.link_id !== edel);
      const autot = naap.filter(([x]) => x.properties.linkkityyp !== 8);
      if (autot.length) return autot.some(([x]) => x.properties.toiminn_lk <= VT) && s <= MATKA;
      if (!naap.length || s > MATKA) return false;
      [f, k] = naap[0]; edel = f.properties.link_id;
    }
    return false;
  }

  const tulos = []; const laskuri = {};
  for (const A of L.filter(f => f.properties.linkkityyp === 8 && f.properties.silta_alik === -1)) {
    const g = A.geometry.coordinates;
    for (const paa of [g[0], g[g.length - 1]]) {
      let n = sol(paa), edel = A.properties.link_id, s = 0, ok = false;
      for (let i = 0; i < 14; i++) {
        const naap = (V.get(n) ?? []).filter(([x]) => x.properties.link_id !== edel);
        if (!naap.length) break;
        // EXCEPTION RULES ratkaisee mitka haarat ovat konflikteja
        const haarat = naap.map(([f, k]) => ({ f, k, tyyp: f.properties.linkkityyp,
          toim: f.properties.toiminn_lk, paatiehen: paatielle(f, k) }));
        const kevyet = suodata('nakema', haarat, laskuri).map(h => [h.f, h.k]);
        if (kevyet.length >= 2) { ok = true; break; }
        // yksi jatko: kavele eteenpain. Jos jaljella ei ole yhtaan, umpikuja.
        const jatko = kevyet.length === 1 ? kevyet[0] : null;
        if (!jatko) break;
        const gg = ulos(jatko[0], jatko[1]); s += pit(gg);
        if (s > 80) break;
        n = sol(gg[gg.length - 1]); edel = jatko[0].properties.link_id;
      }
      if (ok) tulos.push(s);
    }
  }
  return { nimi: d.nimi, m: tulos, laskuri };
}

const kaikkiRivit = readdirSync(`${juuri}data/kunnat`).filter(f => f.endsWith('.gz')).sort()
  .map(kaupunki);
tarkista('nakema', kaikkiRivit.length, kaikkiRivit.reduce((a, r) => a + r.m.length, 0));
const rivit = kaikkiRivit.filter(r => r.m.length);
const osuus = (a, raja) => a.filter(x => x >= raja).length / a.length * 100;
rivit.sort((a, b) => osuus(b.m, 20) - osuus(a.m, 20));
console.log(`saanto: haara joka nousee toiminn_lk <= ${VT} -tielle ${MATKA} m:n sisalla ei ole konfliktihaara\n`);
console.log(`${'kaupunki'.padEnd(14)}${'suita'.padStart(7)}${'>= 20 m'.padStart(10)}` +
            `${'>= 15 m'.padStart(10)}${'>= 12 m'.padStart(10)}${'mediaani'.padStart(11)}`);
console.log('-'.repeat(62));
for (const r of rivit) {
  const a = r.m.slice().sort((x, y) => x - y);
  console.log(`${r.nimi.padEnd(14)}${String(r.m.length).padStart(7)}` +
    `${osuus(r.m, 20).toFixed(0).padStart(9)}%${osuus(r.m, 15).toFixed(0).padStart(9)}%` +
    `${osuus(r.m, 12).toFixed(0).padStart(9)}%${a[a.length >> 1].toFixed(1).padStart(9)} m`);
}
const kaikki = rivit.flatMap(r => r.m);
console.log('-'.repeat(62));
console.log(`${'YHTEENSA'.padEnd(14)}${String(kaikki.length).padStart(7)}` +
  `${osuus(kaikki, 20).toFixed(0).padStart(9)}%${osuus(kaikki, 15).toFixed(0).padStart(9)}%` +
  `${osuus(kaikki, 12).toFixed(0).padStart(9)}%`);
const osumat = {};
for (const r of rivit) for (const [k, v] of Object.entries(r.laskuri)) osumat[k] = (osumat[k] ?? 0) + v;
console.log('\nEXCEPTION RULES');
for (const p of saannot('nakema')) {
  console.log(`\n  [${p.id}] ${p.nimi} — ohitti ${(osumat[p.id] ?? 0).toLocaleString('fi-FI')} haaraa`);
  console.log(`    saanto:    ${p.saanto}`);
  console.log(`    perustelu: ${p.perustelu.replace(/(.{76}) /g, '$1\n               ')}`);
  if (p.huom) console.log(`    huom:      ${p.huom.replace(/(.{76}) /g, '$1\n               ')}`);
}
writeFileSync(`${juuri}data/nakemat2.json`, JSON.stringify({ kaupungit: rivit, poikkeukset: kuvaus('nakema'), osumat }));
