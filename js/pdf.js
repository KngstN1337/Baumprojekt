// LTR – „PDF erstellen“: Auswahl, was ins PDF kommt (ganzer Lehrgang oder Teilnehmerakte eines Teams),
// Aufbau der Seiten in der Gestaltung „Amtlich Blau“ (A4 quer, Kopfzeile auf jeder Seite, so viele Seiten wie nötig),
// danach Teilen-Menü (Handy) bzw. Herunterladen (PC) und eine Kopie im Lehrgangsordner in Google Drive (Unterordner „PDF“).
// pdfmake wird erst beim ersten Erstellen nachgeladen, damit die App schnell startet.
(function (global) {
  'use strict';
  global.BaumprojektPdf = function (ctx) {
    const WBK = global.BaumprojektWorkbook, S = global.BaumprojektServices;
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const BLAU = '#0061A7', GRAU = '#F2F2F2', LINIE = '#9FB6CC', HELL = '#E3EEF8';
    // Gleiche Farben je Geruch wie in der App (Reihenfolge im Lehrgang)
    const ZG_FARBEN = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'];
    const ZG_REST = '#8e8e93';

    // Auswahl (bleibt für die Sitzung erhalten)
    const BLAETTER = [
      ['deckblatt', 'Deckblatt', 'Lehrgang, Zeitraum, Trainer, Inhalt'],
      ['teams', 'Teams', 'Stammdaten aller Teams'],
      ['tage', 'Tagesprotokolle', 'alle Notizen, ein Abschnitt je Woche'],
      ['wochen', 'Wochenberichte', 'eine Seite je Woche'],
      ['zgtab', 'Zielgerüche-Tabelle', 'Belohnungen je Team und Tag', true],
      ['zgdia', 'Zielgerüche-Diagramme', 'Kreisdiagramm je Team', true]
    ];
    const AKTE = [
      ['stamm', 'Stammdaten', 'Hund, Behörde, Gesamteindruck'],
      ['zgdia', 'Zielgerüche-Diagramm', 'mit Tabelle je Geruch', true],
      ['entw', 'Entwicklung je Woche', 'aus den Wochenberichten'],
      ['zgtab', 'Zielgerüche je Tag', 'Belohnungen an jedem Tag', true],
      ['tage', 'Tagesprotokolle', 'alle Notizen dieses Teams']
    ];
    const st = { modus: 'kurs', woche: 0, team: '', von: 'lehrgang', kurs: {}, akte: {} };
    BLAETTER.forEach(b => { st.kurs[b[0]] = true; });
    AKTE.forEach(b => { st.akte[b[0]] = true; });

    // ---------------- Daten-Helfer ----------------
    const course = () => ctx.course();
    const spuer = () => { const c = course(); return !!(c && ((c.meta && c.meta.art === 'spuerhund') || (c.zg && c.zg.length))); };
    const teams = () => (course().teams || []).map(t => Object.assign({}, t, { name: WBK.teamName(t) }));
    const wochen = () => Math.max(1, Number(course().meta.wochen) || 4);
    const wocheStart = n => WBK.addDays(course().meta.start, (n - 1) * 7);
    function kw(iso) { const d = WBK.isoToDate ? WBK.isoToDate(iso) : new Date(iso + 'T00:00'); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const wd = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - wd); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); }
    const wocheText = n => n + '. Woche (KW ' + kw(wocheStart(n)) + ')';
    const deKurz = iso => WBK.weekday(iso) + ' ' + WBK.isoToDe(iso).replace(/\.(\d\d)(\d\d)$/, '.$2');
    const zeitraumVonBis = () => {
      if (st.woche) { const a = wocheStart(st.woche); return [a, WBK.addDays(a, 6)]; }
      const a = course().meta.start; return [a, WBK.addDays(a, wochen() * 7 - 1)];
    };
    const imZeitraum = iso => { const [a, b] = zeitraumVonBis(); return iso >= a && iso <= b; };
    const zeitraumText = () => { const [a, b] = zeitraumVonBis(); return (st.woche ? wocheText(st.woche) + ' · ' : '') + WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(b); };
    // Woche, in die ein Tag fällt (1 …); Tage vor dem Start zählen zur ersten Woche
    const wocheVon = iso => Math.max(1, Math.floor((WBK.dayIndex(course().meta.start, iso) - 1) / 7) + 1);
    const zgAlle = () => course().zg || [];
    function stoffe() {
      const c = course(), l = ((c.spuer && c.spuer.stoffe) || []).slice();
      zgAlle().forEach(e => { if (e.stoff && !l.includes(e.stoff)) l.push(e.stoff); });
      return l;
    }
    const farbe = s => { const i = ((course().spuer && course().spuer.stoffe) || []).indexOf(s); return i >= 0 && i < ZG_FARBEN.length ? ZG_FARBEN[i] : ZG_REST; };
    const zgSumme = (team, stoff, datum) => zgAlle().reduce((n, e) => n + (e.team === team && e.stoff === stoff && (datum ? e.datum === datum : imZeitraum(e.datum)) ? Number(e.anzahl) || 0 : 0), 0);
    const notizen = team => WBK.sortNotes(course().notes.filter(n => (!team || n.team === team) && imZeitraum(n.datum)));
    const notizText = l => l.map(n => /^\s*•/.test(n.text) || l.length === 1 ? n.text : '• ' + n.text).join('\n');

    // ---------------- Seite „PDF erstellen“ ----------------
    const sw = (k, titel, unter, an) => '<label class="cell"><div class="cell-tx"><b>' + esc(titel) + '</b><span>' + esc(unter) + '</span></div><input type="checkbox" class="switch" data-k="' + k + '"' + (an ? ' checked' : '') + '></label>';
    function render() {
      const c = course(); if (!c) return;
      $('#pdfSub').textContent = c.meta.titel || '';
      $('#pdfBack').lastChild.textContent = st.von === 'team' ? 'Zurück' : 'Lehrgänge';
      $('#pdfSeg').innerHTML = [['kurs', 'Ganzer Lehrgang'], ['akte', 'Teilnehmerakte']].map(([k, t]) => '<button type="button" data-m="' + k + '"' + (st.modus === k ? ' class="on"' : '') + '>' + t + '</button>').join('');
      const tl = teams(); if (!tl.some(t => t.name === st.team)) st.team = tl[0] ? tl[0].name : '';
      let h = '';
      if (st.modus === 'kurs') {
        const sichtbar = BLAETTER.filter(b => !b[3] || spuer());
        const alles = sichtbar.every(b => st.kurs[b[0]]) && !st.woche;
        h += '<div class="group">' + sw('alles', 'Alles aufnehmen', 'alle Blätter, alle Wochen, alle Teams', alles) + '</div>';
        h += '<div class="section-h">Blätter</div><div class="group">' + sichtbar.map(b => sw(b[0], b[1], b[2], st.kurs[b[0]])).join('') + '</div>';
      } else {
        const t = tl.find(x => x.name === st.team);
        h += '<div class="section-h">Team</div><div class="group"><label class="cell picker"><div class="cell-tx"><b>' + esc(t ? t.name + (t.hund && t.name.indexOf(t.hund) < 0 ? ' mit ' + t.hund : '') : 'Keine Teams') + '</b></div><span class="val">Wechseln<svg><use href="#i-updown"/></svg></span><select id="pdfTeam" aria-label="Team wählen">' +
          tl.map(x => '<option' + (x.name === st.team ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label></div>';
        h += '<div class="section-h">In der Akte</div><div class="group">' + AKTE.filter(b => !b[3] || spuer()).map(b => sw(b[0], b[1], b[2], st.akte[b[0]])).join('') + '</div>';
      }
      if (st.woche > wochen()) st.woche = 0;
      h += '<div class="section-h">Zeitraum</div><div class="group"><label class="cell picker"><div class="cell-tx"><b>Wochen</b></div><span class="val">' + esc(st.woche ? wocheText(st.woche) : 'Alle Wochen') + '<svg><use href="#i-updown"/></svg></span><select id="pdfWoche" aria-label="Zeitraum wählen"><option value="0">Alle Wochen</option>' +
        Array.from({ length: wochen() }, (_, i) => '<option value="' + (i + 1) + '"' + (st.woche === i + 1 ? ' selected' : '') + '>' + esc(wocheText(i + 1)) + '</option>').join('') + '</select></label></div>';
      $('#pdfBody').innerHTML = h;
      $('#pdfGo').disabled = !auswahl().length || (st.modus === 'akte' && !st.team);
    }
    // Ausgewählte Teile in der Reihenfolge des PDFs
    function auswahl() {
      if (st.modus === 'kurs') return BLAETTER.filter(b => (!b[3] || spuer()) && st.kurs[b[0]]).map(b => b[0]);
      return AKTE.filter(b => (!b[3] || spuer()) && st.akte[b[0]]).map(b => b[0]);
    }
    function bind() {
      $('#pdfBack').addEventListener('click', () => ctx.go(st.von === 'team' ? 'team' : 'lehrgang'));
      $('#pdfSeg').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; st.modus = b.dataset.m; render(); });
      $('#pdfBody').addEventListener('change', e => {
        const el = e.target;
        if (el.id === 'pdfTeam') st.team = el.value;
        else if (el.id === 'pdfWoche') st.woche = Number(el.value) || 0;
        else if (el.dataset.k === 'alles') { if (el.checked) { BLAETTER.forEach(b => { st.kurs[b[0]] = true; }); st.woche = 0; } else BLAETTER.forEach(b => { st.kurs[b[0]] = false; }); }
        else if (el.dataset.k) (st.modus === 'kurs' ? st.kurs : st.akte)[el.dataset.k] = el.checked;
        render();
      });
      $('#pdfGo').addEventListener('click', erstellen);
    }
    // Öffnen: von der Lehrgangsseite (ganzer Lehrgang) oder aus einem Team (Teilnehmerakte, Team schon gewählt)
    function open(team) {
      if (!course()) return ctx.toast('Kein Lehrgang gewählt.');
      st.von = team ? 'team' : 'lehrgang';
      if (team) { st.modus = 'akte'; st.team = team; } else st.modus = 'kurs';
      ctx.go('pdf'); render();
    }
    const tab = () => st.von === 'team' ? 'heute' : 'lehrgang';

    // ---------------- PDF-Bausteine ----------------
    let bereit = null, logo = null;
    function laden() {
      if (!bereit) bereit = (async () => {
        if (!global.pdfMake) await skript('vendor/pdfmake.min.js');
        if (!global.pdfMake.vfs || !Object.keys(global.pdfMake.vfs).length) await skript('vendor/vfs_fonts.js');
        try { const b = await (await fetch('icons/logo-lafp.png')).blob(); logo = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(null); f.readAsDataURL(b); }); } catch (e) { logo = null; }
      })().catch(e => { bereit = null; throw e; });
      return bereit;
    }
    const skript = src => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('PDF-Baustein konnte nicht geladen werden. Bitte mit Internet erneut versuchen.')); document.head.appendChild(s); });

    function titel(text, unter, mitLogo) {
      const links = { stack: [{ text, style: 'h1' }, unter ? { text: unter, style: 'unter' } : ''] };
      return [
        { columns: mitLogo && logo ? [links, { image: logo, width: 150, alignment: 'right' }] : [links], columnGap: 10 },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 773, y2: 4, lineWidth: 1.2 }], margin: [0, 0, 0, 10] }
      ];
    }
    // headlineLevel: Hauptüberschrift; steht sie unten auf einer Seite ohne Text darunter, rutscht sie mit auf die nächste Seite (siehe pageBreakBefore)
    const balken = text => ({ table: { widths: ['*'], body: [[{ text, bold: true, color: '#FFFFFF', fillColor: BLAU, margin: [2, 1, 2, 1], ueberschrift: true }]] }, layout: 'noBorders', margin: [0, 8, 0, 6], headlineLevel: 1 });
    const kopf = l => l.map(t => ({ text: t, style: 'th' }));
    // Spaltenbreiten auf die volle Seitenbreite verteilen: feste Spalten (Zahl) bleiben, Textspalten (0) bekommen Platz
    // nach Textmenge (mindestens minB). Die Textspalte mit dem meisten Text bekommt '*' und füllt den Rest bis zum Rand.
    const BREITE = 773;
    const txtLaenge = c => c == null ? 0 : typeof c === 'string' ? c.length : c.text != null ? (Array.isArray(c.text) ? c.text.map(txtLaenge).reduce((a, b) => a + b, 0) : String(c.text).length) : c.stack ? c.stack.map(txtLaenge).reduce((a, b) => a + b, 0) : 0;
    function verteile(spec, zeilen, gesamt, minB) {
      const n = spec.length, frei = (gesamt || BREITE) - spec.reduce((a, b) => a + b, 0) - n * 8 - (n + 1) * 0.5 - 4;
      const idx = spec.map((b, i) => b ? -1 : i).filter(i => i >= 0);
      const len = idx.map(i => Math.max(20, zeilen.reduce((a, r) => a + txtLaenge(r[i]), 0)));
      const summe = len.reduce((a, b) => a + b, 0), mn = minB || 70;
      let br = len.map(l => Math.max(mn, frei * l / summe));
      const zuviel = br.reduce((a, b) => a + b, 0) - frei; // Mindestbreiten wieder bei den breiten Spalten abziehen
      if (zuviel > 0) { const gross = br.reduce((a, b) => a + (b > mn ? b - mn : 0), 0); br = br.map(b => b > mn ? b - zuviel * (b - mn) / gross : b); }
      const w = spec.slice(), groesste = br.indexOf(Math.max(...br));
      idx.forEach((i, k) => { w[i] = k === groesste ? '*' : Math.floor(br[k]); });
      return w;
    }
    // Liste mit blauer Kopfzeile (auf jeder Seite wiederholt), Zeilen grau/weiß, dicke blaue Linie vor jedem neuen Tag
    function liste(widths, body, neueTage) {
      const dick = new Set(neueTage || []);
      return {
        table: { headerRows: 1, keepWithHeaderRows: 1, widths, body, dontBreakRows: true },
        layout: {
          fillColor: i => i === 0 ? BLAU : (i % 2 ? null : GRAU),
          hLineWidth: i => dick.has(i) ? 1.8 : 0.5,
          hLineColor: i => dick.has(i) ? BLAU : LINIE,
          vLineWidth: () => 0.5, vLineColor: () => LINIE,
          paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3
        }
      };
    }
    function kv(paare, spalten) {
      const rows = [];
      for (let i = 0; i < paare.length; i += spalten) {
        const r = [];
        for (let k = 0; k < spalten; k++) { const p = paare[i + k] || ['', '']; r.push({ text: p[0], bold: true, fillColor: HELL }, { text: p[1] || '–' }); }
        rows.push(r);
      }
      const w = spalten === 2 ? [110, '*', 120, '*'] : [130, '*'];
      return { table: { widths: w, body: rows }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LINIE, vLineColor: () => LINIE, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 } };
    }
    const leer = text => ({ text, italics: true, color: '#555555', margin: [0, 2, 0, 6] });
    const teamLabel = t => t.name + (t.teilnehmer && t.name.indexOf(t.teilnehmer) < 0 ? ' – ' + t.teilnehmer : '');
    const teamUnter = t => [t.hund && t.name.indexOf(t.hund) < 0 ? 'mit ' + t.hund : '', t.behoerde].filter(Boolean).join(' · ');

    // Donut als SVG (Ringstücke als Flächen, damit es in jedem PDF-Programm gleich aussieht)
    function donutSvg(werte, groesse) {
      const sum = werte.reduce((a, w) => a + w[1], 0), R = 70, r = 46, cx = 80, cy = 80;
      let a0 = -Math.PI / 2, teile = '';
      const pt = (rad, a) => (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2);
      if (!sum) teile = '<circle cx="80" cy="80" r="58" fill="none" stroke="#E5E5EA" stroke-width="24"/>';
      const aktiv = werte.filter(w => w[1] > 0);
      aktiv.forEach(([s, v]) => {
        const winkel = 2 * Math.PI * v / sum, luecke = aktiv.length > 1 ? 0.025 : 0, a1 = a0 + winkel;
        if (aktiv.length === 1) teile += '<circle cx="80" cy="80" r="58" fill="none" stroke="' + farbe(s) + '" stroke-width="24"/>';
        else {
          const b0 = a0 + luecke / 2, b1 = a1 - luecke / 2, gross = b1 - b0 > Math.PI ? 1 : 0;
          teile += '<path fill="' + farbe(s) + '" d="M ' + pt(R, b0) + ' A ' + R + ' ' + R + ' 0 ' + gross + ' 1 ' + pt(R, b1) + ' L ' + pt(r, b1) + ' A ' + r + ' ' + r + ' 0 ' + gross + ' 0 ' + pt(r, b0) + ' Z"/>';
        }
        a0 = a1;
      });
      return { stack: [{ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' + teile + '</svg>', width: groesse, alignment: 'center' },
        { text: String(sum), fontSize: 18, bold: true, alignment: 'center', margin: [0, -groesse / 2 - 14, 0, 0] }, { text: 'Belohnungen', fontSize: 7, alignment: 'center', color: '#444444', margin: [0, 0, 0, groesse / 2 - 16] }] };
    }
    function legende(werte) {
      const sum = werte.reduce((a, w) => a + w[1], 0);
      return {
        table: { widths: [10, '*', 34, 34], body: werte.map(([s, v]) => [{ canvas: [{ type: 'rect', x: 0, y: 1.5, w: 8, h: 8, color: farbe(s) }] }, s, { text: String(v), alignment: 'right' }, { text: sum ? Math.round(v * 100 / sum) + ' %' : '–', alignment: 'right' }]) },
        layout: { hLineWidth: (i, n) => i === 0 || i === n.table.body.length ? 0 : 0.5, vLineWidth: () => 0, hLineColor: () => '#DDDDDD', paddingTop: () => 2, paddingBottom: () => 2 }
      };
    }
    const werteVon = team => stoffe().map(s => [s, zgSumme(team, s)]);
    function dCard(t, breite) {
      const w = werteVon(t.name);
      return {
        unbreakable: true, margin: [0, 0, 0, 10],
        table: { widths: ['*'], body: [
          [{ columns: [{ text: teamLabel(t), bold: true, color: '#FFFFFF' }, { text: t.behoerde || '', color: '#FFFFFF', alignment: 'right' }], fillColor: BLAU }],
          [{ columns: [{ width: breite, stack: [donutSvg(w, breite - 10)] }, { width: '*', stack: [legende(w)], margin: [0, 16, 0, 0] }], columnGap: 10, margin: [2, 6, 2, 4] }]
        ] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LINIE, vLineColor: () => LINIE }
      };
    }

    // ---------------- Teile ----------------
    const neueSeite = inhalt => { if (inhalt.length) inhalt[0] = Object.assign({}, inhalt[0], { pageBreak: 'before' }); return inhalt; };
    function deckblatt(inhaltListe) {
      const c = course(), m = c.meta, [a, b] = zeitraumVonBis();
      return [
        ...titel((m.titel ? m.titel + ' | ' : '') + 'Trainingsdokumentation', '', true),
        kv([['Lehrgang', m.titel], ['Art', m.art === 'spuerhund' ? 'Spürhund' : 'Allgemein'], ['Zeitraum', WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(b)], ['Dauer', st.woche ? wocheText(st.woche) : wochen() + ' Wochen'],
          ['Trainer/in', m.trainer], ['Teams', String(teams().length)], ['Notizen', String(notizen().length)], ['Erstellt am', WBK.isoToDe(ctx.today())]], 2),
        balken('Inhalt dieses PDFs'),
        { ul: inhaltListe, margin: [6, 0, 0, 0] }
      ];
    }
    function teamsBlatt() {
      const g = course().gesamt || {};
      // Steht der Name der Teilnehmerin / des Teilnehmers schon als Team da, fällt die doppelte Spalte weg
      const mitTn = teams().some(t => t.teilnehmer && t.teilnehmer !== t.name);
      const body = [kopf(['Team', ...(mitTn ? ['Teilnehmer/in'] : []), 'Hund', 'Behörde', 'Rasse / Alter', 'Bemerkung', 'Gesamteindruck'])].concat(teams().map(t => [{ text: t.name, bold: true }, ...(mitTn ? [t.teilnehmer || '–'] : []), t.hund || '–', t.behoerde || '–', t.rasse || '–', t.bemerkung || '–', g[t.name] || '–']));
      return [...titel('Teamstammdaten', (course().meta.titel || '') + ' · ' + teams().length + ' Teams'), liste([95, ...(mitTn ? [95] : []), 70, 95, 75, '*', '*'], body)];
    }
    // Tagesprotokoll im PDF (Layout A): oben eine Zeile mit den kurzen Angaben, darunter Beobachtungen / nächster Schritt
    // und Bemerkungen über die ganze Breite. Leere Teile fallen weg, Noten stehen fett, dicke blaue Linie nur vor einem neuen Tag.
    const NOTEN = /^(sehr gut|gut|befriedigend|ausreichend|mangelhaft|ungenügend)\.?$/i;
    const mitNote = v => {
      if (!v) return '–';
      const zeilen = v.split('\n');
      return { text: zeilen.map((z, i) => ({ text: z + (i < zeilen.length - 1 ? '\n' : ''), bold: NOTEN.test(z.trim()) })) };
    };
    function tageA(tl, tage, ns, zelle, nurTeam) {
      const OBEN = [['ort', 'Trainingsort'], ['zielgerueche', 'Zielgerüche'], ['inhalt', 'Trainingsinhalt / Aufbau'], ['motivation', 'Motivation'], ['anzeige', 'Anzeigeverhalten']];
      // Breiten nach Textmenge in diesem Abschnitt: Spalten mit viel Text werden breiter, die Tabelle reicht immer bis zum rechten Rand
      const proben = [];
      tage.forEach(d => tl.forEach(t => { const l = ns.filter(x => x.datum === d && x.team === t.name); if (l.length) proben.push(OBEN.map(([k]) => zelle(l, k))); }));
      const innenBreite = BREITE - 62 - (nurTeam ? 0 : 80) - 2;
      const wInnen = verteile(OBEN.map(() => 0), proben, innenBreite, 84);
      const UNTEN = WBK.FELDER.filter(f => f[0] === 'beobachtung' || f[0] === 'bemerkung');
      const vorn = nurTeam ? 1 : 2; // Datum (und Team) als eigene Spalten, der Rest steckt in einer inneren Tabelle
      // Innere Tabelle: oben die kurzen Angaben, darunter die langen Texte über die ganze Breite.
      // So bleibt ein Eintrag beim Seitenwechsel zusammen und die Spalten stehen bei allen Einträgen gleich.
      const innen = (zeilen, kopfzeile) => ({
        table: { widths: wInnen, body: zeilen },
        layout: {
          hLineWidth: i => !kopfzeile && i === 1 && zeilen.length > 1 ? 0.5 : 0, hLineColor: () => LINIE,
          vLineWidth: i => i > 0 && i < OBEN.length ? 0.5 : 0, vLineColor: () => LINIE,
          // Außen hat schon die umgebende Zelle Abstand oben/unten; so stehen alle Texte einer Zeile auf gleicher Höhe
          paddingLeft: () => 4, paddingRight: () => 4, paddingTop: i => i === 0 ? 0 : 3, paddingBottom: i => i === zeilen.length - 1 ? 0 : 3
        }
      });
      const ws = [54, ...(nurTeam ? [] : [72]), '*'];
      const head = [...kopf(['Datum', ...(nurTeam ? [] : ['Team'])]), innen([kopf(OBEN.map(o => o[1]))], true)];
      const body = [head];
      const dick = new Set(), ohne = new Set(), tagStart = new Set(), fuell = [null];
      let eintrag = 0;
      tage.forEach(d => {
        tl.forEach(t => {
          const l = ns.filter(x => x.datum === d && x.team === t.name); if (!l.length) return;
          if (!tagStart.has(d)) { tagStart.add(d); if (body.length > 1) dick.add(body.length); }
          fuell.push(eintrag++ % 2 ? GRAU : null);
          const r = [{ text: deKurz(d), bold: true, noWrap: true }];
          if (!nurTeam) r.push({ stack: [{ text: teamLabel(t), bold: true }, ...(t.hund && t.name.indexOf(t.hund) < 0 ? [{ text: 'mit ' + t.hund }] : [])] });
          const oben = OBEN.map(([k]) => { const v = zelle(l, k); return k === 'motivation' || k === 'anzeige' ? mitNote(v) : (v || '–'); });
          const zeilen = [oben];
          const unten = UNTEN.map(([k, h]) => [h, zelle(l, k)]).filter(x => x[1]);
          const stack = [];
          unten.forEach(([h, v], i) => stack.push({ text: h.toUpperCase(), bold: true, color: BLAU, fontSize: 7, characterSpacing: 0.3, margin: [0, i ? 3 : 0, 0, 1] }, { text: v }));
          // Ein Eintrag bleibt zusammen auf einer Seite. Sehr lange Texte kommen in eine eigene Zeile über die ganze Breite,
          // die über mehrere Seiten laufen darf (eine zu hohe, nicht teilbare Zeile würde sonst verschluckt).
          const lang = unten.map(x => x[1]).join('').length > 1500;
          if (unten.length && !lang) zeilen.push([{ stack, colSpan: OBEN.length, margin: [0, 1, 0, 1] }, ...Array(OBEN.length - 1).fill('')]);
          r.push(innen(zeilen));
          body.push(r.map(x => Object.assign(typeof x === 'string' ? { text: x } : x, { unbreakable: true })));
          if (lang) {
            // In Stücke von höchstens etwa einer halben Seite teilen, damit jede Zeile auf eine Seite passt
            const stuecke = [];
            unten.forEach(([h, v]) => {
              let rest = v, erstes = true;
              while (rest) {
                let cut = rest.length <= 2500 ? rest.length : rest.lastIndexOf(' ', 2500);
                if (cut <= 0) cut = Math.min(2500, rest.length);
                stuecke.push([erstes ? h : '', rest.slice(0, cut).trim()]); rest = rest.slice(cut).trim(); erstes = false;
              }
            });
            stuecke.forEach(([h, v], si) => {
              if (si) ohne.add(body.length); // keine Linie zwischen den Stücken eines Textes
              fuell.push(fuell[fuell.length - 1]);
              body.push([{ stack: [...(h ? [{ text: h.toUpperCase(), bold: true, color: BLAU, fontSize: 7, characterSpacing: 0.3, margin: [0, 0, 0, 1] }] : []), { text: v }], colSpan: ws.length }, ...Array(ws.length - 1).fill('')]);
            });
          }
        });
      });
      return {
        table: { headerRows: 1, keepWithHeaderRows: 1, widths: ws, body, dontBreakRows: true },
        fontSize: 8.5, lineHeight: 1.05,
        layout: {
          fillColor: i => i === 0 ? BLAU : fuell[i],
          hLineWidth: i => dick.has(i) ? 1.8 : ohne.has(i) ? 0 : 0.5,
          hLineColor: i => dick.has(i) ? BLAU : LINIE,
          vLineWidth: () => 0.5, vLineColor: () => LINIE,
          // Die Zelle mit der inneren Tabelle bekommt keinen eigenen Abstand, den hat die innere Tabelle
          paddingLeft: i => i >= vorn ? 0 : 4, paddingRight: i => i >= vorn ? 0 : 4,
          paddingTop: () => 3, paddingBottom: () => 3
        }
      };
    }
    // Tagesprotokolle: eine Zeile je Team und Tag, Abschnitt (neue Seite) je Woche
    function tageBlatt(nurTeam) {
      const tl = teams().filter(t => !nurTeam || t.name === nurTeam);
      const alle = notizen(nurTeam);
      if (!alle.length) return [...titel(nurTeam ? 'Tagesprotokolle' : 'Tagesprotokolle', zeitraumText()), leer('Im gewählten Zeitraum gibt es keine Notizen.')];
      const proWoche = new Map();
      alle.forEach(n => { const w = wocheVon(n.datum); if (!proWoche.has(w)) proWoche.set(w, []); proWoche.get(w).push(n); });
      const out = [];
      [...proWoche.keys()].sort((a, b) => a - b).forEach((w, wi) => {
        const ns = proWoche.get(w), tage = [...new Set(ns.map(n => n.datum))].sort();
        // Sind Notizen schon auf die Spalten verteilt, kommt das Tagesprotokoll mit allen Spalten wie in Excel
        const spalten = ns.some(n => n.felder);
        const F = WBK.FELDER, feld = (n, k) => n.felder ? String(n.felder[k] || '').trim() : (k === 'beobachtung' ? n.text || '' : '');
        const zelle = (l, k) => { const v = l.map(n => feld(n, k)).filter(Boolean); return v.length > 1 ? v.map(x => /^\s*•/.test(x) ? x : '• ' + x).join('\n') : v[0] || ''; };
        const unter = WBK.isoToDe(wocheStart(w)) + ' bis ' + WBK.isoToDe(WBK.addDays(wocheStart(w), 6));
        const ueber = 'Tagesprotokolle · ' + wocheText(w) + (nurTeam ? ' · ' + nurTeam : '');
        let teil;
        if (spalten) teil = [...titel(ueber, unter), tageA(tl, tage, ns, zelle, nurTeam)];
        else {
          // Ältere, nicht aufgeteilte Notizen: einfache Liste
          const body = [kopf(['Datum', ...(nurTeam ? [] : ['Team']), 'Notizen'])], neu = [];
          tage.forEach(d => {
            let erste = true;
            tl.forEach(t => {
              const l = ns.filter(n => n.datum === d && n.team === t.name); if (!l.length) return;
              if (erste) neu.push(body.length);
              body.push([{ text: deKurz(d), bold: true, noWrap: true }, ...(nurTeam ? [] : [{ text: teamLabel(t), bold: true }]), notizText(l)]); erste = false;
            });
          });
          teil = [...titel(ueber, unter), Object.assign(liste([52, ...(nurTeam ? [] : [66]), '*'], body, neu), { fontSize: 8.5, lineHeight: 1.05 })];
        }
        out.push(...(wi ? neueSeite(teil) : teil));
      });
      return out;
    }
    // Zielgerüche-Tabelle: je Woche Team × Geruch mit Belohnungen je Tag
    function zgTabelle(nurTeam) {
      const tl = teams().filter(t => !nurTeam || t.name === nurTeam), sl = stoffe();
      const tageMit = [...new Set(zgAlle().filter(e => imZeitraum(e.datum) && (!nurTeam || e.team === nurTeam) && Number(e.anzahl)).map(e => e.datum))].sort();
      if (!sl.length || !tageMit.length) return [...titel('Zielgerüche · Belohnungen je Tag', zeitraumText()), leer('Im gewählten Zeitraum wurden keine Belohnungen gezählt.')];
      const proWoche = new Map();
      tageMit.forEach(d => { const w = wocheVon(d); if (!proWoche.has(w)) proWoche.set(w, []); proWoche.get(w).push(d); });
      const out = [];
      [...proWoche.keys()].sort((a, b) => a - b).forEach((w, wi) => {
        const tage = proWoche.get(w);
        const body = [kopf([...(nurTeam ? [] : ['Team']), 'Zielgeruch', 'Woche', ...tage.map(d => WBK.weekday(d) + '\n' + WBK.isoToDe(d).slice(0, 6))])], neu = [];
        tl.forEach(t => {
          let erste = true;
          sl.forEach(s => {
            const proTag = tage.map(d => zgSumme(t.name, s, d)), sum = proTag.reduce((a, x) => a + x, 0);
            if (!sum) return;
            if (erste && !nurTeam) neu.push(body.length);
            body.push([...(nurTeam ? [] : [{ text: erste ? teamLabel(t) : '', bold: true }]), s, { text: String(sum), bold: true, alignment: 'center' }, ...proTag.map(x => ({ text: x ? String(x) : '', alignment: 'center' }))]);
            erste = false;
          });
        });
        const widths = [...(nurTeam ? [] : [130]), 110, 40, ...tage.map(() => '*')];
        // Teilnehmerakte: Wochen untereinander (kurz), ganzer Lehrgang: jede Woche auf eigener Seite
        const teil = nurTeam ? [Object.assign(balken('Zielgerüche je Tag · ' + wocheText(w)), wi ? {} : { margin: [0, 0, 0, 6] }), liste(widths, body, neu)]
          : [...titel('Zielgerüche · ' + wocheText(w), WBK.isoToDe(wocheStart(w)) + ' bis ' + WBK.isoToDe(WBK.addDays(wocheStart(w), 6))), liste(widths, body, neu)];
        out.push(...(wi && !nurTeam ? neueSeite(teil) : teil));
      });
      return out;
    }
    function zgDiagramme() {
      const tl = teams(), zeilen = [];
      for (let i = 0; i < tl.length; i += 2) zeilen.push({ columns: [dCard(tl[i], 170), tl[i + 1] ? dCard(tl[i + 1], 170) : { text: '' }], columnGap: 12 });
      return [...titel('Zielgerüche · Kreisdiagramme je Team', zeitraumText(), true), ...zeilen];
    }
    // Wochenberichte: je Woche eine Seite wie der Excel-Reiter
    const berichtWochen = () => Object.keys(course().wochenberichte || {}).map(Number).filter(w => w > 0 && (!st.woche || w === st.woche)).sort((a, b) => a - b);
    function wochenBlatt() {
      const ws = berichtWochen(), m = course().meta;
      if (!ws.length) return [...titel('Wochenberichte', zeitraumText()), leer('Für den gewählten Zeitraum gibt es noch keinen Wochenbericht (Lehrgänge → Wochenberichte).')];
      const out = [];
      ws.forEach((w, i) => {
        const b = course().wochenberichte[w], ab = b.abschnitte || {}, a = wocheStart(w);
        const body = [kopf(['Team', 'Tages-\nprotokolle', ...WBK.WB_TEAM.map(x => x[1] === 'Ausbilderbewertung' ? 'Ausbilder-\nbewertung' : x[1])])];
        teams().forEach(t => { const tb = (b.teams || {})[t.name] || {}, n = WBK.einheiten(course(), t.name, w); body.push([{ text: teamLabel(t) + (t.behoerde ? ', ' + t.behoerde : ''), bold: true }, { text: String(n), alignment: 'center' }, ...WBK.WB_TEAM.map(([k]) => k === 'bewertung' ? { text: tb[k] || '', alignment: 'center' } : tb[k] || '')]); });
        const teil = [...titel((m.titel ? m.titel + ' | ' : '') + 'Gemeinsamer interner Wochenbericht', '', true),
          kv([['Dienststelle', m.kopfBehoerde], ['Organisationseinheit', [m.kopfOe1, m.kopfOe2].filter(Boolean).join(' – ')], ['Trainer', m.trainer], ['Lehrgangswoche', w + '. Lehrgangswoche'], ['Kalenderwoche', kw(a) + '. KW'], ['Zeitraum', WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(WBK.addDays(a, 6))]], 2),
          balken('1 | Ausbildungsinhalte / Schwerpunkte'), { text: ab.inhalte || '–' }, balken('2 | Gesamtüberblick der Ausbilder'), { text: ab.ueberblick || '–' },
          balken('3 | Individuelle Entwicklung der Mensch-Hund-Teams'), liste(verteile([110, 50, ...WBK.WB_TEAM.map(([k]) => k === 'bewertung' ? 58 : 0)], body.slice(1)), body),
          balken('4 | Gesamtbewertung der Ausbildungsgruppe'), { text: ab.gesamt || '–' }, balken('5 | Hinweise für die Ausbildungsgruppe'), { text: ab.hinweise || '–' }];
        out.push(...(i ? neueSeite(teil) : teil));
      });
      return out;
    }
    function entwicklung(t) {
      const ws = berichtWochen().filter(w => (course().wochenberichte[w].teams || {})[t.name]);
      if (!ws.length) return [balken('Entwicklung je Woche'), leer('Noch kein Wochenbericht vorhanden.')];
      const body = [kopf(['Woche', 'Fortschritte', 'Auffälligkeiten / Defizite', 'Fördermaßnahmen / nächste Schritte', 'Ausbilder-\nbewertung'])];
      ws.forEach(w => { const tb = course().wochenberichte[w].teams[t.name]; body.push([w + '. Woche\nKW ' + kw(wocheStart(w)), tb.fortschritte || '', tb.defizite || '', tb.foerderung || '', { text: tb.bewertung || '', alignment: 'center' }]); });
      return [balken('Entwicklung je Woche'), liste(verteile([60, 0, 0, 0, 58], body.slice(1)), body)];
    }
    // Teilnehmerakte eines Teams
    function akte(teile) {
      const t = teams().find(x => x.name === st.team), m = course().meta, g = (course().gesamt || {})[t.name];
      const out = [...titel('Teilnehmerakte · ' + teamLabel(t), [teamUnter(t), m.titel, st.woche ? wocheText(st.woche) : 'alle Wochen'].filter(Boolean).join(' · '), true)];
      if (teile.includes('stamm')) out.push(balken('Stammdaten'), kv([['Team', t.name], ['Lehrgang', m.titel], ...(t.teilnehmer && t.teilnehmer !== t.name ? [['Hundeführer/in', t.teilnehmer]] : []), ['Zeitraum', zeitraumText()], ['Diensthund', t.hund], ['Trainer/in', m.trainer], ['Behörde', t.behoerde], ['Notizen', String(notizen(t.name).length)], ['Rasse / Alter', t.rasse], ['Bemerkung', t.bemerkung]], 2),
        balken('Gesamteindruck'), g ? { text: g } : leer('Noch kein Gesamteindruck eingetragen (Excel-Datei, Blatt „Teams“, Spalte „Gesamteindruck“).'));
      if (teile.includes('entw')) out.push(...entwicklung(t));
      if (teile.includes('zgdia')) { const w = werteVon(t.name); out.push({ stack: [balken('Zielgerüche'), { columns: [{ width: 200, stack: [donutSvg(w, 180)] }, { width: 320, stack: [legende(w)], margin: [0, 30, 0, 0] }], columnGap: 20 }], unbreakable: true }); }
      if (teile.includes('zgtab')) out.push(...neueSeite(zgTabelle(t.name)));
      if (teile.includes('tage')) out.push(...neueSeite(tageBlatt(t.name)));
      return out;
    }

    function dokument() {
      const c = course(), teile = auswahl(), inhalt = [];
      let kopfRechts = c.meta.titel || '';
      if (st.modus === 'akte') { inhalt.push(...akte(teile)); kopfRechts = 'Teilnehmerakte ' + st.team; }
      else {
        const namen = { deckblatt: 'Deckblatt', teams: 'Teamstammdaten', tage: 'Tagesprotokolle', wochen: 'Wochenberichte', zgtab: 'Zielgerüche je Tag', zgdia: 'Zielgerüche-Diagramme' };
        teile.forEach((k, i) => {
          const teil = k === 'deckblatt' ? deckblatt(teile.filter(x => x !== 'deckblatt').map(x => namen[x]).concat(st.woche ? ['Zeitraum: ' + zeitraumText()] : [])) : k === 'teams' ? teamsBlatt() : k === 'tage' ? tageBlatt() : k === 'wochen' ? wochenBlatt() : k === 'zgtab' ? zgTabelle() : zgDiagramme();
          inhalt.push(...(i ? neueSeite(teil) : teil));
        });
      }
      const erstellt = WBK.isoToDe(ctx.today());
      return {
        pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [34, 40, 34, 36],
        info: { title: dateiName().replace(/\.pdf$/, '') },
        header: () => ({ columns: [{ text: c.meta.titel || '' }, { text: kopfRechts === c.meta.titel ? '' : kopfRechts, alignment: 'right' }], margin: [34, 16, 34, 0], fontSize: 7, color: '#777777' }),
        footer: (seite, von) => ({ columns: [{ text: 'Interne Dokumentation' }, { text: 'Seite ' + seite + ' von ' + von, alignment: 'center', bold: true, color: '#000000' }, { text: 'Erstellt am ' + erstellt, alignment: 'right' }], margin: [34, 10, 34, 0], fontSize: 7, color: '#777777' }),
        content: inhalt,
        // Eine Hauptüberschrift nie allein am Seitenende: Folgt auf derselben Seite nichts oder höchstens eine Tabellenkopfzeile, beginnt sie auf der nächsten Seite
        pageBreakBefore: (node, folgend) => node.headlineLevel === 1 && !folgend.some(n => !n.ueberschrift && n.headlineLevel !== 1),
        styles: { h1: { fontSize: 15, bold: true, color: BLAU }, unter: { fontSize: 8, margin: [0, 2, 0, 0] }, th: { bold: true, color: '#FFFFFF', fontSize: 8.5 } },
        defaultStyle: { fontSize: 9, color: '#000000', lineHeight: 1.1 }
      };
    }
    const sauber = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    function dateiName() {
      const c = course(), d = ctx.today();
      const nurWb = st.modus === 'kurs' && auswahl().join() === 'wochen' && st.woche;
      const was = st.modus === 'akte' ? 'Teilnehmerakte ' + st.team : nurWb ? 'Wochenbericht ' + (c.meta.titel || '') + ' KW ' + kw(wocheStart(st.woche)) : 'Lehrgang ' + (c.meta.titel || '');
      return sauber(was + (st.woche && !nurWb ? ' ' + st.woche + '. Woche' : '') + ' ' + d) + '.pdf';
    }

    // Fehlende oder unvollständige Wochenberichte im gewählten Zeitraum (nur Wochen, die schon begonnen haben)
    function wbLuecken() {
      const c = course(), mitWb = st.modus === 'akte' ? auswahl().includes('entw') : auswahl().includes('wochen');
      if (!mitWb) return [];
      const n = Math.max(1, Number(c.meta.wochen) || 4), ws = st.woche ? [st.woche] : Array.from({ length: n }, (_, i) => i + 1);
      const tl = st.modus === 'akte' ? teams().filter(t => t.name === st.team) : teams();
      return ws.filter(w => wocheStart(w) <= ctx.today()).map(w => {
        const b = (c.wochenberichte || {})[w];
        if (!b) return w + '. Woche (KW ' + kw(wocheStart(w)) + '): kein Bericht';
        const ab = b.abschnitte || {};
        let leer = st.modus === 'akte' ? 0 : ['inhalte', 'ueberblick', 'gesamt', 'hinweise'].filter(k => !String(ab[k] || '').trim()).length;
        tl.forEach(t => { const tb = (b.teams || {})[t.name] || {}; leer += ['fortschritte', 'defizite', 'foerderung', 'bewertung'].filter(k => !String(tb[k] || '').trim()).length; });
        return leer ? w + '. Woche (KW ' + kw(wocheStart(w)) + '): ' + leer + (leer === 1 ? ' Feld leer' : ' Felder leer') : '';
      }).filter(Boolean);
    }
    async function erstellen(trotzdem) {
      if (!course() || !auswahl().length) return;
      const luecken = trotzdem === true ? [] : wbLuecken();
      if (luecken.length) {
        ctx.openModal('<h3>Wochenberichte nicht vollständig</h3><p class="modal-sub">' + luecken.map(esc).join('<br>') + '</p><p class="modal-sub">Du kannst sie unter Lehrgänge → Wochenberichte ergänzen.</p>' +
          '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="pdfTrotzdem">Trotzdem erstellen</button></div>');
        $('#pdfTrotzdem').onclick = () => { ctx.closeModal(); erstellen(true); };
        return;
      }
      ctx.busy('PDF wird erstellt …');
      let blob;
      try {
        await laden();
        const doc = dokument();
        blob = await new Promise((ok, fail) => { try { global.pdfMake.createPdf(doc).getBlob(ok); } catch (e) { fail(e); } });
      } catch (e) { ctx.busy(''); console.error(e); ctx.toast('PDF konnte nicht erstellt werden: ' + (e.message || e), 6000); return; }
      ctx.busy('');
      const name = dateiName(), file = new File([blob], name, { type: 'application/pdf' });
      kopieInDrive(name, blob);
      await teilen(file);
    }
    // Kopie im Lehrgangsordner („PDF“), läuft im Hintergrund; schlägt es fehl, bleibt das PDF trotzdem nutzbar
    function kopieInDrive(name, blob) {
      const id = ctx.activeId(); if (!id || !S.Drive.token) return;
      S.Drive.withFolders(id, async f => {
        const ziel = f.shared ? f.folder : await S.Drive.folder('PDF', f.folder);
        return S.Drive.upload({ name, mimeType: 'application/pdf', parents: [ziel] }, blob, 'application/pdf');
      }).then(() => ctx.toast('Kopie im Lehrgangsordner in Google Drive gespeichert.', 2500))
        .catch(e => { console.warn('PDF-Kopie in Drive', e); ctx.toast('Kopie in Google Drive hat nicht geklappt. Das PDF selbst ist fertig.', 4000); });
    }
    const mobil = () => /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    async function teilen(file) {
      if (mobil() && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); return; }
        catch (e) {
          if (e && e.name === 'AbortError') return;
          // Safari erlaubt das Teilen nur direkt nach einem Tipp: dann über einen eigenen Knopf
          ctx.openModal('<h3>PDF ist fertig</h3><p class="modal-sub">' + esc(file.name) + '</p><div class="actions"><button class="btn-gray" data-m="close">Schließen</button><button class="btn-filled" id="pdfShare">Teilen</button></div>');
          $('#pdfShare').onclick = async () => { ctx.closeModal(); try { await navigator.share({ files: [file], title: file.name }); } catch (x) { if (!x || x.name !== 'AbortError') herunterladen(file); } };
          return;
        }
      }
      herunterladen(file);
    }
    function herunterladen(file) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    // Nur den Wochenbericht einer Woche als PDF (für den Vorgesetzten), ohne die Auswahl zu verändern
    async function wochenbericht(w) {
      const alt = JSON.stringify(st);
      st.modus = 'kurs'; st.woche = w; Object.keys(st.kurs).forEach(k => { st.kurs[k] = k === 'wochen'; });
      try { await erstellen(true); } finally { Object.assign(st, JSON.parse(alt)); }
    }
    return { bind, render, open, tab, wochenbericht, dokument: () => dokument(), laden, _st: st };
  };
})(typeof window !== 'undefined' ? window : globalThis);
