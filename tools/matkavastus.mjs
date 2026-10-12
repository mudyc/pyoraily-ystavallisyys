#!/usr/bin/env node
/**
 * Matkavastus ja pituuskaltevuus kevyen liikenteen verkosta, Z-arvoista.
 *
 * MITTARI. Helsingin pyoraliikenteen suunnitteluohje maarittelee matkavastuksen
 * S = H^2 / L, missa H on noustava korkeusero ja L on osuuden pituus. Alle 0,2
 * on "erityisen tavoiteltava" baanoilla ja paareiteilla. Pituuskaltevuuden
 * suositus on enintaan 4 % paareiteilla, 8 % ehdoton ylaraja.
 *
 * KAKSI VINOUMAA, JOTKA ON HOIDETTAVA.
 *
 * 1. Lyhyt linkki suurentaa Z:n virheen. Alle 5 m linkeista 3 % nayttaa yli
 *    20 % kaltevuutta, mika ei ole maastoa vaan mittauskohinaa. Siksi alle
 *    MIN_SEG metrin segmentit jatetaan kaltevuuslaskusta pois.
 *
 * 2. Paasta-paahan mittaus tasoittaa maet pois. Yli 250 m linkeilla mediaani-
 *    kaltevuus putoaa 1,08 %:iin, koska nousu ja lasku kumoavat toisensa.
 *    Siksi kaltevuus lasketaan SEGMENTEITTAIN, ei linkeittain.
 *
 * NOUSUT YHDISTETAAN RISTEYSTEN YLI. Matkavastus on kumulatiivinen suure: sama
 * maki jaettuna viiteen linkkiin antaisi viisi pienta S:aa yhden ison sijaan.
 * Linkit ketjutetaan siksi solmujen lapi, joiden aste on 2 - eli siella missa
 * reitti jatkuu yksikasitteisesti - ja nousut etsitaan ketjusta.
 *
 * MITA EI VOI LASKEA. Sivukaltevuus on kohtisuorassa vaylaa vastaan, eika
 * aineistossa ole vaylan leveytta eika poikkileikkausta - vain keskilinja.
 * Ohjeen sivukaltevuusvaatimus (0,5-2,0 %, enintaan 3,0 %) jaa siis kokonaan
 * mittaamatta. Sita ei voi paatella tasta aineistosta millaan.
 *
 *   node tools/matkavastus.mjs [--min-seg 2] [--dippi 0.3]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tarkista } from './poikkeukset.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : +process.argv[i + 1]; };
const MIN_SEG = arg('--min-seg', 2);     // lyhyemmat segmentit ovat Z-kohinaa
const RAJA    = arg('--raja', 25);       // nain lahella harjaa risteys katkaisee vauhdin
const juuri = new URL('..', import.meta.url).pathname;

import { ketjuta, nousut, harvenna, sol, d2, TARK, DIPPI, HARVA } from './korkeus.mjs';

/** Ruudukkohaku lahimmalle pisteelle. */
function ruudukko(pisteet, solu = 40) {
  const m = new Map();
  for (const p of pisteet) {
    const k = `${Math.floor(p.x / solu)}_${Math.floor(p.y / solu)}`;
    if (!m.has(k)) m.set(k, []); m.get(k).push(p);
  }
  return (x, y, sade) => {
    const r = Math.ceil(sade / solu); let d = Infinity;
    const cx = Math.floor(x / solu), cy = Math.floor(y / solu);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++)
      for (const p of m.get(`${cx+i}_${cy+j}`) ?? [])
        d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    return d;
  };
}

function kaupunki(tiedosto) {
  const d = JSON.parse(gunzipSync(readFileSync(`${juuri}data/kunnat/${tiedosto}`), 'utf8'));
  const linkit = d.features
    .filter(f => f.geometry?.type === 'LineString' && f.geometry.coordinates.length >= 2
                 && f.properties.linkkityyp === 8 && f.geometry.coordinates[0].length >= 3)
    .map(f => ({ id: f.properties.link_id, c: f.geometry.coordinates }));

  // kaltevuus segmenteittain, painotettuna pituudella
  let pit = 0, yli4 = 0, yli8 = 0, lyhyet = 0;
  for (const L of linkit) for (let i = 1; i < L.c.length; i++) {
    const dl = d2(L.c[i - 1], L.c[i]); if (dl < 1e-6) continue;
    pit += dl;
    if (dl < MIN_SEG) { lyhyet += dl; continue; }        // Z-kohinaa, ei maastoa
    const g = Math.abs(L.c[i][2] - L.c[i - 1][2]) / dl * 100;
    if (g > 4) yli4 += dl;
    if (g > 8) yli8 += dl;
  }

  // kevytverkon risteykset: solmut joissa kolme tai useampi linkinpaa
  const aste = new Map();
  for (const L of linkit) for (const e of [L.c[0], L.c[L.c.length - 1]]) {
    const n = sol(e); const a = aste.get(n) ?? { x: e[0], y: e[1], n: 0 }; a.n++; aste.set(n, a);
  }
  const risteysEt = ruudukko([...aste.values()].filter(a => a.n >= 3));
  let valot = [];
  try { valot = JSON.parse(gunzipSync(readFileSync(
    `${juuri}data/valot/${String(d.kuntakoodi).padStart(3, '0')}.json.gz`), 'utf8')); } catch {}
  const valoEt = ruudukko(valot);

  const kaikkiNousut = ketjuta(linkit).flatMap(nousut);
  for (const n of kaikkiNousut) {
    n.risteys = risteysEt(n.x, n.y, RAJA);
    n.valo = valoEt(n.x, n.y, RAJA);
  }
  // Merkitseva nousu: vahintaan 2 m korkeuseroa. Puolen metrin tormy harjalla
  // oleva risteys ei ole se ongelma josta ohje puhuu.
  const merk = kaikkiNousut.filter(n => n.H >= 2);
  const pysaytetyt = merk.filter(n => n.risteys <= RAJA);
  const valoPysaytetyt = merk.filter(n => n.valo <= RAJA);
  const raskaat = kaikkiNousut.filter(n => n.S >= 0.2);
  const raskasPit = raskaat.reduce((a, n) => a + n.L, 0);
  // "metrin nousu 4 %:n kaltevuudella vastaa 10 m lisamatkaa" -> H * 10 m
  const lisamatka = kaikkiNousut.reduce((a, n) => a + n.H * 10, 0);

  return { nimi: d.nimi, km: pit / 1000, valoja: valot.length,
           merkNousuja: merk.length, pysaytetyt: pysaytetyt.length,
           valoPysaytetyt: valoPysaytetyt.length,
           pysOsuus: merk.length ? pysaytetyt.length / merk.length * 100 : null,
           valoOsuus: merk.length ? valoPysaytetyt.length / merk.length * 100 : null,
           pahimmatPys: merk.filter(n => n.valo <= RAJA).sort((a, b) => b.H - a.H).slice(0, 3)
             .map(n => ({ H: +n.H.toFixed(1), L: Math.round(n.L), S: +n.S.toFixed(2),
                          valo: Math.round(n.valo), x: Math.round(n.x), y: Math.round(n.y) })), yli4: yli4 / pit * 100, yli8: yli8 / pit * 100,
           kohinaOsuus: lyhyet / pit * 100,
           nousuja: kaikkiNousut.length, raskaita: raskaat.length,
           raskasOsuus: raskasPit / pit * 100,
           mediaaniS: kaikkiNousut.length
             ? kaikkiNousut.map(n => n.S).sort((a, b) => a - b)[kaikkiNousut.length >> 1] : null,
           pahinS: kaikkiNousut.length ? Math.max(...kaikkiNousut.map(n => n.S)) : null,
           lisamatkaKm: lisamatka / 1000,
           // Kohdetason lista vertailusivua varten. Vain merkitsevat nousut (H >= 2 m),
           // pyoristettyna niin ettei tiedosto kasva turhaan: 15 638 kohdetta koko maassa.
           nousuKohteet: merk.map(n => {
             const o = { x: Math.round(n.x), y: Math.round(n.y),
               H: +n.H.toFixed(1), L: Math.round(n.L), S: +n.S.toFixed(2),
               v: Math.round(Math.min(n.valo, 999)), r: Math.round(Math.min(n.risteys, 999)) };
             if (n.S >= 0.2 || n.valo <= RAJA) o.g = n.g;   // vain valittaville
             return o;
           }),
           pahimmat: kaikkiNousut.sort((a, b) => b.S - a.S).slice(0, 3)
             .map(n => ({ S: +n.S.toFixed(2), H: +n.H.toFixed(1), L: Math.round(n.L) })) };
}

const rivit = readdirSync(`${juuri}data/kunnat`).filter(f => f.endsWith('.gz')).sort().map(kaupunki);
tarkista('matkavastus', rivit.length, rivit.reduce((a, r) => a + r.nousuja, 0));

console.log(`matkavastus S = H^2/L, tavoite alle 0,2   ·   segmentit alle ${MIN_SEG} m jatetty pois\n`);
rivit.sort((a, b) => a.raskasOsuus - b.raskasOsuus);
console.log(`${'kaupunki'.padEnd(14)}${'verkko km'.padStart(10)}${'yli 4 %'.padStart(9)}` +
  `${'yli 8 %'.padStart(9)}${'nousuja'.padStart(9)}${'S>=0,2'.padStart(8)}${'osuus'.padStart(8)}` +
  `${'mediaani S'.padStart(12)}${'pahin S'.padStart(9)}`);
console.log('-'.repeat(88));
for (const r of rivit)
  console.log(`${r.nimi.padEnd(14)}${r.km.toFixed(0).padStart(10)}${r.yli4.toFixed(1).padStart(8)}%` +
    `${r.yli8.toFixed(1).padStart(8)}%${String(r.nousuja).padStart(9)}${String(r.raskaita).padStart(8)}` +
    `${r.raskasOsuus.toFixed(1).padStart(7)}%${(r.mediaaniS ?? 0).toFixed(3).padStart(12)}` +
    `${(r.pahinS ?? 0).toFixed(1).padStart(9)}`);
const kokPit = rivit.reduce((a, r) => a + r.km, 0);
console.log('-'.repeat(88));
console.log(`${'YHTEENSA'.padEnd(14)}${kokPit.toFixed(0).padStart(10)}` +
  `${(rivit.reduce((a, r) => a + r.yli4 * r.km, 0) / kokPit).toFixed(1).padStart(8)}%` +
  `${(rivit.reduce((a, r) => a + r.yli8 * r.km, 0) / kokPit).toFixed(1).padStart(8)}%` +
  `${String(rivit.reduce((a, r) => a + r.nousuja, 0)).padStart(9)}` +
  `${String(rivit.reduce((a, r) => a + r.raskaita, 0)).padStart(8)}`);

// "Maen jalkeen ei saisi olla valoristeysta": vauhti menetetaan juuri siella
// missa se on kalleinta hankkia. Merkitseva nousu = vahintaan 2 m korkeuseroa.
console.log(`\n\npysahdys maen paalla — risteys tai valo ${RAJA} m:n sisalla harjasta\n`);
rivit.sort((a, b) => (a.valoOsuus ?? 0) - (b.valoOsuus ?? 0));
console.log(`${'kaupunki'.padEnd(14)}${'valoja'.padStart(8)}${'nousuja >=2 m'.padStart(15)}` +
  `${'risteys harjalla'.padStart(18)}${'VALO harjalla'.padStart(16)}`);
console.log('-'.repeat(71));
for (const r of rivit)
  console.log(`${r.nimi.padEnd(14)}${String(r.valoja).padStart(8)}${String(r.merkNousuja).padStart(15)}` +
    `${(r.pysaytetyt + ' (' + (r.pysOsuus ?? 0).toFixed(0) + ' %)').padStart(18)}` +
    `${(r.valoPysaytetyt + ' (' + (r.valoOsuus ?? 0).toFixed(1) + ' %)').padStart(16)}`);
const mn = rivit.reduce((a, r) => a + r.merkNousuja, 0);
console.log('-'.repeat(71));
console.log(`${'YHTEENSA'.padEnd(14)}${String(rivit.reduce((a,r)=>a+r.valoja,0)).padStart(8)}${String(mn).padStart(15)}` +
  `${(rivit.reduce((a,r)=>a+r.pysaytetyt,0) + ' (' + (rivit.reduce((a,r)=>a+r.pysaytetyt,0)/mn*100).toFixed(0) + ' %)').padStart(18)}` +
  `${(rivit.reduce((a,r)=>a+r.valoPysaytetyt,0) + ' (' + (rivit.reduce((a,r)=>a+r.valoPysaytetyt,0)/mn*100).toFixed(1) + ' %)').padStart(16)}`);

console.log('\npahimmat valoristeykset mäen päällä (korkein nousu ensin):');
for (const r of rivit.flatMap(r => r.pahimmatPys.map(p => ({ ...p, nimi: r.nimi })))
                     .sort((a, b) => b.H - a.H).slice(0, 10))
  console.log(`  ${r.nimi.padEnd(13)} nousu ${r.H.toFixed(1).padStart(5)} m / ${String(r.L).padStart(4)} m` +
    `  S=${r.S.toFixed(2).padStart(5)}  valo ${String(r.valo).padStart(2)} m paassa  ${r.x},${r.y}`);

console.log(`\nZ-kohinasta pois jatetty keskimaarin ${(rivit.reduce((a,r)=>a+r.kohinaOsuus*r.km,0)/kokPit).toFixed(1)} % verkon pituudesta`);
writeFileSync(`${juuri}data/matkavastus.json`, JSON.stringify(rivit));

// Liitetaan vertailusivun aineistoon, jotta sivu lukee yhden tiedoston.
const kpol = `${juuri}viz/kaupungit.json`;
const K = JSON.parse(readFileSync(kpol, 'utf8'));
const idx = Object.fromEntries(rivit.map(r => [r.nimi, r]));
for (const k of K) {
  const r = idx[k.nimi]; if (!r) continue;
  k.verkkoKm = +r.km.toFixed(0);
  k.yli4 = +r.yli4.toFixed(1);
  k.yli8 = +r.yli8.toFixed(1);
  k.raskasOsuus = +r.raskasOsuus.toFixed(1);     // S >= 0,2 osuus verkon pituudesta
  k.mediaaniS = +(r.mediaaniS ?? 0).toFixed(3);
  k.merkNousuja = r.merkNousuja;
  k.valoHarjalla = r.valoPysaytetyt;
  k.valoOsuus = +(r.valoOsuus ?? 0).toFixed(1);
  k.risteysHarjalla = r.pysaytetyt;
  k.risteysOsuus = +(r.pysOsuus ?? 0).toFixed(1);
  k.pahimmatPys = r.pahimmatPys;
  k.nousut = r.nousuKohteet;
}
writeFileSync(kpol, JSON.stringify(K));
console.log(`\nliitetty viz/kaupungit.json (${(JSON.stringify(K).length/1e6).toFixed(1)} MB)`);
