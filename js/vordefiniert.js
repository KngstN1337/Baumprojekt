// Baumprojekt – vordefinierte Zielgerüche, Geruchs-Vorlagen und Konditionierungsschritte.
// Diese Einträge bekommt jeder Nutzer von Anfang an (in der App als „Vordefiniert“).
// Eigene Einträge der Nutzer liegen getrennt in ihrem Google Drive.
// Hier einfach ergänzen, streichen oder umbenennen. Namen der Gerüche in den Vorlagen müssen genauso geschrieben sein wie oben.
window.BaumprojektVordefiniert = {
  // Glossar: Fachbegriffe für Spracherkennung und Formulierung (falsch = typische Fehlerkennungen, mit Komma getrennt)
  glossar: [
    { begriff: 'Clicker', falsch: 'Klicker, Klicka' },
    { begriff: 'Kong', falsch: 'Kongo, Gong, King' },
    { begriff: 'markern', falsch: 'markieren, Markern' },
    { begriff: 'spüren', falsch: 'spuren, spühren' },
    { begriff: 'Spürhund', falsch: 'Spür Hund, Spurhund' },
    { begriff: 'Trieb', falsch: 'Trip' }
  ],
  // Gerüche, gruppiert nach Bereich. Gerüche aus den Vorlagen unten kommen automatisch dazu.
  gerueche: [
    { gruppe: 'Sprengstoffe', namen: ['TNT', 'C4', 'Schwarzpulver', 'TATP', 'Nitropenta (PETN)'] },
    { gruppe: 'Betäubungsmittel', namen: ['Cannabis', 'Kokain', 'Heroin', 'Amphetamin'] },
    { gruppe: 'Datenspeicher', namen: ['SIM-Karte', 'USB-Stick', 'Mikrofon', 'Kamera', 'Festplatte', 'Mobiltelefon'] }
  ],
  // Geruchs-Vorlagen: fertige Stofflisten für einen Lehrgang
  geruchVorlagen: [
    { name: 'Sprengstoff Grundlehrgang', stoffe: ['TNT', 'C4', 'Schwarzpulver', 'TATP'] },
    { name: 'Rauschgift', stoffe: ['Cannabis', 'Kokain', 'Heroin', 'Amphetamin'] },
    { name: 'Datenspeicher', stoffe: ['SIM-Karte', 'USB-Stick', 'Mikrofon', 'Kamera', 'Festplatte', 'Mobiltelefon'] }
  ],
  // Schritt-Vorlagen: Konditionierungsschritte (Name und kurze Beschreibung)
  schrittVorlagen: [
    { name: 'Kong - Zielgeruch Koppelung', schritte: [
      { name: 'Reagenzglas, Kongstück, Zielgeruch', beschr: '' },
      { name: 'Reagenzglas (frisch kontaminiert), Zielgeruch', beschr: '' },
      { name: 'Reagenzglas (alt kontaminiert), Zielgeruch', beschr: '' },
      { name: 'Reagenzglas, Zielgeruch', beschr: '' }
    ] }
  ]
};
