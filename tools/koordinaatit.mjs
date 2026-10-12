/**
 * Maastokoordinaatin normalisointi: Digiroad julkaisee maast_x/maast_y eri
 * kunnissa eri koordinaattijarjestelmassa.
 *
 * Oulussa 1 356 pysakin maast_x on valilla 25,2–25,9 — se on WGS84-asteita, ei
 * TM35FIN-metreja. Koko kaupungin katosmittaus putosi siihen: jokainen 399:sta
 * katoksesta hylattiin "ei pyoratieta 30 m:ssa", koska pisteet olivat Atlantilla
 * paivantasaajan tuntumassa. 399/399 samasta syysta ei ole loydos vaan vika.
 *
 * Sama koskee Kuopiota (584 astetta / 68 metria samassa kunnassa), Mikkelia ja
 * Vaasaa. Osalla rivaista x ja y ovat lisaksi vaarin pain.
 *
 * Tunnistus on karkea mutta yksikasitteinen: Suomi on TM35FIN:ssa itakoordinaatti
 * 50 000–800 000 ja pohjoiskoordinaatti 6,6–7,8 miljoonaa, joten mikaan oikea
 * metriarvo ei voi olla alle sadan. Muunnos tarkistetaan vertaamalla tulosta
 * pysakin tielle napsautettuun x,y:hyn — ne ovat samaa pysakkia ja siksi
 * kymmenien metrien paassa toisistaan.
 */

// JHS 197 / ETRS-TM35FIN: UTM-kaista 35N, GRS80.
const A = 6378137.0, F = 1 / 298.257222101;
const LON0 = 27 * Math.PI / 180, K0 = 0.9996, E0 = 500000;
const n = F / (2 - F);
const A1 = A / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64);
const e = Math.sqrt(2 * F - F * F);
const h = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180,
           13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
           61 * n ** 3 / 240 - 103 * n ** 4 / 140,
           49561 * n ** 4 / 161280];

/** WGS84 (lon, lat asteina) -> TM35FIN (E, N metreina). */
export function tm35(lon, lat) {
  const phi = lat * Math.PI / 180, l = lon * Math.PI / 180 - LON0;
  const Q = Math.asinh(Math.tan(phi)) - e * Math.atanh(e * Math.sin(phi));
  const beta = Math.atan(Math.sinh(Q));
  const et = Math.atanh(Math.cos(beta) * Math.sin(l));
  const xi = Math.asin(Math.sin(beta) * Math.cosh(et));
  let X = xi, Y = et;
  for (let i = 0; i < 4; i++) {
    const k = 2 * (i + 1);
    X += h[i] * Math.sin(k * xi) * Math.cosh(k * et);
    Y += h[i] * Math.cos(k * xi) * Math.sinh(k * et);
  }
  return [A1 * Y * K0 + E0, A1 * X * K0];
}

const metri = (x, y) => x > 5e4 && x < 8e5 && y > 6.5e6 && y < 7.9e6;
const aste  = (x, y) => x > 19 && x < 32 && y > 59 && y < 71;

/**
 * Palauttaa maastokoordinaatin TM35FIN-metreina, tai null jos sita ei ole tai
 * se ei ole tulkittavissa. `laskuri` kerryttaa mika tulkinta osui.
 */
export function maasto(mx, my, laskuri) {
  if (mx == null || my == null) return null;
  const lisaa = k => { if (laskuri) laskuri[k] = (laskuri[k] ?? 0) + 1; };
  if (metri(mx, my)) { lisaa('tm35fin'); return [mx, my]; }
  if (metri(my, mx)) { lisaa('tm35fin-kaannetty'); return [my, mx]; }
  if (aste(mx, my))  { lisaa('wgs84'); return tm35(mx, my); }
  if (aste(my, mx))  { lisaa('wgs84-kaannetty'); return tm35(my, mx); }
  lisaa('tulkitsematon');
  return null;
}
