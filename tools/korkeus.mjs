/**
 * Korkeusprofiilin jaettu koneisto: linkkien ketjutus ja yhtajaksoiset nousut.
 *
 * Omana moduulinaan siksi, etta sita kayttaa kaksi mittaria - matkavastus ja
 * alamaen jalkeinen risteys - ja kaksi toteutusta samasta asiasta tarkoittaa
 * ettei kumpaakaan lukua ole tarkistettu. Nakemamittarilla kavi juuri niin.
 *
 * ALAMAKI on nousu toiseen suuntaan. `nousut()` palauttaa nousun alkupisteen
 * `g[0]`:ssa ja harjan `x,y`:ssa, joten ketjun kaantaminen antaa alamaen pohjan
 * samalla koodilla: kaannetyssa ketjussa nousun ALKU on alamaen pohja.
 */
export const TARK = 0.6;
export const DIPPI = 0.3;          // nain suuri notko ei katkaise nousua
export const HARVA = 10;           // pisteiden harvennusvali, m

export const sol = p => `${Math.round(p[0] / TARK)}_${Math.round(p[1] / TARK)}`;
export const d2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Linkit ketjuiksi: yhdistetaan solmujen lapi joissa reitti jatkuu yksikasitteisesti. */
export function ketjuta(linkit) {
  const V = new Map();
  for (const L of linkit) for (const [k, e] of [[false, L.c[0]], [true, L.c[L.c.length - 1]]]) {
    const n = sol(e); if (!V.has(n)) V.set(n, []); V.get(n).push([L, k]);
  }
  const kaytetty = new Set(), ketjut = [];
  const ulos = (L, k) => k ? L.c.slice().reverse() : L.c;
  const jatko = (n, edel) => {
    const h = (V.get(n) ?? []).filter(([L]) => L.id !== edel);
    return h.length === 1 ? h[0] : null;          // aste 2 = yksi jatko
  };
  for (const L0 of linkit) {
    if (kaytetty.has(L0.id)) continue;
    kaytetty.add(L0.id);
    let c = L0.c.slice();
    // kasvata molempiin suuntiin
    for (const loppuun of [true, false]) {
      let edel = L0.id, n = sol(loppuun ? c[c.length - 1] : c[0]);
      for (let i = 0; i < 400; i++) {
        const j = jatko(n, edel); if (!j) break;
        const [L, k] = j; if (kaytetty.has(L.id)) break;
        kaytetty.add(L.id);
        const g = ulos(L, k);
        if (loppuun) c = c.concat(g.slice(1));
        else c = g.slice(0, -1).reverse().concat(c);
        edel = L.id; n = sol(loppuun ? c[c.length - 1] : c[0]);
      }
    }
    ketjut.push(c);
  }
  return ketjut;
}

/**
 * Yhtajaksoiset nousut ketjusta. Pieni notko ei katkaise.
 * Harjan sijainti otetaan talteen, koska mittari "maen jalkeen ei saisi olla
 * valoristeysta" tarvitsee tietaa MISSA nousu paattyy.
 */
export function nousut(c) {
  const out = [];
  let alkuZ = c[0][2], huippuZ = c[0][2], huippuP = c[0], pit = 0, nousuPit = 0, auki = false;
  let alkuI = 0, huippuI = 0;
  const sulje = () => {
    const H = huippuZ - alkuZ;
    if (H > 0.5 && nousuPit > 5)
      out.push({ H, L: nousuPit, S: H * H / nousuPit, x: huippuP[0], y: huippuP[1],
                 // alkupiste omana kenttanaan: kaannetyssa ketjussa tama on
                 // alamaen POHJA, ja se on alamakimittarin mittauskohta
                 ax: c[alkuI][0], ay: c[alkuI][1],
                 // Nousun geometria alusta harjalle: sivun hehku tarvitsee patkan, ei
                 // pistetta. Harvennettuna, koska hehku ei tarvitse metrin tarkkuutta -
                 // taysi tarkkuus olisi 25,7 pistetta nousua kohti ja 4,3 MB tiedosto.
                 g: harvenna(c.slice(alkuI, huippuI + 1)) });
  };
  for (let i = 1; i < c.length; i++) {
    const dl = d2(c[i - 1], c[i]); if (dl < 1e-6) continue;
    const z = c[i][2];
    pit += dl;
    if (z > huippuZ) { huippuZ = z; huippuP = c[i]; huippuI = i; nousuPit = pit; auki = true; }
    if (auki && huippuZ - z > DIPPI) {            // notko liian syva: nousu paattyy
      sulje();
      alkuZ = z; huippuZ = z; huippuP = c[i]; alkuI = huippuI = i; pit = 0; nousuPit = 0; auki = false;
    }
    if (!auki && z < alkuZ) { alkuZ = z; alkuI = i; }   // laskussa: nousun lahtotaso laskee
  }
  if (auki) sulje();
  return out;
}

/** Pisteiden harvennus: pidetaan paat ja muut vahintaan HARVA metrin valein. */
export function harvenna(c) {
  if (c.length <= 2) return c.map(q => [Math.round(q[0]), Math.round(q[1])]);
  const out = [c[0]]; let edel = c[0];
  for (let i = 1; i < c.length - 1; i++)
    if (d2(edel, c[i]) >= HARVA) { out.push(c[i]); edel = c[i]; }
  out.push(c[c.length - 1]);
  return out.map(q => [Math.round(q[0]), Math.round(q[1])]);
}

