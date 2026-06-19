/* =========================================================================
   Nijmegen Duckstad — centrale configuratie
   Pas hier de cijfers en links aan. De rest van de site werkt automatisch mee.
   ========================================================================= */
window.DUCKSTAD = {
  // --- Versie (in de footer) — bump bij ELKE update ---
  version: "1.0.6",

  // --- Verkoop / live teller ---
  // ducksSold is alleen een fallback; met het bestelsysteem actief haalt de
  // teller de echte stand op via /api/status.
  ducksSold: 0,
  ducksTotal: 5000,        // verkoopdoel reguliere eendjes
  pricePerDuck: 5,         // prijs per regulier eendje (€)
  businessDuckPrice: 150,  // prijs bedrijfseendje (€)
  businessDucksTotal: 50,  // doel bedrijfseendjes

  // --- Evenement ---
  eventDateISO: "2027-04-17T15:00:00+02:00",
  eventDateLabel: "Zaterdag 17 april 2027",
  eventLocation: "Spiegelwaal, Nijmegen",

  // --- Links ---
  // Interne bestelpagina (eigen systeem met iDEAL). Zet op een externe URL
  // als je weer naar een ander verkoopsysteem wilt linken.
  salesUrl: "/bestellen",
  formAccessKey: "",
  contactEmail: "info@nijmegenduckstad.nl",
  phone: "",

  // --- Goed doel ---
  goalNet: 31701,

  // --- Social ---
  instagram: "",
  facebook: ""
};
