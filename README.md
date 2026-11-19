# SwingMirror 0.9 – Capacitor-projekt (iOS + Android)

Samme webkode som 0.8, pakket som rigtig app med Capacitor 8. Én kodebase bygger både iPhone/iPad- og Android-appen.

## Hvad er ændret siden 0.8

| Område | Før | Nu |
|---|---|---|
| PeerJS | Hentet fra unpkg.com ved hver start | Ligger lokalt i appen (`www/vendor`) |
| Gem optagelse | Gemte et enkelt billede (`<a download>`, virker ikke i app) | **Gem optagelse** gemmer et videoklip af det seneste (forsinkelse + 10 sek.) i Fotos (iOS) / album "SwingMirror" (Android). Der gemmes aldrig noget, medmindre man trykker |
| Skærm i dvale | Ikke håndteret | Holdes vågen, mens kamera kører eller viewer er forbundet |
| Billedfrekvens i buffer | ca. 8 fps (JPEG som base64-tekst) | op til 30 fps (JPEG-blobs, lavere hukommelse) |
| Ændring af spejl/Fit/Fill/kvalitet/forsinkelse | Tømte bufferen | Tømmer ikke bufferen længere |
| Fill | Havde reelt ingen effekt | Beskærer nu billedet til skærmen (tydeligst i Golf Mode) |
| Forbindelse | Låst til PeerJS' delte servere | Egen server og TURN kan sættes i `www/config.js` |
| Android-tilbageknap | – | Afslutter Golf Mode først |
| Kamera afbrudt i baggrunden | Døde tavst | Appen fortæller, at kameraet skal startes igen |

Pairing-koderne er uændrede, så den nye app kan forbindes med din gamle GitHub Pages-version under test.

## Kom i gang på Windows (Android)

1. Installer **Node.js LTS** og **Android Studio**.
2. I projektmappen:
   ```
   npm install
   npm run native:add     # opretter android/ og ios/ og tilføjer tilladelser
   npm run sync
   npm run open:android   # åbner Android Studio – tryk Run med en telefon/emulator
   ```
3. Efter hver kodeændring i `www/`: `npm run sync`.

Kamera virker ikke i emulatorer på samme måde som på en rigtig telefon – test på en fysisk enhed.

## iOS uden Mac

`ios/`-mappen oprettes af `npm run native:add` også på Windows, men bygning og signering kræver Xcode. Uden Mac bruges en cloud-build-tjeneste (fx Codemagic eller GitHub Actions med macOS) sammen med en Apple Developer-konto (ca. 99 USD/år). Testversioner installeres på iPhone/iPad via TestFlight. Selve build-opsætningen laves som næste skridt.

## Stabil forbindelse (gør før udgivelse)

Uden ændringer bruger appen PeerJS' gratis offentlige signaleringsserver og delte TURN-servere. Det er fint til test, men ikke noget at bygge en udgivet app på. I `www/config.js` kan du angive:

- **Egen PeerJS-server** (`peerjs-server` på npm, kan køre på en lille VPS eller hos fx Fly.io/Render).
- **Egen TURN-server** (coturn på samme VPS) eller en TURN-tjeneste (fx Cloudflare eller Twilio). Gem helst ikke faste adgangskoder i appen i produktion; brug kortlivede legitimationsoplysninger fra en lille backend.

## Før udgivelse

- Skift `appId` i `capacitor.config.json` (nu `dk.swingmirror.app`). Det kan ikke ændres efter udgivelse.
- App-ikon (1024×1024 px) og splash screen – kan genereres med `@capacitor/assets`.
- Privatlivspolitik på en offentlig webadresse (kræves af begge butikker).
- App Store/Google Play: skærmbilleder, beskrivelse, aldersgrænse, privatlivsoplysninger.

## Sådan virker "Gem optagelse"

Under almindelig øvning gemmes intet. Viewer'en holder kun de seneste ca. 27 sekunder i hukommelsen. Efter et slag trykker man på **Gem optagelse**, og de seneste (forsinkelse + 10) sekunder gemmes som video. Klippet optages i realtid i baggrunden, så det tager lige så lang tid at gemme, som klippet varer (der vises en fremdrift). Man kan øve videre imens, men appen skal være åben.
Hjælpelinjer/gitter og spejlvending kommer kun med i optagelsen, hvis de er slået til.

## Kendte begrænsninger

- Når appen går i baggrunden, stopper iOS/Android kameraet. Appen skal være åben på kameraenheden.
- Video-optagelsen bruger telefonens indbyggede videoindkodning (`MediaRecorder`). Tjek især, at filen kan afspilles og ligger i Fotos/galleriet på både iPhone/iPad og Android.
- Koden er ikke testet på rigtige enheder endnu. Tjek især: kamera-tilladelse, gem optagelse (video), statuslinje/udsnit øverst på Android, og forbindelse over mobilnet/hotspot.
