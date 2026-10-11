#!/usr/bin/env node
/**
 * Kaupunkikohtaiset tunnusluvut artefaktista -> viz/kaupungit.json
 *
 * Mittarit on valittu niin, ettei kunnan pinta-ala sekoita niita. Kuopion
 * kaltaisessa kunnassa on 62 000 linkkia joista valtaosa on metsaautoteita,
 * joten mikaan "osuus kaikista linkeista" ei kerro pyoraverkosta mitaan.
 * Kaikki alla on suhteutettu kevyen liikenteen verkkoon tai asukaslukuun.
 *
 *   node tools/pisteet.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { Reader } from '../src/read/reader.js';
import { FileTransport } from '../src/transport/file.js';
import { decodeParts } from '../src/geom.js';

const juuri = new URL('..', import.meta.url).pathname;
const VAESTO = JSON.parse(readFileSync(process.env.HOME + '/proj/oma/ajoneuvorekisteri/viz/data/vaesto2025.json'));
const r = await new Reader(new FileTransport(`${juuri}data/pyoratiet.l0`), { cacheLimit: 768e6 }).open();

const kunnat = (await r.search({ size: 0, aggs: { k: { terms: { field: 'kuntanimi', size: 50 } } } }))
  .aggregations.k.buckets.map(b => b.key);

const RAJAT = [['suositeltava', 20], ['tyydyttava', 15], ['minimi12', 12], ['minimi10', 10]];
const out = [];

for (const nimi of kunnat) {
  const ehto = x => ({ bool: { filter: [{ term: { kuntanimi: nimi } }, ...x] } });
  const alikulut = await r.search({ query: ehto([{ term: { laji: 'linkki' } },
      { term: { linkkityyp: 8 } }, { term: { silta_alik: -1 } }]), size: 5000, sort: [{ avain: 'asc' }] });
  const risteykset = await r.search({ query: ehto([{ term: { laji: 'risteys' } }]),
      size: 200000, sort: [{ avain: 'asc' }] });
  const kevyt = await r.search({ query: ehto([{ term: { laji: 'linkki' } }, { term: { linkkityyp: 8 } }]),
      size: 0 });
  // Eritasoratkaisut: silta_alik != 0. terms-aggregointi ei kelpaa, koska kentta
  // on numeerinen ja indeksi tukee terms-aggregointia vain avainsanoille.
  const eritaso = await r.search({ query: { bool: {
      filter: [{ term: { kuntanimi: nimi } }, { term: { laji: 'linkki' } }, { term: { linkkityyp: 8 } }],
      must_not: [{ term: { silta_alik: 0 } }] } }, size: 0 });

  const SOLU = 32, ruudut = new Map();
  for (const h of risteykset.hits.hits) {
    const p = h._source, k = `${Math.floor(p.x / SOLU)}_${Math.floor(p.y / SOLU)}`;
    if (!ruudut.has(k)) ruudut.set(k, []);
    ruudut.get(k).push(p);
  }
  const lahin = (x, y) => {
    let d = Infinity, m = null, cx = Math.floor(x / SOLU), cy = Math.floor(y / SOLU);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      for (const p of ruudut.get(`${cx+i}_${cy+j}`) ?? []) {
        const e = Math.hypot(p.x - x, p.y - y); if (e < d) { d = e; m = p; }
      }
    return { d, p: m };
  };

  const kohteet = [];
  for (const h of alikulut.hits.hits) {
    const s = h._source, c = decodeParts(s.geom)[0];
    for (const [i, pää] of [[0, c[0]], [1, c[c.length - 1]]]) {
      const { d, p } = lahin(pää[0], pää[1]);
      if (!p) continue;
      kohteet.push({ id: s.link_id, suu: i, x: Math.round(pää[0]), y: Math.round(pää[1]),
                     m: d < 1 ? 0 : Math.round(d * 10) / 10, aste: p.aste, kevyita: p.kevyita,
                     nimi: s.tienimi || null });
    }
  }

  const n = kohteet.length;
  const jakauma = Object.fromEntries(RAJAT.map(([k, raja]) =>
    [k, kohteet.filter(o => o.m >= raja).length]));
  const kevytN = kevyt.hits.total.value;
  const erita = eritaso.hits.total.value;
  const kevytRisteykset = risteykset.hits.hits.filter(h => h._source.kevyita >= 3).length;
  const koodi = Object.entries(VAESTO.nimet).find(([, v]) => v === nimi)?.[0];
  const as = koodi ? VAESTO.kunnat[koodi] : null;

  out.push({
    nimi, koodi: koodi ? +koodi : null, asukkaita: as,
    alikulut: alikulut.hits.total.value, suuaukot: n,
    kevytlinkkeja: kevytN, eritasoja: erita, kevytristeyksia: kevytRisteykset,
    // paamittari: osuus suuaukoista jotka tayttavat suositeltavan nakemaalueen
    nakema20: n ? jakauma.suositeltava / n : null,
    nakema15: n ? jakauma.tyydyttava / n : null,
    nakema12: n ? jakauma.minimi12 / n : null,
    mediaani: n ? kohteet.map(o => o.m).sort((a, b) => a - b)[n >> 1] : null,
    // suhteutetut tukimittarit; nimittajana kevytverkko, ei kunnan pinta-ala
    eritasojaPer1000: kevytN ? erita / kevytN * 1000 : null,
    risteyksiaPer1000: kevytN ? kevytRisteykset / kevytN * 1000 : null,
    kohteet,
  });
  process.stderr.write(`  ${nimi.padEnd(14)} ${n} suuaukkoa\n`);
}

out.sort((a, b) => b.nakema20 - a.nakema20);
writeFileSync(`${juuri}viz/kaupungit.json`, JSON.stringify(out));
console.log(`\n${out.length} kaupunkia -> viz/kaupungit.json ` +
            `(${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
console.log('\nkarki nakemalla:');
for (const k of out.slice(0, 5))
  console.log(`  ${k.nimi.padEnd(14)} ${(k.nakema20 * 100).toFixed(0)} % >= 20 m, mediaani ${k.mediaani} m`);
