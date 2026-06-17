/* =========================================================================
   Nijmegen Duckstad — centrale configuratie
   Pas hier de cijfers en links aan. De rest van de site werkt automatisch mee.
   ========================================================================= */
window.DUCKSTAD = {
  // --- Verkoop / live teller ---
  ducksSold: 0,            // aantal verkochte eendjes (handmatig bijwerken of koppelen aan verkoopsysteem)
  ducksTotal: 5000,        // verkoopdoel reguliere eendjes
  pricePerDuck: 5,         // prijs per regulier eendje (€)
  businessDuckPrice: 150,  // prijs bedrijfseendje (€)
  businessDucksTotal: 50,  // doel bedrijfseendjes

  // --- Evenement ---
  eventDateISO: "2027-04-17T15:00:00+02:00", // datum/tijd start (voor de countdown)
  eventDateLabel: "Zaterdag 17 april 2027",
  eventLocation: "Spiegelwaal, Nijmegen",

  // --- Links ---
  salesUrl: "https://badeendjesrace.nl",   // online verkoopsysteem (vervang door jullie directe verkooplink)
  // E-mail-endpoint voor formulieren. Vul je Web3Forms access key in (gratis via web3forms.com)
  // of laat leeg om de mailto-fallback te gebruiken.
  formAccessKey: "",
  contactEmail: "info@nijmegenduckstad.nl",
  phone: "",

  // --- Goed doel ---
  goalNet: 31701,          // verwachte netto-opbrengst voor het goede doel (€)

  // --- Social ---
  instagram: "",           // bijv. "https://instagram.com/nijmegenduckstad"
  facebook: ""
};
