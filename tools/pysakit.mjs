#!/usr/bin/env node
/**
 * Pysakkijarjestelyt: onko katos pyoratien ja autotien valissa?
 *
 * OHJE. Helsingin pyoraliikenteen suunnitteluohje: katos sijoitetaan odotus-
 * tilaan, pyoratien ja ajoradan valiin, vahintaan 0,3 m pyoratien reunasta.
 * Jarjestys poikkisuunnassa on siis  ajorata | katos | pyoratie | jalkakaytava,
 * ja pyoraliikenne kulkee odotustilan takaa. Jos pyoratie on katoksen ja
 * ajoradan valissa, pyorailijat ajavat odotustilan lapi.
 *
 * TESTI. Pysakki projisoidaan omalle tielinkilleen: siita saadaan tien suunta,
 * kohtisuora etaisyys ja PUOLI. Sama tehdaan lahimmalle kevytvaylan pisteelle.
 * Jos molemmat ovat samalla puolella tieta, jarjestys ratkeaa etaisyyksista:
 * pysakki lahempana tieta = oikein, pyoratie lahempana = vaarin.
 *
 * KOORDINAATTI. Pysakin GEOMETRIA on tielinkille napsautettu piste, joten sen
 * kohtisuora etaisyys tiesta on nolla eika puoli ratkea. Maastokoordinaatti
 * (maast_x/y) on mitattu todellinen sijainti ja eroaa geometriasta mediaanilla
 * 10 m. Vain se kelpaa tahan mittaukseen.
 *
 * KATTAVUUS ON ONGELMA. Maastokoordinaatti on taytetty 41 %:lle pysakeista,
 * mutta jakauma on hyvin epatasainen: Espoo 89 %, Helsinki 84 % - Turku, Salo,
 * Kouvola ja Vaasa 0 %. Se kertoo maastokaynneista eika pyorailysta, joten
 * tasta EI saa kaupunkien paremmuusjarjestysta. Luku patee niihin pysakkeihin
 * joilla koordinaatti on, ja kattavuus on raportoitava sen rinnalla.
 *
 * Mukaan vain pysakit joilla ON katos (katos = 2; Digiroadissa 1 = Ei) ja joiden lahella on
 * kevytvayla: muuten koko jarjestelykysymysta ei synny.
 *
 *   node tools/pysakit.mjs [--sade 30]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { maasto } from './koordinaatit.mjs';
import { saannot, tarkista } from './poikkeukset.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : +process.argv[i + 1]; };
const SADE = arg('--sade', 30);      // nain lahella kevytvayla kuuluu jarjestelyyn
const MIN_ET = 1.0;                  // alle taman puoli on maarittelematon
const juuri = new URL('..', import.meta.url).pathname;
const KOORD = {};   // mika koordinaattitulkinta osui mihinkin
const SAANNOT = saannot('pysakit');

/** Pisteen projektio murtoviivalle: kohtisuora etaisyys, puoli ja tien suunta. */
function projisoi(p, c) {
  let paras = null;
  for (let i = 1; i < c.length; i++) {
    const [ax, ay] = c[i - 1], [bx, by] = c[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2));
    const rx = ax + dx * t, ry = ay + dy * t;
    const d = Math.hypot(p[0] - rx, p[1] - ry);
    if (!paras || d < paras.d) {
      // ristitulo kertoo kummalla puolella tieta piste on
      paras = { d, rx, ry, puoli: Math.sign(dx * (p[1] - ay) - dy * (p[0] - ax)) };
    }
  }
  return paras;
}

function kaupunki(tiedosto) {
  const koodi = tiedosto.slice(0, 3);
  const d = JSON.parse(gunzipSync(readFileSync(`${juuri}data/kunnat/${tiedosto}`), 'utf8'));
  let pysakit = [];
  try { pysakit = JSON.parse(gunzipSync(readFileSync(
    `${juuri}data/pysakit/${koodi}.json.gz`), 'utf8')); } catch { return null; }
  // Maastokoordinaatti yhteen koordinaatistoon ENNEN mittausta: Digiroad julkaisee
  // sen osassa kuntia WGS84-asteina ja osassa x/y vaarin pain. Ks. koordinaatit.mjs.
  for (const p of Object.values(pysakit)) {
    const m = maasto(p.mx, p.my, KOORD);
    p.mx = m ? m[0] : null; p.my = m ? m[1] : null;
  }

  const linkit = new Map();
  const kevyt = [];
  for (const f of d.features) {
    if (f.geometry?.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
    linkit.set(f.properties.link_id, f.geometry.coordinates);
    if (f.properties.linkkityyp === 8) kevyt.push(f.geometry.coordinates);
  }
  // Kevytvaylan SEGMENTIT ruudukkoon, eivat taitepisteet. Lahin taitepiste ei
  // kelpaa: pysakit ovat suorilla osuuksilla, joilla taitepistevali on p90 = 14 m
  // ja enimmillaan 356 m, joten lahin taitepiste voi olla kymmenia metreja sivussa
  // kohtisuorasta jalasta - ja sen etaisyys ajoradasta on silloin eri. Mitattuna
  // ero oli mediaanilla 0,10 m mutta p90 1,1 m ja p99 10,4 m, ja luokitus vaihtui
  // 4,8 %:ssa tapauksista. Segmentti kirjataan jokaiseen ruutuun jonka se lavistaa.
  const SOLU = 40, ruudut = new Map();
  for (const c of kevyt) for (let i = 1; i < c.length; i++) {
    const a = c[i-1], b = c[i];
    const x0 = Math.floor(Math.min(a[0], b[0]) / SOLU), x1 = Math.floor(Math.max(a[0], b[0]) / SOLU);
    const y0 = Math.floor(Math.min(a[1], b[1]) / SOLU), y1 = Math.floor(Math.max(a[1], b[1]) / SOLU);
    for (let u = x0; u <= x1; u++) for (let v = y0; v <= y1; v++) {
      const k = `${u}_${v}`;
      if (!ruudut.has(k)) ruudut.set(k, []); ruudut.get(k).push([a, b]);
    }
  }
  /** Lahin piste VIIVALLA, ei lahin taitepiste. */
  const lahinKevyt = (x, y) => {
    let d = Infinity, m = null;
    const cx = Math.floor(x / SOLU), cy = Math.floor(y / SOLU), r = Math.ceil(SADE / SOLU);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++)
      for (const [a, b] of ruudut.get(`${cx+i}_${cy+j}`) ?? []) {
        const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
        let t = L2 ? ((x - a[0]) * vx + (y - a[1]) * vy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a[0] + t * vx, qy = a[1] + t * vy;
        const e = Math.hypot(qx - x, qy - y); if (e < d) { d = e; m = [qx, qy]; }
      }
    return d <= SADE ? m : null;
  };

  const t = { katollisia: 0, eiMaastoa: 0, arvioitavia: 0, oikein: 0, vaarin: 0,
              eiPyoratieta: 0, eriPuoli: 0, epaselva: 0, kohteet: [] };
  for (const p of pysakit) {
    if (p.lakkautettu) continue;
    // EXCEPTION RULES: katos ilman maastokoordinaattia kasitellaan kuin katosta
    // ei olisi - ilman sijaintia ei ole mitaan mitattavaa.
    if (p.katos === 2 && p.mx == null) t.eiMaastoa++;   // 2 = Kylla, ks. poikkeukset.mjs
    if (SAANNOT.some(r => r.ohita(p))) continue;   // ks. suodata(): saannot ovat mittauskohtaisia
    t.katollisia++;
    const tie = linkit.get(p.link_id);
    if (!tie) { t.epaselva++; continue; }
    const S = projisoi([p.mx, p.my], tie);
    if (!S || S.d < MIN_ET) { t.epaselva++; continue; }   // katos tien paalla: puoli ei ratkea
    const C = lahinKevyt(p.mx, p.my);
    if (!C) { t.eiPyoratieta++; continue; }
    const P = projisoi(C, tie);
    if (!P) { t.epaselva++; continue; }
    if (P.puoli !== S.puoli) { t.eriPuoli++; continue; }   // pyoratie tien toisella puolen
    t.arvioitavia++;
    const ok = S.d < P.d;                                   // katos lahempana ajorataa
    if (ok) t.oikein++; else t.vaarin++;
    // Kaikki arvioitavat talteen, ei vain vaarat: kartalla pitaa nakya myos
    // mihin ne oikein sijoitetut osuvat, muuten lukija ei nae mittakaavaa.
    t.kohteet.push({ x: Math.round(p.mx), y: Math.round(p.my), nimi: p.nimi_su || null,
      id: p.valtak_id, kat: +S.d.toFixed(1), pyo: +P.d.toFixed(1),
      ero: +(S.d - P.d).toFixed(1), ok, telin: p.pyoratelin === 1 });
  }
  t.nimi = d.nimi;
  t.osuus = t.arvioitavia ? t.vaarin / t.arvioitavia * 100 : null;
  // pahin ensin: suurin positiivinen ero = katos kauimpana ajoradasta pyoratien takana
  t.kohteet.sort((a, b) => b.ero - a.ero);
  return t;
}

const kaikkiRivit = readdirSync(`${juuri}data/kunnat`).filter(f => f.endsWith('.gz')).sort()
  .map(kaupunki).filter(Boolean);
tarkista('pysakit', kaikkiRivit.reduce((a, r) => a + r.katollisia, 0),
                    kaikkiRivit.reduce((a, r) => a + r.arvioitavia, 0));
const rivit = kaikkiRivit.filter(r => r.arvioitavia);
rivit.sort((a, b) => a.osuus - b.osuus);
console.log(`katos pyoratien ja ajoradan valissa — ohjeen mukainen jarjestys\n`);
console.log(`${'kaupunki'.padEnd(14)}${'katoksia'.padStart(10)}${'(ohitettu)'.padStart(12)}` +
  `${'arvioitavia'.padStart(13)}${'oikein'.padStart(8)}${'VAARIN'.padStart(8)}${'osuus'.padStart(7)}`);
console.log('-'.repeat(80));
for (const r of rivit)
  console.log(`${r.nimi.padEnd(14)}${String(r.katollisia).padStart(10)}${String(r.eiMaastoa).padStart(12)}` +
    `${String(r.arvioitavia).padStart(13)}${String(r.oikein).padStart(8)}${String(r.vaarin).padStart(8)}` +
    `${r.osuus.toFixed(0).padStart(6)}%`);
const S = (k) => rivit.reduce((a, r) => a + r[k], 0);
console.log('-'.repeat(80));
console.log(`${'YHTEENSA'.padEnd(14)}${String(S('katollisia')).padStart(10)}${String(S('eiMaastoa')).padStart(12)}` +
  `${String(S('arvioitavia')).padStart(13)}${String(S('oikein')).padStart(8)}${String(S('vaarin')).padStart(8)}` +
  `${(S('vaarin') / S('arvioitavia') * 100).toFixed(0).padStart(6)}%`);
for (const r of SAANNOT) {
  console.log(`\nEXCEPTION RULE [${r.id}] ${r.nimi} — ohitti ${S('eiMaastoa').toLocaleString('fi-FI')} pysäkkiä`);
  console.log(`  saanto: ${r.saanto}`);
  console.log(`  huom:   ${r.huom.replace(/(.{72}) /g, '$1\n          ')}`);
}
console.log(`\nmaastokoordinaatin tulkinta: ` + Object.entries(KOORD)
  .map(([k, v]) => `${k} ${v.toLocaleString('fi-FI')}`).join(', '));
console.log(`\nkatoksista rajattu pois: ei pyörätietä ${SADE} m:ssä ${S('eiPyoratieta')}, ` +
  `pyörätie tien toisella puolen ${S('eriPuoli')}, katos tien päällä tai linkki tuntematon ${S('epaselva')}`);

// Kaupunki, jolta ei jaa yhtaan arvioitavaa, putoaa taulukosta kokonaan - ja sen
// mukana katoaa tieto siita MIKSI. Se on sama hiljainen nimittajavirhe kuin
// nakemamittauksessa: Oulu putosi vaikka silla on maan paras maastokoordinaatti-
// kattavuus. Tulostetaan pudonneet ja syyt erikseen.
const nolla = kaikkiRivit.filter(r => !r.arvioitavia);
if (nolla.length) {
  console.log(`\nEI YHTAAN ARVIOITAVAA — ${nolla.length} kaupunkia putoaa vertailusta`);
  console.log(`${'kaupunki'.padEnd(14)}${'katoksia'.padStart(10)}${'ei maastoa'.padStart(12)}` +
    `${'ei pyörätietä'.padStart(15)}${'eri puoli'.padStart(11)}${'epäselvä'.padStart(10)}`);
  for (const r of nolla)
    console.log(`${r.nimi.padEnd(14)}${String(r.katollisia).padStart(10)}${String(r.eiMaastoa).padStart(12)}` +
      `${String(r.eiPyoratieta).padStart(15)}${String(r.eriPuoli).padStart(11)}${String(r.epaselva).padStart(10)}`);
}
writeFileSync(`${juuri}data/pysakit.json`, JSON.stringify(rivit));

const kpol = `${juuri}viz/kaupungit.json`;
const K = JSON.parse(readFileSync(kpol, 'utf8'));
const idx = Object.fromEntries(rivit.map(r => [r.nimi, r]));
for (const k of K) {
  const r = idx[k.nimi];
  if (!r) { k.pysakkiOsuus = null; k.pysakit = []; continue; }
  k.katoksia = r.katollisia;
  k.pysArvioitavia = r.arvioitavia;
  k.pysVaarin = r.vaarin;
  k.pysakkiOsuus = +r.osuus.toFixed(1);
  k.pysakit = r.kohteet;
}
writeFileSync(kpol, JSON.stringify(K));
console.log(`\nliitetty viz/kaupungit.json (${(JSON.stringify(K).length / 1e6).toFixed(1)} MB)`);
