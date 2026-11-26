// Baumprojekt – Excel-Datei je Lehrgang (Format der ersten Vorlage: Übersicht, Notizen (Rohdaten), Teams)
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
  const SHEET_STAND = '_uebersicht';
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

  // ---------- Schreiben ----------
  function build(course) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Baumprojekt';
    const m = course.meta;
    const teams = course.teams.map(t => ({ ...t, name: teamName(t) }));
    const days = courseDays(course);
    const notes = sortNotes(course.notes);

    // Übersicht
    const ws = wb.addWorksheet(SHEET_UEB, { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
    ws.getCell('A1').value = 'Lehrgang: ' + (m.titel || '') + '  ·  Trainer: ' + (m.trainer || '___________') + (m.ort ? '  ·  Ort: ' + m.ort : '');
    ws.getCell('A1').font = { bold: true, size: 13 };
    const head = ws.getRow(3);
    head.height = 32;
    const headers = ['Team (Teilnehmer & Hund)', ...days.map(d => 'Tag ' + dayIndex(m.start, d) + '\n' + weekday(d) + ' ' + isoToDe(d)), 'Gesamteindruck'];
    headers.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      c.border = BORDER;
    });
    ws.getColumn(1).width = 22;
    days.forEach((_, i) => { ws.getColumn(i + 2).width = 40; });
    ws.getColumn(days.length + 2).width = 26;

    // Sprechen mehrere Trainer in den Lehrgang, steht in der Übersicht hinter jeder Notiz, von wem sie ist
    const mehrere = new Set(notes.map(n => n.von).filter(Boolean)).size > 1;
    const stand = [];
    const allTeamNames = teams.map(t => t.name);
    notes.forEach(n => { if (n.team && !allTeamNames.includes(n.team)) allTeamNames.push(n.team); });
    allTeamNames.forEach((name, r) => {
      const row = ws.getRow(4 + r);
      let maxLines = 1;
      row.getCell(1).value = name;
      row.getCell(1).font = { bold: true };
      days.forEach((d, i) => {
        const segs = segments(notes, name, d, mehrere);
        stand.push(...segs);
        const txt = segs.map(render).join('\n');
        if (txt) row.getCell(i + 2).value = txt;
        maxLines = Math.max(maxLines, Math.ceil(txt.length / 42) + (txt.match(/\n/g) || []).length);
      });
      const g = (course.gesamt || {})[name];
      if (g) row.getCell(days.length + 2).value = g;
      for (let c = 1; c <= days.length + 2; c++) {
        const cell = row.getCell(c);
        cell.alignment = { wrapText: true, vertical: 'top' };
        cell.border = BORDER;
      }
      row.height = Math.max(45, Math.min(400, maxLines * 15 + 6));
    });

    // Notizen (Rohdaten)
    const wn = wb.addWorksheet(SHEET_NOT, { views: [{ state: 'frozen', ySplit: 1 }] });
    // Kategorien gibt es nicht mehr: Die Spalte wird nicht mehr geschrieben (alte Werte stehen noch in den Sicherungen).
    const mitKat = false;
    const COLS = [['Datum', 12, n => isoToDe(n.datum)], ['Lehrgangstag', 13, n => 'Tag ' + dayIndex(m.start, n.datum)], ['Uhrzeit', 9, n => n.uhrzeit || ''], ['Team', 18, n => n.team || ''],
      ...(mitKat ? [['Kategorie', 17, n => n.kategorie || '']] : []), ['Notiz', 70, n => n.text || ''], ['Quelle', 13, n => n.quelle || 'Sprachnotiz'], ['Eingesprochen von', 20, n => n.von || '']];
    COLS.forEach(([h, w], i) => {
      const c = wn.getRow(1).getCell(i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      wn.getColumn(i + 1).width = w;
    });
    notes.forEach((n, i) => {
      const row = wn.getRow(i + 2);
      row.values = COLS.map(col => col[2](n));
      row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; });
    });
    wn.autoFilter = { from: 'A1', to: String.fromCharCode(64 + COLS.length) + Math.max(1, notes.length + 1) };

    // Teams
    const wt = wb.addWorksheet(SHEET_TEAMS);
    // „Rasse / Alter“ wird nicht mehr abgefragt; Spalte bleibt nur, solange alte Teams einen Eintrag haben
    const mitRasse = teams.some(t => t.rasse);
    const TC = [['Team', 18, t => t.name], ['Teilnehmer/in', 18, t => t.teilnehmer || ''], ['Hund', 12, t => t.hund || ''], ['Behörde', 22, t => t.behoerde || ''],
      ...(mitRasse ? [['Rasse / Alter', 22, t => t.rasse || '']] : []), ['Bemerkung', 30, t => t.bemerkung || '']];
    TC.forEach(([h, w], i) => {
      const c = wt.getRow(1).getCell(i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      wt.getColumn(i + 1).width = w;
    });
    teams.forEach((t, i) => { wt.getRow(i + 2).values = TC.map(col => col[2](t)); });

    // Versteckte Einstellungen
    const wm = wb.addWorksheet(SHEET_META, { state: 'hidden' });
    [['format', 'baumprojekt-1'], ['titel', m.titel || ''], ['trainer', m.trainer || ''], ['ort', m.ort || ''], ['start', m.start], ['wochen', Number(m.wochen) || 4],
      ...(m.art ? [['art', m.art], ['geruchVorlage', m.geruchVorlage || ''], ['schrittVorlage', m.schrittVorlage || '']] : [])]
      .forEach((kv, i) => { wm.getRow(i + 1).values = kv; });
    buildSpuer(wb, course, teams, days);

    // Verstecktes Glossar des Lehrgangs: Fachbegriffe beider Trainer (je Zeile Begriff | oft erkannt als | von)
    const wg = wb.addWorksheet(SHEET_GLOSSAR, { state: 'hidden' });
    wg.getRow(1).values = ['Begriff', 'Oft erkannt als', 'Von'];
    (course.glossar || []).forEach((g, i) => { wg.getRow(i + 2).values = [g.begriff, g.falsch || '', g.von || '']; });

    // Verstecktes Abbild der Übersicht (je Abschnitt eine Zeile), damit Änderungen am PC erkannt werden
    const wsn = wb.addWorksheet(SHEET_STAND, { state: 'hidden' });
    wsn.getRow(1).values = ['Team', 'Datum', 'Uhrzeit', 'Von', 'Punkt', 'Kürzel', 'Text'];
    stand.forEach((x, i) => { wsn.getRow(i + 2).values = [x.team, x.datum, x.uhrzeit, x.von, x.bullet ? '1' : '0', x.suf, x.text]; });

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
    // Übersicht: je Team und Stoff eine Zeile, Schritt, Summe und Belohnungen je Tag
    const ws = wb.addWorksheet(SHEET_ZG, { views: [{ state: 'frozen', xSplit: 4, ySplit: 3 }] });
    ws.getCell('A1').value = 'Zielgerüche: ' + (m.titel || '') + (m.schrittVorlage ? '  ·  Schritte: ' + m.schrittVorlage : '');
    ws.getCell('A1').font = { bold: true, size: 13 };
    head(ws.getRow(3), ['Team', 'Stoff', 'Schritt', 'Belohnungen gesamt', ...days.map(d => 'Tag ' + dayIndex(m.start, d) + '\n' + isoToDe(d).slice(0, 6))],
      [22, 18, 22, 12, ...days.map(() => 8)], ws);
    ws.getRow(3).height = 32;
    let r = 4;
    teams.forEach(t => stoffe.forEach(st => {
      const row = ws.getRow(r++), nr = zgSchritt(zg, t.name, st), schr = sp.schritte[nr - 1];
      row.getCell(1).value = t.name; row.getCell(1).font = { bold: true };
      row.getCell(2).value = st;
      row.getCell(3).value = nr ? nr + (schr && schr.name && schr.name !== 'Schritt ' + nr ? ' · ' + schr.name : '') : '';
      row.getCell(4).value = zgSumme(zg, t.name, st);
      row.getCell(4).font = { bold: true };
      days.forEach((d, i) => { const n = zgSumme(zg, t.name, st, d); if (n) row.getCell(i + 5).value = n; });
      for (let c = 1; c <= days.length + 4; c++) { const cell = row.getCell(c); cell.border = BORDER; if (c > 2) cell.alignment = { horizontal: 'center' }; }
    }));
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
    const tcol = {};
    if (wt) wt.getRow(1).eachCell((c, k) => { tcol[String(cellText(c.value) || '').trim()] = k; });
    const tat = (name, alt) => tcol[name] || (Object.keys(tcol).length ? 0 : alt);
    const ttxt = (r, k) => k ? String(cellText(r.getCell(k).value) || '').trim() : '';
    if (wt) wt.eachRow((r, i) => {
      if (i === 1) return;
      const t = { name: ttxt(r, tat('Team', 1)), teilnehmer: ttxt(r, tat('Teilnehmer/in', 2)), hund: ttxt(r, tat('Hund', 3)), behoerde: ttxt(r, tat('Behörde', 0)), rasse: ttxt(r, tat('Rasse / Alter', 4)), bemerkung: ttxt(r, tat('Bemerkung', 5)) };
      t.name = teamName(t);
      if (t.name) course.teams.push(t);
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
      if (n.datum && n.text) course.notes.push(n);
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
    parseSpuer(wb, course);
    course.amPcGeaendert = applyOverviewEdits(wb, course);
    if (!course.meta.start) course.meta.start = course.notes.length ? sortNotes(course.notes)[0].datum : dateToIso(new Date());
    return course;
  }

  const api = { zgSumme, zgSchritt, build, toBuffer, parse, teamName, courseDays, sortNotes, isoToDe, dateToIso, addDays, dayIndex, weekday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.BaumprojektWorkbook = api;
})(typeof window !== 'undefined' ? window : globalThis);
