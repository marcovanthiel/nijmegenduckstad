# Setup — bestel-, betaal- & loterijsysteem

Dit systeem maakt van de site een echte webshop voor badeendjes: online
bestellen → iDEAL betalen (Mollie) → automatisch opvolgende eendnummers →
bevestiging → admin-dashboard met loterijlijst-export en trekkingen.

> **Het staat op een aparte branch** (`feature/bestelsysteem`), zodat de live
> site ongemoeid blijft. De stappen hieronder zet je éénmalig op; pas daarna
> mergen we naar `main` en gaat het live. **Niet eerder mergen** — anders faalt
> de deploy omdat de D1-database/secret nog niet bestaan.

## Wat het kan
- Bestelformulier (`/bestellen`): 1 of meer eendjes (€5) of bedrijfseendjes (€150).
- Veilige iDEAL-betaling via Mollie (wij zien nooit kaart-/bankgegevens).
- **Automatische, opvolgende nummering** per serie (regulier 1,2,3…; bedrijf apart).
- Bevestigingspagina met de toegekende nummers + (optioneel) bevestigingsmail.
- Live verkoopteller op de homepage (echte cijfers).
- **Admin-dashboard** (`/admin`, wachtwoord): verkoopstand, bestellingen,
  CSV-export van loterijlijst / bestellingen / nieuwsbrief, printbare loterijlijst (PDF),
  **trekkingsmodule** (random winnaar per prijs), instellingen (verkoop open/dicht,
  voorraad), en handmatige verkoop (contant/Tikkie) met directe nummering.

## Benodigd
- Een **Mollie-account** (gratis): https://www.mollie.com — voor de API-key.
- De Cloudflare CLI **wrangler** (`npm i -g wrangler`) en `wrangler login`,
  OF doe de stappen via het Cloudflare-dashboard.

## Stap 1 — D1-database aanmaken
```
wrangler d1 create nijmegenduckstad
```
Kopieer het getoonde `database_id` en zet het in **wrangler.toml** bij
`[[d1_databases]] … database_id = "…"`.

## Stap 2 — Tabellen aanmaken (migratie)
```
wrangler d1 execute nijmegenduckstad --remote --file=migrations/0001_init.sql
```

## Stap 3 — Cloudflare API-token uitbreiden
De GitHub Action gebruikt `CLOUDFLARE_API_TOKEN`. Voeg permissie toe:
**Account → D1 → Edit** (naast de bestaande Workers Scripts/KV-rechten).
Token aanpassen kan op https://dash.cloudflare.com/profile/api-tokens.

## Stap 4 — Secrets zetten
```
wrangler secret put MOLLIE_API_KEY      # begin met je TEST-key (test_...)
wrangler secret put ADMIN_PASSWORD      # kies een sterk wachtwoord voor /admin
# optioneel:
wrangler secret put ADMIN_USER          # standaard 'admin'
wrangler secret put RESEND_API_KEY      # voor bevestigingsmails (resend.com)
wrangler secret put MAIL_FROM           # bv. "Nijmegen Duckstad <info@nijmegenduckstad.nl>"
```
(Kan ook via dashboard → Workers & Pages → nijmegenduckstad → Settings → Variables and Secrets.)

## Stap 5 — Testen
- Eerst lokaal/preview met de **test-key**: een test-iDEAL-betaling doorloopt
  de flow zonder echt geld. Controleer dat je op `/bestelling?id=…` je nummers ziet
  en dat ze in het admin-dashboard staan.
- Webhooks van Mollie werken alleen op een **publiek bereikbare URL**
  (dus op het live domein, niet op localhost). Test de volledige betaalflow
  daarom op de gemergede site (zie stap 6) of een preview-deployment.

## Stap 6 — Live zetten
1. Merge `feature/bestelsysteem` → `main` (via een Pull Request op GitHub).
2. De GitHub Action deployt automatisch (~30s).
3. Check: `https://nijmegenduckstad.nl/bestellen` werkt, en `/admin` vraagt om wachtwoord.
4. Wanneer alles goed is: vervang de Mollie **test-key** door je **live-key**
   (`wrangler secret put MOLLIE_API_KEY` met `live_...`) en push een lege commit of
   redeploy.

## Beheer & administratie
- **Dashboard:** `https://nijmegenduckstad.nl/admin` (gebruiker `admin` + jouw wachtwoord).
- **Loterijlijst** (nummer ↔ koper) exporteer je als CSV of print je als PDF voor de trekking.
- **Trekking:** vul een prijs in en klik "Trek een winnaar" — het systeem kiest willekeurig
  een nog niet-gewonnen eendje en legt de winnaar vast.
- **Verkoop sluiten:** zet in het dashboard "online verkoop open" uit.

## Privacy (AVG)
- We slaan alleen op wat nodig is: naam, e-mail, (optioneel) telefoon/woonplaats,
  nieuwsbrief-keuze. Toestemming is verplicht bij het bestellen.
- Betaalgegevens lopen volledig via Mollie; die raken onze servers niet.
- Wil je later data verwijderen na de trekking: dat kan met een SQL-statement
  (`wrangler d1 execute …`). Vraag me gerust om een opschoonscript.

## Architectuur (kort)
- Eén Cloudflare Worker (`src/index.js`) handelt `/api/*` af en serveert verder de
  statische site via de ASSETS-binding.
- D1 (SQLite) bevat `orders`, `ducks`, `counters`, `settings`, `draws`.
- Nummering is atomair (counter + `RETURNING`), dus geen dubbele nummers, ook niet
  bij gelijktijdige betalingen.
