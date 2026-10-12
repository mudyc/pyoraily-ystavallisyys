#!/usr/bin/env node
/**
 * Kaupunkikohtaiset tunnusluvut artefaktista -> viz/kaupungit.json
 *
 * Mittarit on valittu niin, ettei kunnan pinta-ala sekoita niita. Kuopion
 * kaltaisessa kunnassa on 62 000 linkkia joista valtaosa on metsaautoteita,
 * joten mikaan "osuus kaikista linkeista" ei kerro pyoraverkosta mitaan.
 * Kaikki alla on suhteutettu kevyen liikenteen verkkoon tai asukaslukuun.
 *
 * NAKEMA lasketaan tools/nakema.mjs:lla, samalla koodilla kuin tarkistusajo
 * tools/nakemat2.mjs. Niilla oli aiemmin eri menetelma — sivu mittasi suoran
 * etaisyyden lahimpaan risteykseen, tarkistusajo kaveli verkkoa — ja ne antoivat
 * Jyvaskylalle 51 % ja 49 %. Suora etaisyys osoittautui vaaraksi eika vain
 * erilaiseksi: se loysi lyhyen alikulun molemmille suille saman, tunnelin takana
 * olevan risteyksen. Ks. tools/nakema.mjs.
 *
 *   node tools/pisteet.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Reader } from '../src/read/reader.js';
import { FileTransport } from '../src/transport/file.js';
import { suuaukot } from './nakema.mjs';
import { kuvaus, tarkista } from './poikkeukset.mjs';

const juuri = new URL('..', import.meta.url).pathname;
const VAESTO = JSON.parse(readFileSync(process.env.HOME + '/proj/oma/ajoneuvorekisteri/viz/data/vaesto2025.json'));
const r = await new Reader(new FileTransport(`${juuri}data/pyoratiet.l0`), { cacheLimit: 768e6 }).open();

const kunnat = (await r.search({ size: 0, aggs: { k: { terms: { field: 'kuntanimi', size: 50 } } } }))
  .aggregations.k.buckets.map(b => b.key);

const laskuri = {};
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

  // Nakema kavellaan verkossa alikulun suulta ULOSPAIN, joten se tarvitsee
  // taysgeometrian; artefaktin risteysdokumentit eivat kerro mihin suuntaan
  // risteys on. Lahde on sama kunta-geojson josta artefaktikin on rakennettu.
  const koodi0 = Object.entries(VAESTO.nimet).find(([, v]) => v === nimi)?.[0];
  const tiedosto = koodi0 ? `${juuri}data/kunnat/${String(koodi0).padStart(3, '0')}.geojson.gz` : null;
  const kohteet = tiedosto
    ? suuaukot(JSON.parse(gunzipSync(readFileSync(tiedosto), 'utf8')).features, laskuri)
    : [];

  const n = kohteet.length;
  const jakauma = Object.fromEntries(RAJAT.map(([k, raja]) =>
    [k, kohteet.filter(o => o.m >= raja).length]));
  const kevytN = kevyt.hits.total.value;
  const erita = eritaso.hits.total.value;
  const kevytRisteykset = risteykset.hits.hits.filter(h => h._source.kevyita >= 3).length;
  const koodi = koodi0;
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
    sensuroituja: kohteet.filter(o => o.sens).length,
    kohteet,
  });
  process.stderr.write(`  ${nimi.padEnd(14)} ${String(n).padStart(5)} suuaukkoa` +
    ` (${kohteet.filter(o => o.sens).length} sensuroitu)\n`);
}

tarkista('nakema', out.length, out.reduce((a, k) => a + k.suuaukot, 0));
out.sort((a, b) => b.nakema20 - a.nakema20);
writeFileSync(`${juuri}viz/kaupungit.json`, JSON.stringify(out));
// Saannot omaan tiedostoonsa: kaupungit.json on taulukko, johon matkavastus.mjs
// ja pysakit.mjs liittavat kenttia, eika sita kannata kaaria metatiedon ympari.
writeFileSync(`${juuri}viz/nakema-saannot.json`,
  JSON.stringify({ poikkeukset: kuvaus('nakema'), osumat: laskuri,
                   sensuroituja: out.reduce((a, k) => a + (k.sensuroituja ?? 0), 0) }));
console.log(`\n${out.length} kaupunkia -> viz/kaupungit.json ` +
            `(${(JSON.stringify(out).length / 1e6).toFixed(1)} MB)`);
console.log('\nkarki nakemalla:');
for (const k of out.slice(0, 5))
  console.log(`  ${k.nimi.padEnd(14)} ${(k.nakema20 * 100).toFixed(0)} % >= 20 m, mediaani ${k.mediaani} m`);
