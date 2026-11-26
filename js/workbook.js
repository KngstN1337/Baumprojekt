// Baumprojekt – Excel-Datei je Lehrgang (Format der ersten Vorlage: Übersicht, Notizen (Rohdaten), Teams)
// Datenquelle ist das Blatt "Notizen (Rohdaten)". Die Übersicht wird daraus bei jedem Speichern neu
// aufgebaut; die Spalte "Gesamteindruck" bleibt dabei erhalten.
(function (global) {
  'use strict';
  const ExcelJS = global.ExcelJS || (typeof require !== 'undefined' ? require('exceljs') : null);

  const SHEET_UEB = 'Übersicht';
  const SHEET_NOT = 'Notizen (Rohdaten)';
  const SHEET_TEAMS = 'Teams';
  const SHEET_META = '_baumprojekt';
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
    ws.getCell('A1').value = 'Lehrgang: ' + (m.titel || '') + '  ·  Trainer: ' + (m.trainer || '___________') + '  ·  Ort: ' + (m.ort || '___________');
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
    const vonKurz = n => (mehrere && n.von ? ' (' + n.von.trim().split(/\s+/)[0] + ')' : '');
    const allTeamNames = teams.map(t => t.name);
    notes.forEach(n => { if (n.team && !allTeamNames.includes(n.team)) allTeamNames.push(n.team); });
    allTeamNames.forEach((name, r) => {
      const row = ws.getRow(4 + r);
      let maxLines = 1;
      row.getCell(1).value = name;
      row.getCell(1).font = { bold: true };
      days.forEach((d, i) => {
        const txt = notes.filter(n => n.team === name && n.datum === d).map(n => (/^\s*•/.test(n.text) ? '' : '• ') + n.text + vonKurz(n)).join('\n');
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
    const nh = ['Datum', 'Lehrgangstag', 'Uhrzeit', 'Team', 'Kategorie', 'Notiz', 'Quelle', 'Eingesprochen von'];
    const nw = [12, 13, 9, 18, 17, 70, 13, 20];
    nh.forEach((h, i) => {
      const c = wn.getRow(1).getCell(i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      wn.getColumn(i + 1).width = nw[i];
    });
    notes.forEach((n, i) => {
      const row = wn.getRow(i + 2);
      row.values = [isoToDe(n.datum), 'Tag ' + dayIndex(m.start, n.datum), n.uhrzeit || '', n.team || '', n.kategorie || '', n.text || '', n.quelle || 'Sprachnotiz', n.von || ''];
      row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; });
    });
    wn.autoFilter = { from: 'A1', to: 'H' + Math.max(1, notes.length + 1) };

    // Teams
    const wt = wb.addWorksheet(SHEET_TEAMS);
    const th = ['Team', 'Teilnehmer/in', 'Hund', 'Rasse / Alter', 'Bemerkung'];
    const tw = [18, 18, 10, 22, 30];
    th.forEach((h, i) => {
      const c = wt.getRow(1).getCell(i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      wt.getColumn(i + 1).width = tw[i];
    });
    teams.forEach((t, i) => { wt.getRow(i + 2).values = [t.name, t.teilnehmer || '', t.hund || '', t.rasse || '', t.bemerkung || '']; });

    // Versteckte Einstellungen
    const wm = wb.addWorksheet(SHEET_META, { state: 'hidden' });
    [['format', 'baumprojekt-1'], ['titel', m.titel || ''], ['trainer', m.trainer || ''], ['ort', m.ort || ''], ['start', m.start], ['wochen', Number(m.wochen) || 4]]
      .forEach((kv, i) => { wm.getRow(i + 1).values = kv; });

    return wb;
  }

  async function toBuffer(course) { return build(course).xlsx.writeBuffer(); }

  // ---------- Lesen ----------
  async function parse(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const course = { meta: {}, teams: [], notes: [], gesamt: {} };

    const wm = wb.getWorksheet(SHEET_META);
    if (wm) wm.eachRow(r => { const k = String(cellText(r.getCell(1).value) || ''); if (k) course.meta[k] = cellText(r.getCell(2).value); });
    if (course.meta.start) course.meta.start = parseDateCell(course.meta.start);
    course.meta.wochen = Number(course.meta.wochen) || 4;

    const wt = wb.getWorksheet(SHEET_TEAMS);
    if (wt) wt.eachRow((r, i) => {
      if (i === 1) return;
      const t = { name: String(cellText(r.getCell(1).value) || '').trim(), teilnehmer: String(cellText(r.getCell(2).value) || '').trim(), hund: String(cellText(r.getCell(3).value) || '').trim(), rasse: String(cellText(r.getCell(4).value) || '').trim(), bemerkung: String(cellText(r.getCell(5).value) || '').trim() };
      t.name = teamName(t);
      if (t.name) course.teams.push(t);
    });

    const wn = wb.getWorksheet(SHEET_NOT);
    if (wn) wn.eachRow((r, i) => {
      if (i === 1) return;
      const n = { datum: parseDateCell(r.getCell(1).value), uhrzeit: parseTimeCell(r.getCell(3).value), team: String(cellText(r.getCell(4).value) || '').trim(), kategorie: String(cellText(r.getCell(5).value) || '').trim(), text: String(cellText(r.getCell(6).value) || '').trim(), quelle: String(cellText(r.getCell(7).value) || '').trim(), von: String(cellText(r.getCell(8).value) || '').trim() };
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
    if (!course.meta.start) course.meta.start = course.notes.length ? sortNotes(course.notes)[0].datum : dateToIso(new Date());
    return course;
  }

  const api = { build, toBuffer, parse, teamName, courseDays, sortNotes, isoToDe, dateToIso, addDays, dayIndex, weekday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.BaumprojektWorkbook = api;
})(typeof window !== 'undefined' ? window : globalThis);
