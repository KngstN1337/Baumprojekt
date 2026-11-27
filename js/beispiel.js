// LTR – Beispiel-Lehrgang zum Ausprobieren: „Datenspeicherspürhunde“, 4 Wochen, 5 Teams, mit Tagesprotokollen,
// Belohnungszähler und Wochenberichten (Woche 1–3; die laufende Woche bleibt leer zum Ausprobieren). Alle Namen sind erfunden.
(function (global) {
  'use strict';
  global.BaumprojektBeispiel = function (heute, trainer) {
    const WBK = global.BaumprojektWorkbook;
    let seed = 7; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const pick = a => a[Math.floor(r() * a.length)];
    // Start: Montag vor drei Wochen, damit der Lehrgang gerade in der 4. Woche läuft
    const d0 = new Date(heute + 'T00:00');
    const wd = (d0.getDay() + 6) % 7, start = WBK.addDays(heute, -wd - 21);
    const T = [
      { teilnehmer: 'Markus Brandt', hund: 'Juna', rasse: 'Labrador Retriever, 2 J.', behoerde: 'PP Dortmund', typ: 'sicher' },
      { teilnehmer: 'Sandra Kühn', hund: 'Fiete', rasse: 'Malinois, 3 J.', behoerde: 'PP Münster', typ: 'stuermisch' },
      { teilnehmer: 'Tobias Reuter', hund: 'Ayla', rasse: 'Springer Spaniel, 2 J.', behoerde: 'KPB Soest', typ: 'zoegerlich' },
      { teilnehmer: 'Nina Albers', hund: 'Bento', rasse: 'Deutscher Schäferhund, 4 J.', behoerde: 'PP Bielefeld', typ: 'sicher' },
      { teilnehmer: 'Jan Petersen', hund: 'Kira', rasse: 'Labrador Retriever, 3 J.', behoerde: 'PP Essen', typ: 'ablenkbar' }
    ].map(t => Object.assign(t, { name: WBK.teamName(t) }));
    const STOFFE = ['SIM-Karte', 'USB-Stick', 'Festplatte', 'Mobiltelefon', 'Kamera', 'Mikrofon'];
    const abWoche = { 'SIM-Karte': 1, 'USB-Stick': 1, 'Festplatte': 2, 'Mobiltelefon': 2, 'Kamera': 3, 'Mikrofon': 4 };
    const ORTE = [['Ausbildungszentrum · Halle A', 'Lochwand und Kofferreihe'], ['Bürogebäude · 2. OG', 'Schreibtische, Regale, Steckdosenleisten'], ['Wohnungsattrappe', 'Küche, Wohnzimmer, Kinderzimmer'],
      ['Fahrzeughalle', 'Pkw-Innenräume und Kofferräume'], ['Lagerhalle', 'Kartons und Paletten']];
    const NOTE = ['sehr gut', 'gut', 'befriedigend'];
    const notes = [], zg = [];
    for (let w = 1; w <= 4; w++) {
      for (let t = 0; t < 4; t++) { // Montag bis Donnerstag
        const datum = WBK.addDays(start, (w - 1) * 7 + t);
        if (datum > heute) continue;
        const [ort, bereich] = ORTE[(w + t) % ORTE.length];
        const stoffe = STOFFE.filter(s => abWoche[s] <= w);
        const heuteStoffe = stoffe.slice(-3);
        T.forEach((tm, ti) => {
          const g = tm.hund, gut = w >= 3 || tm.typ === 'sicher';
          const inhalt = w === 1 ? 'Kong-Koppelung an ' + heuteStoffe.join(' und ') + ', einfache Verstecke in Bodennähe, ' + (3 + t) + ' Durchgänge.'
            : w === 2 ? 'Suche in ' + bereich + ', ' + (4 + t) + ' Verstecke, davon ' + (1 + t % 2) + ' in Kopfhöhe.'
              : 'Freie Suche ' + bereich + ' mit ' + (5 + t) + ' Verstecken und ' + (t % 2 ? 'einem Leerraum' : 'Ablenkung durch Futter') + '.';
          const mot = { sicher: g + ' arbeitete konzentriert und ausdauernd.', stuermisch: g + ' sehr triebig, anfangs zu schnell an den Verstecken vorbei.', zoegerlich: g + ' brauchte Anlaufzeit, wurde dann zunehmend freudiger.', ablenkbar: g + ' ließ sich von Geräuschen und Futterresten ablenken.' }[tm.typ];
          const anz = gut ? g + ' zeigte sicher an der Quelle an, ruhiges Ablegen.' : { stuermisch: g + ' zeigte teils zu stürmisch an, kratzte zweimal.', zoegerlich: g + ' zeigte zögerlich, verweist erst nach Nachfrage.', ablenkbar: g + ' zeigte bei ' + heuteStoffe[0] + ' sicher, bei den anderen Stoffen noch unsicher.', sicher: '' }[tm.typ];
          const note = gut ? NOTE[(ti + t) % 2] : NOTE[1 + (ti + t) % 2];
          const naechst = { sicher: 'Verstecke höher und tiefer, längere Suchzeiten.', stuermisch: 'Ruhiger anführen, Anzeige an der Quelle festigen.', zoegerlich: 'Mehr Erfolgserlebnisse mit leichten Verstecken, Belohnung schneller.', ablenkbar: 'Ablenkung schrittweise steigern, Suchen kürzer halten.' }[tm.typ];
          const felder = { ort: ort.split(' · ')[0] + (ort.includes('·') ? ' · ' + ort.split(' · ')[1] : ''), zielgerueche: heuteStoffe.join(', '), inhalt,
            motivation: mot + '\nBewertung: ' + note, anzeige: anz + '\nBewertung: ' + note, beobachtung: 'Nächster Schritt: ' + naechst,
            bemerkung: ti === 2 && w === 2 && t === 1 ? 'Ayla hat die linke Vorderpfote geschont, Suche verkürzt.' : ti === 4 && w === 3 && t === 0 ? 'Teilnehmer erst ab 10 Uhr anwesend (Dienstbesprechung).' : '' };
          const text = WBK.FELDER.map(([k]) => felder[k]).filter(Boolean).join('\n');
          notes.push({ datum, uhrzeit: String(8 + ti).padStart(2, '0') + ':' + String(10 + Math.floor(r() * 40)).padStart(2, '0'), team: tm.name, text, felder, quelle: 'Beispiel', von: '' });
          heuteStoffe.forEach((s, si) => zg.push({ datum, uhrzeit: '', team: tm.name, stoff: s, anzahl: Math.round(6 + r() * 12 + w * 2 - si), schritt: '', von: '', id: 'bsp' + notes.length + si }));
        });
      }
    }
    const wochenberichte = {};
    const TEXT = {
      1: ['Schwerpunkt war die Koppelung der Zielgerüche SIM-Karte und USB-Stick über den Kong sowie erste Suchen in Bodennähe in Halle A.', 'Alle Teams haben die Koppelung angenommen. Die Gruppe arbeitete motiviert, das Anzeigeverhalten ist noch uneinheitlich.', 'Die Ausbildungsgruppe hat einen guten Start in den Lehrgang gezeigt.', 'Hunde vor der Suche ausreichend lösen lassen, Belohnung immer an der Quelle.'],
      2: ['Einführung der Zielgerüche Festplatte und Mobiltelefon, Suchen im Bürogebäude und in der Wohnungsattrappe, erste Verstecke in Kopfhöhe.', 'Die Teams werden in der Suche selbstständiger. Bei höheren Verstecken zeigen einige Hunde noch Unsicherheiten.', 'Die Gruppe hat sich insgesamt gut weiterentwickelt.', 'Suchmuster in Räumen konsequent einhalten (rechts beginnend, hoch und tief).'],
      3: ['Einführung des Zielgeruchs Kamera, freie Suchen in Fahrzeugen und in der Lagerhalle mit Leerräumen und Ablenkung.', 'Die Gruppe sucht zunehmend sicher und ausdauernd, das Anzeigeverhalten hat sich bei den meisten Teams gefestigt.', 'Die Ausbildungsgruppe befindet sich auf einem guten bis sehr guten Stand.', 'In der kommenden Woche folgt der Zielgeruch Mikrofon und eine Übung unter Prüfungsbedingungen.']
    };
    const TEAMTEXT = {
      sicher: ['zeigte sicher und ruhig an der Quelle an.', 'Keine.', 'Suchzeiten verlängern, Verstecke variieren.', 'sehr gut'],
      stuermisch: ['sucht schnell und mit hoher Motivation.', 'Anzeige teils zu stürmisch, Kratzen am Versteck (Di, Mi).', 'Ruhiger anführen, Anzeige an der Quelle festigen.', 'gut'],
      zoegerlich: ['wird zunehmend freudiger in der Suche.', 'Zögerliches Verweisen bei neuen Stoffen (Mo, Do).', 'Mehr Erfolgserlebnisse mit leichten Verstecken.', 'befriedigend'],
      ablenkbar: ['arbeitet bei bekannten Stoffen zuverlässig.', 'Lässt sich von Geräuschen und Futter ablenken (Di).', 'Ablenkung schrittweise steigern, kürzere Suchen.', 'befriedigend']
    };
    [1, 2, 3].forEach(w => {
      if (WBK.addDays(start, (w - 1) * 7) > heute) return;
      const x = TEXT[w], teams = {};
      T.forEach(tm => { const y = TEAMTEXT[tm.typ]; teams[tm.name] = { fortschritte: tm.hund + ' ' + y[0], defizite: y[1], foerderung: y[2], bewertung: w === 3 && tm.typ === 'zoegerlich' ? 'gut' : y[3], hinweise: 'Keine besonderen Hinweise', bemerkungen: tm.hund === 'Ayla' && w === 2 ? 'Linke Vorderpfote am Dienstag geschont.' : '' }; });
      wochenberichte[w] = { abschnitte: { inhalte: x[0], ueberblick: x[1], gesamt: x[2], hinweise: x[3] }, teams };
    });
    return {
      meta: { titel: 'Beispiel Datenspeicherspürhunde', trainer: trainer || 'Ausbilder', ort: 'Ausbildungszentrum', start, wochen: 4, art: 'spuerhund', geruchVorlage: 'Datenspeicher', schrittVorlage: '' },
      teams: T.map(({ typ, ...t }) => t), notes, gesamt: {}, spuer: { stoffe: STOFFE.slice(), schritte: [] }, zg, wochenberichte
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
