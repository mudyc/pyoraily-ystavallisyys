# pyöräily-ystävällisyys

Digiroadin tielinkeistä laskettu vertailu Suomen 20 suurimman kaupungin
pyöräilyinfrastruktuurista, mitattuna [Helsingin pyöräliikenteen
suunnitteluohjetta](https://pyoraliikenne.hel.fi/) vastaan.

Jokainen mittari on **osuus joka täyttää ohjeen vaatimuksen**, joten tavoite on
100 % eikä "paras aineistossa". Kaupunkisivulla osa ei ole arvosana vaan kartta
siitä mihin kannattaa mennä katsomaan.

## Mittarit

| Mittari | Mitä | Tila |
| --- | --- | --- |
| **Näkemät** | Matka alikulun suuaukolta lähimpään risteykseen. Ohje: 20 m suositeltava, 15 m tyydyttävä, 12 m minimi. | 5 844 suuaukkoa, 45 % alle 20 m |
| **Pysäkkisijainti** | Onko katos pyörätien ja ajoradan välissä. | 2 271 arvioitavaa, 43 % väärin |
| **Matkavastus** | *S = H² / L*, tavoite alle 0,2. Laskettu Z-koordinaateista. | 9 986 km verkkoa, 12,9 % yli 4 %:n kaltevuudessa |
| **Kokonaisarvio** | Kolmen edellisen keskiarvo. Puuttuva osa jätetään huomiotta. | |

## Mikä tässä on opittavaa muille kuin pyöräilijöille

Kolme asiaa toistui niin usein että ne ovat metodologia eivätkä yksityiskohtia.

**Kattavuus kaataa mittarin useammin kuin menetelmä.** `dr_leveys` kattaa
kevytväylistä 0,8 %, `dr_nopeusrajoitus` ja `dr_liikennemaara` 0,0 %, pysäkkien
maastokoordinaatti 0–94 % kunnasta riippuen. Kattavuus kertoo kuka on käynyt
mittaamassa, ei siitä mitä on rakennettu — ja jos se korreloi kaupungin kanssa,
mittari mittaa kirjaamiskäytäntöä.

**Kontrolli kaatoi useamman mittarin kuin aineisto.** "Valo mäen päällä",
"pysähdys alamäen pohjalla" ja "jyrkkä kaarre pysäkin kohdalla" näyttivät
kaikki merkittäviltä, kunnes ne vertasi satunnaiseen verkon pisteeseen:
rikastumat 0,62× … 1,02×. Ilman kontrollia olisi raportoitu kolme olematonta
löydöstä. Ks. `tools/`-skriptien kommentit.

**Koodistoa ei saa arvata.** `katos`-kentässä **1 = Ei ja 2 = Kyllä**, vastoin
Digiroadin tavanomaista konventiota. Koko pysäkkimittari laskettiin ensin
katoksettomille pysäkeille. Virhe näkyi aineistossa koko ajan: `katos = 1`
yhdessä `mainoskat = 2`:n kanssa esiintyi **nolla kertaa**, mikä on mahdollista
vain jos 1 = Ei.

## Hylätyt mittarit ja miksi

| Mittari | Syy |
| --- | --- |
| Pysähdys mäen päällä | Kaksi kontrollia antoi 2,03× ja 0,62×. Ero on nousun määritelmässä, ei datassa. Kommentoitu ulos `viz/index.html`:ssä perusteluineen. |
| Kaarre pysäkin kohdalla | Rikastuma 0,78× ja 1,02× — ei signaalia. |
| Pyörätien leveys | `dr_leveys` kattaa kevytväylistä 0,8 %. |
| Talvihoitoluokka | 11 % kattavuus, ja kartalla katsottuna merkinnät ovat satunnaisia eivätkä pääverkko. Kaksi arvoa (9, 10), joiden vastaavuutta K1/K2:een ei ole vahvistettu. |
| Erotteluperiaatteet (nopeus × liikennemäärä) | Molemmat lähtötiedot 0 % kevytverkolla. |
| B7 — väistämisvelvollisuus pyöräilijän tienylityspaikassa | Jyväskylässä 19 kpl, kaikki ajoradalla. Vastaan 124 B5/B6:ta kevytväylillä: etuajo-oikeus 13 % merkityistä kohdista. **Lupaava, mutta muita kaupunkeja ei ehditty hakea.** |

## Auki

- **Näkemämittarilla on kaksi menetelmää eikä sivu käytä EXCEPTION RULES -sääntöjä.**
  `tools/pisteet.mjs` (sivun luvut) mittaa suoran etäisyyden lähimpään risteykseen;
  `tools/nakemat2.mjs` kävelee verkkoa ja soveltaa valtatiesääntöä. Jyväskylä
  51 % vastaan 49 %. Nämä eivät ole yhdistettävissä: sääntö koskee haaroja, joita
  suora etäisyys ei katso.
- Nousun määritelmä (ketjutettu vs. ketjuttamaton) on ratkaisematta ja koskee
  myös matkavastusta.
- Hoitoluokkien 9 ja 10 vastaavuus K1/K2:een vahvistamatta.

## EXCEPTION RULES

`tools/poikkeukset.mjs` on nimetty rakenne mittausten poikkeuksille: jokainen
kantaa säännön, perustelun, lähteen ja mitatun vaikutuksensa. Poikkeus joka ei
ole luettavissa on sama asia kuin virhe — lukija ei voi arvioida tulosta
tuntematta niitä. Säännöt ovat **mittauskohtaisia**; ks. `suodata()`:n kommentti
siitä mitä tapahtui kun ne eivät olleet.

## Ajaminen

```bash
python3 tools/fetch.py 20     # Digiroad OGC API -> data/kunnat/ (~590 MB)
node tools/ingest.mjs         # (kutsutaan build.mjs:stä)
node tools/build.mjs          # -> data/pyoratiet.l0  (293 MB, 1 063 463 dokumenttia)
node tools/pisteet.mjs        # -> viz/kaupungit.json
node tools/matkavastus.mjs    # liittää matkavastuksen samaan
node tools/pysakit.mjs        # liittää pysäkkisijainnin samaan
node tools/serve.js . 8910    # http://127.0.0.1:8910/viz/index.html
```

Rajapinnan `offset` ei toimi — se palauttaa aina saman sivun — joten koko kunta
haetaan yhdellä isolla `limit`-arvolla. Siksi kuntaraja on jakoperuste.

## Artefakti

Linkit ja risteykset ovat samassa L0-artefaktissa. Risteykset lasketaan
rakennusaikana solmuasteesta, koska sen johtaminen kyselyhetkellä vaatisi koko
verkon lukemisen — mikä on juuri se mitä klusterointiavain on olemassa
välttämään.

Avain on `(kunta, laji) * 4^18 + hilbert(keskipiste)`: kunta ja laji korkeissa
biteissä, koska tutkielma tehdään kaupunki kerrallaan, ja Hilbert matalissa,
jotta naapurit ovat vierekkäin. Kunnan koko verkko — 37 345 linkkiä — on siksi
**2 kierrosta, 3 hakua, 10,5 MB, 20 ms**.

Sivujuonne joka kannattaa panna merkille: pelkkien kevytlinkkien hakeminen
maksaa *17 hakua ja 6,8 MB*, kun koko verkko maksaa 3 hakua ja 10,5 MB.
Vähemmän dataa, enemmän pyyntöjä — suodatettu joukko on hajallaan lohkon
sisällä. Predikaatti valitsee rivejä, ei tavuja.

## Aineistot

- [Digiroad](https://vayla.fi/vaylista/aineistot/digiroad/aineisto), Väylävirasto.
  Ylläpito on siirtynyt Fintrafficin PETI-järjestelmään ja avoin rajapinta on
  jäädytetty kevääseen 2026; tämä dokumentoi sen tilanteen.
- Väestö: Tilastokeskus, kuntien asukasluvut 31.12.2025.
- Indeksi ja lukija: [serverless_index](https://github.com/mudyc/serverless_index).

Koodi MIT, aineistot lähteidensä ehdoilla.
