#!/usr/bin/env node
/**
 * Alikulkujen nakemaalueet: paljonko matkaa alikulun suulta on seuraavaan
 * risteykseen, ja tayttaako se Helsingin pyoraliikenteen suunnitteluohjeen
 * Kuvan 4 nakemaalueet (suositeltava 20 m, tyydyttava 15 m, minimi 12 m).
 *
 * MITTARI. Alikulun rakenne peittaa sivusuunnat, joten nakemaalue voi alkaa
 * vasta suuaukolta. Jos lahin risteys on lahempana kuin vaadittu nakemaalue,
 * vaatimusta ei voi tayttaa riippumatta siita mita reunoille on rakennettu.
 *
 * RAJAUS. Valttamaton ehto, ei riittava. Aineistossa on vain vaylan keskilinja
 * - ei seinia, luiskia, kaiteita eika kasvillisuutta. Luku on siis ALARAJA:
 * todellisia puutteita on enemman, ei vahemman.
 *
 * Kysely nojaa klusterointiavaimeen: kunnan risteykset ja kunnan linkit ovat
 * kumpikin oma yhtenainen lohkonsa, joten molemmat saa muutamalla tavuvalilla
 * eika koko maan lapikaynnilla.
 *
 *   node tools/nakemat.mjs [kuntakoodi]
 */
import { Reader } from '../src/read/reader.js';
import { FileTransport } from '../src/transport/file.js';
import { decodeParts } from '../src/geom.js';

const LUOKAT = [['suositeltava', 20], ['tyydyttava', 15], ['minimi 12 m', 12], ['minimi 10 m', 10]];

const polku = new URL('../data/pyoratiet.l0', import.meta.url).pathname;
const r = await new Reader(new FileTransport(polku), { cacheLimit: 512e6 }).open();

const kunnat = (await r.search({ size: 0, aggs: { k: { terms: { field: 'kuntanimi', size: 50 } } } }))
  .aggregations.k.buckets;

async function kaupunki(nimi) {
  r.resetStats();
  const alikulut = await r.search({
    query: { bool: { filter: [{ term: { kuntanimi: nimi } }, { term: { laji: 'linkki' } },
                              { term: { linkkityyp: 8 } }, { term: { silta_alik: -1 } }] } },
    size: 5000, sort: [{ avain: 'asc' }] });
  const risteykset = await r.search({
    query: { bool: { filter: [{ term: { kuntanimi: nimi } }, { term: { laji: 'risteys' } }] } },
    size: 200000, sort: [{ avain: 'asc' }] });
  const s = r.stats;

  // Ruudukko lahimman risteyksen hakuun: 32 m solu kattaa 60 m sateen 3x3:lla.
  const SOLU = 32, ruudut = new Map();
  for (const h of risteykset.hits.hits) {
    const p = h._source, k = `${Math.floor(p.x / SOLU)}_${Math.floor(p.y / SOLU)}`;
    (ruudut.get(k) ?? ruudut.set(k, []).get(k)).push(p);
  }
  const lahin = (x, y) => {
    let d = Infinity, mika = null;
    const cx = Math.floor(x / SOLU), cy = Math.floor(y / SOLU);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      for (const p of ruudut.get(`${cx+i}_${cy+j}`) ?? []) {
        const e = Math.hypot(p.x - x, p.y - y);
        if (e < d) { d = e; mika = p; }
      }
    return { d, p: mika };
  };

  const suut = [];
  for (const h of alikulut.hits.hits) {
    const c = decodeParts(h._source.geom)[0];
    for (const pää of [c[0], c[c.length - 1]]) {
      const { d, p } = lahin(pää[0], pää[1]);
      if (p == null) continue;
      // risteys suoraan suuaukolla: alle metrin paassa on sama solmu
      suut.push({ id: h._source.link_id, x: pää[0], y: pää[1], m: d < 1 ? 0 : d,
                  aste: p.aste, kevyita: p.kevyita });
    }
  }
  return { nimi, alikulut: alikulut.hits.total.value, risteykset: risteykset.hits.total.value,
           suut, stats: { ...s } };
}

const valittu = process.argv[2];
const lista = valittu ? kunnat.filter(k => k.key.toLowerCase().startsWith(valittu.toLowerCase())) : kunnat;

console.log(`${'kaupunki'.padEnd(14)}${'alikulkuja'.padStart(11)}${'suita'.padStart(7)}` +
            LUOKAT.map(([n]) => n.slice(0, 11).padStart(13)).join('') + `${'mediaani'.padStart(10)}`);
console.log('-'.repeat(14 + 11 + 7 + 13 * LUOKAT.length + 10));
const kaikki = [];
for (const k of lista) {
  const t = await kaupunki(k.key);
  if (!t.suut.length) continue;
  kaikki.push(t);
  const n = t.suut.length, a = t.suut.map(s => s.m).sort((x, y) => x - y);
  const sol = LUOKAT.map(([, raja]) => {
    const ei = t.suut.filter(s => s.m < raja).length;
    return `${ei} (${Math.round(ei / n * 100)} %)`.padStart(13);
  }).join('');
  console.log(`${t.nimi.padEnd(14)}${String(t.alikulut).padStart(11)}${String(n).padStart(7)}${sol}` +
              `${a[n >> 1].toFixed(1).padStart(9)} m`);
}
console.log('\nsarakkeet: montako suuaukkoa EI tayta nakemaaluetta');
const io = kaikki.reduce((a, t) => a + t.stats.bytes, 0), rd = kaikki.reduce((a, t) => a + t.stats.reads, 0);
console.log(`kyselyt: ${kaikki.length * 2} kpl, ${rd} hakua, ${(io / 1e6).toFixed(1)} MB`);

// Yhteenveto
const kaikkiSuut = kaikki.flatMap(t => t.suut);
const N = kaikkiSuut.length;
console.log(`\nyhteensa ${kaikki.reduce((a,t)=>a+t.alikulut,0)} alikulkua, ${N} suuaukkoa`);
for (const [nimi, raja] of LUOKAT) {
  const ei = kaikkiSuut.filter(s => s.m < raja).length;
  console.log(`  ${nimi.padEnd(14)} ei tayta ${String(ei).padStart(5)}  ${(ei/N*100).toFixed(0)} %`);
}
const nolla = kaikkiSuut.filter(s => s.m < 1).length;
console.log(`  risteys suoraan suuaukolla (alle 1 m): ${nolla}  ${(nolla/N*100).toFixed(0)} %`);
const kk = kaikkiSuut.filter(s => s.kevyita >= 3).length;
console.log(`  suista joiden risteyksessa 3+ kevytvaylaa: ${kk}`);
