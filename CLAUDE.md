# CLAUDE.md — Nijmegen Duckstad

Gedeeld overdrachtsdocument voor **Claude Code** én **Claude Cowork**.
Beide assistenten lezen dit bestand automatisch in als project-context.
Houd dit bestand actueel — elke beslissing, nieuwe afspraak of niet-
vanzelfsprekende keuze hoort hier te landen.

## Project

Marketing-/verkoopsite voor de **Rotary Badeendjesrace 2026** in
Nijmegen. Eigen domein, los van de fundraising-subsite op
`marcovanthiel.nl/fundraising/` (die hub blijft de overkoepelende
Rotary-Nijmegen-Stad-en-Land-fundraising tonen).

| Veld | Waarde |
|---|---|
| Datum evenement | **zaterdag 17 april 2027** |
| Start bedrijvenrace | 15:00 |
| Locatie | Spiegelwaal, Nijmegen |
| Eendje | €5 |
| Bedrijfseendje | €150 |
| Doelbedrag | €31.701 |
| Organisatie | Rotary Nijmegen Stad en Land |
| Partners | Rotaract Nijmegen + Roeivereniging Phocas |
| Contact | info@nijmegenduckstad.nl |
| Talen | NL-only |

## Hosting & deploy

- **Live**: `https://nijmegenduckstad.nl/` (en `www.nijmegenduckstad.nl`)
- **Repo**: `marcovanthiel/nijmegenduckstad` (public)
- **Cloudflare account ID**: `04865fcd4034789d3970c1b51950227c`
- **Cloudflare zone ID**: `1ceaf2106428d029b9c78df996d87846`
- **Type**: Cloudflare **Workers Static Assets** (geen Pages-project).
  Worker-service-naam: `nijmegenduckstad`. De Worker bevat geen
  eigen code; `wrangler.toml` declareert alleen `[assets]`.
- **Custom domains** zijn via Account-API aan de Worker gekoppeld
  (niet via `routes` in `wrangler.toml`).

### Deploy-pipeline (sinds 2026-06-17)

```
push naar main → .github/workflows/deploy.yml
              → cloudflare/wrangler-action@v3
              → wrangler deploy
              → site live in ~20 seconden
```

Vereiste GitHub-secrets (al gezet op de repo):
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Handmatig opnieuw deployen kan via: **Actions tab → "Deploy to
Cloudflare Workers" → Run workflow**.

## ⚠ Allerbelangrijkste regel: GitHub = single source of truth

**Niet meer direct `wrangler deploy` vanuit een lokale machine of een
andere omgeving.** Alle wijzigingen lopen via GitHub:

1. clone of pull `marcovanthiel/nijmegenduckstad`
2. edit + commit + push naar `main`
3. GitHub Actions verzorgt de deploy

Reden: tot 2026-06-17 had Cowork rechtstreeks naar de Worker gepushed.
Resultaat: GitHub liep maandenlang achter (april-2027-datum) terwijl
live al de september-2026-datum stond. Vervolgens raakte ook de live
state corrupt (alle subpages 307-loopten) en niemand wist welke van
de twee bronnen de waarheid was. Dit document bestaat om dat te
voorkomen.

Als je een **noodfix** rechtstreeks via wrangler doet (bv. CI is
kapot), zet de wijziging dan dezelfde dag terug in main zodat de
volgende push 'm niet weer overschrijft.

## Repo-structuur

```
.
├── wrangler.toml        # Worker-config, NIET aanpassen behalve voor
│                         # nieuwe asset-behandeling of compatibility_date
├── .assetsignore        # gitignore-equivalent voor wat NIET als asset
│                         # naar Cloudflare gaat (node_modules, .git, etc.)
├── .github/workflows/
│   └── deploy.yml       # auto-deploy bij push naar main
├── _headers             # security-headers (Workers Static Assets
│                         # ondersteunt dit, _redirects niet — zie hieronder)
├── index.html           # 8 pagina's plat HTML, kebab-case URL's
├── adopteren.html
├── evenement.html       # programma met tijden
├── prijzen.html
├── sponsoren.html
├── goede-doel.html
├── vrijwilligers.html   # ook bekend als "Meedoen" in de nav
├── contact.html
├── faq.html
├── 404.html             # fallback voor onbekende paden
├── robots.txt
├── sitemap.xml
└── assets/
    ├── css/style.css
    ├── img/{logo.svg, favicon.svg}
    └── js/
        ├── config.js    # 🎯 centrale plek voor datum, prijzen, doelen
        └── main.js      # countdown, teller, formulier-handlers
```

## Datum, tijd en cijfers wijzigen

Eén bron van waarheid: **`assets/js/config.js`**. Daarin staan
`eventDateISO`, `eventDateLabel`, prijzen, doelen, contact, social.
`main.js` rendert die in elementen met `data-*`-attributen.

Maar in de HTML zelf staan **óók** hardcoded datums op plekken die
buiten de `data-*`-flow vallen (sidebars, FAQ-antwoord, hero-tekst).
Bij datumwijzigingen 11 HTML-bestanden langslopen — niet alleen
`config.js`. Snelle grep:

```
grep -rn "17 april\|19 september\|2026-09\|13:30\|15:00" *.html assets/js/
```

(Vervang de patterns op de oude én nieuwe datum.)

## Bekende valkuilen / waarom-bestanden-zijn-zoals-ze-zijn

### `_redirects` werkt NIET op Workers Static Assets
Cloudflare Pages ondersteunt `_redirects` met status `200` (rewrite).
Workers Static Assets doet dat niet betrouwbaar — sub-pages gingen
in een 307-loop. **Vervangen** door `html_handling = "auto-trailing-
slash"` in `wrangler.toml`. Effect: `/adopteren` serveert
`adopteren.html` zonder redirect; `/adopteren.html` → 307 naar
`/adopteren`. Niet `_redirects` opnieuw toevoegen — gebruik
wrangler-config.

### `_headers` blijft wel
Cloudflare Workers Static Assets ondersteunt `_headers` (security-
headers, cache-control). Gebruik dat bestand voor headers, niet
de wrangler-config.

### `.assetsignore` is cruciaal
`cloudflare/wrangler-action` installeert wrangler in `node_modules/`
in de workdir die wrangler vervolgens als `[assets].directory='.'`
indexeert. Zonder `.assetsignore` faalt de deploy op
"Asset too large" (workerd-binary is 122 MiB). Voeg nieuwe build-
artifacts (toekomstige `dist/`, `node_modules`, etc.) hier toe.

### Geen Hugo, geen build-tool
Pure HTML + CSS + JS. Geen Vite, geen npm-build. Wat je in de repo
ziet is wat live wordt geserveerd. Geen pre-processing-magic.

### Cloudflare Web Analytics injecteert NIET op Workers-sites
"Automatic Setup" van Cloudflare Web Analytics injecteert het beacon
(`static.cloudflareinsights.com/beacon.min.js`) alleen bij gewone
origin-responses, **niet** bij Worker-responses. Onze site is
*Workers Static Assets* → de toggle aanzetten doet niets, het beacon
blijft afwezig (geverifieerd 2026-06-21: live HTML bevat geen beacon).
Wil je het tóch, voeg het `<script defer src=… data-cf-beacon='{"token":"…"}'>`
**handmatig** toe in alle pagina's (de CSP whitelist `static.cloudflareinsights.com`
staat al klaar sinds v1.0.17). Anders volstaat onze eigen cookieloze
statistiek (v1.0.16, `/api/track` in `main.js` → admin Statistiek-tab).

### Token-permissies op Cloudflare
Het `CLOUDFLARE_API_TOKEN` heeft o.a. nodig:
- `Account → Workers Scripts → Edit`
- `Account → Workers KV Storage → Edit` (voor static assets)
- `Account → Account Settings → Read`

Custom-domain-koppeling staat los van wrangler.toml — beheerd via
dashboard / Account-API. Niet aan wrangler.toml `routes` toevoegen,
dat triggert een extra zone-permissie-eis op het token.

## Update-checklist voor toekomstige sessies

Voordat je begint met code-wijzigingen:

- [ ] `git pull origin main` — werk altijd vanaf de laatste main
- [ ] Lees `assets/js/config.js` — daar staat de actuele evenement-
      info; check of de datums in HTML's nog overeenkomen
- [ ] Bij grote wijzigingen: update de "Datum evenement"-tabel
      bovenin dit bestand
- [ ] Na een PR / commit: check **Actions tab** dat de deploy slaagt
- [ ] Bij verandering aan deploy-pipeline of architectuur: update
      de relevante sectie hierboven

## Bestelsysteem (branch `bestelsysteem`, nog niet op main)

De site wordt uitgebreid van static-only naar een Worker-met-code + D1:

- `src/index.js` — `/api/*` (bestellen, Mollie-webhook, status, admin); rest valt door
  naar de ASSETS-binding (statische site). `wrangler.toml` krijgt `main`, een
  `[[d1_databases]]`-binding en `[assets] binding="ASSETS"`.
- `migrations/0001_init.sql` — tabellen orders/ducks/counters/settings/draws.
- Nieuwe pagina’s: `bestellen.html`, `bestelling.html`, `admin.html`.
- Nummering is atomair (counter + `RETURNING`).
- Secrets: `MOLLIE_API_KEY`, `ADMIN_PASSWORD` (+ optioneel `ADMIN_USER`,
  `RESEND_API_KEY`, `MAIL_FROM`). Token heeft **D1 Edit** nodig.
- **Niet naar main mergen** voordat D1 + secrets bestaan, anders faalt de deploy.
- `.assetsignore` sluit `src/`, `migrations/`, configs uit de publieke assets.

## Verbeterpunten (backlog)

- **Mails aan aanbrengers van prijzen ook in CC naar de accountmanager.** Wanneer een
  aanbrenger van een prijs een e-mail krijgt (bevestiging/communicatie rond de ingebrachte
  prijs), moet de bijbehorende accountmanager standaard in de CC staan. Te implementeren in
  de mailflow van het bestelsysteem (zie sectie hierboven) zodra die flow voor
  prijzen-aanbrengers gebouwd/uitgebreid wordt.

## Hulp-sectie & handleidingen (sinds 2026-07-03)

- **`hulp.html`** = overzichtspagina (link in de footer van alle pagina's);
  **`hulp-accountmanagers.html`** = volledige handleiding voor accountmanagers
  met echte schermafbeeldingen (`assets/img/hulp/*.png`) en een **printknop**
  (`window.print()` + `@media print`-CSS → nette PDF). Beide **noindex**, niet
  in de sitemap. De admin-footer linkt naar de handleiding.
- **Onderhoudsregel: wijzigt er iets aan de admin-UI of een flow die in een
  handleiding staat (admin.html, src/index.js-endpoints, bestel-/mailflow),
  werk dan in dezelfde sessie de betreffende hulp-pagina bij** (tekst én zo
  nodig screenshots). Een Claude-Code-hook herinnert hieraan; voor Cowork
  geldt deze regel via dit document.
- **Screenshots reproduceren**: lokaal `npx wrangler@latest dev --port 8788`
  (migraties + demodata in lokale D1; localhost is uitgezonderd van de
  https-redirect in `src/index.js`), inloggen als demo-accountmanager en
  screenshotten via puppeteer-core + systeem-Chrome (viewport 1280×840,
  deviceScaleFactor 2), daarna verkleinen naar 1440px breed (sharp). De
  demodata-seed en het screenshotscript zijn eenvoudig opnieuw te maken;
  gebruik dezelfde bestandsnamen in `assets/img/hulp/` (immutable-cache:
  bij een gewijzigde screenshot een `?v=`-query aan de img-src toevoegen
  of de bestandsnaam wijzigen).

## Recente architectuur-besluiten (changelog)

- **2026-07-03** (Code): **Hulp-sectie + handleiding voor accountmanagers.**
  `hulp.html` + `hulp-accountmanagers.html` (10 hoofdstukken: inloggen,
  overzicht, prijzen beheren, bevestigingsmail met `{{prijs}}`/CC/voorbeeld,
  bestellingen/statistiek/exporteren, FAQ) met 9 schermafbeeldingen op basis
  van een lokale demo-omgeving, printbaar via printknop + print-CSS. Footer
  van alle pagina's kreeg een **Hulp**-link; admin-footer linkt naar de
  handleiding. `src/index.js`: **localhost uitgezonderd van de
  https-redirect** zodat `wrangler dev` lokaal werkt (productie ongewijzigd).
  Zie de sectie "Hulp-sectie & handleidingen" voor de onderhoudsregel.

- **2026-07-03** (Code): **Software-tab + versie volgt de historie.** Nieuwe **"Software"-tab**
  in de admin (`admin.html` + endpoint `GET /api/admin/software`, alle rollen, read-only):
  app-versie/commit, runtime, deploy-tool (wrangler gepind vs. npm-laatste + status) en
  integraties (D1/Mollie/Resend). Duckstad heeft géén npm-runtime-dependencies (bewust puur
  HTML/CSS/JS) → dit is een systeemoverzicht, geen pakketlijst. **Versiebeleid gewijzigd:** de
  deploy-versie (`version.json`) wordt nu **automatisch afgeleid uit de git-historie** —
  `VER="1.$((N/10)).$((N%10))"` met `N = git rev-list --count HEAD` (fetch-depth:0). Dus géén
  handmatige `config.js`-bump meer nodig; het versienummer weerspiegelt het aantal updates en
  groeit vanzelf mee. (Vervangt de eerdere afspraak "bump `version` in `config.js` bij elke
  update".) Zelfde schema op alle beheerde sites; `/updates` blijft de changelog.

- **2026-07-03** (Code): **Mail hersteld — Resend-key was ongeldig (401 "API key is invalid").**
  Alle uitgaande mail (bestelbevestigingen, organisator-notificaties, wachtwoord-resets,
  prijsbevestigingen, dagrapport) faalde stil. Nieuwe Resend-key gezet (`wrangler secret put
  RESEND_API_KEY`), **scoped op sending via `rotarynijmegenstadenland.nl`** — het domein
  `nijmegenduckstad.nl` is NIET in Resend geverifieerd, dus de afzender moet een geverifieerd
  domein zijn. Daarom nu: **`MAIL_FROM` = `Nijmegen Duckstad <noreply@rotarynijmegenstadenland.nl>`**
  (geverifieerd + on-brand: de Rotary-club organiseert de race) en **`MAIL_REPLY_TO` =
  `info@nijmegenduckstad.nl`** (antwoorden komen in de Duckstad-inbox). Geverifieerd: `POST
  /api/contact` geeft weer `{"ok":true}`. Wil je afzender `@nijmegenduckstad.nl`? Dan eerst dat
  domein in Resend verifiëren (+ SPF/DKIM-DNS in Cloudflare). NB: `wrangler secret put` is een
  secret-operatie (geen code-deploy) en mag dus buiten de GitHub-flow.

- **2026-07-02** (Code, v1.0.18): **UX-verbeterronde (3 doelgroepen) o.b.v. gebruiksvriendelijkheidsscan.**
  *Klant*: bestelflow toont nu de geselecteerde bundel/type/extra (`.is-selected`+`aria-pressed`);
  keuze uit `adopteren.html` gaat mee (`?qty`/`?type`); ingevulde velden blijven bewaard na een
  mislukte betaling (sessionStorage); goede-doel-cijfers verhelderd; **privacyverklaring** toegevoegd
  (`privacy.html` + footer/sitemap); nav/CTA/vocabulaire gelijkgetrokken; site-brede `:focus-visible`
  + skip-links + fieldset/legend + veldgekoppelde fouten. **Contact-/sponsor-/vrijwilligerformulier
  van `mailto` naar echte verzending** via nieuw `POST /api/contact` (honeypot + rate-limit, mailt naar
  `ORGANIZER_EMAIL` met reply_to=indiener). *Accountmanager*: prijzentabel met zoeken + filters
  (nog-te-bevestigen / mijn prijzen); bevestigingsmail ondertekent met de **ingelogde** gebruiker
  (waarschuwing bij mismatch met gekoppelde AM), **voorbeeld-knop**, waarschuwing bij opnieuw sturen,
  **CC naar de accountmanager** (`sendPrizeConfirmation`); labels i.p.v. placeholders in de modal;
  foutcodes vertaald + opslaan-bevestiging. *Beheerder*: **bestellingen** met zoek/statusfilter +
  klik-detail (startnummers/telefoon) + "markeer als betaald"/"bevestiging opnieuw" (nieuwe endpoints
  `mark-paid`/`resend-confirmation`); **trekking** met per-rij verwijderen (`draw-delete`) + ontkoppelde
  reset + waarschuwing bij dubbel startnummer/prijs; dashboard-KPI's (verkoop open/gesloten, prijzen te
  bevestigen, % van doel); **prijs-per-eendje** in Instellingen + bevestiging bij sluiten + max-waarschuwing;
  rol-wijziging met bevestiging; `.catch` + knop-disable overal (dubbelklik-preventie) + consistente
  toasts; a11y: `role=tab`/`aria-selected`, aria-labels op icoonknoppen, touch-scrollbar.


- **2026-06-21** (Code, dashboard-stap): **"Always Use HTTPS" aangezet** in het
  Cloudflare-dashboard (SSL/TLS → Edge Certificates). Geverifieerd: `http://` →
  **301** naar `https://` op zowel home als subpagina's. Hiermee is het laatste
  handmatige security-puntje uit v1.0.5/v1.0.6 afgevinkt. Tevens vastgesteld dat
  **Cloudflare Web Analytics niet automatisch injecteert op deze Workers-site**
  (beacon afwezig in live HTML) — zie valkuil hierboven; eigen statistiek blijft de bron.

- **2026-06-21** (Code, v1.0.16): **eigen cookieloze webstatistiek** (Cloudflare Web Analytics kon niet
  via de wrangler-OAuth-token: RUM-API geeft auth-error → zelf gebouwd). Migratie `0007_pageviews.sql`
  (geaggregeerd: day/path/ref/n, geen PII, geen cookies → geen banner nodig). `POST /api/track` (beacon
  uit `main.js` op elke publieke pagina, same-origin dus CSP `connect-src 'self'` volstaat; light
  rate-limit). Admin: `GET /api/admin/analytics` (elke rol) + **Statistiek-tab** met KPI's, dag-grafiek
  (14d), top-pagina's, verkeersbronnen en **conversie** (betaalde orders ÷ /bestellen-bezoeken).

- **2026-06-21** (Code, v1.0.15): **conversie/ops batch 2 (backend)**. Migratie `0006_order_extras.sql`
  (--remote toegepast): `orders.extra_cents` (default 0) + `orders.gift_name`. `apiOrder`: vrijwillige
  **extra gift** (`extra_cents`, geclampt 0..€500 → kan prijs nooit verlagen) opgeteld bij `amount`, en
  **cadeau-ontvanger** (`gift_name`). Bestelpagina: cadeau-toggle + extra-gift-knoppen (+€5/10/25).
  Webhook: **organisator-notificatie** (`notifyOrganizer`, env `ORGANIZER_EMAIL`) bij elke betaalde order
  + **refund-afhandeling** (`amountRefunded` → status `refunded`). **Cron** (`[triggers] crons=["0 6 * * *"]`
  + `scheduled()` → `runDaily`): pending>6u → expired, oude `rate_limits` prunen, **dagrapport + CSV-backup**
  mailen (`sendDailyReport`, Resend-attachment). `export-orders` CSV uitgebreid met extra/cadeau.

- **2026-06-21** (Code, v1.0.14): **conversie + SEO/social, batch 1**. (1) Branding **2026→2027** site-breed
  (meta/og-descriptions, hero-eyebrow, FAQ). (2) **Social share**: OG-afbeelding `assets/img/og.jpg`
  (1200×630, gerenderd via Chrome-headless uit /tmp/og.html) + og:image/og:url/og:site_name/twitter:card
  + `rel=canonical` op 9 indexeerbare pagina's. (3) **Event JSON-LD** (schema.org/Event) op index.
  (4) **Bestelpagina**: bundel-snelkeuze (1/5/10/25), knop "Veilig betalen" (Mollie toont alle methoden),
  trust-regel (🔒 Mollie · iDEAL/creditcard/meer · startnummer per mail). (5) **Bedankpagina**: deelknoppen
  (WhatsApp/Facebook/X/kopieer-link) met startnummer in de tekst. Backend-batch (apiOrder extra-gift +
  cadeau-eendje, webhook-notify/refunds, cron) volgt apart.

- **2026-06-21** (Code, v1.0.13): kwaak-bestand vervangen door een **CC0 / volledig rechtenvrije**
  opname (BigSoundBank #0276 "Ducks", DenisChardonnet, CC0 — geen attributieplicht). Passage met
  enkele kwaken uitgesneden (mallard-XC62258 BY-SA verwijderd). Audio-URL `?v=2` (cachebust). Geen
  attributie meer nodig; `CREDITS.txt` bijgewerkt.

- **2026-06-21** (Code, v1.0.12): **echte eendenopname** i.p.v. synth — `assets/audio/kwaak.mp3`
  (mallard, xeno-canto XC62258, opname Jonathon Jongsma, **CC BY-SA 3.0** → attributie in
  `assets/audio/CREDITS.txt`; bijgesneden+mono+genormaliseerd via ffmpeg, 24 KB). `main.js` speelt 'm
  via `new Audio()`; de gesynthetiseerde kwaak (`quackSound`) blijft als **fallback** als het bestand
  niet laadt/mag. CSP `media-src` valt terug op `default-src 'self'` → same-origin audio toegestaan.

- **2026-06-21** (Code, v1.0.11): kwaak-geluid verbeterd — formant-filtering (3 bandpass = nasale "aa"),
  pitch-contour omhoog→omlaag ("kwAAk"), 2 ontstemde zaagtanden + ruisaanzet ("k") + tremolo-roughness.

- **2026-06-21** (Code, v1.0.10): **2e easter egg** — dubbelklik op de grote eend (`.bigduck`) → "Kwaak!"
  (tekstballon `.quack-bubble` + squash-animatie `@keyframes quack`, !important i.v.m. `bob`) mét
  **gesynthetiseerd eendengeluid** via Web Audio API (zaagtand-osc die in toonhoogte zakt + bandpass +
  rasp-LFO; geen audiobestand). AudioContext lazy in de dblclick-gesture (autoplay-policy ok).

- **2026-06-21** (Code, v1.0.8): easter-egg verfijnd — nu flippen ook het **logo-eendje** (`.nav__logo img`)
  en de **grote hero-eend** (`.bigduck`) mee, naast de 🦆-emoji's + `.footer-duck`. Animatie vloeiend
  gemaakt: constante rotatiesnelheid + `linear` (was schokkerig door overshoot-bezier + ongelijke
  stappen), `transform-box:fill-box` zodat SVG's om hun midden draaien.

- **2026-06-21** (Code, v1.0.7): **easter egg** — 2× klikken op `.nav__logo` (linksboven) laat alle
  eendjes een koprol maken. `main.js` wikkelt elke losse 🦆-emoji eenmalig in `<span class="egg-duck">`
  (TreeWalker) en animeert die + `.footer-duck` met `@keyframes koprol` (style.css). Dubbelklik wordt
  gedetecteerd via een click-timer (280ms) zodat de eerste klik niet meteen naar home navigeert;
  modifier-clicks (cmd/ctrl/shift) blijven normaal werken. Alleen publieke site (admin laadt main.js niet).

- **2026-06-19** (Code, v1.0.6): security-headers ook in **`_headers`** (volledige set incl. HSTS+CSP,
  X-Frame-Options DENY). Reden: Cloudflare serveert **gecachte statische pagina's rechtstreeks via de
  static-pipeline** (Worker draait dan niet) → die kregen alleen de `_headers`-headers en geen
  withSec/redirect. Nu dekt `_headers` de gecachte pagina's en `withSec` de Worker/API + cache-misses.
  Resterende handmatige stap: **Cloudflare-dashboard → "Always Use HTTPS" aan** (REST-API lukte niet met
  de wrangler-OAuth-token); HSTS dekt het praktische risico al na de eerste HTTPS-load.

- **2026-06-19** (Code, v1.0.5): **security-hardening (pentest-fixes)**. Security-headers **in de Worker**
  (`withSec()` op elke response): HSTS, CSP, X-Frame-Options DENY, X-Content-Type-Options, Referrer-
  Policy, Permissions-Policy. **HTTPS afgedwongen** in code (cf-visitor-scheme → 301 naar https). **Rate-limiting** per
  IP via nieuwe D1-tabel `rate_limits` (migratie 0005; fail-open) op login (8/5min), reset (5/15min),
  order (15/10min). **Sessies ingetrokken** bij rolwijziging (`user-role`) en wachtwoordreset
  (`set-password`). **CSV-formule-injectie** geneutraliseerd in `csvCell`. **Mail**: kopersnaam via
  `escHtml`. **Login-timing** gelijkgetrokken (dummy-hash) + constant-time vergelijk break-glass.
  **Generieke 500/502** (geen interne details meer). `setting` heeft nu een key-allowlist + validatie;
  `managers` beperkt tot admin/accountmanager. NB nog handmatig in Cloudflare-dashboard: "Always Use
  HTTPS" en (optioneel) WAF rate-limiting als extra laag — de code dekt beide nu al af.

- **2026-06-19** (Code, v1.0.1): **scrollbalk altijd zichtbaar + nieuwe prijs in een dialog**.
  (1) Admin `.scroll` van `overflow:auto` → `overflow-y:scroll` zodat de (azuren) scrollbalk altijd
  zichtbaar is i.p.v. pas bij scrollen (macOS-overlay verborg 'm). (2) Op de Prijzen-tab is het
  inline-formulier vervangen door een knop **"➕ Nieuwe prijs" rechtsboven** die een **`<dialog>`**
  (`#prizeDialog`, modal) opent; bewerken (✏️) opent dezelfde dialog vooraf-ingevuld; opslaan/annuleren/
  ✕ sluit 'm. Dialog staat los onderaan `#app` (buiten de tabpanes). `.modal` + `::backdrop` styles in
  de admin-`<style>`.

- **2026-06-19** (Code): **versienummer in de footer + versiebeleid**. `config.js` heeft nu een veld
  **`version`** (start `1.0.0`); `main.js` toont `v<version>` in `.footer-bottom` (of vult
  `[data-version]`-elementen). Admin laadt `config.js` en toont de versie in een eigen footer
  (`#adminVersion`). **Afspraak: bump `version` in `config.js` bij ELKE update** (patch voor fixes/
  kleine wijzigingen, minor voor features). Publieke `config.js`/`main.js`-script-refs eenmalig naar
  `?v=1` gebust (oude immutable-cache breken); voortaan houdt must-revalidate ze vers, dus alleen het
  versieveld bumpen volstaat.

- **2026-06-19** (Code): **scrollbaarheid zichtbaar gemaakt (site-breed)**. macOS verbergt scrollbars;
  in `style.css` nu altijd zichtbare, gestylede scrollbars voor de pagina (`html::-webkit-scrollbar`)
  én voor scrollbare boxen (`.scroll`/`.scroll-area`), plus een **fade-schaduw** boven/onder die boxen
  via sticky `::before/::after` (tekent over opaque tabellen) — alleen zichtbaar bij echte overflow via
  JS-klassen `can-scroll-up`/`can-scroll-down`. JS staat in `admin.html` (`setShade`/`refreshScrollHints`,
  MutationObserver voor async-gevulde tabellen + recalcs bij tabwissel/resize). De 4 admin-tabellen zijn
  de enige in-content scrollgebieden; publieke pagina's krijgen de zichtbare scrollbars via de gedeelde CSS.

- **2026-06-19** (Code): **admin opgedeeld in tabbladen**. De lange scroll-pagina is nu een
  tabbalk (`.tabs`/`.tabpane`, vanilla JS in `admin.html`): **Bestellingen · Prijzen · Exporteren ·
  Verkoop · Race · Gebruikers**. KPI's blijven boven de tabs. Verkoop = instellingen + handmatige
  verkoop; Race = winnaar invoeren. Tabs Verkoop/Race/Gebruikers zijn `admin-only` (verborgen voor
  readonly/accountmanager via bestaande `is-admin`-class op flex-items). Panelen ongewijzigd, alleen
  in `<section class="tabpane">` gewikkeld; standaard actief = Bestellingen.

- **2026-06-19** (Code): **accountmanager-rol + koppeling aan prijzen**. Migratie `0004_accountmanager.sql`
  (--remote vóór deploy): `users.name`, `users.phone`, `prizes.account_manager_id`. Nieuwe rol
  **`accountmanager`**: mag ingebrachte prijzen beheren (`prize`/`prize-delete`/`prize-confirm` →
  nieuwe `PRIZE_MANAGE`-set, naast admin) en de rest inzien; overige mutaties blijven admin-only
  (`user-update` toegevoegd aan `ADMIN_ONLY`). Per prijs koppel je een accountmanager (dropdown,
  endpoint `GET managers` = admins+accountmanagers). De **bevestigingsmail-ondertekening** wordt de
  **naam + telefoon** van de gekoppelde accountmanager (client vult dit in `defaultPrizeMessage`,
  uit de `am_*`-join op `prizes`). Gebruikersbeheer: naam/telefoon bij aanmaken + inline bewerkbaar
  (`user-update`), rol-select met accountmanager. Frontend-zichtbaarheid via body-class `can-prizes`
  (admin|accountmanager) i.p.v. alleen `is-admin`. NB: accountmanager = echt user-account; de
  break-glass env-admin staat niet in `users` en is dus niet koppelbaar.

- **2026-06-19** (Code): **prijzenadministratie + bevestigingsmail aan inbrengers**. Nieuwe D1-tabel
  `prizes` (migratie `0003_prizes.sql`, --remote toegepast vóór de deploy): prijs/waarde/omschrijving,
  inbrenger (naam, bedrijf, e-mail, telefoon), `conditions` (voorwaarden) en `confirmation_sent_at`.
  Admin-endpoints: `GET prizes` (read-only mag bekijken), `POST prize` (toevoegen/bewerken; met `id`=update),
  `POST prize-delete`, `POST prize-confirm` (allemaal muteren = admin-only, in `ADMIN_ONLY`-set). `stats`
  geeft nu ook `prizes`-telling (extra KPI). De bevestigingsmail (`sendPrizeConfirmation`, branded Resend-
  template met prijs-kaartje + Rotary-footer) gaat naar `donor_email`; **onderwerp + bericht zijn vooraf
  ingevuld én aanpasbaar in de admin** (`admin.html`, paneel "🎁 Prijzen & inbrengers") voordat verzonden
  wordt — de voorwaarden zitten standaard in de tekst. Platte tekst → HTML via `htmlParagraphs`/`escHtml`.
  Mail vereist `RESEND_API_KEY` + een `donor_email` (anders nette foutmelding); na verzenden wordt
  `confirmation_sent_at` gezet en toont de tabel "verstuurd <datum>". De mail bevat **één kader**
  (`prizeBox`) met de prijs+waarde, de `description` (websitetekst) én de voorwaarden; het kader wordt
  in het bericht geplaatst op de **`{{prijs}}`-marker** (admin kan die regel verplaatsen; geen marker →
  kader onderaan). `description` is bewerkbaar in het adminformulier (ontbrak eerst → werd bij elke
  prize-update gewist). De 9 prijzen van `prijzen.html` zijn als voorbeeld-rijen in remote D1 geseed
  (donor = placeholder, donor_email = marco@ zodat testmails veilig zijn).

- **2026-06-17** (Code): **admin-accounts + rollen, orders verwijderen, "loterij"→race**.
  (1) Basic-auth (`ADMIN_PASSWORD`) vervangen door **gebruikersaccounts** (e-mail=gebruikersnaam)
  met **rollen** admin/read-only, **sessie-cookies** (`sessions`-tabel), **PBKDF2**-hashing en
  **wachtwoordreset** via Resend (pagina `admin-wachtwoord.html`). Migratie `0002_users.sql`
  (`users`+`sessions`). `ADMIN_USER`/`ADMIN_PASSWORD` blijven als **break-glass**-admin. Read-only
  mag bekijken + exports; muteren is admin-only (set in `adminApi`). (2) `POST /api/admin/delete-order`
  verwijdert order+ducks+winnaars; `assignNumbers` toegekend nu de **laagste vrije** nummers, dus
  vrijgekomen nummers worden hergebruikt (teller vervallen). (3) Willekeurige **trekking vervangen
  door winnaar-invoer** (`/api/admin/winner`, winnend startnummer); overal "loterij" hernoemd naar
  race/badeendjesrace/eendjeslijst (UI, mail, export `eendjeslijst.csv`, bestelpagina's, SETUP).
  Deploy-vereiste: migratie 0002 op remote D1 vóór de code-deploy.

- **2026-06-17** (Code): **bevestigingsmail vernieuwd** (`sendConfirmation` in `src/index.js`):
  HTML-mail met loterijticket-kaartjes per eendje (🦆 + startnummer, padStart 4) en een
  Rotary-footer (logo `assets/img/rotary-nijmegen-stadenland.png`, gekopieerd uit de
  fundraising-hub) met de 3 acties + link naar marcovanthiel.nl/fundraising. Plus: website-
  **footer-copyright** in alle pagina's → "Rotary club - Nijmegen Stad en Land", gelinkt naar
  https://www.rotary.nl/nijmegenstadenland/ (ook in de mailfooter).

- **2026-06-17** (Code): **navigatiebalk opgeschoond**. 8 links + CTA pasten niet inline
  (labels braken over 2 regels tussen ~900–1280px). Fix: nav-labels ingekort ("Adopteer een
  eendje"→"Adopteren", "Het evenement"→"Evenement", alléén binnen `<ul class="nav__links">`,
  in alle HTML's), `white-space:nowrap` + compactere links, en hamburger-breakpoint van
  900→**1100px** (los van de overige 900px-layout-breakpoints). Footer-/body-tekst ongemoeid.

- **2026-06-17** (Code): **bevestigingsmail werkend**. `marcovanthiel.nl` draait op M365 en
  is NIET in Resend geverifieerd; enige verified domein = `kunstcollectie.marcovanthiel.nl`.
  Daarom `MAIL_FROM` = `Nijmegen Duckstad <noreply@kunstcollectie.marcovanthiel.nl>` + in
  `sendConfirmation()` een `reply_to` (`MAIL_REPLY_TO` env, default `marco@marcovanthiel.nl`)
  en logging van Resend-fouten (was eerst stil falen). Voor branding op `@nijmegenduckstad.nl`:
  dat domein in Resend verifiëren + DNS in Cloudflare.

- **2026-06-17** (Code): 3 concrete **topprijzen** op `prijzen.html` (ballonvaart, weekend
  Maastricht, weekend Saalbach Hinterglemm) met foto's, via nieuwe `.prize-card`-component
  in `style.css`. Foto's: Pexels (commercieel/zonder watermerk) in `assets/img/prijzen/`.

- **2026-06-17** (Code, PR #1 → `main`, commit `0ee90e4`): **bestelsysteem LIVE**.
  `bestelsysteem` gemerged → GitHub Action deploy `success`. Vooraf: alle gevoelige
  waarden van plaintext-variabelen omgezet naar **secrets** (`ADMIN_PASSWORD`,
  `MOLLIE_API_KEY`, `RESEND_API_KEY`, `MAIL_FROM`) — plaintext-vars worden door
  `wrangler deploy` gewist, secrets niet. Live geverifieerd: `/bestellen` 200,
  `/admin` 401 zonder ww, `/api/status` leest D1 (sold 0/5000), `/api/order` valideert (400).
  Let op: Mollie staat op de **test**-key; voor echt geld de live-key zetten. Resend-mail
  werkt alleen als het `MAIL_FROM`-domein in Resend geverifieerd is (faalt anders zacht).

- **2026-06-17** (Code, branch `bestelsysteem`): infra-setup van het bestelsysteem
  uitgevoerd. D1 `nijmegenduckstad` bestond al (uuid `6bb084ee-43a2-4e17-9d11-1966ef6a1c74`);
  `database_id` ingevuld in `wrangler.toml` en migratie `0001_init.sql` --remote gedraaid →
  tabellen orders/ducks/counters/settings/draws + seed (prijzen €5/€150, `sales_open=1`).
  **Nog open vóór merge:** D1-Edit-permissie op het GitHub-`CLOUDFLARE_API_TOKEN` + secrets
  (`MOLLIE_API_KEY` test, `ADMIN_PASSWORD`). **NIET gemerged naar main** (afspraak).

- **2026-06-17** (Cowork, branch `bestelsysteem`): online **bestel-/betaal-/loterijsysteem**
  toegevoegd — Worker-code (`src/index.js`) + D1-database + Mollie iDEAL + admin-
  dashboard (`/admin`) met CSV/PDF-export en trekkingen. Staat op een aparte branch;
  gaat live na infra-setup (zie `SETUP-BESTELSYSTEEM.md`) en merge naar `main`.

- **2026-06-17** (Cowork): verkoopweekenden voorlopig gezet op 27–28 mrt, 3–4 apr,
  10–11 apr 2027 (CONCEPT — te bevestigen door Marco); introductieweek-regel
  verwijderd (paste niet bij april).
- **2026-06-17** (Cowork, via web-upload): evenementdatum gezet op **zaterdag 17 april 2027 / 15:00** in `config.js` + HTML’s, op verzoek van
  Marco. NB: verkoopweekend-datums (aug/sep 2026) moeten nog
  geactualiseerd worden naar 2027.
- **2026-06-17** (commit `f9a2d73`+`7a95b2d`): GitHub Actions auto-
  deploy ingesteld; `_redirects` vervangen door wrangler
  `html_handling`; datum-fix naar 19 september 2026 / 13:30 in
  HTML's en `config.js`.
- **2026-06-17 (eerder)**: Oorspronkelijk gemaakt door Claude
  Cowork; tot deze datum directe deploys via wrangler buiten GitHub
  om.

## Contact tussen Cowork en Code

Beide assistenten houden dit bestand bij. Bij elk merge of grote
beslissing: voeg een regel toe in **Recente architectuur-besluiten**
met datum + commit-hash + één-regel-omschrijving. Zo zien we van
elkaar wat er gebeurd is zonder dat we elkaars sessies hoeven te
lezen.
