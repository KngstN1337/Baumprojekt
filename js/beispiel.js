// LTR – Testgruppe zum Ausprobieren: erzeugt einen Lehrgang mit erfundenen Teams und wahlweise Tagesprotokollen,
// Belohnungszähler und Wochenberichten. Was ausgefüllt ist und welche Lücken eingebaut werden, steuern die Optionen
// (siehe js/testgruppe.js). Alle Namen sind erfunden.
(function (global) {
  'use strict';
  const POOL = [
    ['Markus Brandt', 'Juna', 'Labrador Retriever, 2 J.', 'PP Dortmund', 'sicher'],
    ['Sandra Kühn', 'Fiete', 'Malinois, 3 J.', 'PP Münster', 'stuermisch'],
    ['Tobias Reuter', 'Ayla', 'Springer Spaniel, 2 J.', 'KPB Soest', 'zoegerlich'],
    ['Nina Albers', 'Bento', 'Deutscher Schäferhund, 4 J.', 'PP Bielefeld', 'sicher'],
    ['Jan Petersen', 'Kira', 'Labrador Retriever, 3 J.', 'PP Essen', 'ablenkbar'],
    ['Lea Hoffmann', 'Mojo', 'Malinois, 2 J.', 'PP Köln', 'stuermisch'],
    ['Daniel Vogt', 'Elli', 'Springer Spaniel, 3 J.', 'KPB Unna', 'sicher'],
    ['Katrin Wolff', 'Rocky', 'Holländer Schäferhund, 2 J.', 'PP Hagen', 'zoegerlich'],
    ['Felix Brenner', 'Luna', 'Labrador Retriever, 4 J.', 'KPB Borken', 'ablenkbar'],
    ['Miriam Scholz', 'Paco', 'Malinois, 3 J.', 'PP Bochum', 'sicher'],
    ['Stefan Lorenz', 'Nala', 'Cocker Spaniel, 2 J.', 'KPB Kleve', 'zoegerlich'],
    ['Julia Hartmann', 'Odin', 'Deutscher Schäferhund, 3 J.', 'PP Duisburg', 'stuermisch']
  ];
  const STOFFE = ['SIM-Karte', 'USB-Stick', 'Festplatte', 'Mobiltelefon', 'Kamera', 'Mikrofon'];
  const ORTE = [['Ausbildungszentrum · Halle A', 'Lochwand und Kofferreihe'], ['Bürogebäude · 2. OG', 'Schreibtische, Regale, Steckdosenleisten'], ['Wohnungsattrappe', 'Küche, Wohnzimmer, Kinderzimmer'],
    ['Fahrzeughalle', 'Pkw-Innenräume und Kofferräume'], ['Lagerhalle', 'Kartons und Paletten']];
  const NOTE = ['sehr gut', 'gut', 'befriedigend'];
  const MOT = { sicher: 'arbeitete konzentriert und ausdauernd.', stuermisch: 'sehr triebig, anfangs zu schnell an den Verstecken vorbei.', zoegerlich: 'brauchte Anlaufzeit, wurde dann zunehmend freudiger.', ablenkbar: 'ließ sich von Geräuschen und Futterresten ablenken.' };
  const NAECHST = { sicher: 'Verstecke höher und tiefer, längere Suchzeiten.', stuermisch: 'Ruhiger anführen, Anzeige an der Quelle festigen.', zoegerlich: 'Mehr Erfolgserlebnisse mit leichten Verstecken, Belohnung schneller.', ablenkbar: 'Ablenkung schrittweise steigern, Suchen kürzer halten.' };
  const TEAMTEXT = {
    sicher: ['zeigte sicher und ruhig an der Quelle an.', 'Keine.', 'Suchzeiten verlängern, Verstecke variieren.', 'sehr gut'],
    stuermisch: ['sucht schnell und mit hoher Motivation.', 'Anzeige teils zu stürmisch, Kratzen am Versteck.', 'Ruhiger anführen, Anzeige an der Quelle festigen.', 'gut'],
    zoegerlich: ['wird zunehmend freudiger in der Suche.', 'Zögerliches Verweisen bei neuen Gerüchen.', 'Mehr Erfolgserlebnisse mit leichten Verstecken.', 'befriedigend'],
    ablenkbar: ['arbeitet bei bekannten Gerüchen zuverlässig.', 'Lässt sich von Geräuschen und Futter ablenken.', 'Ablenkung schrittweise steigern, kürzere Suchen.', 'befriedigend']
  };
  // Allgemeiner Lehrgang (kein Spürhund): Inhalte aus Unterordnung und Revierarbeit
  const ALLG = ['Unterordnung: Leinenführigkeit und Fußarbeit im Wechsel', 'Revieren in der Halle mit Verbellen am Versteck', 'Gehorsam unter Ablenkung im Stadtgebiet', 'Bauchgurtführung und Abrufen aus der Bewegung', 'Fährte auf Wiese, 300 Schritte mit zwei Winkeln'];

  // opt: { teams, wochen, art ('spuerhund' | ''), woche (laufende Lehrgangswoche, wochen+1 = abgeschlossen), startHeute,
  //        protokolle ('keine' | 'bis' | 'luecken'), belohnungen, wochenberichte ('keine' | 'vor' | 'alle'),
  //        kopf ({ behoerde, oe1, oe2 } oder null), bewertungFehlt, teamOhne, titel }
  global.BaumprojektBeispiel = function (heute, trainer, opt) {
    const WBK = global.BaumprojektWorkbook;
    const o = Object.assign({ teams: 5, wochen: 4, art: 'spuerhund', woche: 4, protokolle: 'bis', belohnungen: true, wochenberichte: 'vor', kopf: null, bewertungFehlt: false, teamOhne: false, titel: 'Testgruppe' }, opt || {});
    const nT = Math.max(1, Math.min(POOL.length, Number(o.teams) || 5)), W = Math.max(1, Math.min(52, Number(o.wochen) || 4));
    const spuer = o.art === 'spuerhund', woche = Math.max(1, Math.min(W + 1, Number(o.woche) || 1));
    let seed = 7; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // Start so legen, dass heute in der gewünschten Lehrgangswoche liegt (abgeschlossen: letzte Woche war die letzte)
    const wd = (new Date(heute + 'T00:00').getDay() + 6) % 7;
    const start = o.startHeute ? heute : WBK.addDays(heute, -wd - (woche - 1) * 7);
    const T = POOL.slice(0, nT).map(([teilnehmer, hund, rasse, behoerde, typ]) => ({ teilnehmer, hund, rasse, behoerde, typ }));
    T.forEach(t => { t.name = WBK.teamName(t); });
    const ohne = o.teamOhne && nT > 1 ? T[nT - 1].name : null;
    // Gerüche über die Wochen verteilt einführen
    const abWoche = s => 1 + Math.floor(STOFFE.indexOf(s) * Math.max(1, W - 1) / STOFFE.length / 1.5);
    const notes = [], zg = [];
    const tagNr = (w, t) => (w - 1) * 4 + t;
    if (o.protokolle !== 'keine') {
      for (let w = 1; w <= W; w++) {
        for (let t = 0; t < 4; t++) { // Montag bis Donnerstag
          const datum = WBK.addDays(start, (w - 1) * 7 + t);
          if (datum >= heute) continue; // bis gestern, heute bleibt frei zum Einsprechen
          const [ort, bereich] = ORTE[(w + t) % ORTE.length];
          const heuteStoffe = STOFFE.filter(s => abWoche(s) <= w).slice(-3);
          const phase = Math.min(3, 1 + Math.floor((w - 1) * 3 / W));
          T.forEach((tm, ti) => {
            if (tm.name === ohne) return;
            if (o.protokolle === 'luecken' && r() < 0.22) return; // einzelne Tage fehlen
            const g = tm.hund, gut = phase >= 3 || tm.typ === 'sicher';
            let inhalt;
            if (spuer) inhalt = phase === 1 ? 'Kong-Koppelung an ' + heuteStoffe.join(' und ') + ', einfache Verstecke in Bodennähe, ' + (3 + t) + ' Durchgänge.'
              : phase === 2 ? 'Suche in ' + bereich + ', ' + (4 + t) + ' Verstecke, davon ' + (1 + t % 2) + ' in Kopfhöhe.'
                : 'Freie Suche ' + bereich + ' mit ' + (5 + t) + ' Verstecken und ' + (t % 2 ? 'einem Leerraum' : 'Ablenkung durch Futter') + '.';
            else inhalt = ALLG[(tagNr(w, t) + ti) % ALLG.length] + '.';
            const anz = !spuer ? '' : gut ? g + ' zeigte sicher an der Quelle an, ruhiges Ablegen.' : { stuermisch: g + ' zeigte teils zu stürmisch an, kratzte zweimal.', zoegerlich: g + ' zeigte zögerlich, verweist erst nach Nachfrage.', ablenkbar: g + ' zeigte bei ' + heuteStoffe[0] + ' sicher, bei den anderen Gerüchen noch unsicher.', sicher: '' }[tm.typ];
            const note = gut ? NOTE[(ti + t) % 2] : NOTE[1 + (ti + t) % 2];
            const ohneNote = o.bewertungFehlt && (ti + tagNr(w, t)) % 3 === 0;
            const bw = ohneNote ? '' : '\n' + note;
            const felder = {
              ort, zielgerueche: spuer ? heuteStoffe.join(', ') : '', inhalt,
              motivation: g + ' ' + MOT[tm.typ] + bw, anzeige: anz ? anz + bw : '', beobachtung: 'Nächster Schritt: ' + NAECHST[tm.typ],
              bemerkung: ti === 2 && w === 2 && t === 1 ? g + ' hat die linke Vorderpfote geschont, Suche verkürzt.' : ti === 4 && w === 3 && t === 0 ? 'Teilnehmer erst ab 10 Uhr anwesend (Dienstbesprechung).' : ''
            };
            if (o.protokolle === 'luecken' && r() < 0.3) felder[['motivation', 'anzeige', 'beobachtung', 'ort'][Math.floor(r() * 4)]] = '';
            const text = WBK.FELDER.map(([k]) => felder[k]).filter(Boolean).join('\n');
            notes.push({ datum, uhrzeit: String(8 + ti % 9).padStart(2, '0') + ':' + String(10 + Math.floor(r() * 40)).padStart(2, '0'), team: tm.name, text, felder, quelle: 'Testgruppe', von: '' });
            if (spuer && o.belohnungen) heuteStoffe.forEach((s, si) => zg.push({ datum, uhrzeit: '', team: tm.name, stoff: s, anzahl: Math.round(6 + r() * 12 + w * 2 - si), schritt: '', von: '', id: 'tg' + notes.length + '_' + si }));
          });
        }
      }
    }
    // Wochenberichte: bis zur Vorwoche oder alle bereits begonnenen Wochen
    const wochenberichte = {};
    const bisWoche = o.wochenberichte === 'alle' ? Math.min(W, woche) : o.wochenberichte === 'vor' ? Math.min(W, woche - 1) : 0;
    for (let w = 1; w <= bisWoche; w++) {
      const stoffe = STOFFE.filter(s => abWoche(s) === w);
      const phase = Math.min(3, 1 + Math.floor((w - 1) * 3 / W));
      const ab = spuer ? {
        inhalte: (stoffe.length ? 'Einführung der Zielgerüche ' + stoffe.join(' und ') + '. ' : '') + ['Koppelung über den Kong und erste Suchen in Bodennähe.', 'Suchen in Räumen mit Verstecken in Kopfhöhe.', 'Freie Suchen in Fahrzeugen und Lagerhalle mit Leerräumen und Ablenkung.'][phase - 1],
        ueberblick: ['Alle Teams haben die Koppelung angenommen, das Anzeigeverhalten ist noch uneinheitlich.', 'Die Teams werden in der Suche selbstständiger, bei höheren Verstecken gibt es noch Unsicherheiten.', 'Die Gruppe sucht zunehmend sicher und ausdauernd, das Anzeigeverhalten hat sich gefestigt.'][phase - 1]
      } : {
        inhalte: ALLG[w % ALLG.length] + ', dazu ' + ALLG[(w + 2) % ALLG.length].toLowerCase() + '.',
        ueberblick: ['Die Teams finden sich in die Abläufe ein.', 'Die Gruppe arbeitet zunehmend sicher unter Ablenkung.', 'Die Teams zeigen die Übungen überwiegend zuverlässig.'][phase - 1]
      };
      ab.gesamt = ['Die Ausbildungsgruppe hat einen guten Start gezeigt.', 'Die Gruppe hat sich insgesamt gut weiterentwickelt.', 'Die Ausbildungsgruppe befindet sich auf einem guten bis sehr guten Stand.'][phase - 1];
      ab.hinweise = ['Hunde vor der Arbeit ausreichend lösen lassen, Belohnung immer an der Quelle.', 'Suchmuster in Räumen konsequent einhalten.', 'Übungen zunehmend unter Prüfungsbedingungen durchführen.'][phase - 1];
      const teams = {};
      T.forEach((tm, ti) => {
        if (tm.name === ohne) return;
        const y = TEAMTEXT[tm.typ];
        teams[tm.name] = { fortschritte: tm.hund + ' ' + y[0], defizite: y[1], foerderung: y[2], bewertung: o.bewertungFehlt && (ti + w) % 3 === 0 ? '' : phase === 3 && tm.typ === 'zoegerlich' ? 'gut' : y[3], hinweise: ti === 2 && w === 2 ? 'Linke Vorderpfote am Dienstag geschont.' : 'Keine besonderen Hinweise' };
      });
      wochenberichte[w] = { abschnitte: ab, teams };
    }
    const k = o.kopf || {};
    return {
      meta: {
        titel: o.titel, trainer: trainer || 'Ausbilder', ort: 'Ausbildungszentrum', start, wochen: W, test: 'ja',
        kopfBehoerde: k.behoerde || '', kopfOe1: k.oe1 || '', kopfOe2: k.oe2 || '',
        ...(spuer ? { art: 'spuerhund', geruchVorlage: 'Datenspeicher', schrittVorlage: '' } : {})
      },
      teams: T.map(({ typ, ...t }) => t), notes, gesamt: {}, spuer: { stoffe: spuer ? STOFFE.slice() : [], schritte: [] }, zg, wochenberichte
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
