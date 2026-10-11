/**
 * EXCEPTION RULES — nakemamittauksen poikkeukset.
 *
 * Perusmittaus on yksinkertainen: alikulun suulta kavellaan ulospain, ja
 * ensimmainen solmu jossa kohtaa vahintaan kaksi muuta haaraa on konflikti-
 * piste. Sen etaisyys on kaytettavissa oleva nakemaalue.
 *
 * Kaikki haarat eivat kuitenkaan ole konflikteja. Nama poikkeukset kertovat
 * mitka jatetaan laskematta ja miksi. Jokainen on tassa nakyva merkinta eika
 * ehto koodin sisalla, koska poikkeus joka ei ole luettavissa on sama asia
 * kuin virhe: lukija ei voi arvioida tulosta tuntematta niita, eika kukaan
 * muista vuoden paasta mita koodin `continue` tarkoitti.
 *
 * Jokainen saanto mittaa myos oman vaikutuksensa, joten taulukosta nakee
 * paljonko kukin siirtaa lopputulosta. Saanto joka ei siirra mitaan on
 * turha; saanto joka siirtaa paljon pitaa perustella hyvin.
 *
 * `mittaus` kertoo mihin mittaukseen saanto kuuluu, koska niita on nyt useampi
 * eivatka ne jaa samoja kohteita.
 */

/** @typedef {{ f: object, k: boolean, pit: number, dz: number, toim: number|null,
 *              tyyp: number, paatiehen: boolean }} Haara */

export const POIKKEUKSET = [
  {
    mittaus: 'nakema',
    id: 'valtatie',
    nimi: 'Valtatielle nouseva haara',
    saanto: 'Haara, joka saavuttaa toiminn_lk ≤ 1 -tien 150 metrin sisalla, '
          + 'ei ole konfliktihaara.',
    perustelu:
      'Valtatiella ei kulje pyoraliikennetta. Helsingin ohjeen Kuva 4 koskee '
      + 'pyorateiden KESKINAISIA risteamisia, ja paatien ylitykselle on oma '
      + 'vaatimuksensa — se on eri mittaus, ei tama. Alikulun rampit nousevat '
      + 'tyypillisesti juuri sille tielle jonka ali kuljetaan, joten ilman tata '
      + 'saantoa jokainen kunnollinen alikulku saisi konfliktipisteen omasta '
      + 'rakenteestaan.',
    huom:
      'Tama ei ole ramppisaanto. Ramppi, joka vie toiselle kevyen liikenteen '
      + 'vaylalle, ON konfliktipiste ja lasketaan mukaan. Merkitsevaa on mihin '
      + 'haara johtaa, ei se onko se jyrkka.',
    lahde: 'Havainto: valtatiella ei kulje pyoria. Vahvistettu Digiroadin '
         + 'toiminn_lk-luokituksesta (1 = Nelostie, Ysitie, Keuruuntie).',
    /** @param {Haara} h */
    ohita: h => h.paatiehen,
  },
  {
    mittaus: 'pysakit',
    id: 'katos-ilman-koordinaattia',
    nimi: 'Katos ilman maastokoordinaattia',
    saanto: 'Pysakki, jolla katos = 2 (Kylla) mutta maastokoordinaattia ei ole '
          + 'annettu, kasitellaan kuin katosta ei olisi.',
    perustelu:
      'Mittaus koskee katoksen SIJAINTIA suhteessa pyoratiehen. Pysakin geometria '
      + 'on tielinkille napsautettu piste, jonka kohtisuora etaisyys tiesta on nolla '
      + '- siita ei ratkea kummalla puolella tieta katos on. Maastokoordinaatti on '
      + 'mitattu todellinen sijainti ja eroaa geometriasta mediaanilla 10 m. Ilman '
      + 'sita ei ole mitaan mitattavaa, joten tieto "katos on olemassa" ei yksin '
      + 'riita tekemaan pysakista arvioitavaa.',
    huom:
      'Tama EI korjaa vertailukelpoisuutta. Maastokoordinaatin kattavuus vaihtelee '
      + 'kunnittain 0 %:sta 94 %:iin, ja se kertoo maastokayntien historiasta eika '
      + 'pyorailysta. Saanto tekee rajauksesta nakyvan ja maaritellyn sen sijaan '
      + 'etta puuttuva tieto suodattaisi hiljaa - mutta kaupunkien paremmuus'
      + 'jarjestysta tasta ei edelleenkaan saa.',
    lahde: 'Kayttajan paatos: "jos maastokoordinaattia ei ole annettu, kayttaydy '
         + 'kuin katosta ei olisi." Koodiarvot: Vaylaviraston Tietolajien kuvaus, '
         + 'katos 1 = Ei, 2 = Kylla, 3 = Rakenteilla.',
    /** @param {{katos:number, mx:number|null}} p */
    // Digiroadin koodisto: katos 1 = Ei, 2 = Kylla, 3 = Rakenteilla.
    // EI 1 = kylla, vaikka moni muu Digiroadin kentta niin tekee.
    ohita: p => p.katos !== 2 || p.mx == null,
  },
];

/** Yhden mittauksen saannot. */
export const saannot = mittaus => POIKKEUKSET.filter(p => p.mittaus === mittaus);

/**
 * Jattaa jaljelle kohteet jotka eivat osu yhteenkaan saantoon, ja kirjaa mika
 * saanto poisti mita.
 *
 * `mittaus` on PAKOLLINEN: saannot koskevat eri kohdelajeja - haaroja, pysakkeja -
 * eivatka ne ymmarra toistensa kenttia. Ilman rajausta pysakkisaanto
 * (`p.katos !== 1`) hylkaisi jokaisen haaran, koska haaralla ei ole `katos`-
 * kenttaa ja `undefined !== 1` on tosi. Se olisi hiljainen virhe: mittaus ei
 * kaadu vaan palauttaa nollan.
 */
export function suodata(mittaus, kohteet, laskuri) {
  const omat = saannot(mittaus);
  if (!omat.length && POIKKEUKSET.length)
    throw new Error(`suodata: tuntematon mittaus "${mittaus}" - saantoja ei ole`);
  const jaljella = [];
  for (const h of kohteet) {
    const osuma = omat.find(p => p.ohita(h));
    if (osuma) { if (laskuri) laskuri[osuma.id] = (laskuri[osuma.id] ?? 0) + 1; continue; }
    jaljella.push(h);
  }
  return jaljella;
}

/**
 * Mittaus, joka saa syotetta mutta tuottaa nollan, on rikki kaytannossa aina.
 *
 * Tama on olemassa koska se tapahtui: pysakkisaanto lisattiin jaettuun
 * rekisteriin, se sovellettiin haaroihin joilla ei ole `katos`-kenttaa,
 * `undefined !== 1` oli tosi ja jokainen haara karsiutui. Nakemamittaus
 * tulosti `YHTEENSA 0  NaN%` eika kaatunut, koska JavaScriptissa puuttuva
 * kentta on `undefined`, vertailu siihen on kelvollinen totuusarvo ja 0/0 on
 * NaN jonka `toFixed` muotoilee merkkijonoksi. Kolme kertaa perakkain virhe
 * muuttui arvoksi.
 *
 * Halvin vastatoimi on tama: jos syotetta oli ja tulosta ei, pysahdy.
 */
export function tarkista(nimi, syote, tulos) {
  if (syote > 0 && tulos === 0)
    throw new Error(`${nimi}: ${syote} kohdetta sisaan, 0 ulos. ` +
      'Mittaus on rikki - tarkista suodattimet ja EXCEPTION RULES.');
  return tulos;
}

/** Luettava yhteenveto, sama teksti koodissa ja sivulla. */
export function kuvaus(mittaus) {
  return (mittaus ? saannot(mittaus) : POIKKEUKSET).map(p => ({
    mittaus: p.mittaus, id: p.id, nimi: p.nimi, saanto: p.saanto,
    perustelu: p.perustelu, huom: p.huom, lahde: p.lahde,
  }));
}
