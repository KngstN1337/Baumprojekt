// Baumprojekt – vordefinierte Zielgerüche, Geruchs-Vorlagen und Konditionierungsschritte.
// Diese Einträge bekommt jeder Nutzer von Anfang an (in der App als „Vordefiniert“).
// Eigene Einträge der Nutzer liegen getrennt in ihrem Google Drive.
// Hier einfach ergänzen, streichen oder umbenennen. Namen der Gerüche in den Vorlagen müssen genauso geschrieben sein wie oben.
window.BaumprojektVordefiniert = {
  // Gerüche, gruppiert nach Bereich
  gerueche: [
    { gruppe: 'Sprengstoffe', namen: ['TNT', 'C4', 'Schwarzpulver', 'TATP', 'Nitropenta (PETN)'] },
    { gruppe: 'Betäubungsmittel', namen: ['Cannabis', 'Kokain', 'Heroin', 'Amphetamin'] }
  ],
  // Geruchs-Vorlagen: fertige Stofflisten für einen Lehrgang
  geruchVorlagen: [
    { name: 'Sprengstoff Grundlehrgang', stoffe: ['TNT', 'C4', 'Schwarzpulver', 'TATP'] },
    { name: 'Rauschgift', stoffe: ['Cannabis', 'Kokain', 'Heroin', 'Amphetamin'] }
  ],
  // Schritt-Vorlagen: Konditionierungsschritte (Name und kurze Beschreibung)
  schrittVorlagen: [
    { name: 'Grundkonditionierung', schritte: [
      { name: 'Schritt 1', beschr: '' },
      { name: 'Schritt 2', beschr: '' },
      { name: 'Schritt 3', beschr: '' },
      { name: 'Schritt 4', beschr: '' }
    ] }
  ]
};
