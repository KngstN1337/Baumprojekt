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
      ['zgtab', 'Zielgerüche-Tabelle', 'Belohnungen je Team und Tag', true],
      ['zgdia', 'Zielgerüche-Diagramme', 'Kreisdiagramm je Team', true]
    ];
    const AKTE = [
      ['stamm', 'Stammdaten', 'Hund, Behörde, Gesamteindruck'],
      ['zgdia', 'Zielgerüche-Diagramm', 'mit Tabelle je Geruch', true],
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
    const balken = text => ({ table: { widths: ['*'], body: [[{ text, bold: true, color: '#FFFFFF', fillColor: BLAU, margin: [2, 1, 2, 1] }]] }, layout: 'noBorders', margin: [0, 8, 0, 6] });
    const kopf = l => l.map(t => ({ text: t, style: 'th' }));
    // Liste mit blauer Kopfzeile (auf jeder Seite wiederholt), Zeilen grau/weiß, dicke blaue Linie vor jedem neuen Tag
    function liste(widths, body, neueTage) {
      const dick = new Set(neueTage || []);
      return {
        table: { headerRows: 1, widths, body, dontBreakRows: true },
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
        ...titel('LTR | Trainingsdokumentation', m.titel || '', true),
        kv([['Lehrgang', m.titel], ['Art', m.art === 'spuerhund' ? 'Spürhund' : 'Allgemein'], ['Zeitraum', WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(b)], ['Dauer', st.woche ? wocheText(st.woche) : wochen() + ' Wochen'],
          ['Trainer/in', m.trainer], ['Teams', String(teams().length)], ['Notizen', String(notizen().length)], ['Erstellt am', WBK.isoToDe(ctx.today())]], 2),
        balken('Inhalt dieses PDFs'),
        { ul: inhaltListe, margin: [6, 0, 0, 0] },
        balken('Hinweis'),
        { text: 'Erstellt mit LTR aus der Lehrgangsdatei in Google Drive. Nur dienstlich freigegebene Angaben weitergeben und die geltenden Datenschutz- und Aufbewahrungsvorgaben beachten.' }
      ];
    }
    function teamsBlatt() {
      const g = course().gesamt || {};
      const body = [kopf(['Team', 'Teilnehmer/in', 'Hund', 'Behörde', 'Rasse / Alter', 'Bemerkung', 'Gesamteindruck'])].concat(teams().map(t => [{ text: t.name, bold: true }, t.teilnehmer || '–', t.hund || '–', t.behoerde || '–', t.rasse || '–', t.bemerkung || '–', g[t.name] || '–']));
      return [...titel('Teamstammdaten', (course().meta.titel || '') + ' · ' + teams().length + ' Teams'), liste([95, 95, 70, 95, 75, '*', '*'], body)];
    }
    // Tagesprotokolle: eine Zeile je Team und Tag, Abschnitt (neue Seite) je Woche
    function tageBlatt(nurTeam) {
      const tl = teams().filter(t => !nurTeam || t.name === nurTeam), mitZg = spuer();
      const alle = notizen(nurTeam);
      if (!alle.length) return [...titel(nurTeam ? 'Tagesprotokolle' : 'Tagesprotokolle', zeitraumText()), leer('Im gewählten Zeitraum gibt es keine Notizen.')];
      const proWoche = new Map();
      alle.forEach(n => { const w = wocheVon(n.datum); if (!proWoche.has(w)) proWoche.set(w, []); proWoche.get(w).push(n); });
      const out = [];
      [...proWoche.keys()].sort((a, b) => a - b).forEach((w, wi) => {
        const ns = proWoche.get(w), tage = [...new Set(ns.map(n => n.datum))].sort();
        const head = nurTeam ? ['Datum', 'Notizen'] : ['Datum', 'Team', 'Notizen'];
        if (mitZg) head.push('Belohnungen');
        const body = [kopf(head)], neu = [];
        tage.forEach(d => {
          let erste = true;
          tl.forEach(t => {
            const l = ns.filter(n => n.datum === d && n.team === t.name); if (!l.length) return;
            if (erste) neu.push(body.length);
            const r = [{ text: erste || nurTeam ? deKurz(d) : '', bold: true }];
            if (!nurTeam) r.push({ text: teamLabel(t), bold: true });
            r.push(notizText(l));
            if (mitZg) { const z = stoffe().map(s => [s, zgSumme(t.name, s, d)]).filter(x => x[1]); r.push(z.length ? z.map(x => x[0] + ': ' + x[1]).join('\n') + '\nGesamt: ' + z.reduce((a, x) => a + x[1], 0) : '–'); }
            body.push(r); erste = false;
          });
        });
        const widths = nurTeam ? [62, '*'] : [62, 120, '*']; if (mitZg) widths.push(110);
        const unter = WBK.isoToDe(wocheStart(w)) + ' bis ' + WBK.isoToDe(WBK.addDays(wocheStart(w), 6)) + ' · eine Zeile je ' + (nurTeam ? 'Tag' : 'Team und Tag') + ' · dicke Linie bei jedem neuen Tag';
        const teil = [...titel('Tagesprotokolle · ' + wocheText(w) + (nurTeam ? ' · ' + nurTeam : ''), unter), liste(widths, body, neu)];
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
          : [...titel('Zielgerüche · ' + wocheText(w), 'Belohnungen je Team und Geruch an jedem Trainingstag · aus dem Zähler in der App'), liste(widths, body, neu)];
        out.push(...(wi && !nurTeam ? neueSeite(teil) : teil));
      });
      return out;
    }
    function zgDiagramme() {
      const tl = teams(), zeilen = [];
      for (let i = 0; i < tl.length; i += 2) zeilen.push({ columns: [dCard(tl[i], 170), tl[i + 1] ? dCard(tl[i + 1], 170) : { text: '' }], columnGap: 12 });
      return [...titel('Zielgerüche · Kreisdiagramme je Team', 'Anteil jedes Zielgeruchs an allen Belohnungen · ' + zeitraumText(), true), ...zeilen];
    }
    // Teilnehmerakte eines Teams
    function akte(teile) {
      const t = teams().find(x => x.name === st.team), m = course().meta, g = (course().gesamt || {})[t.name];
      const out = [...titel('Teilnehmerakte · ' + teamLabel(t), [teamUnter(t), m.titel, st.woche ? wocheText(st.woche) : 'alle Wochen'].filter(Boolean).join(' · '), true)];
      if (teile.includes('stamm')) out.push(balken('Stammdaten'), kv([['Team', t.name], ['Lehrgang', m.titel], ['Hundeführer/in', t.teilnehmer], ['Zeitraum', zeitraumText()], ['Diensthund', t.hund], ['Trainer/in', m.trainer], ['Behörde', t.behoerde], ['Notizen', String(notizen(t.name).length)], ['Rasse / Alter', t.rasse], ['Bemerkung', t.bemerkung]], 2),
        balken('Gesamteindruck'), g ? { text: g } : leer('Noch kein Gesamteindruck eingetragen (Spalte „Gesamteindruck“ in der Excel-Datei).'));
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
        const namen = { deckblatt: 'Deckblatt', teams: 'Teamstammdaten', tage: 'Tagesprotokolle', zgtab: 'Zielgerüche je Tag', zgdia: 'Zielgerüche-Diagramme' };
        teile.forEach((k, i) => {
          const teil = k === 'deckblatt' ? deckblatt(teile.filter(x => x !== 'deckblatt').map(x => namen[x]).concat(st.woche ? ['Zeitraum: ' + zeitraumText()] : [])) : k === 'teams' ? teamsBlatt() : k === 'tage' ? tageBlatt() : k === 'zgtab' ? zgTabelle() : zgDiagramme();
          inhalt.push(...(i ? neueSeite(teil) : teil));
        });
      }
      const erstellt = WBK.isoToDe(ctx.today());
      return {
        pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [34, 40, 34, 36],
        info: { title: dateiName().replace(/\.pdf$/, ''), creator: 'LTR', producer: 'LTR' },
        header: () => ({ columns: [{ text: 'LTR · Lehrgangsdokumentation' }, { text: kopfRechts, alignment: 'right' }], margin: [34, 16, 34, 0], fontSize: 7, color: '#777777' }),
        footer: (seite, von) => ({ columns: [{ text: 'Interne Dokumentation' }, { text: 'Seite ' + seite + ' von ' + von, alignment: 'center', bold: true, color: '#000000' }, { text: 'Erstellt am ' + erstellt, alignment: 'right' }], margin: [34, 10, 34, 0], fontSize: 7, color: '#777777' }),
        content: inhalt,
        styles: { h1: { fontSize: 15, bold: true, color: BLAU }, unter: { fontSize: 8, margin: [0, 2, 0, 0] }, th: { bold: true, color: '#FFFFFF', fontSize: 8.5 } },
        defaultStyle: { fontSize: 9, color: '#000000', lineHeight: 1.1 }
      };
    }
    const sauber = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    function dateiName() {
      const c = course(), d = ctx.today();
      const was = st.modus === 'akte' ? 'Teilnehmerakte ' + st.team : 'Lehrgang ' + (c.meta.titel || '');
      return sauber(was + (st.woche ? ' ' + st.woche + '. Woche' : '') + ' ' + d) + '.pdf';
    }

    async function erstellen() {
      if (!course() || !auswahl().length) return;
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

    return { bind, render, open, tab, dokument: () => dokument(), laden, _st: st };
  };
})(typeof window !== 'undefined' ? window : globalThis);
