// LTR – Wochenberichte: je Lehrgangswoche ein Bericht (Abschnitte 1–5 und je Team eine Zeile), von der KI aus den
// Tagesprotokollen vorgeschlagen, vom Trainer geprüft und geändert. Gespeichert als eigener Reiter „Wochenbericht KW nn“ in der Excel.
(function (global) {
  'use strict';
  global.BaumprojektWochen = function (ctx) {
    const WBK = global.BaumprojektWorkbook, S = global.BaumprojektServices;
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const TITEL = { inhalte: 'Ausbildungsinhalte / Schwerpunkte', ueberblick: 'Gesamtüberblick der Ausbilder', gesamt: 'Gesamtbewertung der Ausbildungsgruppe', hinweise: 'Hinweise für die Ausbildungsgruppe' };
    let woche = 0, entwurf = null, stand = '';
    const course = () => ctx.course();
    const start = w => WBK.addDays(course().meta.start, (w - 1) * 7);
    const wochen = () => Math.max(1, Number(course().meta.wochen) || 4);
    const teams = () => course().teams.map(t => Object.assign({}, t, { name: WBK.teamName(t) }));
    const notizenDerWoche = w => { const a = start(w), b = WBK.addDays(a, 6); return WBK.sortNotes(course().notes.filter(n => n.datum >= a && n.datum <= b)); };

    // ---------------- Liste der Wochen ----------------
    function renderListe() {
      const c = course(); if (!c) return;
      $('#wbSub').textContent = c.meta.titel || '';
      const wbs = c.wochenberichte || {};
      $('#wbList').innerHTML = Array.from({ length: wochen() }, (_, i) => {
        const w = i + 1, a = start(w), n = notizenDerWoche(w).length, da = !!wbs[w];
        return '<button type="button" class="cell" data-w="' + w + '"><div class="cell-tx"><b>' + w + '. Woche · KW ' + WBK.isoKW(a) + '</b><span>' + WBK.isoToDe(a).slice(0, 6) + ' bis ' + WBK.isoToDe(WBK.addDays(a, 6)) + ' · ' + n + (n === 1 ? ' Notiz' : ' Notizen') + '</span></div>' +
          '<span class="cell-st">' + (da ? 'Bericht da' : '<span class="muted">noch keiner</span>') + '</span><svg class="chev"><use href="#i-chev"/></svg></button>';
      }).join('');
    }
    function oeffnen(w) {
      woche = w;
      const vorhanden = (course().wochenberichte || {})[w];
      entwurf = JSON.parse(JSON.stringify(vorhanden || { abschnitte: {}, teams: {} }));
      ctx.go('woche'); renderEditor(); stand = JSON.stringify(lesen());
    }

    // ---------------- Bericht bearbeiten ----------------
    const feld = (key, label, wert, rows) => '<label class="wb-feld"><span>' + esc(label) + '</span><textarea class="wb-ta" data-f="' + key + '" rows="' + (rows || 2) + '">' + esc(wert || '') + '</textarea></label>';
    function renderEditor() {
      const a = start(woche), ab = entwurf.abschnitte || {};
      $('#wbTitle').textContent = woche + '. Woche';
      $('#wbWoSub').textContent = 'KW ' + WBK.isoKW(a) + ' · ' + WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(WBK.addDays(a, 6));
      const da = !!(course().wochenberichte || {})[woche];
      let h = '<div class="group">' + (da ? '<button type="button" class="cell link-cell" id="wbPdf">Wochenbericht als PDF …</button>' : '') + '<button type="button" class="cell link-cell" id="wbKi">' + (Object.values(ab).some(Boolean) ? 'Neu vorschlagen lassen' : 'Aus den Tagesprotokollen vorschlagen lassen') + '</button></div>';
      h += '<div class="section-h">Gruppe</div><div class="group">' + ['inhalte', 'ueberblick'].map(k => feld('a.' + k, TITEL[k], ab[k], 3)).join('') + '</div>';
      teams().forEach(t => {
        const tb = (entwurf.teams || {})[t.name] || {}, n = WBK.einheiten(course(), t.name, woche);
        h += '<div class="section-h">' + esc(t.name) + ' · ' + n + (n === 1 ? ' Tagesprotokoll' : ' Tagesprotokolle') + '</div><div class="group">' +
          WBK.WB_TEAM.map(([k, l]) => feld('t.' + t.name + '.' + k, l, tb[k], k === 'bewertung' ? 1 : 2)).join('') + '</div>';
      });
      h += '<div class="section-h">Abschluss</div><div class="group">' + ['gesamt', 'hinweise'].map(k => feld('a.' + k, TITEL[k], ab[k], 2)).join('') + '</div>';
      $('#wbBody').innerHTML = h;
      document.querySelectorAll('.wb-ta').forEach(groesse);
    }
    function groesse(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(44, ta.scrollHeight) + 'px'; }
    function lesen() {
      const b = { abschnitte: {}, teams: {} };
      document.querySelectorAll('#wbBody .wb-ta').forEach(ta => {
        const f = ta.dataset.f, v = ta.value.trim();
        if (f.startsWith('a.')) b.abschnitte[f.slice(2)] = v;
        else { const i = f.lastIndexOf('.'), team = f.slice(2, i), k = f.slice(i + 1); (b.teams[team] = b.teams[team] || {})[k] = v; }
      });
      return b;
    }
    const geaendert = () => !$('#v-woche').classList.contains('hidden') && JSON.stringify(lesen()) !== stand;

    async function vorschlagen() {
      if (!ctx.openaiKey()) return ctx.toast('Für den Vorschlag wird der OpenAI-Schlüssel gebraucht (Einstellungen).', 5000);
      const ns = notizenDerWoche(woche);
      if (!ns.length) return ctx.toast('In dieser Woche gibt es noch keine Notizen.', 4000);
      const jetzt = lesen();
      if ((Object.values(jetzt.abschnitte).some(Boolean) || Object.values(jetzt.teams).some(t => Object.values(t).some(Boolean))) &&
        !confirm('Der Vorschlag ersetzt den Text, der jetzt in den Feldern steht. Gespeichert wird erst mit „Sichern“. Weiter?')) return;
      // Tagesprotokolle der Woche als Text: je Tag und Team mit Spalten
      const F = WBK.FELDER, tl = teams();
      const zg = course().zg || [];
      let txt = 'Lehrgang: ' + (course().meta.titel || '') + ', ' + woche + '. Lehrgangswoche\nTeams: ' + tl.map(t => t.name + (t.behoerde ? ' (' + t.behoerde + ')' : '')).join('; ') + '\n\n';
      [...new Set(ns.map(n => n.datum))].sort().forEach(d => {
        txt += '## ' + WBK.weekday(d) + ' ' + WBK.isoToDe(d) + '\n';
        tl.forEach(t => {
          const l = ns.filter(n => n.datum === d && n.team === t.name); if (!l.length) return;
          txt += '### ' + t.name + '\n';
          l.forEach(n => { txt += n.felder ? F.map(([k, h]) => n.felder[k] ? h + ': ' + n.felder[k] : '').filter(Boolean).join('\n') + '\n' : n.text + '\n'; });
          const bel = zg.reduce((a, e) => a + (e.team === t.name && e.datum === d ? Number(e.anzahl) || 0 : 0), 0);
          if (bel) txt += 'Belohnungen: ' + bel + '\n';
        });
        txt += '\n';
      });
      ctx.busy('Schreibe den Vorschlag …');
      try {
        const r = await S.wochenbericht(txt, { key: ctx.openaiKey(), model: ctx.llmModel() });
        entwurf = { abschnitte: { inhalte: r.inhalte || '', ueberblick: r.ueberblick || '', gesamt: r.gesamt || '', hinweise: r.hinweise || '' }, teams: {} };
        (r.teams || []).forEach(x => { const t = tl.find(y => y.name === x.team); if (t) { const tb = {}; WBK.WB_TEAM.forEach(([k]) => { tb[k] = x[k] || ''; }); entwurf.teams[t.name] = tb; } });
        renderEditor();
        ctx.toast('Vorschlag fertig. Bitte prüfen und dann „Sichern“ tippen.', 4000);
      } catch (e) { ctx.toast('Vorschlag fehlgeschlagen: ' + e.message, 6000); }
      finally { ctx.busy(''); }
    }
    async function sichern() {
      const b = lesen(), w = woche;
      try {
        await ctx.withStore('Speichere Wochenbericht …', () => ctx.modifyCourse(c => { c.wochenberichte = c.wochenberichte || {}; c.wochenberichte[w] = b; },
          c => JSON.stringify(((c.wochenberichte || {})[w] || {}).abschnitte || {}) === JSON.stringify(b.abschnitte)));
        stand = JSON.stringify(b);
        ctx.toast('✓ Wochenbericht gespeichert (Excel-Reiter „Wochenbericht KW ' + WBK.isoKW(start(w)) + '“)', 3500);
        ctx.go('wochen');
      } catch (e) { /* gemeldet */ }
    }

    function bind() {
      $('#wbOpen').addEventListener('click', () => { if (!course()) return ctx.toast('Kein Lehrgang gewählt.'); ctx.go('wochen'); });
      $('#wbBack').addEventListener('click', () => ctx.go('lehrgang'));
      $('#wbList').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) oeffnen(Number(b.dataset.w)); });
      $('#wbWoBack').addEventListener('click', () => ctx.go('wochen'));
      $('#wbSave').addEventListener('click', sichern);
      $('#wbBody').addEventListener('click', async e => {
        if (e.target.closest('#wbKi')) vorschlagen();
        if (e.target.closest('#wbPdf')) { const w = woche; if (geaendert()) { await sichern(); if (geaendert()) return; } ctx.pdfWoche(w); }
      });
      $('#wbBody').addEventListener('input', e => { if (e.target.classList.contains('wb-ta')) groesse(e.target); });
    }
    return { bind, renderListe, geaendert, verwerfen: () => { stand = JSON.stringify(lesen()); }, speichern: sichern };
  };
})(typeof window !== 'undefined' ? window : globalThis);
