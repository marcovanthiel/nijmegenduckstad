# Nijmegen Duckstad — website

Website voor de Rotary Badeendjesrace, draait als **Cloudflare Worker + Static Assets + D1** (bestelsysteem met Mollie iDEAL).
Domein: **nijmegenduckstad.nl** (al actief op Cloudflare).

---

## 1. Wat zit erin

| Pagina | Bestand | Inhoud |
|---|---|---|
| Home | `index.html` | Hero, live teller + voortgangsbalk, countdown, hoe-werkt-het, CTA's |
| Adopteer een eendje | `adopteren.html` | Prijzen (1 / toom van 5 / bedrijfseendje), link naar verkoopsysteem |
| Het evenement | `evenement.html` | Programma, verkoopweekenden, locatie |
| Te winnen prijzen | `prijzen.html` | Voorbeeldprijzen (definitieve pot nog invullen) |
| Sponsoren | `sponsoren.html` | Zilver/Goud/Titel-pakketten, in natura, aanmeldformulier |
| Goede doel | `goede-doel.html` | Het verhaal, opbrengst, cijfers |
| Meedoen | `vrijwilligers.html` | Vrijwilligers-aanmeldformulier |
| Contact | `contact.html` | Contactformulier + gegevens |
| FAQ | `faq.html` | Veelgestelde vragen |
| 404 | `404.html` | Nette foutpagina |

Plus: `assets/` (css, js, logo + favicon), `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`.

---

## 2. Eerst even aanpassen — `assets/js/config.js`

Alle cijfers en links staan op één plek. Open `assets/js/config.js` en pas aan:

- **`ducksSold`** — aantal verkochte eendjes (de live teller). Werk dit met de hand bij, of laat het later koppelen aan jullie verkoopsysteem.
- **`salesUrl`** — directe link naar de online verkoop (nu `badeendjesrace.nl`). Vervang door jullie eigen verkooplink zodra die er is.
- **`contactEmail`** — nu `info@nijmegenduckstad.nl`. Zorg dat dit e-mailadres bestaat (zie stap 5).
- **`instagram` / `facebook`** — vul de links in; dan verschijnen de social-iconen automatisch.
- **`formAccessKey`** — zie stap 4 (formulieren).

Datum, locatie, prijzen en het opbrengstdoel staan er ook; pas ze aan als er iets wijzigt.

---

## 3. Deployen naar Cloudflare Pages (±10 min)

1. Log in op **dash.cloudflare.com** → linksonder **Workers & Pages** → **Create application** → tab **Pages** → **Upload assets** (de eenvoudigste route, geen GitHub nodig).
2. Geef het project een naam, bijv. `nijmegenduckstad`.
3. **Sleep de volledige inhoud van deze map** (dus de losse bestanden + de `assets`-map, NIET de map zelf) in het uploadvak. Klik **Deploy site**.
4. Je krijgt een tijdelijke URL (`...pages.dev`) om te testen.
5. Ga naar het tabblad **Custom domains** → **Set up a custom domain** → vul `nijmegenduckstad.nl` in (en herhaal voor `www.nijmegenduckstad.nl`). Omdat het domein al in jouw Cloudflare-account zit, zet Cloudflare de DNS automatisch goed. Binnen enkele minuten is de site live met geldig SSL.

> Updaten later? Zelfde project → **Create deployment** → opnieuw de bestanden uploaden. Of koppel een GitHub-repo voor automatische updates bij elke push.

---

## 4. Formulieren laten werken (sponsor / vrijwilliger / contact)

De formulieren werken op twee manieren:

- **Zonder instellen (standaard):** bij verzenden opent het e-mailprogramma van de bezoeker met de ingevulde gegevens, gericht aan `contactEmail`. Werkt direct, maar vraagt een handeling van de bezoeker.
- **Aanbevolen — automatisch in je mailbox:** maak gratis een account op **web3forms.com**, kopieer je **Access Key** en plak die in `config.js` bij `formAccessKey`. Inzendingen komen dan automatisch binnen op het opgegeven e-mailadres, zonder dat de bezoeker iets hoeft te doen. (Alternatieven: Formspree, of Cloudflare Pages Functions.)

---

## 5. E-mailadres `info@nijmegenduckstad.nl`

Cloudflare biedt gratis **Email Routing**: dash → je domein → **Email** → Email Routing aanzetten en `info@nijmegenduckstad.nl` laten doorsturen naar jouw eigen mailbox. Handig voor zowel de contactgegevens als de formulier-fallback.

---

## 6. Nog in te vullen / later

- Echte **prijzenlijst 2026** op `prijzen.html` (nu voorbeeldprijzen).
- **Sponsorlogo's** op `sponsoren.html` zodra pakketten zijn toegekend.
- Definitief **dagprogramma** met tijden op `evenement.html`.
- Exacte **start-/finishlocatie** + eventueel een kaartje op `evenement.html`.
- Foto's van vorige edities of sfeerbeelden (vervang waar gewenst de SVG-illustraties).

Vragen of aanpassingen? Geef het door, dan pas ik het aan.
