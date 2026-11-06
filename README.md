# Ønskje

Ønskjelister utan reklame. Lag fleire lister, ranger ønska (dra for å endre rekkjefølgja),
del lista med ei lenkje, og la familien reservere det dei vil kjøpe – utan at eigaren ser det.

- **Finn**-fana: søk opnar Prisjakt (prissamanlikning) og ti norske butikkar med søkeordet.
  Lim inn lenkja til produktet du fann, så hentar appen namn, bilete og pris automatisk.
- Prisjakt-, IKEA- og Clas Ohlson-lenkjer gir alt. Elkjøp, Komplett og Zalando stengjer for
  automatisk henting – då blir namnet lese ut av sjølve lenkja, og prisen skriv du inn.
- Kvart ønske har «Samanlikn prisar på Prisjakt».
- Ingen konto trengst for å starte (anonym konto per eining). «Vel brukarnamn» gir namn + passord
  og ein gjenopprettingskode, så listene kan opnast på mobil og PC.

## Filer

| Fil | Kva |
| --- | --- |
| `index.html` | Heile appen (HTML, CSS, JS). Font: Bricolage Grotesque. |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: kan leggjast på heimeskjermen, deling frå andre appar (Android). |
| `worker/worker.js` | Cloudflare Worker `onskje`: kontoar, lister, deling, reservasjonar, lenkjehenting. |
| `worker/schema.sql` | D1-tabellar. |

## Lokal testing

Preview-oppsett i `C:\Claude\.claude\launch.json`: `onskje` (python http.server :8768) og
`onskje-worker` (wrangler dev :8788). Appen på localhost snakkar automatisk med :8788.
Første gong: `wrangler d1 execute onskje --local --file schema.sql` i `worker/`.

Wrangler: `node C:\Claude\stordbrann\worker\node_modules\wrangler\bin\wrangler.js …`

## Publisering

- Worker: `wrangler d1 create onskje` (set database_id i `wrangler.toml`),
  `wrangler d1 execute onskje --remote --file schema.sql`, `wrangler deploy`.
- App: GitHub Pages frå `main /` i repoet `Lillerud-land1/onskje`.
- Etter endringar i appen: køyr `bash versjon.sh` før commit. Då får appen beskjed om ny versjon
  når nokon dreg ned / trykkjer Oppdater, eller opnar appen att (utan å måtte lukke henne).
- Auk `CACHE` i `sw.js` berre når sw.js eller SHELL-filene endrar seg.

## Personvern

Reservasjonar blir aldri sende til eigaren av lista (serveren held dei att). Ein gjest kan
angre sin eigen reservasjon med ein nøkkel som berre ligg på eininga hans. Ingen sporing,
ingen reklame, ingen logging av førespurnader i workeren.
