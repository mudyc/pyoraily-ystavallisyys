#!/usr/bin/env node
/**
 * Rakentaa pyoratiet.l0:n kuntakohtaisista GeoJSON-tiedostoista.
 *
 *   node tools/build.mjs
 */
import { writeFileSync } from 'node:fs';
import { build } from '../src/build/builder.js';
import { lue } from './ingest.mjs';

const juuri = new URL('..', import.meta.url).pathname;
const out = `${juuri}data/pyoratiet.l0`;

const docs = [];
let n = 0;
for (const d of lue(`${juuri}data/kunnat`)) {
  docs.push({ id: String(++n), ...d });
  if (n % 100000 === 0) process.stderr.write(`\r  ${n.toLocaleString('fi-FI')}`);
}
process.stderr.write('\n');

const linkkeja = docs.filter(d => d.laji === 'linkki').length;
const risteyksia = docs.length - linkkeja;
const kunnat = new Set(docs.map(d => d.kunta)).size;
console.log(`${docs.length.toLocaleString('fi-FI')} dokumenttia: ` +
            `${linkkeja.toLocaleString('fi-FI')} linkkia, ${risteyksia.toLocaleString('fi-FI')} risteysta, ${kunnat} kuntaa`);

const t0 = Date.now();
const { catalog, bytes } = await build({
  docs, index: 'pyoratiet', clusteringField: 'avain', outPath: out,
  indexFields: ['avain', 'laji', 'kunta', 'kuntanimi', 'linkkityyp', 'silta_alik',
                'toiminn_lk', 'hallinn_lk', 'aste', 'kevyita', 'pituus'],
  storedFields: ['laji', 'link_id', 'linkkityyp', 'silta_alik', 'tienimi', 'kunta',
                 'geom', 'z', 'pituus', 'x', 'y', 'aste', 'kevyita'],
  fieldTypes: { avain: 'numeric', laji: 'keyword', kunta: 'numeric', kuntanimi: 'keyword',
                linkkityyp: 'numeric', silta_alik: 'numeric', toiminn_lk: 'numeric',
                hallinn_lk: 'numeric', aste: 'numeric', kevyita: 'numeric', pituus: 'numeric' },
});
console.log(`\nrakennettu ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  artefakti ${(bytes / 1e6).toFixed(1)} MB (${(bytes / catalog.docCount).toFixed(1)} B/doc)`);
console.log(`  sektioita ${Object.keys(catalog.sections).length}`);
console.log(`  katalogi  ${(JSON.stringify(catalog).length / 1e6).toFixed(2)} MB`);
writeFileSync(`${juuri}data/katalogi.json`, JSON.stringify(catalog));
