// LTR – Excel-Datei je Lehrgang (Format der ersten Vorlage: Übersicht, Notizen (Rohdaten), Teams)
// Datenquelle ist das Blatt "Notizen (Rohdaten)". Die Übersicht wird daraus bei jedem Speichern neu
// aufgebaut; die Spalte "Gesamteindruck" bleibt dabei erhalten.
// Was in der Übersicht am PC geändert wurde, geht nicht verloren: Beim Schreiben merkt sich die App im versteckten
// Blatt "_uebersicht", was in jeder Zelle stand. Beim Lesen wird verglichen, geänderte Zellen fließen in die Notizen zurück.
(function (global) {
  'use strict';
  const ExcelJS = global.ExcelJS || (typeof require !== 'undefined' ? require('exceljs') : null);

  const SHEET_UEB = 'Übersicht';
  const SHEET_NOT = 'Notizen (Rohdaten)';
  const SHEET_TEAMS = 'Teams';
  const SHEET_META = '_baumprojekt';
  const SHEET_GLOSSAR = '_glossar';
  const SHEET_STAND = '_uebersicht'; // alte Dateien (Blatt „Übersicht“)
  const SHEET_TP = 'Tagesprotokolle';
  const SHEET_STAND_TP = '_tagesprotokoll'; // Abbild des Tagesprotokolls für Änderungen am PC
  // Spürhund-Lehrgänge: Zielgerüche, Belohnungen und Konditionierungsschritte
  const SHEET_ZG = 'Zielgerüche';
  const SHEET_ZG_ROH = 'Zielgerüche (Rohdaten)';
  const SHEET_SPUER = '_spuerhund';
  const AM_PC = ' (am PC geändert)';
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const BLUE = 'FF1F4E79';
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

  // ---------- Datums-Helfer (immer lokale Zeit, ISO "YYYY-MM-DD" intern) ----------
  function isoToDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function dateToIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isoToDe(iso) { const [y, m, d] = iso.split('-'); return d + '.' + m + '.' + y; }
  function addDays(iso, n) { const d = isoToDate(iso); d.setDate(d.getDate() + n); return dateToIso(d); }
  function dayIndex(startIso, iso) { return Math.round((isoToDate(iso) - isoToDate(startIso)) / 86400000) + 1; }
  function weekday(iso) { return WD[isoToDate(iso).getDay()]; }

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(r => r.text).join('');
      if (v.text != null) return String(v.text);
      if (v.result != null) return cellText(v.result);
      return '';
    }
    return v;
  }
  function parseDateCell(v) {
    v = cellText(v);
    if (v instanceof Date) return dateToIso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
    if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return dateToIso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
  }
  function parseTimeCell(v) {
    v = cellText(v);
    if (v instanceof Date) return String(v.getUTCHours()).padStart(2, '0') + ':' + String(v.getUTCMinutes()).padStart(2, '0');
    if (typeof v === 'number') { const min = Math.round((v % 1) * 1440); return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
    return String(v || '').trim();
  }

  function teamName(t) {
    if (t.name && t.name.trim()) return t.name.trim();
    const vor = (t.teilnehmer || '').trim().split(/\s+/)[0] || '';
    return [vor, (t.hund || '').trim()].filter(Boolean).join(' & ');
  }

  // Alle Tage des Lehrgangs (Start + Wochen*7) plus evtl. Tage mit Notizen außerhalb des Zeitraums
  function courseDays(course) {
    const days = new Set();
    const n = (Number(course.meta.wochen) || 4) * 7;
    for (let i = 0; i < n; i++) days.add(addDays(course.meta.start, i));
    course.notes.forEach(x => x.datum && days.add(x.datum));
    return [...days].sort();
  }

  function sortNotes(notes) {
    return notes.slice().sort((a, b) => (a.datum + a.uhrzeit).localeCompare(b.datum + b.uhrzeit));
  }

  // Inhalt einer Übersichtszelle: je Notiz ein Abschnitt „• Text (Vorname)“, getrennt durch Zeilenumbruch
  function segments(notes, team, datum, mehrere) {
    return notes.filter(n => n.team === team && n.datum === datum).map(n => ({
      team, datum, uhrzeit: n.uhrzeit || '', von: n.von || '', text: n.text,
      bullet: !/^\s*•/.test(n.text), suf: mehrere && n.von ? n.von.trim().split(/\s+/)[0] : ''
    }));
  }
  const render = s => (s.bullet ? '• ' : '') + s.text + (s.suf ? ' (' + s.suf + ')' : '');
  const norm = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();

  // Spaltenbreite passend zum Inhalt: längste Zeile (+2 Zeichen Luft), begrenzt auf min/max.
  // Längere Texte werden innerhalb der Höchstbreite umgebrochen.
  function fitWidth(values, min, max) {
    let w = 0;
    values.forEach(v => String(v == null ? '' : v).split('\n').forEach(l => { w = Math.max(w, l.length); }));
    return Math.max(min, Math.min(max, w + 2));
  }
  // Wie viele Zeilen ein Text bei gegebener Spaltenbreite braucht
  function lineCount(txt, width) {
    const per = Math.max(1, width - 2);
    return String(txt || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / per)), 0);
  }

  // ---------- Gestaltung „Amtlich Blau“ (Entwurf A2) ----------
  const A2 = { blau: 'FF0061A7', grau: 'FFF2F2F2', label: 'FFE3EEF7', gitter: 'FFBFCEDD', font: 'Arial' };
  const fnt = o => Object.assign({ name: A2.font, size: 10, color: { argb: 'FF000000' } }, o || {});
  const seite = (s, c) => ({ style: s, color: { argb: c || A2.gitter } });
  // Spalten des Tagesprotokolls, die aus den Notizen kommen (Schlüssel = Feld in note.felder)
  const FELDER = [['ort', 'Trainingsort'], ['zielgerueche', 'Zielgerüche'], ['inhalt', 'Trainingsinhalt / Aufbau'], ['motivation', 'Motivation'], ['anzeige', 'Anzeigeverhalten'],
    ['beobachtung', 'Beobachtungen / nächster Schritt'], ['bemerkung', 'Bemerkungen / Wissenswertes']];
  // Inhalt eines Feldes einer Notiz. Ältere Notizen (noch nicht aufgeteilt) stehen ganz unter „Beobachtungen“.
  const feldVon = (n, k) => n.felder ? String(n.felder[k] || '').trim() : (k === 'beobachtung' ? n.text || '' : '');
  const deKurz = iso => weekday(iso) + ' ' + isoToDe(iso).replace(/\.(\d\d)(\d\d)$/, '.$2');
  let LOGO = null;
  let KOPF = ''; // Lehrgangsname für die Kopfzeile beim Druck // Base64 des LAFP-Logos (setzt die App beim Start)

  function titelZeilen(ws, titel, unter, breite) {
    ws.getCell('A1').value = titel; ws.getCell('A1').font = fnt({ size: 16, bold: true, color: { argb: A2.blau } });
    ws.getRow(1).height = 26;
    for (let c = 1; c <= breite; c++) ws.getRow(2).getCell(c).border = { bottom: seite('medium', A2.blau) };
  }
  function kopfZeile(row, werte) {
    werte.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = h; c.font = fnt({ bold: true, color: { argb: 'FFFFFFFF' } });
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A2.blau } };
      c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      const s = seite('thin', A2.blau); c.border = { left: s, right: s, top: s, bottom: seite('medium', A2.blau) };
    });
    row.height = 30;
  }
  // Datenzeile: Schrift schwarz, Zeilen abwechselnd grau/weiß, dünnes Gitter; neuerTag = dicke blaue Linie oben
  function datenZeile(row, n, zebra, neuerTag, mitte) {
    for (let c = 1; c <= n; c++) {
      const cell = row.getCell(c);
      cell.font = fnt(cell.font && cell.font.bold ? { bold: true } : {});
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A2.grau } };
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: mitte && mitte.includes(c) ? 'center' : 'left', indent: mitte && mitte.includes(c) ? 0 : 1 };
      cell.border = { left: seite('thin'), right: seite('thin'), bottom: seite('thin'), top: neuerTag ? seite('thick', A2.blau) : seite('thin') };
    }
  }
  // Querformat, auf Seitenbreite skaliert, so viele Seiten wie nötig, Kopfzeile auf jeder Seite
  function druck(ws, kopfReihe, blatt) {
    ws.pageSetup = Object.assign(ws.pageSetup || {}, { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.25, footer: 0.25 } });
    if (kopfReihe) ws.pageSetup.printTitlesRow = kopfReihe + ':' + kopfReihe;
    ws.headerFooter = { oddHeader: '&L&"Arial"&8' + KOPF.replace(/&/g, '&&') + '&R&"Arial"&8' + blatt, oddFooter: '&L&"Arial"&8Interne Dokumentation&C&"Arial,Fett"&8Seite &P von &N&R&"Arial"&8Gedruckt am &D' };
  }
  // Zeilenhöhe passend zum längsten Text (Excel macht das bei umgebrochenem Text nicht von selbst)
  function hoehe(row, breiten) {
    let z = 1;
    breiten.forEach((w, i) => { z = Math.max(z, lineCount(cellText(row.getCell(i + 1).value) instanceof Date ? '' : cellText(row.getCell(i + 1).value), Math.max(4, w * 1.1))); });
    row.height = Math.max(18, Math.min(409, z * 13 + 6));
  }
  function logoRein(wb, ws, spalte) {
    if (!LOGO) return;
    try { const id = wb.addImage({ base64: LOGO, extension: 'png' }); ws.addImage(id, { tl: { col: spalte, row: 0.2 }, ext: { width: 230, height: 78 }, editAs: 'oneCell' }); } catch (e) { /* ohne Logo weiter */ }
  }

  // ---------- Wochenberichte (je Lehrgangswoche ein Reiter „Wochenbericht KW nn“) ----------
  // Das Blatt selbst ist die Datenquelle: Was am PC geändert wird, liest die App beim nächsten Öffnen wieder ein.
  function isoKW(iso) { const d = isoToDate(iso); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const wd = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - wd); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); }
  const WB_ABSCHNITTE = [['inhalte', '1 | Ausbildungsinhalte / Schwerpunkte'], ['ueberblick', '2 | Gesamtüberblick der Ausbilder'], ['gesamt', '4 | Gesamtbewertung der Ausbildungsgruppe'], ['hinweise', '5 | Hinweise für die Ausbildungsgruppe']];
  const WB_TEAM = [['fortschritte', 'Fortschritte'], ['defizite', 'Auffälligkeiten / Defizite'], ['foerderung', 'Fördermaßnahmen / nächste Schritte'], ['bewertung', 'Ausbilderbewertung'], ['hinweise', 'Hinweise'], ['bemerkungen', 'Bemerkungen / Wissenswertes']];
  const WB_TEAMKOPF = '3 | Individuelle Entwicklung der Mensch-Hund-Teams';
  const wocheStart = (m, w) => addDays(m.start, (w - 1) * 7);
  // Tage mit Notizen eines Teams in einer Woche (= dokumentierte Einheiten)
  function einheiten(course, team, w) {
    const a = wocheStart(course.meta, w), b = addDays(a, 6);
    return new Set(course.notes.filter(n => n.team === team && n.datum >= a && n.datum <= b).map(n => n.datum)).size;
  }
  function buildWochen(wb, course, teams) {
    const m = course.meta, wbs = course.wochenberichte || {};
    Object.keys(wbs).map(Number).filter(w => w > 0).sort((a, b) => a - b).forEach(w => {
      const b = wbs[w] || {}, a = wocheStart(m, w), kw = isoKW(a);
      const ws = wb.addWorksheet('Wochenbericht KW ' + String(kw).padStart(2, '0'), { views: [{ showGridLines: false }] });
      const N = 8, breite = [26, 16, 30, 30, 30, 17, 24, 24];
      breite.forEach((x, i) => { ws.getColumn(i + 1).width = x; });
      titelZeilen(ws, (m.titel ? m.titel + ' | ' : '') + 'Gemeinsamer interner Wochenbericht', '', 6);
      ws.getRow(3).height = 30;
      logoRein(wb, ws, 6.2);
      const kopf = [['Dienststelle', m.kopfBehoerde || '–', 'Organisationseinheit', [m.kopfOe1, m.kopfOe2].filter(Boolean).join(' – ') || '–'], ['Trainer', m.trainer || '–', 'Lehrgangswoche', w + '. Lehrgangswoche'],
        ['Kalenderwoche', kw + '. KW', 'Zeitraum', isoToDe(a) + ' bis ' + isoToDe(addDays(a, 6))]];
      kopf.forEach((k, i) => {
        const r = 4 + i, row = ws.getRow(r);
        ws.mergeCells(r, 2, r, 3); ws.mergeCells(r, 5, r, 6);
        [[1, k[0], true], [2, k[1]], [4, k[2], true], [5, k[3]]].forEach(([c, v, lab]) => {
          const cell = row.getCell(c); cell.value = v; cell.font = fnt(lab ? { bold: true } : {});
          if (lab) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A2.label } };
          cell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
        });
        [1, 2, 3, 4, 5, 6].forEach(c => { row.getCell(c).border = { left: seite('thin'), right: seite('thin'), top: seite('thin'), bottom: seite('thin') }; });
      });
      let r = 8;
      const balken = text => { ws.mergeCells(r, 1, r, N); const c = ws.getCell(r, 1); c.value = text; c.font = fnt({ bold: true, size: 11, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A2.blau } }; c.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(r).height = 20; r++; };
      const absatz = text => { ws.mergeCells(r, 1, r, N); const c = ws.getCell(r, 1); c.value = text || ''; c.font = fnt(); c.alignment = { wrapText: true, vertical: 'top', indent: 1 }; ws.getRow(r).height = Math.max(18, Math.min(409, lineCount(text, 190) * 13 + 6)); r += 2; };
      const ab = b.abschnitte || {};
      WB_ABSCHNITTE.slice(0, 2).forEach(([k, t]) => { balken(t); absatz(ab[k]); });
      balken(WB_TEAMKOPF);
      kopfZeile(ws.getRow(r), ['Team', 'Dokumentierte\nEinheiten', ...WB_TEAM.map(x => x[1])]); r++;
      teams.forEach((t, i) => {
        const tb = (b.teams || {})[t.name] || {}, row = ws.getRow(r++);
        const n = einheiten(course, t.name, w);
        row.values = [t.name + (t.behoerde ? ', ' + t.behoerde : ''), n + (n === 1 ? ' Tagesprotokoll' : ' Tagesprotokolle'), ...WB_TEAM.map(([k]) => tb[k] || '')];
        row.getCell(1).font = { bold: true };
        datenZeile(row, N, i % 2 === 1, false, [2, 6]);
        hoehe(row, breite);
      });
      r++;
      WB_ABSCHNITTE.slice(2).forEach(([k, t]) => { balken(t); absatz(ab[k]); });
      druck(ws, 0, 'Wochenbericht KW ' + kw);
    });
  }
  function parseWochen(wb, course, teams) {
    course.wochenberichte = {};
    const s = c => String(cellText(c.value) == null ? '' : cellText(c.value)).trim();
    wb.worksheets.filter(ws => /^Wochenbericht KW/.test(ws.name)).forEach(ws => {
      let w = 0;
      for (let r = 4; r <= 7; r++) { const row = ws.getRow(r); if (s(row.getCell(4)) === 'Lehrgangswoche') w = parseInt(s(row.getCell(5)), 10) || 0; }
      if (!w) return;
      const b = { abschnitte: {}, teams: {} };
      let modus = '', spalten = null;
      for (let r = 8; r <= ws.rowCount; r++) {
        const row = ws.getRow(r), a = s(row.getCell(1));
        const ab = WB_ABSCHNITTE.find(x => x[1] === a);
        if (ab) { modus = ab[0]; continue; }
        if (a === WB_TEAMKOPF) { modus = 'teams'; spalten = null; continue; }
        if (modus === 'teams') {
          if (!spalten) { if (a === 'Team') { spalten = {}; row.eachCell((c, k) => { const h = s(c).replace(/\s+/g, ' '); const f = WB_TEAM.find(x => x[1] === h); if (f) spalten[f[0]] = k; }); } continue; }
          if (!a) { modus = ''; continue; }
          const tm = teams.find(t => a === t.name || a.indexOf(t.name + ',') === 0); if (!tm) continue;
          const tb = {}; Object.keys(spalten).forEach(k => { tb[k] = s(row.getCell(spalten[k])); });
          b.teams[tm.name] = tb;
        } else if (modus && a && !b.abschnitte[modus]) { b.abschnitte[modus] = a; }
      }
      course.wochenberichte[w] = b;
    });
  }

  // ---------- Schreiben ----------
  function build(course) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'LTR';
    const m = course.meta;
    KOPF = m.titel || '';
    const teams = course.teams.map(t => ({ ...t, name: teamName(t) }));
    const days = courseDays(course);
    const notes = sortNotes(course.notes);
    const zg = course.zg || [];
    const spuer = m.art === 'spuerhund' || zg.length > 0;
    const bis = addDays(m.start, (Number(m.wochen) || 4) * 7 - 1);

    // Start: Kopfdaten (aus den Einstellungen), Lehrgang, Bewertungsskala, Hinweise
    const wsS = wb.addWorksheet('Start', { views: [{ showGridLines: false }] });
    titelZeilen(wsS, (m.titel ? m.titel + ' | ' : '') + 'Trainingsdokumentation', '', 2);
    const start = [['Behörde / Einrichtung', m.kopfBehoerde], ['Organisationseinheit', [m.kopfOe1, m.kopfOe2].filter(Boolean).join(' – ')], ['Lehrgang', m.titel], ['Zeitraum', isoToDe(m.start) + ' bis ' + isoToDe(bis) + ' (' + (Number(m.wochen) || 4) + ' Wochen)'],
      ['Trainer/in', m.trainer], ['Teams', String(teams.length)],
      ['Bewertung', 'Schulnoten, ausgeschrieben und so eingesprochen: sehr gut | gut | befriedigend | ausreichend | mangelhaft | ungenügend. Wird keine Note gesagt, bleibt sie leer.'],
      ['Datenpflege', 'Diese Datei liegt im eigenen Google Drive und wird von der App automatisch aktualisiert. Änderungen im Tagesprotokoll am PC werden übernommen.'],
      ['Datenschutz', 'Nur dienstlich freigegebene Angaben eintragen und die geltenden Datenschutz- und Aufbewahrungsvorgaben beachten.']];
    start.forEach(([k, v], i) => {
      const row = wsS.getRow(4 + i);
      row.getCell(1).value = k; row.getCell(2).value = v || '–';
      row.getCell(1).font = fnt({ bold: true }); row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A2.label } };
      row.getCell(2).font = fnt();
      wsS.mergeCells(4 + i, 2, 4 + i, 3);
      [1, 2, 3].forEach(c => { row.getCell(c).alignment = { wrapText: true, vertical: 'top', indent: 1 }; row.getCell(c).border = { left: seite('thin'), right: seite('thin'), top: seite('thin'), bottom: seite('thin') }; });
      hoehe(row, [26, 90]);
    });
    // Logo in der eigenen Spalte C oben rechts (Werte stehen in B:C verbunden)
    wsS.getColumn(1).width = 26; wsS.getColumn(2).width = 58; wsS.getColumn(3).width = 34;
    wsS.getRow(3).height = 34;
    logoRein(wb, wsS, 2);
    druck(wsS, 0, 'Start');

    // Teams (mit Gesamteindruck)
    const wt = wb.addWorksheet(SHEET_TEAMS, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    const mitRasse = teams.some(t => t.rasse);
    const TC = [['Team', t => t.name], ['Hundeführer/in', t => t.teilnehmer || ''], ['Diensthund', t => t.hund || ''], ['Behörde', t => t.behoerde || ''],
      ...(mitRasse ? [['Rasse / Alter', t => t.rasse || '']] : []), ['Zuständige/r Trainer/in', () => m.trainer || ''], ['Bemerkung', t => t.bemerkung || ''], ['Gesamteindruck', t => (course.gesamt || {})[t.name] || '']];
    titelZeilen(wt, 'Teamstammdaten', (m.titel || '') + ' · ' + teams.length + ' Teams', TC.length);
    kopfZeile(wt.getRow(4), TC.map(c => c[0]));
    const tw = TC.map(([h, f]) => h === 'Gesamteindruck' || h === 'Bemerkung' ? 45 : fitWidth([h, ...teams.map(f)], 12, 30));
    tw.forEach((w, i) => { wt.getColumn(i + 1).width = w; });
    teams.forEach((t, i) => { const row = wt.getRow(5 + i); row.values = TC.map(c => c[1](t)); row.getCell(1).font = { bold: true }; datenZeile(row, TC.length, i % 2 === 1, false); hoehe(row, tw); });
    druck(wt, 4, 'Teams');

    // Tagesprotokolle: eine Zeile je Team und Tag, dicke blaue Linie vor jedem neuen Tag
    const wp = wb.addWorksheet(SHEET_TP, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }] });
    const mehrere = new Set(notes.map(n => n.von).filter(Boolean)).size > 1;
    const PC = [['Datum', 13], ['Team', 18], ['Trainer/in', 14], ...FELDER.slice(0, 3).map(([k, h]) => [h, k === 'inhalt' ? 34 : 18, k]), ...(spuer ? [['Belohnungen', 12]] : []), ...FELDER.slice(3).map(([k, h]) => [h, k === 'bemerkung' ? 24 : 32, k])];
    titelZeilen(wp, 'Tagesprotokolle', 'Eine Zeile je Team und Tag · dicke Linie bei jedem neuen Tag' + (spuer ? ' · Belohnungen kommen aus dem Zähler in der App' : '') + ' · Änderungen am PC werden übernommen', PC.length);
    kopfZeile(wp.getRow(4), PC.map(c => c[0]));
    PC.forEach(([, w], i) => { wp.getColumn(i + 1).width = w; });
    const stand = [];
    let r = 5, zeile = 0;
    days.forEach(d => {
      let erste = true;
      teams.forEach(t => {
        const ns = notes.filter(n => n.team === t.name && n.datum === d);
        const bel = spuer ? zg.reduce((a, e) => a + (e.team === t.name && e.datum === d ? Number(e.anzahl) || 0 : 0), 0) : 0;
        if (!ns.length && !bel) return;
        const row = wp.getRow(r++);
        row.getCell(1).value = isoToDate(d); row.getCell(1).numFmt = '[$-407]ddd dd.mm.yy';
        row.getCell(2).value = t.name; row.getCell(2).font = { bold: true };
        row.getCell(3).value = [...new Set(ns.map(n => (n.von || '').trim()).filter(Boolean))].join(', ') || m.trainer || '';
        PC.forEach(([, , k], i) => {
          if (!k) return;
          const segs = ns.filter(n => feldVon(n, k)).map(n => ({ team: t.name, datum: d, spalte: k, uhrzeit: n.uhrzeit || '', von: n.von || '', text: feldVon(n, k), suf: mehrere && n.von ? n.von.trim().split(/\s+/)[0] : '' }));
          segs.forEach(s => { s.bullet = segs.length > 1 && !/^\s*•/.test(s.text); stand.push(s); });
          row.getCell(i + 1).value = segs.map(render).join('\n');
        });
        if (spuer) row.getCell(PC.findIndex(c => c[0] === 'Belohnungen') + 1).value = bel || '';
        datenZeile(row, PC.length, zeile++ % 2 === 1, erste && r > 6, [PC.findIndex(c => c[0] === 'Belohnungen') + 1]);
        hoehe(row, PC.map(c => c[1]));
        erste = false;
      });
    });
    if (r === 5) { wp.getCell('A5').value = 'Noch keine Notizen.'; wp.getCell('A5').font = fnt({ italic: true }); }
    wp.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, r - 1), column: PC.length } };
    druck(wp, 4, 'Tagesprotokolle');

    buildWochen(wb, course, teams);
    buildSpuer(wb, course, teams, days);

    // Notizen (Rohdaten): jede Notiz eine Zeile, mit den aufgeteilten Feldern
    const wn = wb.addWorksheet(SHEET_NOT, { views: [{ state: 'frozen', ySplit: 1 }] });
    const COLS = [['Datum', n => isoToDe(n.datum)], ['Lehrgangstag', n => 'Tag ' + dayIndex(m.start, n.datum)], ['Uhrzeit', n => n.uhrzeit || ''], ['Team', n => n.team || ''],
      ['Notiz', n => n.text || ''], ...FELDER.map(([k, h]) => [h, n => n.felder ? n.felder[k] || '' : '']), ['Aufgeteilt', n => n.felder ? 'ja' : ''], ['Quelle', n => n.quelle || 'Sprachnotiz'], ['Eingesprochen von', n => n.von || '']];
    kopfZeile(wn.getRow(1), COLS.map(c => c[0]));
    notes.forEach((n, i) => { const row = wn.getRow(i + 2); row.values = COLS.map(col => col[1](n)); row.eachCell(c => { c.font = fnt(); c.alignment = { wrapText: true, vertical: 'top' }; }); });
    COLS.forEach(([h, f], i) => { wn.getColumn(i + 1).width = fitWidth([h, ...notes.map(f)], 8, h === 'Notiz' ? 80 : 40); });
    wn.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, notes.length + 1), column: COLS.length } };
    druck(wn, 1, 'Notizen (Rohdaten)');

    // Versteckte Einstellungen
    const wm = wb.addWorksheet(SHEET_META, { state: 'hidden' });
    [['format', 'baumprojekt-2'], ['titel', m.titel || ''], ['trainer', m.trainer || ''], ['ort', m.ort || ''], ['start', m.start], ['wochen', Number(m.wochen) || 4],
      ['kopfBehoerde', m.kopfBehoerde || ''], ['kopfOe1', m.kopfOe1 || ''], ['kopfOe2', m.kopfOe2 || ''],
      ...(m.art ? [['art', m.art], ['geruchVorlage', m.geruchVorlage || ''], ['schrittVorlage', m.schrittVorlage || '']] : [])]
      .forEach((kv, i) => { wm.getRow(i + 1).values = kv; });

    // Verstecktes Glossar des Lehrgangs: Fachbegriffe beider Trainer (je Zeile Begriff | oft erkannt als | von)
    const wg = wb.addWorksheet(SHEET_GLOSSAR, { state: 'hidden' });
    wg.getRow(1).values = ['Begriff', 'Oft erkannt als', 'Von'];
    (course.glossar || []).forEach((g, i) => { wg.getRow(i + 2).values = [g.begriff, g.falsch || '', g.von || '']; });

    // Verstecktes Abbild des Tagesprotokolls (je Abschnitt eine Zeile), damit Änderungen am PC erkannt werden
    const wsn = wb.addWorksheet(SHEET_STAND_TP, { state: 'hidden' });
    wsn.getRow(1).values = ['Team', 'Datum', 'Uhrzeit', 'Von', 'Punkt', 'Kürzel', 'Text', 'Spalte'];
    stand.forEach((x, i) => { wsn.getRow(i + 2).values = [x.team, x.datum, x.uhrzeit, x.von, x.bullet ? '1' : '0', x.suf, x.text, x.spalte]; });

    return wb;
  }

  // ---------- Spürhund: Zielgerüche ----------
  // Belohnungen je Team, Stoff und Tag (Summe der Einträge; Korrekturen sind negative Einträge)
  function zgSumme(zg, team, stoff, datum) {
    let n = 0;
    zg.forEach(e => { if (e.team === team && e.stoff === stoff && (!datum || e.datum === datum) && e.anzahl) n += Number(e.anzahl) || 0; });
    return n;
  }
  // Aktueller Schritt (Nummer ab 1, 0 = noch keiner) = letzter Schritt-Eintrag
  function zgSchritt(zg, team, stoff) {
    let s = 0, k = '';
    zg.forEach(e => { if (e.team === team && e.stoff === stoff && e.schritt !== '' && e.schritt != null) { const key = e.datum + (e.uhrzeit || ''); if (key >= k) { k = key; s = Number(e.schritt) || 0; } } });
    return s;
  }
  const head = (row, values, widths, ws) => values.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; c.border = BORDER;
    if (widths) ws.getColumn(i + 1).width = widths[i];
  });
  function buildSpuer(wb, course, teams, days) {
    const sp = course.spuer || { stoffe: [], schritte: [] }, zg = course.zg || [];
    if (course.meta.art !== 'spuerhund' && !zg.length) return;
    const m = course.meta;
    const stoffe = sp.stoffe.slice();
    zg.forEach(e => { if (e.stoff && !stoffe.includes(e.stoff)) stoffe.push(e.stoff); });
    // Übersicht: je Team und Stoff eine Zeile, Summe und Belohnungen je Tag (nur Tage mit Belohnungen)
    const ws = wb.addWorksheet(SHEET_ZG, { views: [{ state: 'frozen', xSplit: 3, ySplit: 4, showGridLines: false }] });
    const tage = days.filter(d => zg.some(e => e.datum === d && Number(e.anzahl)));
    const kopf = ['Team', 'Zielgeruch', 'Gesamt', ...tage.map(d => weekday(d) + ' ' + isoToDe(d).slice(0, 6))];
    titelZeilen(ws, 'Zielgerüche · Belohnungen je Team und Tag', (m.titel || '') + ' · aus dem Zähler in der App', kopf.length);
    kopfZeile(ws.getRow(4), kopf);
    const zw = [22, 18, 9, ...tage.map(() => 9)];
    zw.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    let r = 5, zz = 0;
    teams.forEach(t => {
      let erste = true;
      stoffe.forEach(st => {
        const row = ws.getRow(r++);
        row.getCell(1).value = erste ? t.name : ''; row.getCell(1).font = { bold: true };
        row.getCell(2).value = st;
        row.getCell(3).value = zgSumme(zg, t.name, st) || ''; row.getCell(3).font = { bold: true };
        tage.forEach((d, i) => { const n = zgSumme(zg, t.name, st, d); if (n) row.getCell(i + 4).value = n; });
        datenZeile(row, kopf.length, zz++ % 2 === 1, erste && r > 6, kopf.map((_, i) => i + 1).filter(i => i > 2));
        erste = false;
      });
    });
    druck(ws, 4, 'Zielgerüche');
    // Rohdaten: jede Belohnung, Korrektur und jeder Schrittwechsel eine Zeile (Datenquelle)
    const wr = wb.addWorksheet(SHEET_ZG_ROH, { views: [{ state: 'frozen', ySplit: 1 }] });
    head(wr.getRow(1), ['Datum', 'Uhrzeit', 'Team', 'Stoff', 'Belohnungen', 'Schritt', 'Eingetragen von', 'ID'], [12, 9, 18, 18, 12, 9, 20, 12], wr);
    const sorted = zg.slice().sort((a, b) => (a.datum + (a.uhrzeit || '')).localeCompare(b.datum + (b.uhrzeit || '')));
    sorted.forEach((e, i) => { wr.getRow(i + 2).values = [isoToDe(e.datum), e.uhrzeit || '', e.team, e.stoff, e.anzahl === '' || e.anzahl == null ? '' : Number(e.anzahl), e.schritt === '' || e.schritt == null ? '' : Number(e.schritt), e.von || '', e.id || '']; });
    // Versteckt: Stoffe und Schritte des Lehrgangs (aus der Vorlage übernommen, danach unabhängig von ihr)
    const wsp = wb.addWorksheet(SHEET_SPUER, { state: 'hidden' });
    wsp.getRow(1).values = ['Typ', 'Name', 'Beschreibung'];
    let k = 2;
    sp.stoffe.forEach(st => { wsp.getRow(k++).values = ['stoff', st, '']; });
    sp.schritte.forEach(s => { wsp.getRow(k++).values = ['schritt', s.name, s.beschr || '']; });
  }
  function parseSpuer(wb, course) {
    course.spuer = { stoffe: [], schritte: [] }; course.zg = [];
    const t = (r, k) => k ? String(cellText(r.getCell(k).value) == null ? '' : cellText(r.getCell(k).value)).trim() : '';
    const wsp = wb.getWorksheet(SHEET_SPUER);
    if (wsp) wsp.eachRow((r, i) => {
      if (i === 1) return;
      const typ = t(r, 1), name = t(r, 2);
      if (!name) return;
      if (typ === 'stoff') course.spuer.stoffe.push(name);
      if (typ === 'schritt') course.spuer.schritte.push({ name, beschr: t(r, 3) });
    });
    const wr = wb.getWorksheet(SHEET_ZG_ROH);
    if (!wr) return;
    const col = {};
    wr.getRow(1).eachCell((c, k) => { col[String(cellText(c.value) || '').trim()] = k; });
    const num = v => { const s = String(v).replace(',', '.').trim(); return s === '' || isNaN(Number(s)) ? '' : Number(s); };
    wr.eachRow((r, i) => {
      if (i === 1) return;
      const e = { datum: parseDateCell(r.getCell(col['Datum'] || 1).value), uhrzeit: parseTimeCell(r.getCell(col['Uhrzeit'] || 2).value), team: t(r, col['Team']), stoff: t(r, col['Stoff']),
        anzahl: num(t(r, col['Belohnungen'])), schritt: num(t(r, col['Schritt'])), von: t(r, col['Eingetragen von']), id: t(r, col['ID']) };
      if (e.datum && e.team && e.stoff && (e.anzahl !== '' || e.schritt !== '')) course.zg.push(e);
    });
  }

  // ---------- Änderungen aus der Übersicht übernehmen ----------
  // Je Zelle: Abschnitte, die unverändert drinstehen, bleiben. Text zwischen zwei unveränderten Abschnitten gehört zu den
  // fehlenden Abschnitten dazwischen (= geänderte Notiz). Fehlt er ganz, wurde die Notiz gelöscht. Neuer Text ohne
  // passenden Abschnitt wird eine neue Notiz. Gibt die Zahl der geänderten Notizen zurück.
  function applyOverviewEdits(wb, course) {
    const wsn = wb.getWorksheet(SHEET_STAND), wu = wb.getWorksheet(SHEET_UEB);
    if (!wsn || !wu) return 0; // alte Datei: noch kein Abbild, dann gilt wie bisher nur das Blatt Rohdaten
    const t = (r, k) => String(cellText(r.getCell(k).value) || '');
    const stand = new Map();
    wsn.eachRow((r, i) => {
      if (i === 1) return;
      const x = { team: t(r, 1).trim(), datum: t(r, 2).trim(), uhrzeit: t(r, 3).trim(), von: t(r, 4).trim(), bullet: t(r, 5).trim() === '1', suf: t(r, 6).trim(), text: t(r, 7).trim() };
      const key = x.team + '|' + x.datum;
      if (!stand.has(key)) stand.set(key, []);
      stand.get(key).push(x);
    });
    const known = new Set([...course.teams.map(tm => tm.name), ...[...stand.values()].map(a => a[0].team)]);
    const dateCols = [];
    wu.getRow(3).eachCell((c, col) => { const m = String(cellText(c.value) || '').match(/(\d{1,2}\.\d{1,2}\.\d{4})/); if (col > 1 && m) dateCols.push([col, parseDateCell(m[1])]); });
    let count = 0;
    const find = s => course.notes.findIndex(n => n.datum === s.datum && n.team === s.team && (n.uhrzeit || '') === s.uhrzeit && (n.von || '') === s.von && n.text === s.text);
    const clean = (s, piece) => {
      let x = piece;
      if (!s || s.bullet) x = x.replace(/^•\s*/, '');
      if (s && s.suf && x.endsWith('(' + s.suf + ')')) x = x.slice(0, -(s.suf.length + 2));
      return x.trim();
    };
    wu.eachRow((r, ri) => {
      if (ri < 4) return;
      const team = t(r, 1).trim();
      if (!team || !known.has(team)) return; // umbenannte/fremde Zeilen nicht anfassen
      dateCols.forEach(([col, datum]) => {
        const segs = stand.get(team + '|' + datum) || [];
        const cur = norm(cellText(r.getCell(col).value));
        if (cur === norm(segs.map(render).join('\n'))) return;
        // unveränderte Abschnitte in Reihenfolge suchen (nur an Zeilengrenzen)
        let pos = 0;
        const hit = segs.map(s => {
          const want = norm(render(s));
          for (let k = cur.indexOf(want, pos); k >= 0; k = cur.indexOf(want, k + 1)) {
            const e = k + want.length;
            if ((k === 0 || cur[k - 1] === '\n') && (e === cur.length || cur[e] === '\n')) { pos = e; return [k, e]; }
          }
          return null;
        });
        const gap = (pending, raw, near) => {
          const g = norm(raw);
          if (!pending.length) {
            if (g) { course.notes.push({ datum, uhrzeit: near ? near.uhrzeit : '', team, text: clean(null, g), quelle: 'Am PC ergänzt', von: '' }); count++; }
            return;
          }
          let pieces = [];
          if (g) {
            pieces = [g];
            if (pending.length > 1) {
              const p = g.split('\n').reduce((a, l) => { if (/^\s*•/.test(l) || !a.length) a.push(l); else a[a.length - 1] += '\n' + l; return a; }, []);
              if (p.length === pending.length) pieces = p;
            }
          }
          pending.forEach((s, k) => {
            const idx = find(s);
            if (k < pieces.length) {
              const neu = clean(s, pieces[k]);
              if (neu === s.text) return;
              if (idx >= 0) { const n = course.notes[idx]; n.text = neu; if (!(n.quelle || '').endsWith(AM_PC)) n.quelle = (n.quelle || 'Sprachnotiz').replace(/ \(bearbeitet\)$/, '') + AM_PC; }
              else course.notes.push({ datum, uhrzeit: s.uhrzeit, team, text: neu, quelle: 'Am PC ergänzt', von: '' });
              count++;
            } else if (idx >= 0) { course.notes.splice(idx, 1); count++; }
          });
        };
        let prev = 0, pending = [], near = null;
        segs.forEach((s, i) => {
          if (hit[i]) { gap(pending, cur.slice(prev, hit[i][0]), near || s); pending = []; prev = hit[i][1]; near = s; }
          else pending.push(s);
        });
        gap(pending, cur.slice(prev), near);
      });
    });
    return count;
  }

  // ---------- Änderungen aus dem Tagesprotokoll übernehmen ----------
  // Wie bei der alten Übersicht, nur je Zelle (Team, Tag, Spalte): unveränderte Abschnitte bleiben, geänderter Text
  // geht in das Feld der passenden Notiz, gelöschter Text leert das Feld, neuer Text wird eine neue Notiz.
  function applyTpEdits(wb, course) {
    const wsn = wb.getWorksheet(SHEET_STAND_TP), wp = wb.getWorksheet(SHEET_TP);
    if (!wsn || !wp) return 0;
    const t = (r, k) => k ? String(cellText(r.getCell(k).value) || '') : '';
    const stand = new Map();
    wsn.eachRow((r, i) => {
      if (i === 1) return;
      const x = { team: t(r, 1).trim(), datum: t(r, 2).trim(), uhrzeit: t(r, 3).trim(), von: t(r, 4).trim(), bullet: t(r, 5).trim() === '1', suf: t(r, 6).trim(), text: t(r, 7).trim(), spalte: t(r, 8).trim() };
      const key = x.team + '|' + x.datum + '|' + x.spalte;
      if (!stand.has(key)) stand.set(key, []);
      stand.get(key).push(x);
    });
    let kopf = 0;
    for (let i = 1; i <= 8; i++) if (String(cellText(wp.getRow(i).getCell(1).value) || '').trim() === 'Datum') { kopf = i; break; }
    if (!kopf) return 0;
    const spalten = [];
    wp.getRow(kopf).eachCell((c, col) => { const h = String(cellText(c.value) || '').trim(); const f = FELDER.find(x => x[1] === h); if (f) spalten.push([col, f[0]]); });
    const known = new Set([...course.teams.map(tm => tm.name), ...[...stand.values()].map(a => a[0].team)]);
    let count = 0;
    const find = (s, k) => course.notes.findIndex(n => n.datum === s.datum && n.team === s.team && (n.uhrzeit || '') === s.uhrzeit && (n.von || '') === s.von && feldVon(n, k) === s.text);
    const clean = (s, piece) => {
      let x = piece;
      if (!s || s.bullet) x = x.replace(/^•\s*/, '');
      if (s && s.suf && x.endsWith('(' + s.suf + ')')) x = x.slice(0, -(s.suf.length + 2));
      return x.trim();
    };
    const markiere = n => { if (!(n.quelle || '').endsWith(AM_PC)) n.quelle = (n.quelle || 'Sprachnotiz').replace(/ \(bearbeitet\)$/, '') + AM_PC; };
    const setze = (n, k, v) => {
      if (!n.felder) { if (k === 'beobachtung') { n.text = v; return; } n.felder = { beobachtung: n.text || '' }; }
      n.felder[k] = v;
    };
    const leer = n => n.felder ? FELDER.every(([k]) => !String(n.felder[k] || '').trim()) : !String(n.text || '').trim();
    wp.eachRow((r, ri) => {
      if (ri <= kopf) return;
      const team = t(r, 2).trim(), datum = parseDateCell(r.getCell(1).value);
      if (!team || !datum || !known.has(team)) return; // umbenannte/fremde Zeilen nicht anfassen
      spalten.forEach(([col, k]) => {
        const segs = stand.get(team + '|' + datum + '|' + k) || [];
        const cur = norm(cellText(r.getCell(col).value));
        if (cur === norm(segs.map(render).join('\n'))) return;
        let pos = 0;
        const hit = segs.map(s => {
          const want = norm(render(s));
          for (let q = cur.indexOf(want, pos); q >= 0; q = cur.indexOf(want, q + 1)) {
            const e = q + want.length;
            if ((q === 0 || cur[q - 1] === '\n') && (e === cur.length || cur[e] === '\n')) { pos = e; return [q, e]; }
          }
          return null;
        });
        const gap = (pending, raw, near) => {
          const g = norm(raw);
          if (!pending.length) {
            if (g) { const f = {}; FELDER.forEach(([x]) => { f[x] = ''; }); f[k] = clean(null, g); course.notes.push({ datum, uhrzeit: near ? near.uhrzeit : '', team, text: f[k], felder: f, quelle: 'Am PC ergänzt', von: '' }); count++; }
            return;
          }
          let pieces = [];
          if (g) {
            pieces = [g];
            if (pending.length > 1) {
              const p = g.split('\n').reduce((a, l) => { if (/^\s*•/.test(l) || !a.length) a.push(l); else a[a.length - 1] += '\n' + l; return a; }, []);
              if (p.length === pending.length) pieces = p;
            }
          }
          pending.forEach((s, j) => {
            const idx = find(s, k);
            const neu = j < pieces.length ? clean(s, pieces[j]) : '';
            if (neu === s.text) return;
            if (idx >= 0) {
              const n = course.notes[idx];
              setze(n, k, neu); markiere(n);
              if (leer(n)) course.notes.splice(idx, 1);
            } else if (neu) { const f = {}; FELDER.forEach(([x]) => { f[x] = ''; }); f[k] = neu; course.notes.push({ datum, uhrzeit: s.uhrzeit, team, text: neu, felder: f, quelle: 'Am PC ergänzt', von: '' }); }
            count++;
          });
        };
        let prev = 0, pending = [], near = null;
        segs.forEach((s, i) => {
          if (hit[i]) { gap(pending, cur.slice(prev, hit[i][0]), near || s); pending = []; prev = hit[i][1]; near = s; }
          else pending.push(s);
        });
        gap(pending, cur.slice(prev), near);
      });
    });
    return count;
  }

  async function toBuffer(course) { return build(course).xlsx.writeBuffer(); }

  // ---------- Lesen ----------
  async function parse(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const course = { meta: {}, teams: [], notes: [], gesamt: {}, glossar: [] };

    const wm = wb.getWorksheet(SHEET_META);
    if (wm) wm.eachRow(r => { const k = String(cellText(r.getCell(1).value) || ''); if (k) course.meta[k] = cellText(r.getCell(2).value); });
    if (course.meta.start) course.meta.start = parseDateCell(course.meta.start);
    course.meta.wochen = Number(course.meta.wochen) || 4;

    const wt = wb.getWorksheet(SHEET_TEAMS);
    // Überschriftenzeile: neue Dateien Zeile 4 (darüber Titel), alte Dateien Zeile 1
    let tKopf = 1;
    if (wt) for (let i = 1; i <= 6; i++) if (String(cellText(wt.getRow(i).getCell(1).value) || '').trim() === 'Team') { tKopf = i; break; }
    const tcol = {};
    if (wt) wt.getRow(tKopf).eachCell((c, k) => { tcol[String(cellText(c.value) || '').trim()] = k; });
    const tat = (names, alt) => { for (const n of names) if (tcol[n]) return tcol[n]; return Object.keys(tcol).length ? 0 : alt; };
    const ttxt = (r, k) => k ? String(cellText(r.getCell(k).value) || '').trim() : '';
    if (wt) wt.eachRow((r, i) => {
      if (i <= tKopf) return;
      const t = { name: ttxt(r, tat(['Team'], 1)), teilnehmer: ttxt(r, tat(['Hundeführer/in', 'Teilnehmer/in'], 2)), hund: ttxt(r, tat(['Diensthund', 'Hund'], 3)), behoerde: ttxt(r, tat(['Behörde'], 0)), rasse: ttxt(r, tat(['Rasse / Alter'], 4)), bemerkung: ttxt(r, tat(['Bemerkung'], 5)) };
      t.name = teamName(t);
      if (t.name) course.teams.push(t);
      const g = ttxt(r, tat(['Gesamteindruck'], 0));
      if (t.name && g) course.gesamt[t.name] = g;
    });

    const wg = wb.getWorksheet(SHEET_GLOSSAR);
    if (wg) wg.eachRow((r, i) => {
      if (i === 1) return;
      const g = { begriff: String(cellText(r.getCell(1).value) || '').trim(), falsch: String(cellText(r.getCell(2).value) || '').trim(), von: String(cellText(r.getCell(3).value) || '').trim() };
      if (g.begriff) course.glossar.push(g);
    });

    const wn = wb.getWorksheet(SHEET_NOT);
    // Spalten über die Überschriften finden (alte Dateien haben noch „Kategorie“, neue nicht)
    const col = {};
    if (wn) wn.getRow(1).eachCell((c, k) => { col[String(cellText(c.value) || '').trim()] = k; });
    const at = (name, alt) => col[name] || (Object.keys(col).length ? 0 : alt);
    const txt = (r, k) => k ? String(cellText(r.getCell(k).value) || '').trim() : '';
    if (wn) wn.eachRow((r, i) => {
      if (i === 1) return;
      const n = { datum: parseDateCell(r.getCell(at('Datum', 1)).value), uhrzeit: parseTimeCell(r.getCell(at('Uhrzeit', 3) || 3).value), team: txt(r, at('Team', 4)), kategorie: txt(r, at('Kategorie', 5)), text: txt(r, at('Notiz', 6)), quelle: txt(r, at('Quelle', 7)), von: txt(r, at('Eingesprochen von', 8)) };
      // Aufgeteilte Felder fürs Tagesprotokoll (Motivation, Anzeigeverhalten …)
      if (txt(r, at('Aufgeteilt', 0)) === 'ja') { n.felder = {}; FELDER.forEach(([k, hd]) => { n.felder[k] = txt(r, at(hd, 0)); }); }
      if (n.datum && (n.text || n.felder)) course.notes.push(n);
    });

    const wu = wb.getWorksheet(SHEET_UEB);
    if (wu) {
      if (!course.meta.titel) { const a1 = String(cellText(wu.getCell('A1').value) || ''); const mt = a1.match(/Lehrgang:\s*(.*?)\s*(·|$)/); if (mt) course.meta.titel = mt[1]; }
      let gCol = 0;
      wu.getRow(3).eachCell((c, col) => { if (String(cellText(c.value)).trim() === 'Gesamteindruck') gCol = col; });
      if (gCol) wu.eachRow((r, i) => {
        if (i < 4) return;
        const name = String(cellText(r.getCell(1).value) || '').trim();
        const g = String(cellText(r.getCell(gCol).value) || '').trim();
        if (name && g) course.gesamt[name] = g;
      });
    }
    parseWochen(wb, course, course.teams);
    parseSpuer(wb, course);
    course.amPcGeaendert = wb.getWorksheet(SHEET_STAND_TP) ? applyTpEdits(wb, course) : applyOverviewEdits(wb, course);
    if (!course.meta.start) course.meta.start = course.notes.length ? sortNotes(course.notes)[0].datum : dateToIso(new Date());
    return course;
  }

  const api = { FELDER, WB_ABSCHNITTE, WB_TEAM, isoKW, einheiten, setLogo: b => { LOGO = b || null; }, zgSumme, zgSchritt, build, toBuffer, parse, teamName, courseDays, sortNotes, isoToDe, dateToIso, addDays, dayIndex, weekday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.BaumprojektWorkbook = api;
})(typeof window !== 'undefined' ? window : globalThis);
