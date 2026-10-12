/**
 * Nakemaalueen mittaus alikulun suuaukolta — jaettu toteutus.
 *
 * SUUNNALLISUUS. Mittaus tehdaan VAIN ulostulosuuntaan. Alikulun suulta
 * katsotaan sita mita tunnelista tullessa on edessa; se mika on tunnelin
 * toisella puolella ei ole taman suun nakema, koska sinne paasee vain
 * kulkemalla tunnelin lapi.
 *
 * Tama moduuli on olemassa koska sivun luvut laskettiin aiemmin eri tavalla
 * kuin tarkistusajo: suorana etaisyytena lahimpaan risteykseen koko verkosta.
 * Lyhyella alikululla se loysi MOLEMMILLE suille saman risteyksen. Jyvaskylan
 * 7984330e on 38 m pitka ja sen kummankin paan lahin risteys on sama piste
 * 432892,6897070 — toisesta paasta se on edessa, toisesta tunnelin takana.
 * Molemmat paat merkittiin vaarallisiksi yhden havainnon perusteella, ja 15
 * jyvaskylalaista alikulkua sai nain kaksi alle 12 metrin arvoa yhdesta.
 *
 * Alikulun oma linkki on kielletty koko kavelyn ajan, ei vain ensimmaisella
 * askeleella: muuten pidempi reitti voisi kiertaa takaisin tunnelin lapi.
 *
 * KONFLIKTIHAARAT ratkaisee poikkeukset.mjs. Risteys lasketaan vasta kun siina
 * kohtaa vahintaan kaksi haaraa jotka eivat osu yhteenkaan poikkeussaantoon.
 *
 * Verkko rakennetaan KAIKISTA linkeista, ei vain kevytvaylista: paatiesaanto
 * tunnistaa valtatien vain jos autotiet ovat verkossa, ja autotien ylitys on
 * myos konflikti.
 */
import { suodata } from './poikkeukset.mjs';

export const TARK = 0.6;          // solmujen yhdistamistarkkuus, m
export const MAX_KAVELY = 80;     // tata kauempaa ei enaa etsita, m
const VT = 1;                     // toiminn_lk <= VT on paatie
const PAATIE_MATKA = 150;         // kuinka kaukaa haaran kohde etsitaan

export const sol = p => `${Math.round(p[0] / TARK)}_${Math.round(p[1] / TARK)}`;
export const pit = c => { let s = 0;
  for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i-1][0], c[i][1] - c[i-1][1]);
  return s; };

/** Verkko: solmu -> [[linkki, kaannettavako]]. Kaikki linkit, ei vain kevyet. */
export function verkota(linkit) {
  const V = new Map();
  for (const f of linkit) {
    const g = f.geometry.coordinates;
    for (const [k, e] of [[false, g[0]], [true, g[g.length - 1]]]) {
      const n = sol(e); if (!V.has(n)) V.set(n, []); V.get(n).push([f, k]);
    }
  }
  return V;
}

const ulos = (f, k) => k ? f.geometry.coordinates.slice().reverse() : f.geometry.coordinates;

/** Johtaako haara paatielle? Seurataan kevytverkkoa kunnes tulee autotie. */
function paatielle(V, f0, k0) {
  let f = f0, k = k0, edel = f0.properties.link_id, s = 0;
  for (let i = 0; i < 25; i++) {
    const g = ulos(f, k); s += pit(g);
    const naap = (V.get(sol(g[g.length - 1])) ?? []).filter(([x]) => x.properties.link_id !== edel);
    const autot = naap.filter(([x]) => x.properties.linkkityyp !== 8);
    if (autot.length) return autot.some(([x]) => x.properties.toiminn_lk <= VT) && s <= PAATIE_MATKA;
    if (!naap.length || s > PAATIE_MATKA) return false;
    [f, k] = naap[0]; edel = f.properties.link_id;
  }
  return false;
}

/**
 * Yhden suuaukon nakema: matka ensimmaiseen konfliktiristeykseen ULOSPAIN.
 *
 * SENSUROINTI. Jos konfliktia ei loydy 80 metrin sisalla, suuaukko EI putoa
 * pois vaan saa arvon 80 m. Se on oikea tulos eika puuttuva: 80 m on nelinkertainen
 * suositeltavaan 20 metriin nahden, joten suuaukko lapaisee jokaisen rajan riippumatta
 * siita mita 81. metrilla on. Pudottaminen poistaisi nimenomaan HYVAT tapaukset
 * nimittajasta — Jyvaskylassa 73 suuaukkoa 382:sta, eli mittari naytti kaupungin
 * huonompana kuin se on. Sama koskee tapausta jossa kaikki haarat ovat
 * valtatiehaaroja: silloin pyoraliikenteen konfliktia ei ole.
 *
 * Umpikuja on eri asia ja palauttaa null. Kunta-aineisto on leikattu kuntarajalta,
 * joten verkon paattyminen voi olla joko todellinen umpikuja tai aineiston reuna,
 * eika niita erota toisistaan. Tuntematonta ei lasketa lapimenneeksi.
 *
 * Palauttaa { m, aste, kevyita, x, y, sensuroitu } tai null.
 */
export function nakemaSuulta(V, alikulku, paa, laskuri) {
  const kielletty = alikulku.properties.link_id;   // tunnelin lapi ei saa kulkea
  let n = sol(paa), edel = kielletty, s = 0;
  for (let i = 0; i < 14; i++) {
    const solmu = V.get(n) ?? [];
    const naap = solmu.filter(([x]) =>
      x.properties.link_id !== edel && x.properties.link_id !== kielletty);
    if (!naap.length) return null;                 // umpikuja tai aineiston reuna
    const haarat = naap.map(([f, k]) => ({ f, k, tyyp: f.properties.linkkityyp,
      toim: f.properties.toiminn_lk, paatiehen: paatielle(V, f, k) }));
    const kelpaa = suodata('nakema', haarat, laskuri);
    if (kelpaa.length >= 2)
      return { m: s, x: paa[0], y: paa[1], aste: solmu.length, sensuroitu: false,
               kevyita: solmu.filter(([x]) => x.properties.linkkityyp === 8).length };
    if (!kelpaa.length) return sensuroitu(paa, solmu);   // ei pyoraliikenteen konfliktia
    const g = ulos(kelpaa[0].f, kelpaa[0].k);
    s += pit(g);
    if (s > MAX_KAVELY) return sensuroitu(paa, solmu);
    n = sol(g[g.length - 1]); edel = kelpaa[0].f.properties.link_id;
  }
  return sensuroitu(paa, V.get(n) ?? []);
}

const sensuroitu = (paa, solmu) => ({ m: MAX_KAVELY, x: paa[0], y: paa[1],
  aste: solmu.length, kevyita: solmu.filter(([x]) => x.properties.linkkityyp === 8).length,
  sensuroitu: true });

/** Kaikki alikulkujen suuaukot yhdesta kunnasta. */
export function suuaukot(features, laskuri) {
  const L = features.filter(f => f.geometry?.type === 'LineString'
    && f.geometry.coordinates.length >= 2);
  const V = verkota(L);
  const out = [];
  for (const A of L.filter(f => f.properties.linkkityyp === 8 && f.properties.silta_alik === -1)) {
    const g = A.geometry.coordinates;
    for (const [i, paa] of [[0, g[0]], [1, g[g.length - 1]]]) {
      const r = nakemaSuulta(V, A, paa, laskuri);
      if (!r) continue;
      out.push({ id: A.properties.link_id, suu: i,
                 x: Math.round(r.x), y: Math.round(r.y), m: Math.round(r.m * 10) / 10,
                 aste: r.aste, kevyita: r.kevyita, nimi: A.properties.tienimi_su || null,
                 ...(r.sensuroitu ? { sens: 1 } : {}) });
    }
  }
  return out;
}
