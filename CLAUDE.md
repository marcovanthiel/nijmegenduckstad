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

## Recente architectuur-besluiten (changelog)

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
