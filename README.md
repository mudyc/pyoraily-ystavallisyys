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
| **Näkemät** | Matka alikulun suuaukolta ensimmäiseen risteykseen **ulostulosuunnassa**. Ohje: 20 m suositeltava, 15 m tyydyttävä, 12 m minimi. | 6 054 suuaukkoa, 32 % alle 20 m |
| **Pysäkkisijainti** | Onko katos pyörätien ja ajoradan välissä. | 2 865 arvioitavaa, 39 % väärin, 15 kaupunkia |
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

**Suunta on osa mittausta, ei yksityiskohta.** Näkemä mitattiin aluksi suorana
etäisyytenä lähimpään risteykseen. Lyhyellä alikululla se löysi **molemmille
suille saman risteyksen** — sen joka on tunnelin takana ja jonne pääsee vain
kulkemalla tunnelin läpi. Jyväskylässä 15 alikulkua sai näin kaksi alle 12 metrin
arvoa yhdestä havainnosta, ja Espoon 12-metrinen `a489974d` merkittiin molemmista
päistä vaikka risteys on vain toisessa. Korjaus on kävellä verkkoa ulospäin ja
kieltää alikulun oma linkki koko kävelyn ajaksi. Virheen huomasi käyttäjä
kartalta, ei testi: *molemmat päät vaarallisia* on uskottava tulos, ja juuri
siksi se meni läpi.

**Puuttuva tulos on yleensä hyvä tulos, ja sen pudottaminen on vinouma.**
Verkkokävely ei löydä risteystä 80 metrin sisällä 1 851 suuaukolta — ne ovat
mittarin **parhaat** tapaukset, koska 80 m on nelinkertainen vaatimukseen nähden.
Niiden hylkääminen "puuttuvana" näytti jokaisen kaupungin huonompana kuin se on;
Jyväskylä 60 % eikä 49 %. Sensurointi kiinteään 80 metriin on oikea luku, ei
paikkaus. Aito umpikuja jää pois, koska kunta-aineisto on leikattu kuntarajalta
eikä verkon loppumista erota aineiston reunasta.

**Koordinaatisto ei ole aineiston ominaisuus vaan kunnan.** Digiroad julkaisee
pysäkin maastokoordinaatin Oulussa, Kuopiossa, Mikkelissä ja Vaasassa
**WGS84-asteina** ja muualla TM35FIN-metreinä — Kuopiossa molempia samassa
kunnassa (584 astetta, 68 metriä). Tampereella 47 riviä on x ja y väärin päin.
Oulun koko katosmittaus hävisi tähän: jokainen 399:stä katoksesta hylättiin
"ei pyörätietä 30 metrissä", koska pisteet olivat Atlantilla. Oulu putosi
vertailusta kokonaan ja näytti kaupungilta jolta puuttuu tieto, vaikka sillä on
maan paras kattavuus. Korjattuna Oulu on **kolmanneksi paras**, 20 % väärin.

Kaksi asiaa teki tästä hiljaisen. Kaupunki, jolta ei jäänyt yhtään arvioitavaa,
putosi taulukosta eikä sen hylkäyssyitä tulostettu lainkaan — joten "399 hylättiin
samasta syystä" ei näkynyt missään. Ja 100 % hylkäysosuus näyttää uskottavalta
puuttuvalta aineistolta. Kumpikin on nyt tulosteessa: `tools/pysakit.mjs` listaa
pudonneet kaupungit syineen ja kertoo mikä koordinaattitulkinta osui mihinkin.

**Mittaustarkkuus kuuluu mitata, ei arvioida.** Kysymykseen "mikä on väärin, jos
katos on oikein ja ero alle 3 m?" ensimmäinen vastaukseni oli lisätä kolmas luokka:
alle 3 metrin ero jätettäisiin ratkaisematta. Se oli väärin. Oikein sijoitettu
katos tuottaa *luonnostaan* parin metrin eron — noin 2 m syvä katos pyörätien
edessä — joten pieni ero on normaalitapaus eikä epäselvyys, ja kaista olisi
pudottanut 34 % aineistosta oletetun virherajan perusteella.

Todellinen epätarkkuus oli muualla ja mitattavissa. Lähin pyörätien piste haettiin
**taitepisteistä**, ei viivalta, ja pysäkit ovat suorilla osuuksilla joilla
taitepisteväli on p90 = 14 m ja enimmillään 356 m. Virhe pyörätien etäisyydessä
oli mediaanilla 0,10 m, p90 1,1 m, p99 10,4 m, ja luokitus vaihtui **4,8 %:ssa**
tapauksista. Kolmen metrin kaista olisi siis heittänyt kolmanneksen aineistosta
viiden prosentin ongelman takia. Korjaus on projisoida segmentille, jolloin virhe
poistuu sen sijaan että se peitettäisiin. Luokitus pysyy binäärisenä, koska
neutraalia fyysistä tilaa ei ole: katos on joko välissä tai takana.

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
| PETI (Fintrafficin pysäkkikanta) | Digiroadin pysäkkitiedon seuraaja, avoin NeTEx-dump kahdesti päivässä. Ei auta: sama aineisto (`publisher = DGR`, `digiroad_id`-avain, katosmäärät täsmäävät ±5 %), ja **katoksella ei ole omaa koordinaattia** — `ShelterEquipment` kantaa vain `Seats`/`Enclosed`, ja `EquipmentPlace`, `EquipmentPosition` ja `AccessSpace` esiintyvät nolla kertaa. Digiroadin maastokoordinaatti ei siirtynyt mukana, joten PETI menettää juuri sen kentän jolla mittari tehdään. Uudet kentät liian harvoja: valaistus 9 % (0 % Helsingissä, Espoossa, Vantaalla ja Seinäjoella), `WheelchairAccess` 95 % unknown, `Enclosed` 35 kpl koko maassa, pyöräpysäköinti 2 kpl. |
| B7 — väistämisvelvollisuus pyöräilijän tienylityspaikassa | Jyväskylässä 19 kpl, kaikki ajoradalla. Vastaan 124 B5/B6:ta kevytväylillä: etuajo-oikeus 13 % merkityistä kohdista. **Lupaava, mutta muita kaupunkeja ei ehditty hakea.** |

## Auki

- Nousun määritelmä (ketjutettu vs. ketjuttamaton) on ratkaisematta ja koskee
  myös matkavastusta.
- Hoitoluokkien 9 ja 10 vastaavuus K1/K2:een vahvistamatta.
- Katoksen sijainti on yhden lähteen varassa. Digiroadin maastokoordinaatti
  kattaa 16 % katoksista eikä PETI tuo tilalle mitään (ks. hylätyt). Jos mittari
  halutaan vertailukelpoiseksi, koordinaatin pitää tulla muualta — OSM:ssä
  `amenity=shelter` on oma solmunsa omine koordinaatteineen.
- Viisi kaupunkia (Kouvola, Salo, Tampere, Turku, Vaasa) jää yhä pysäkkivertailun
  ulkopuolelle: yhdelläkään niiden katoksellisista pysäkeistä ei ole
  maastokoordinaattia.
- Hämeenlinnassa maastokoordinaatti on mediaanilla 179 m päässä pysäkin omasta
  geometriasta, kun muualla ero on 5–20 m. Syy on selvittämättä.
- Umpikujaan päättyvät suuaukot jäävät pois (Jyväskylässä 8 / 382). Kuntarajalta
  leikattu aineisto ja todellinen umpikuja näyttävät samalta; erottaminen vaatisi
  naapurikunnan verkon.

## EXCEPTION RULES

Näkemä lasketaan yhdessä paikassa, `tools/nakema.mjs`:ssä, jota sekä sivun data
(`tools/pisteet.mjs`) että tarkistusajo (`tools/nakemat2.mjs`) kutsuvat. Ne antoivat
aiemmin eri tuloksen samasta mittarista, mikä tarkoitti ettei kumpikaan luku ollut
tarkistettu.

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
node tools/split-artifact.js data/pyoratiet.l0   # -> 7 osaa a 45 MiB, nama ovat repossa
node tools/pisteet.mjs        # -> viz/kaupungit.json + viz/nakema-saannot.json
node tools/matkavastus.mjs    # liittää matkavastuksen samaan
node tools/pysakit.mjs        # liittää pysäkkisijainnin samaan
node tools/nakemat2.mjs       # sama näkemämittaus, tulostaa EXCEPTION RULES -osumat
node tools/serve.js . 8910    # http://127.0.0.1:8910/viz/index.html
```

Rajapinnan `offset` ei toimi — se palauttaa aina saman sivun — joten koko kunta
haetaan yhdellä isolla `limit`-arvolla. Siksi kuntaraja on jakoperuste.

## Artefakti

Artefakti on repossa **paloiteltuna**: kokonainen tiedosto on 293 MB eikä GitHub
tarjoile yli 100 MiB:n tiedostoja, mutta seitsemän 45 MiB:n osaa kyllä.
`ChunkedHttpTransport` kuvaa globaalin tavuvälin osille, joten lukija näkee yhden
yhtenäisen tiedoston eikä formaatissa muutu mitään. Paikallisesti kokonainen
tiedosto riittää, jolloin pudotaan tavalliseen `HttpTransport`iin.

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
  Ylläpito on siirtynyt Fintrafficin [PETI](https://www.fintraffic.fi/fi/digitaalisetpalvelut/fintrafficin-datapalvelut/liikkumisen-tietopalvelut/peti)-järjestelmään
  ja avoin rajapinta on jäädytetty kevääseen 2026; tämä dokumentoi sen tilanteen.
  PETI julkaisee pysäkit NeTEx- ja GTFS-dumppeina kahdesti päivässä, ja
  `digiroad_id` yhdistää ne tähän aineistoon — päivityspolku on siis olemassa,
  mutta uusia mitattavia kenttiä se ei tuo.
- Väestö: Tilastokeskus, kuntien asukasluvut 31.12.2025.
- Indeksi ja lukija: [serverless_index](https://github.com/mudyc/serverless_index).

Koodi MIT, aineistot lähteidensä ehdoilla.
