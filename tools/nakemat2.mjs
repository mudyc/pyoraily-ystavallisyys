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
 * Tama on SIVUN kanssa sama mittaus: molemmat kutsuvat tools/nakema.mjs:aa.
 * Aiemmin talla ja sivulla oli eri toteutus ja eri tulos (49 % vs. 51 %).
 * Skripti jaa olemaan siksi etta se tulostaa EXCEPTION RULES -saantojen osumat
 * ja sensuroinnin maaran, joita sivun JSON ei nayta.
 *
 *   node tools/nakemat2.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { kuvaus, saannot, tarkista } from './poikkeukset.mjs';
import { suuaukot, MAX_KAVELY } from './nakema.mjs';

const juuri = new URL('..', import.meta.url).pathname;

function kaupunki(tiedosto) {
  const d = JSON.parse(gunzipSync(readFileSync(`${juuri}data/kunnat/${tiedosto}`), 'utf8'));
  const laskuri = {};
  const k = suuaukot(d.features, laskuri);
  return { nimi: d.nimi, m: k.map(o => o.m), sens: k.filter(o => o.sens).length, laskuri };
}

const kaikkiRivit = readdirSync(`${juuri}data/kunnat`).filter(f => f.endsWith('.gz')).sort()
  .map(kaupunki);
tarkista('nakema', kaikkiRivit.length, kaikkiRivit.reduce((a, r) => a + r.m.length, 0));
const rivit = kaikkiRivit.filter(r => r.m.length);
const osuus = (a, raja) => a.filter(x => x >= raja).length / a.length * 100;
rivit.sort((a, b) => osuus(b.m, 20) - osuus(a.m, 20));
console.log(`sensuroitu ${rivit.reduce((a, r) => a + r.sens, 0)} suuaukkoa arvoon ${MAX_KAVELY} m ` +
            `(konfliktia ei ${MAX_KAVELY} m:n sisalla; lapaisee jokaisen rajan)\n`);
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
