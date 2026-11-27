// LTR – „Testgruppe erstellen“: Auswahl über das Plus bei „Lehrgänge“ und die Seite zum Einstellen der Testgruppe
// (Schnellwahl des Stands, Schalter für vorbefüllte Teile, weitere Einstellungen). Die Daten erzeugt js/beispiel.js.
(function (global) {
  'use strict';
  global.BaumprojektTestgruppe = function (ctx) {
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const STAENDE = [
      ['start', 'Erster Tag', 'Nur Teams, noch nichts eingesprochen'],
      ['mitte', 'Mittendrin', 'Halbzeit, Protokolle bis gestern'],
      ['ende', 'Kurz vor Ende', 'Letzte Woche läuft, Berichte bis Vorwoche'],
      ['fertig', 'Abgeschlossen', 'Alles fertig, gut für PDF und Excel']
    ];
    const ICON = { start: '🌱', mitte: '🐾', ende: '📋', fertig: '🏁' };
    let st;
    function neu() { st = { stand: 'ende', teams: 5, wochen: 4, art: 'spuerhund', woche: 4, protokolle: true, luecken: false, belohnungen: true, wochenberichte: true, laufend: false, kopf: false, bewertungFehlt: false, teamOhne: false }; }
    function stand(id) {
      st.stand = id; const W = st.wochen;
      if (id === 'start') Object.assign(st, { woche: 1, protokolle: false, belohnungen: false, wochenberichte: false, laufend: false });
      if (id === 'mitte') Object.assign(st, { woche: Math.max(1, Math.ceil(W / 2)), protokolle: true, belohnungen: true, wochenberichte: true, laufend: false });
      if (id === 'ende') Object.assign(st, { woche: W, protokolle: true, belohnungen: true, wochenberichte: true, laufend: false });
      if (id === 'fertig') Object.assign(st, { woche: W + 1, protokolle: true, belohnungen: true, wochenberichte: true, laufend: true });
    }
    const wocheTxt = () => st.woche > st.wochen ? 'Abgeschlossen' : 'Woche ' + st.woche + ' von ' + st.wochen;
    function wbInfo() {
      if (!st.wochenberichte) return '';
      const bis = st.laufend ? Math.min(st.wochen, st.woche) : Math.min(st.wochen, st.woche - 1);
      return bis < 1 ? 'noch keine Woche vorbei' : bis === 1 ? 'Woche 1' : 'Woche 1 bis ' + bis;
    }
    const sw = (k, label, sub, aus) => '<label class="cell tg-row' + (aus ? ' tg-aus' : '') + '"><div class="cell-tx"><b>' + label + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><input type="checkbox" class="switch" data-k="' + k + '"' + (st[k] && !aus ? ' checked' : '') + (aus ? ' disabled' : '') + '></label>';
    const step = (k, label, wert, sub) => '<div class="cell tg-row"><div class="cell-tx"><b>' + label + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><div class="tg-step"><button type="button" data-step="' + k + '" data-d="-1" aria-label="weniger">−</button><b>' + wert + '</b><button type="button" data-step="' + k + '" data-d="1" aria-label="mehr">+</button></div></div>';
    const seg = (k, opts) => '<div class="segmented tg-seg">' + opts.map(([v, t]) => '<button type="button" data-seg="' + k + '" data-v="' + v + '" class="' + (String(st[k]) === String(v) ? 'on' : '') + '">' + t + '</button>').join('') + '</div>';
    function render() {
      const spuer = st.art === 'spuerhund';
      const weitere = $('#tgWeitere') && $('#tgWeitere').open;
      $('#tgBody').innerHTML =
        '<div class="section-h">Stand des Lehrgangs</div><div class="tg-tiles">' + STAENDE.map(([id, t, s]) => '<button type="button" class="tg-tile' + (st.stand === id ? ' on' : '') + '" data-stand="' + id + '"><span class="tg-ic">' + ICON[id] + '</span><b>' + t + '</b><span>' + s + '</span></button>').join('') + '</div>' +
        '<div class="section-h">Enthalten</div><div class="group">' +
        sw('protokolle', 'Tagesprotokolle', st.protokolle ? 'bis gestern, heute bleibt frei' : '') +
        sw('belohnungen', 'Belohnungen (Zähler)', spuer ? '' : 'nur bei Spürhund-Lehrgängen', !spuer) +
        sw('wochenberichte', 'Wochenberichte', wbInfo()) +
        sw('kopf', 'Kopfdaten (Dienststelle)', st.kopf ? (ctx.kopf().eigene ? 'aus deinen Einstellungen' : 'erfunden') : 'bleiben leer') +
        '</div>' +
        '<details class="group disclosure" id="tgWeitere"' + (weitere ? ' open' : '') + '><summary class="cell">Weitere Einstellungen</summary>' +
        step('teams', 'Teams', st.teams) +
        '<div class="cell tg-row"><div class="cell-tx"><b>Dauer</b></div>' + seg('wochen', [[4, '4 Wo.'], [10, '10 Wo.'], [6, '6 Wo.']]) + '</div>' +
        '<div class="cell tg-row"><div class="cell-tx"><b>Art</b></div>' + seg('art', [['', 'Allgemein'], ['spuerhund', 'Spürhund']]) + '</div>' +
        step('woche', 'Heute ist', wocheTxt()) +
        sw('luecken', 'Protokolle mit Lücken', 'einzelne Tage und Felder fehlen', !st.protokolle) +
        sw('laufend', 'Wochenbericht der laufenden Woche', 'schon vorgeschrieben', !st.wochenberichte) +
        sw('bewertungFehlt', 'Einzelne Bewertungen fehlen', '') +
        sw('teamOhne', 'Ein Team ganz ohne Notizen', '', st.teams < 2) +
        '</details>' +
        '<p class="group-foot">' + st.teams + ' Teams · ' + st.wochen + ' Wochen · ' + (spuer ? 'Spürhund' : 'Allgemein') + ' · ' + wocheTxt() + '. Alle Namen sind erfunden. Die Testgruppe liegt wie jeder Lehrgang in deinem Google Drive und lässt sich mit einem Tipp wieder löschen.</p>';
    }
    function klick(e) {
      const t = e.target.closest('[data-stand],[data-step],[data-seg]');
      if (!t) return;
      if (t.dataset.stand) stand(t.dataset.stand);
      if (t.dataset.step === 'teams') st.teams = Math.max(1, Math.min(12, st.teams + Number(t.dataset.d)));
      if (t.dataset.step === 'woche') { st.woche = Math.max(1, Math.min(st.wochen + 1, st.woche + Number(t.dataset.d))); st.stand = ''; }
      if (t.dataset.seg === 'wochen') { st.wochen = Number(t.dataset.v); if (st.stand) stand(st.stand); else st.woche = Math.min(st.woche, st.wochen + 1); }
      if (t.dataset.seg === 'art') st.art = t.dataset.v;
      render();
    }
    function schalter(e) {
      const k = e.target.dataset && e.target.dataset.k; if (!k) return;
      st[k] = e.target.checked;
      if (['protokolle', 'belohnungen', 'wochenberichte'].includes(k)) st.stand = '';
      render();
    }
    function oeffnen() {
      neu(); ctx.go('testgruppe'); render();
    }
    async function erstellen() {
      const namen = ctx.namen();
      let n = 1; while (namen.includes('Testgruppe ' + n)) n++;
      const k = st.kopf ? ctx.kopf() : null;
      const c = global.BaumprojektBeispiel(ctx.today(), ctx.trainer(), {
        titel: 'Testgruppe ' + n, teams: st.teams, wochen: st.wochen, art: st.art, woche: st.woche, startHeute: st.stand === 'start',
        protokolle: !st.protokolle ? 'keine' : st.luecken ? 'luecken' : 'bis', belohnungen: st.belohnungen,
        wochenberichte: !st.wochenberichte ? 'keine' : st.laufend ? 'alle' : 'vor', kopf: k, bewertungFehlt: st.bewertungFehlt, teamOhne: st.teamOhne
      });
      await ctx.anlegen(c);
    }
    // Auswahl beim Plus: Neuer Lehrgang, Testgruppe, geteilter Lehrgang (iOS-Aktionsblatt)
    function auswahl(eintraege) {
      let el = $('#tgAuswahl');
      if (!el) { el = document.createElement('div'); el.id = 'tgAuswahl'; el.className = 'tg-as'; document.body.appendChild(el); }
      el.innerHTML = '<div class="tg-as-box"><div class="tg-as-grp"><div class="tg-as-h">Was möchtest du anlegen?</div>' +
        eintraege.map(([t, s], i) => '<button type="button" data-i="' + i + '">' + esc(t) + '<small>' + esc(s) + '</small></button>').join('') +
        '</div><div class="tg-as-grp"><button type="button" class="tg-as-c" data-i="x">Abbrechen</button></div></div>';
      const zu = () => { el.classList.remove('offen'); };
      el.onclick = e => {
        const b = e.target.closest('button');
        if (!b && e.target !== el) return;
        zu(); if (b && b.dataset.i !== 'x') eintraege[Number(b.dataset.i)][2]();
      };
      requestAnimationFrame(() => el.classList.add('offen'));
    }
    if (!$('#tgBody')) return { oeffnen: () => location.reload(), auswahl: e => e[0][2]() }; // alte index.html im Cache: Start nicht abbrechen
    $('#tgBody').addEventListener('click', klick);
    $('#tgBody').addEventListener('change', schalter);
    $('#tgGo').addEventListener('click', erstellen);
    return { oeffnen, auswahl };
  };
})(typeof window !== 'undefined' ? window : globalThis);
