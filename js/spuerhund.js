// LTR – Spürhund-Lehrgänge: Zielgerüche, Belohnungszähler und Konditionierungsschritte.
// Alles dazu steht in dieser Datei (plus vordefiniert.js); app.js ruft nur die Funktionen unten auf.
// Daten: Bibliothek (eigene Gerüche und Vorlagen) in den Einstellungen im Google Drive des Nutzers,
// Stoffe/Schritte des Lehrgangs und jede Belohnung in der Excel-Datei des Lehrgangs (Blatt „Zielgerüche (Rohdaten)“).
// Tippen auf +1 speichert erst auf dem Gerät und schreibt dann gesammelt nach ein paar Sekunden in die Excel-Datei.
(function (global) {
  'use strict';
  global.BaumprojektSpuerhund = function (ctx) {
    const V = global.BaumprojektVordefiniert || { gerueche: [], geruchVorlagen: [], schrittVorlagen: [] };
    const WBK = global.BaumprojektWorkbook, S = global.BaumprojektServices;
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const lc = s => String(s || '').toLowerCase().trim();
    // Konditionierungsschritte sind ausgeblendet (Hendrik: zu unübersichtlich). Gespeicherte Schritt-Daten bleiben in der Excel erhalten.
    const MIT_SCHRITTEN = false;
    const st = ctx.settings;
    const CHEV = '<svg class="chev"><use href="#i-chev"/></svg>';
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const kurzDatum = iso => { const d = WBK.isoToDe(iso); return WBK.weekday(iso) + ' ' + d.slice(0, 6); };
    ['gerueche', 'geruchVorlagen', 'schrittVorlagen'].forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });

    // ---------------- Bibliothek ----------------
    // Jeder Geruch aus einer vordefinierten Vorlage gehört automatisch auch in die Geruchsliste (Gruppe „Weitere“, falls in keiner Gruppe)
    const vordefGruppen = () => {
      const gs = V.gerueche.map(g => ({ gruppe: g.gruppe, namen: g.namen.slice() })), drin = n => gs.some(g => g.namen.some(x => lc(x) === lc(n)));
      const rest = []; V.geruchVorlagen.forEach(v => v.stoffe.forEach(n => { if (!drin(n) && !rest.some(x => lc(x) === lc(n))) rest.push(n); }));
      if (rest.length) gs.push({ gruppe: 'Weitere', namen: rest });
      return gs;
    };
    const vordefGerueche = () => vordefGruppen().flatMap(g => g.namen);
    const alleGerueche = () => { const a = vordefGerueche(); st.gerueche.forEach(n => { if (!a.some(x => lc(x) === lc(n))) a.push(n); }); return a; };
    const geruchVorlagen = () => V.geruchVorlagen.map(v => ({ id: 'v:' + v.name, name: v.name, stoffe: v.stoffe, vordef: true })).concat(st.geruchVorlagen);
    const schrittVorlagen = () => V.schrittVorlagen.map(v => ({ id: 'v:' + v.name, name: v.name, schritte: v.schritte, vordef: true })).concat(st.schrittVorlagen);
    function speichern() { ctx.saveSettings(); renderEinst(); }
    function geruchMerken(name) { if (!alleGerueche().some(x => lc(x) === lc(name))) { st.gerueche.push(name); st.gerueche.sort((a, b) => a.localeCompare(b, 'de')); return true; } return false; }

    function renderEinst() {
      const c1 = $('#zgCount'), c2 = MIT_SCHRITTEN && $('#svCount');
      if (c1) c1.textContent = alleGerueche().length + ' · ' + geruchVorlagen().length + ' Vorlagen';
      if (c2) c2.textContent = schrittVorlagen().length + ' Vorlagen';
    }

    // Seite „Zielgerüche“: Alle Gerüche | Vorlagen
    let zgTab = 'g';
    function renderGerueche() {
      $('#zgSeg').innerHTML = [['g', 'Alle Gerüche'], ['v', 'Vorlagen']].map(([k, t]) => '<button type="button" data-tab="' + k + '"' + (k === zgTab ? ' class="on"' : '') + '>' + t + '</button>').join('');
      ctx.show('#zgPanelG', zgTab === 'g'); ctx.show('#zgPanelV', zgTab === 'v');
      $('#zgVordef').innerHTML = vordefGruppen().map(g => '<div class="section-h">' + esc(g.gruppe) + ' · vordefiniert</div><div class="group">' +
        g.namen.map(n => '<div class="cell"><div class="cell-tx"><b>' + esc(n) + '</b></div></div>').join('') + '</div>').join('');
      $('#zgEigene').innerHTML = st.gerueche.map((n, i) => '<button type="button" class="cell" data-eg="' + i + '"><div class="cell-tx"><b>' + esc(n) + '</b></div>' + CHEV + '</button>').join('') || '<div class="empty">Noch keine eigenen Gerüche.</div>';
      const zeile = v => '<button type="button" class="cell" data-gv="' + esc(v.id) + '"><div class="cell-tx"><b>' + esc(v.name) + '</b><span>' + esc(v.stoffe.join(', ') || 'keine Stoffe') + '</span></div>' + CHEV + '</button>';
      $('#gvVordef').innerHTML = geruchVorlagen().filter(v => v.vordef).map(zeile).join('') || '<div class="empty">Keine.</div>';
      $('#gvEigene').innerHTML = st.geruchVorlagen.map(zeile).join('') + '<button type="button" class="cell link-cell" data-gv="neu">Neue Vorlage</button>';
      renderEinst();
    }
    function geruchHinzufuegen(ev) {
      ev.preventDefault();
      const n = $('#zgNeu').value.trim(); if (!n) return;
      if (geruchMerken(n)) { speichern(); ctx.toast('✓ „' + n + '“ hinzugefügt', 1500); } else ctx.toast('„' + n + '“ gibt es schon.');
      $('#zgNeu').value = ''; $('#zgNeu').focus(); renderGerueche();
    }
    function eigenerGeruch(i) {
      const alt = st.gerueche[i]; if (alt == null) return;
      ctx.openModal('<h3>Geruch</h3><div class="group form m-group"><label class="field"><span>Name</span><input id="egN" value="' + esc(alt) + '" autocomplete="off"></label></div>' +
        '<p class="modal-foot">Umbenennen ändert laufende Lehrgänge nicht.</p>' +
        '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="egOk">Sichern</button></div><button class="danger" id="egDel">Geruch löschen</button>');
      $('#egOk').onclick = () => {
        const n = $('#egN').value.trim(); if (!n) return;
        st.gerueche[i] = n; st.geruchVorlagen.forEach(v => { v.stoffe = v.stoffe.map(s => s === alt ? n : s); });
        speichern(); ctx.closeModal(); renderGerueche();
      };
      $('#egDel').onclick = () => {
        if (!confirm('„' + alt + '“ löschen? Er verschwindet auch aus deinen Vorlagen. Laufende Lehrgänge behalten ihn.')) return;
        st.gerueche.splice(i, 1); st.geruchVorlagen.forEach(v => { v.stoffe = v.stoffe.filter(s => s !== alt); });
        speichern(); ctx.closeModal(); renderGerueche();
      };
    }
    // Vorlage ansehen (vordefiniert: nur kopieren) oder bearbeiten (eigene)
    function geruchVorlage(id) {
      const v = id === 'neu' ? { id: 'e:' + uid(), name: '', stoffe: [] } : geruchVorlagen().find(x => x.id === id); if (!v) return;
      if (v.vordef) {
        ctx.openModal('<h3>' + esc(v.name) + '</h3><p class="modal-sub">Vordefinierte Vorlage</p><div class="group m-group">' + v.stoffe.map(s => '<div class="cell"><div class="cell-tx"><b>' + esc(s) + '</b></div></div>').join('') + '</div>' +
          '<p class="modal-foot">Vordefinierte Vorlagen kannst du nicht ändern. Kopiere sie, dann kannst du die Kopie anpassen.</p><div class="actions"><button class="btn-gray" data-m="close">Schließen</button><button class="btn-filled" id="gvCopy">Als eigene kopieren</button></div>');
        $('#gvCopy').onclick = () => { const k = { id: 'e:' + uid(), name: v.name + ' (eigene)', stoffe: v.stoffe.slice() }; st.geruchVorlagen.push(k); speichern(); renderGerueche(); geruchVorlage(k.id); };
        return;
      }
      let gewaehlt = v.stoffe.slice();
      const liste = () => { const a = alleGerueche(); gewaehlt.forEach(s => { if (!a.includes(s)) a.push(s); }); return a; };
      const male = () => {
        $('#gvList').innerHTML = liste().map(s => '<label class="cell"><div class="cell-tx"><b>' + esc(s) + '</b></div><input type="checkbox" class="switch" data-s="' + esc(s) + '"' + (gewaehlt.includes(s) ? ' checked' : '') + '></label>').join('');
        $('#gvAnz').textContent = 'Stoffe in dieser Vorlage · ' + gewaehlt.length;
      };
      ctx.openModal('<h3>' + (v.name ? 'Vorlage bearbeiten' : 'Neue Vorlage') + '</h3><div class="group form m-group"><label class="field"><span>Name</span><input id="gvN" value="' + esc(v.name) + '" placeholder="z. B. Mein Lehrgang" autocomplete="off"></label></div>' +
        '<div class="section-h" id="gvAnz"></div><div class="group m-group" id="gvList"></div>' +
        '<div class="group form m-group"><label class="field"><span>Neuer Geruch</span><input id="gvNeu" placeholder="z. B. Semtex" autocomplete="off" enterkeyhint="done"></label><button type="button" class="cell link-cell" id="gvAdd">Hinzufügen</button></div>' +
        '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="gvOk">Sichern</button></div>' + (id !== 'neu' ? '<button class="danger" id="gvDel">Vorlage löschen</button>' : ''));
      male();
      $('#gvList').onchange = e => { const s = e.target.dataset.s; if (s == null) return; gewaehlt = e.target.checked ? gewaehlt.concat(s) : gewaehlt.filter(x => x !== s); male(); };
      const add = () => { const n = $('#gvNeu').value.trim(); if (!n) return; geruchMerken(n); const echt = alleGerueche().find(x => lc(x) === lc(n)) || n; if (!gewaehlt.includes(echt)) gewaehlt.push(echt); $('#gvNeu').value = ''; male(); };
      $('#gvAdd').onclick = add;
      $('#gvNeu').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      $('#gvOk').onclick = () => {
        const name = $('#gvN').value.trim(); if (!name) { ctx.toast('Bitte einen Namen eintragen.'); $('#gvN').focus(); return; }
        const neu = { id: v.id, name, stoffe: liste().filter(s => gewaehlt.includes(s)) };
        const i = st.geruchVorlagen.findIndex(x => x.id === v.id);
        if (i >= 0) st.geruchVorlagen[i] = neu; else st.geruchVorlagen.push(neu);
        speichern(); ctx.closeModal(); renderGerueche(); ctx.toast('✓ Vorlage gespeichert');
      };
      if ($('#gvDel')) $('#gvDel').onclick = () => { if (!confirm('Vorlage „' + v.name + '“ löschen? Laufende Lehrgänge behalten ihre Stoffe.')) return; st.geruchVorlagen = st.geruchVorlagen.filter(x => x.id !== v.id); speichern(); ctx.closeModal(); renderGerueche(); };
    }

    // Seite „Konditionierungsschritte“: Vorlagen mit beschrifteten Schritten
    function renderSchritte() {
      const zeile = v => '<button type="button" class="cell" data-sv="' + esc(v.id) + '"><div class="cell-tx"><b>' + esc(v.name) + '</b><span>' + v.schritte.length + ' Schritte · ' + esc(v.schritte.map(s => s.name).join(' → ')) + '</span></div>' + CHEV + '</button>';
      $('#svVordef').innerHTML = schrittVorlagen().filter(v => v.vordef).map(zeile).join('') || '<div class="empty">Keine.</div>';
      $('#svEigene').innerHTML = st.schrittVorlagen.map(zeile).join('') + '<button type="button" class="cell link-cell" data-sv="neu">Neue Vorlage</button>';
      renderEinst();
    }
    function schrittVorlage(id) {
      const v = id === 'neu' ? { id: 'e:' + uid(), name: '', schritte: [{ name: '', beschr: '' }, { name: '', beschr: '' }, { name: '', beschr: '' }, { name: '', beschr: '' }] } : schrittVorlagen().find(x => x.id === id); if (!v) return;
      const liste = s => s.map((x, i) => '<div class="cell"><div class="avatar zg-nr">' + (i + 1) + '</div><div class="cell-tx wrap"><b>' + esc(x.name || 'Schritt ' + (i + 1)) + '</b>' + (x.beschr ? '<span>' + esc(x.beschr) + '</span>' : '') + '</div></div>').join('');
      if (v.vordef) {
        ctx.openModal('<h3>' + esc(v.name) + '</h3><p class="modal-sub">Vordefinierte Vorlage</p><div class="group m-group">' + liste(v.schritte) + '</div>' +
          '<p class="modal-foot">Vordefinierte Vorlagen kannst du nicht ändern. Kopiere sie, dann kannst du die Schritte selbst beschriften.</p><div class="actions"><button class="btn-gray" data-m="close">Schließen</button><button class="btn-filled" id="svCopy">Als eigene kopieren</button></div>');
        $('#svCopy').onclick = () => { const k = { id: 'e:' + uid(), name: v.name + ' (eigene)', schritte: v.schritte.map(x => ({ name: x.name, beschr: x.beschr || '' })) }; st.schrittVorlagen.push(k); speichern(); renderSchritte(); schrittVorlage(k.id); };
        return;
      }
      let sch = v.schritte.map(x => ({ name: x.name, beschr: x.beschr || '' }));
      const lesen = () => { document.querySelectorAll('#svRows [data-i]').forEach(el => { sch[Number(el.dataset.i)][el.dataset.k] = el.value; }); };
      const male = () => {
        $('#svRows').innerHTML = sch.map((x, i) => '<div class="section-h zg-sh">Schritt ' + (i + 1) +
          '<span><button type="button" class="text-btn" data-mv="' + i + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="nach oben">↑</button><button type="button" class="text-btn" data-mv="' + i + '" data-d="1"' + (i < sch.length - 1 ? '' : ' disabled') + ' aria-label="nach unten">↓</button><button type="button" class="text-btn danger-text" data-rm="' + i + '" aria-label="Schritt löschen">Löschen</button></span></div>' +
          '<div class="group form m-group"><label class="field"><span>Name</span><input data-i="' + i + '" data-k="name" value="' + esc(x.name) + '" placeholder="z. B. Prägung am Stoff" autocomplete="off"></label>' +
          '<label class="field"><span>Beschreibung</span><input data-i="' + i + '" data-k="beschr" value="' + esc(x.beschr) + '" placeholder="optional" autocomplete="off"></label></div>').join('');
      };
      ctx.openModal('<h3>' + (v.name ? 'Schritte beschriften' : 'Neue Schritt-Vorlage') + '</h3><div class="group form m-group"><label class="field"><span>Vorlage</span><input id="svN" value="' + esc(v.name) + '" placeholder="z. B. Meine Schritte" autocomplete="off"></label></div>' +
        '<div id="svRows"></div><div class="group m-group"><button type="button" class="cell link-cell" id="svAdd">Schritt hinzufügen</button></div>' +
        '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="svOk">Sichern</button></div>' + (id !== 'neu' ? '<button class="danger" id="svDel">Vorlage löschen</button>' : ''));
      male();
      $('#svRows').onclick = e => {
        const mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]');
        if (!mv && !rm) return;
        lesen();
        if (mv) { const i = Number(mv.dataset.mv), j = i + Number(mv.dataset.d); [sch[i], sch[j]] = [sch[j], sch[i]]; }
        if (rm) { if (sch.length < 2) return ctx.toast('Mindestens ein Schritt.'); sch.splice(Number(rm.dataset.rm), 1); }
        male();
      };
      $('#svAdd').onclick = () => { lesen(); sch.push({ name: '', beschr: '' }); male(); const ins = document.querySelectorAll('#svRows input[data-k=name]'); ins[ins.length - 1].focus(); };
      $('#svOk').onclick = () => {
        lesen();
        const name = $('#svN').value.trim(); if (!name) { ctx.toast('Bitte einen Namen für die Vorlage eintragen.'); $('#svN').focus(); return; }
        const neu = { id: v.id, name, schritte: sch.map((x, i) => ({ name: x.name.trim() || 'Schritt ' + (i + 1), beschr: x.beschr.trim() })) };
        const i = st.schrittVorlagen.findIndex(x => x.id === v.id);
        if (i >= 0) st.schrittVorlagen[i] = neu; else st.schrittVorlagen.push(neu);
        speichern(); ctx.closeModal(); renderSchritte(); ctx.toast('✓ Vorlage gespeichert');
      };
      if ($('#svDel')) $('#svDel').onclick = () => { if (!confirm('Vorlage „' + v.name + '“ löschen? Laufende Lehrgänge behalten ihre Schritte.')) return; st.schrittVorlagen = st.schrittVorlagen.filter(x => x.id !== v.id); speichern(); ctx.closeModal(); renderSchritte(); };
    }

    // ---------------- Lehrgang anlegen / bearbeiten ----------------
    let form = null; // { art, gv, sv, stoffe, schritte }
    function fillForm(c) {
      const m = (c && c.meta) || {}, sp = (c && c.spuer) || { stoffe: [], schritte: [] };
      const gv = geruchVorlagen().find(v => v.name === m.geruchVorlage), sv = schrittVorlagen().find(v => v.name === m.schrittVorlage);
      form = { art: m.art || '', gv: gv ? gv.id : '', sv: sv ? sv.id : '', svName: m.schrittVorlage || '', stoffe: sp.stoffe.slice(), schritte: sp.schritte.map(x => ({ ...x })) };
      // Neuer Lehrgang: erste Schritt-Vorlage vorschlagen
      if (!c && MIT_SCHRITTEN) { const s0 = schrittVorlagen()[0]; if (s0) { form.sv = s0.id; form.svName = s0.name; form.schritte = s0.schritte.map(x => ({ ...x })); } }
      renderForm();
    }
    function renderForm() {
      if (!form) return;
      document.querySelectorAll('#courseForm input[name=art]').forEach(r => { r.checked = r.value === form.art; });
      ctx.show('#spuerBox', form.art === 'spuerhund');
      const opt = (list, sel, leer) => '<option value=""' + (sel ? '' : ' selected') + '>' + leer + '</option>' +
        ['Vordefiniert', 'Meine Vorlagen'].map((g, k) => { const l = list.filter(v => !!v.vordef === !k); return l.length ? '<optgroup label="' + g + '">' + l.map(v => '<option value="' + esc(v.id) + '"' + (v.id === sel ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('') + '</optgroup>' : ''; }).join('');
      const gv = geruchVorlagen().find(v => v.id === form.gv);
      $('#gvSel').innerHTML = opt(geruchVorlagen(), form.gv, 'Keine Vorlage');
      $('#gvName').textContent = gv ? gv.name : 'Keine Vorlage';
      $('#gvInfo').textContent = form.stoffe.length + (form.stoffe.length === 1 ? ' Geruch' : ' Gerüche');
      $('#formStoffe').innerHTML = form.stoffe.map((s, i) => '<div class="cell"><div class="cell-tx"><b>' + esc(s) + '</b></div><button type="button" class="rm" data-rmst="' + i + '" aria-label="' + esc(s) + ' entfernen">⊖</button></div>').join('') +
        '<button type="button" class="cell link-cell" id="addStoff">Geruch hinzufügen</button>';
      if (!$('#svSel')) return;
      $('#svSel').innerHTML = opt(schrittVorlagen(), form.sv, 'Keine Vorlage');
      $('#svName').textContent = form.svName || 'Keine Vorlage';
      $('#svInfo').textContent = form.schritte.length ? form.schritte.length + (form.schritte.length === 1 ? ' Schritt' : ' Schritte') : 'Ohne Schritte wird nur gezählt';
      $('#formSchritte').innerHTML = form.schritte.map((x, i) => '<div class="cell"><div class="avatar zg-nr">' + (i + 1) + '</div><div class="cell-tx wrap"><b>' + esc(x.name) + '</b>' + (x.beschr ? '<span>' + esc(x.beschr) + '</span>' : '') + '</div><button type="button" class="rm" data-rmsch="' + i + '" aria-label="Schritt ' + (i + 1) + ' entfernen">⊖</button></div>').join('') +
        '<button type="button" class="cell link-cell" id="addSchritt">Schritt hinzufügen</button>';
    }
    function formChange(e) {
      if (!form) return false;
      const t = e.target;
      if (t.name === 'art') { form.art = t.value; renderForm(); return true; }
      if (t.id === 'gvSel') {
        const v = geruchVorlagen().find(x => x.id === t.value);
        if (v && form.stoffe.length && !form.stoffe.every(s => v.stoffe.includes(s)) && !confirm('Die Gerüche dieses Lehrgangs durch die Vorlage „' + v.name + '“ ersetzen?\n\nBereits gezählte Belohnungen bleiben erhalten.')) { renderForm(); return true; }
        form.gv = t.value; if (v) form.stoffe = v.stoffe.slice(); renderForm(); return true;
      }
      if (t.id === 'svSel') {
        const v = schrittVorlagen().find(x => x.id === t.value);
        form.sv = t.value; form.svName = v ? v.name : ''; form.schritte = v ? v.schritte.map(x => ({ name: x.name, beschr: x.beschr || '' })) : []; renderForm(); return true;
      }
      return false;
    }
    function formClick(e) {
      if (!form) return false;
      const rm = e.target.closest('[data-rmst]');
      if (rm) { form.stoffe.splice(Number(rm.dataset.rmst), 1); renderForm(); return true; }
      if (e.target.id === 'addStoff') { stoffWaehlen(); return true; }
      const rs = e.target.closest('[data-rmsch]');
      if (rs) { form.schritte.splice(Number(rs.dataset.rmsch), 1); renderForm(); return true; }
      if (e.target.id === 'addSchritt') { schrittNeu(); return true; }
      return false;
    }
    // Geruch zum Lehrgang hinzufügen: aus der Bibliothek antippen oder neu eintippen. Danach Rückfrage „Nur hier / In Vorlage“.
    function stoffWaehlen() {
      const frei = alleGerueche().filter(s => !form.stoffe.includes(s));
      ctx.openModal('<h3>Geruch hinzufügen</h3><div class="group form m-group"><label class="field"><span>Neuer Geruch</span><input id="asNeu" placeholder="z. B. Sprengschnur" autocomplete="off" enterkeyhint="done"></label><button type="button" class="cell link-cell" id="asOk">Hinzufügen</button></div>' +
        (frei.length ? '<div class="section-h">Aus der Liste</div><div class="group m-group" id="asList">' + frei.map(s => '<button type="button" class="cell" data-as="' + esc(s) + '"><div class="cell-tx"><b>' + esc(s) + '</b></div></button>').join('') + '</div>' : '') +
        '<div class="actions"><button class="btn-gray" data-m="close">Fertig</button></div>');
      const nimm = name => {
        name = name.trim(); if (!name) return;
        const neu = geruchMerken(name); if (neu) ctx.saveSettings();
        const echt = alleGerueche().find(x => lc(x) === lc(name)) || name;
        if (!form.stoffe.includes(echt)) form.stoffe.push(echt);
        renderForm(); ctx.closeModal();
        const v = st.geruchVorlagen.find(x => x.id === form.gv);
        if (v && !v.stoffe.includes(echt)) {
          ctx.openModal('<h3>„' + esc(echt) + '“ hinzugefügt</h3><p class="modal-sub">Auch in der Vorlage „' + esc(v.name) + '“ speichern? Dann ist er beim nächsten Lehrgang gleich dabei.</p><div class="actions"><button class="btn-gray" data-m="close">Nur hier</button><button class="btn-filled" id="inV">In Vorlage</button></div>');
          $('#inV').onclick = () => { v.stoffe.push(echt); speichern(); ctx.closeModal(); ctx.toast('✓ Auch in der Vorlage gespeichert'); };
        } else ctx.toast('✓ „' + echt + '“ hinzugefügt' + (neu ? ' (und unter Einstellungen → Zielgerüche gemerkt)' : ''), 2500);
      };
      $('#asOk').onclick = () => nimm($('#asNeu').value);
      $('#asNeu').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nimm($('#asNeu').value); } };
      if ($('#asList')) $('#asList').onclick = e => { const b = e.target.closest('[data-as]'); if (b) nimm(b.dataset.as); };
    }
    // Schritt nur für diesen Lehrgang hinzufügen
    function schrittNeu() {
      ctx.openModal('<h3>Schritt ' + (form.schritte.length + 1) + '</h3><div class="group form m-group"><label class="field"><span>Name</span><input id="snN" placeholder="z. B. Reagenzglas, Zielgeruch" autocomplete="off"></label>' +
        '<label class="field"><span>Beschreibung</span><input id="snB" placeholder="optional" autocomplete="off"></label></div>' +
        '<p class="modal-foot">Gilt nur für diesen Lehrgang. Vorlagen änderst du unter Einstellungen → Spürhund.</p><div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="snOk">Hinzufügen</button></div>');
      setTimeout(() => $('#snN').focus(), 60);
      $('#snOk').onclick = () => { const n = $('#snN').value.trim(); if (!n) { $('#snN').focus(); return; } form.schritte.push({ name: n, beschr: $('#snB').value.trim() }); ctx.closeModal(); renderForm(); };
    }
    // Für submitCourse: Angaben, die in meta und course.spuer gehören
    function readForm() {
      if (!form || form.art !== 'spuerhund') return { meta: { art: form && form.art ? form.art : '' }, spuer: null };
      const gv = geruchVorlagen().find(v => v.id === form.gv);
      return { meta: { art: 'spuerhund', geruchVorlage: gv ? gv.name : '', schrittVorlage: form.svName || '' }, spuer: { stoffe: form.stoffe.slice(), schritte: form.schritte.map(x => ({ ...x })) } };
    }

    // ---------------- Zählen ----------------
    let pending = [];
    const PKEY = 'zg:pending';
    S.KV.get(PKEY).then(p => { if (Array.isArray(p)) { pending = p.concat(pending); renderAll(); planFlush(1000); } });
    const eintraege = () => {
      const c = ctx.course(); if (!c) return [];
      const zg = c.zg || [], ids = new Set(zg.map(e => e.id).filter(Boolean));
      return zg.concat(pending.filter(e => e.courseId === ctx.activeId() && !ids.has(e.id)));
    };
    const heute = (team, stoff) => WBK.zgSumme(eintraege(), team, stoff, ctx.selDate());
    const gesamt = (team, stoff) => WBK.zgSumme(eintraege(), team, stoff);
    const schritt = (team, stoff) => WBK.zgSchritt(eintraege(), team, stoff);
    function eintragen(team, stoff, anzahl, schrittNr) {
      if (!ctx.course()) return;
      pending.push({ id: uid(), courseId: ctx.activeId(), datum: ctx.selDate(), uhrzeit: nowTime(), team, stoff, anzahl: anzahl == null ? '' : anzahl, schritt: schrittNr == null ? '' : schrittNr, von: ctx.myName() });
      S.KV.set(PKEY, pending);
      renderAll(); planFlush(4000);
    }
    let flushTimer = 0, flushing = false, fehlerGemeldet = false;
    function planFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
    // Gesammelte Einträge in die Excel-Datei schreiben (ohne Warte-Anzeige, damit man weiterzählen kann)
    async function flush() {
      if (flushing) return planFlush(2000);
      const id = ctx.activeId();
      const batch = pending.filter(e => e.courseId === id);
      if (!batch.length || !S.Drive.connected() || !navigator.onLine) { renderStatus(); if (batch.length) planFlush(30000); return; }
      flushing = true; renderStatus();
      // Viele +1 hintereinander werden zu einer Zeile je Team, Stoff und Tag zusammengefasst (Schrittwechsel bleiben einzeln)
      const rows = [], sum = {};
      batch.forEach(e => {
        const r = { id: e.id, datum: e.datum, uhrzeit: e.uhrzeit, team: e.team, stoff: e.stoff, anzahl: e.anzahl, schritt: e.schritt, von: e.von };
        if (e.schritt !== '') { rows.push(r); return; }
        const k = e.datum + '|' + e.team + '|' + e.stoff;
        if (sum[k]) { sum[k].anzahl += Number(e.anzahl) || 0; sum[k].uhrzeit = e.uhrzeit; } else { sum[k] = r; r.anzahl = Number(e.anzahl) || 0; rows.push(r); }
      });
      const zeilen = rows.filter(r => r.schritt !== '' || r.anzahl);
      try {
        await ctx.modifyCourse(c => { c.zg = c.zg || []; zeilen.forEach(r => { if (!c.zg.some(x => x.id === r.id)) c.zg.push(Object.assign({}, r)); }); },
          c => zeilen.every(r => (c.zg || []).some(x => x.id === r.id)));
        const fertig = new Set(batch.map(e => e.id));
        pending = pending.filter(e => !fertig.has(e.id)); await S.KV.set(PKEY, pending);
        fehlerGemeldet = false;
      } catch (e) {
        console.warn('Zielgerüche später erneut speichern', e);
        if (!fehlerGemeldet) { fehlerGemeldet = true; ctx.toast('Zählerstand ist auf dem Handy gesichert und wird gespeichert, sobald Google Drive erreichbar ist.', 5000); }
        planFlush(30000);
      } finally { flushing = false; renderAll(); }
      if (pending.some(e => e.courseId === id)) planFlush(3000);
    }
    function renderStatus() {
      const n = pending.filter(e => e.courseId === ctx.activeId()).length;
      // Nur zeigen, wenn das Speichern gerade nicht klappt (sonst passiert es nach ein paar Sekunden von selbst)
      const zeigen = n && (fehlerGemeldet || !navigator.onLine);
      document.querySelectorAll('.zg-status').forEach(el => { el.textContent = zeigen ? n + (n > 1 ? ' Einträge warten' : ' Eintrag wartet') + ' auf das Speichern in Google Drive (auf dem Handy gesichert).' : ''; });
    }

    // ---------------- Akte (Team-Seite) ----------------
    const istSpuer = () => { const c = ctx.course(); return !!(c && c.meta && c.meta.art === 'spuerhund'); };
    const stoffe = () => { const c = ctx.course(); return (c && c.spuer && c.spuer.stoffe) || []; };
    const schritte = () => { const c = ctx.course(); return (MIT_SCHRITTEN && c && c.spuer && c.spuer.schritte) || []; };
    const punkte = n => schritte().length ? '<span class="zg-dots" aria-label="Schritt ' + n + ' von ' + schritte().length + '">' + schritte().map((_, i) => '<i' + (i < n ? ' class="on"' : '') + '></i>').join('') + '</span>' : '';
    const schrittText = n => schritte().length && n ? 'Schritt ' + n + (schritte()[n - 1] && schritte()[n - 1].name !== 'Schritt ' + n ? ' · ' + schritte()[n - 1].name : '') : '';
    // Donut: Anteil jedes Stoffs an allen Belohnungen, feste Farbe je Stoff (Reihenfolge im Lehrgang)
    const FARBEN = 8;
    const farbe = s => { const i = stoffe().indexOf(s); return i >= 0 && i < FARBEN ? 'var(--zg' + (i + 1) + ')' : 'var(--zg-x)'; };
    const balken = (team, s) => { const m = Math.max(1, ...stoffe().map(x => gesamt(team, x))); return Math.round(gesamt(team, s) / m * 100); };
    function donut(team) {
      if (!stoffe().length) return '';
      const werte = stoffe().map(s => [s, gesamt(team, s)]), sum = werte.reduce((a, w) => a + w[1], 0);
      const r = 62, U = 2 * Math.PI * r, luecke = werte.filter(w => w[1]).length > 1 ? 2.5 : 0;
      let off = 0, ringe = '';
      if (sum) werte.forEach(([s, v]) => { if (!v) return; const l = U * v / sum; ringe += '<circle r="' + r + '" cx="80" cy="80" fill="none" stroke="' + farbe(s) + '" stroke-width="18" stroke-dasharray="' + Math.max(l - luecke, 0.5).toFixed(1) + ' ' + U.toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '" transform="rotate(-90 80 80)"><title>' + esc(s) + ': ' + v + '</title></circle>'; off += l; });
      const sumH = stoffe().reduce((a, s) => a + heute(team, s), 0);
      return '<div class="zg-donut"><svg viewBox="0 0 160 160" role="img" aria-label="' + sum + ' Belohnungen gesamt"><circle r="' + r + '" cx="80" cy="80" fill="none" stroke="var(--fill)" stroke-width="18"/>' + ringe +
        '<text x="80" y="82" text-anchor="middle" class="zg-donut-n">' + sum + '</text><text x="80" y="103" text-anchor="middle" class="zg-donut-l">Belohnungen</text></svg>' +
        '<div class="zg-donut-h">' + (ctx.selDate() === ctx.today() ? 'heute' : WBK.isoToDe(ctx.selDate()).slice(0, 6)) + ' +' + sumH + '</div>' + undoKnopf(team) + '</div>';
    }
    // Rückgängig in der Schnellübersicht: merkt sich die letzten +1 (je Team, nur in dieser Sitzung)
    const zuletzt = [];
    const meinUndo = team => { for (let i = zuletzt.length - 1; i >= 0; i--) { const u = zuletzt[i]; if (u.team === team && u.courseId === ctx.activeId() && u.datum === ctx.selDate()) return i; } return -1; };
    function rueckgaengig() {
      const team = ctx.currentTeam(), i = meinUndo(team); if (i < 0) return;
      const u = zuletzt.splice(i, 1)[0];
      if (heute(team, u.stoff) > 0) { eintragen(team, u.stoff, -1); ctx.toast('−1 bei ' + u.stoff, 1500); } else renderAll();
    }
    function undoKnopf(team) {
      const i = meinUndo(team), u = zuletzt[i];
      return '<button type="button" class="zg-undo" id="zgUndo"' + (u ? '' : ' hidden') + '><svg><use href="#i-back"/></svg>Rückgängig' + (u ? ': ' + esc(u.stoff) + ' +1' : '') + '</button>';
    }
    function renderTeam() {
      const box = $('#zgBox'), link = $('#zgLink'); if (!box) return;
      const team = ctx.currentTeam();
      if (!istSpuer() || !team) { box.innerHTML = ''; if (link) link.innerHTML = ''; return; }
      // Akte: nur eine kompakte Zeile, die Liste steht auf eigener Seite
      const sumH = stoffe().reduce((a, s) => a + heute(team, s), 0), sumG = stoffe().reduce((a, s) => a + gesamt(team, s), 0);
      if (link) link.innerHTML = '<button type="button" class="cell" id="zgOpenTeam"><div class="cell-tx"><b>Zielgerüche</b><span>' + stoffe().length + (stoffe().length === 1 ? ' Geruch' : ' Gerüche') + ' · heute ' + sumH + ' · gesamt ' + sumG + ' Belohnungen</span></div>' + CHEV + '</button>';
      $('#zgSub').textContent = teamTitel(team);
      $('#zgBackTx').textContent = (ctx.teamByName(team) || {}).teilnehmer || team;
      const heuteTxt = ctx.selDate() === ctx.today() ? 'heute' : WBK.isoToDe(ctx.selDate()).slice(0, 6);
      box.innerHTML = donut(team) + '<div class="section-h zg-sh">Belohnungen gesamt' + (stoffe().length ? '<button type="button" class="text-btn" id="zgTraining">Trainingsmodus</button>' : '') + '</div><div class="group" id="zgRows">' +
        (stoffe().map(s => { const n = schritt(team, s); return '<div class="cell zg-row" data-stoff="' + esc(s) + '"><button type="button" class="cell-tx zg-detail" data-detail><b><i class="zg-sw" style="background:' + farbe(s) + '"></i>' + esc(s) + '</b><span class="zg-bar"><i style="width:' + balken(team, s) + '%;background:' + farbe(s) + '"></i></span><span>' + punkte(n) + esc([schrittText(n), heuteTxt + ' ' + heute(team, s)].filter(Boolean).join(' · ')) + '</span></button>' +
          '<button type="button" class="zg-n" data-num aria-label="Zahl bearbeiten">' + gesamt(team, s) + '<svg><use href="#i-pencil"/></svg></button><button type="button" class="zg-plus" data-plus aria-label="Eine Belohnung an ' + esc(s) + '">+1</button></div>'; }).join('') ||
          '<div class="empty">Noch keine Zielgerüche. Unter Lehrgänge → „Aktuellen Lehrgang bearbeiten“ auswählen.</div>') +
        (stoffe().length && schritte().length ? '<button type="button" class="cell link-cell" id="zgAlle">Schritt für alle Gerüche setzen</button>' : '') + '</div>' +
        '<p class="group-foot">+1 = eine Belohnung am Stoff. „Rückgängig“ oben nimmt das letzte +1 zurück. Zahl mit Stift antippen = Anzahl selbst eintragen. Stoff antippen = Verlauf je Tag.</p>' +
        '<p class="zg-status sync-info"></p>';
      renderStatus();
    }
    // +1 antippen; gedrückt halten = −1
    function initPlus(root) {
      let t = 0, lang = false;
      root.addEventListener('pointerdown', e => {
        const b = e.target.closest('[data-plus],#trTap'); if (!b) return;
        lang = false; clearTimeout(t);
        t = setTimeout(() => { lang = true; const z = ziel(b); if (z && heute(z.team, z.stoff) > 0) { eintragen(z.team, z.stoff, -1); if (navigator.vibrate) navigator.vibrate([20, 40, 20]); ctx.toast('−1 bei ' + z.stoff, 1500); } }, 650);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => root.addEventListener(ev, () => clearTimeout(t)));
      root.addEventListener('contextmenu', e => { if (e.target.closest('[data-plus],#trTap')) e.preventDefault(); });
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-plus],#trTap'); if (!b) return;
        if (lang) { lang = false; return; }
        const z = ziel(b); if (!z) return;
        zuletzt.push({ team: z.team, stoff: z.stoff, datum: ctx.selDate(), courseId: ctx.activeId() }); if (zuletzt.length > 50) zuletzt.shift();
        eintragen(z.team, z.stoff, 1); if (navigator.vibrate) navigator.vibrate(15);
        b.classList.remove('zg-pop'); void b.offsetWidth; b.classList.add('zg-pop');
      });
    }
    const ziel = b => b.id === 'trTap' ? (tr.stoff ? { team: ctx.currentTeam(), stoff: tr.stoff } : null) : { team: ctx.currentTeam(), stoff: b.closest('[data-stoff]').dataset.stoff };
    function teamClick(e) {
      const row = e.target.closest('[data-stoff]');
      if (e.target.id === 'zgTraining') return training(stoffe()[0]);
      if (e.target.closest('#zgUndo')) return rueckgaengig();
      if (e.target.id === 'zgAlle') return schrittWahl(null);
      if (!row) return;
      if (e.target.closest('[data-num]')) zahl(row.dataset.stoff);
      else if (e.target.closest('[data-detail]')) detail(row.dataset.stoff);
    }

    // Zahl direkt eintippen: dazuzählen oder Tageswert genau setzen
    function zahl(stoff) {
      const team = ctx.currentTeam(), h = heute(team, stoff), g = gesamt(team, stoff);
      let modus = 'plus';
      ctx.openModal('<h3>' + esc(stoff) + ' · ' + (ctx.selDate() === ctx.today() ? 'heute' : esc(WBK.isoToDe(ctx.selDate()))) + '</h3><p class="modal-sub">' + esc(teamTitel(team)) + '</p>' +
        '<div class="m-pad"><div class="segmented" id="zMod"><button type="button" data-m2="plus" class="on">Dazuzählen</button><button type="button" data-m2="minus">Abziehen</button><button type="button" data-m2="genau">Heute genau</button></div></div>' +
        '<input id="zIn" class="zg-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" placeholder="0" aria-label="Anzahl">' +
        '<p class="modal-sub" id="zVor"></p><div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="zOk" disabled>Übernehmen</button></div>');
      // Minus-Zeichen gibt es auf der iPhone-Zahlentastatur nicht, darum eigener Modus „Abziehen“ (nie unter 0)
      const delta = () => { const roh = Math.round(Number($('#zIn').value) || 0), n = Math.abs(roh); if (modus === 'minus' || roh < 0) return -Math.min(n, h); return modus === 'plus' ? n : n - h; };
      const upd = () => {
        const leer = $('#zIn').value === '', d = delta();
        const n = Math.abs(Math.round(Number($('#zIn').value) || 0)), zuViel = (modus === 'minus' || Number($('#zIn').value) < 0) && n > h;
        $('#zVor').textContent = leer ? (modus === 'plus' ? 'Wie viele Belohnungen kommen dazu?' : modus === 'minus' ? 'Wie viele Belohnungen sollen weg? (heute gezählt: ' + h + ')' : 'Wie viele Belohnungen waren es an diesem Tag insgesamt?') : 'heute ' + h + ' → ' + (h + d) + '  ·  gesamt ' + g + ' → ' + (g + d) + (zuViel ? '  ·  mehr als ' + h + ' geht an diesem Tag nicht' : '');
        $('#zOk').disabled = leer || !d;
      };
      $('#zMod').onclick = e => { const b = e.target.closest('[data-m2]'); if (!b) return; modus = b.dataset.m2; $('#zMod').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); upd(); $('#zIn').focus(); };
      $('#zIn').oninput = upd;
      $('#zIn').onkeydown = e => { if (e.key === 'Enter' && !$('#zOk').disabled) $('#zOk').click(); };
      $('#zOk').onclick = () => { const d = delta(); if (d) eintragen(team, stoff, d); ctx.closeModal(); ctx.toast('✓ ' + stoff + ': ' + (d > 0 ? '+' : '') + d); };
      upd(); setTimeout(() => $('#zIn').focus(), 60);
    }
    const teamTitel = name => { const t = ctx.teamByName(name); return t ? (t.teilnehmer || t.name) + (t.hund ? ' mit ' + t.hund : '') : name; };

    // Stoff in der Akte antippen: Schritt setzen, Summen, Verlauf je Tag
    function detail(stoff) {
      const team = ctx.currentTeam();
      const male = () => {
        const n = schritt(team, stoff), sch = schritte();
        const alle = eintraege().filter(e => e.team === team && e.stoff === stoff);
        const tage = [...new Set(alle.map(e => e.datum))].sort().reverse();
        const erreicht = {}; alle.filter(e => e.schritt !== '').sort((a, b) => (a.datum + a.uhrzeit).localeCompare(b.datum + b.uhrzeit)).forEach(e => { erreicht[e.schritt] = e.datum; });
        $('#modalCard').innerHTML = '<h3>' + esc(stoff) + '</h3><p class="modal-sub">' + esc(teamTitel(team)) + '</p>' +
          (sch.length ? '<div class="section-h">Schritt</div><div class="m-pad"><div class="segmented" id="dSeg">' + sch.map((_, i) => '<button type="button" data-sn="' + (i + 1) + '"' + (i + 1 === n ? ' class="on"' : '') + '>' + (i + 1) + '</button>').join('') + '</div></div>' +
            '<p class="modal-foot zg-foot">' + (n ? esc(schrittText(n) + (sch[n - 1].beschr ? ' – ' + sch[n - 1].beschr : '') + (erreicht[n] ? ' · seit ' + WBK.isoToDe(erreicht[n]).slice(0, 6) : '')) : 'Noch kein Schritt erreicht. Antippen, um ihn zu setzen.') + '</p>' : '') +
          '<div class="section-h">Belohnungen</div><div class="group m-group"><div class="cell"><div class="cell-tx"><b>Gesamt</b></div><span class="zg-cnt">' + gesamt(team, stoff) + '</span></div>' +
          '<button type="button" class="cell" id="dZahl"><div class="cell-tx"><b>' + (ctx.selDate() === ctx.today() ? 'Heute' : esc(kurzDatum(ctx.selDate()))) + '</b><span>Antippen, um eine Zahl einzugeben</span></div><span class="zg-cnt">' + heute(team, stoff) + '</span></button></div>' +
          (tage.length ? '<div class="section-h">Verlauf</div><div class="group m-group">' + tage.map(d => {
            const s = alle.filter(e => e.datum === d && e.schritt !== '').map(e => e.schritt);
            return '<div class="cell"><div class="cell-tx"><b>' + esc(kurzDatum(d)) + '</b>' + (s.length && sch.length ? '<span>Schritt ' + s[s.length - 1] + ' gesetzt</span>' : '') + '</div><span class="zg-cnt small-cnt">' + WBK.zgSumme(alle, team, stoff, d) + '</span></div>';
          }).join('') + '</div>' : '') +
          '<div class="actions"><button class="btn-filled" data-m="close">Fertig</button></div>';
        if ($('#dSeg')) $('#dSeg').onclick = e => { const b = e.target.closest('[data-sn]'); if (!b) return; const k = Number(b.dataset.sn); if (k === n) return; eintragen(team, stoff, null, k); male(); };
        $('#dZahl').onclick = () => zahl(stoff);
      };
      ctx.openModal(''); male();
    }

    // Schritt setzen: für einen Stoff (stoff) oder für alle Gerüche des Teams (stoff = null), wahlweise für alle Teams
    function schrittWahl(stoff) {
      const team = ctx.currentTeam(), sch = schritte(), c = ctx.course();
      const jetzt = stoff ? schritt(team, stoff) : 0;
      ctx.openModal('<h3>' + (stoff ? esc(stoff) + ': Schritt' : 'Schritt für alle Gerüche') + '</h3><p class="modal-sub">' + esc(teamTitel(team)) + '</p>' +
        '<div class="group m-group" id="swList">' + sch.map((x, i) => '<label class="cell"><input type="radio" name="sw" value="' + (i + 1) + '"' + (i + 1 === jetzt ? ' checked' : '') + '><div class="avatar zg-nr">' + (i + 1) + '</div><div class="cell-tx wrap"><b>' + esc(x.name) + '</b>' + (x.beschr ? '<span>' + esc(x.beschr) + '</span>' : '') + '</div></label>').join('') + '</div>' +
        (!stoff && c.teams.length > 1 ? '<div class="group m-group"><label class="cell"><div class="cell-tx"><b>Auch für alle anderen Teams</b></div><input type="checkbox" class="switch" id="swTeams"></label></div>' : '') +
        '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="swOk"' + (jetzt ? '' : ' disabled') + '>Setzen</button></div>');
      $('#swList').onchange = () => { $('#swOk').disabled = false; };
      $('#swOk').onclick = () => {
        const k = Number(($('#modal input[name=sw]:checked') || {}).value); if (!k) return;
        const teams = !stoff && $('#swTeams') && $('#swTeams').checked ? c.teams.map(t => t.name) : [team];
        const sts = stoff ? [stoff] : stoffe();
        let n = 0;
        teams.forEach(t => sts.forEach(s => { if (schritt(t, s) !== k) { eintragen(t, s, null, k); n++; } }));
        ctx.closeModal(); ctx.toast(n ? '✓ Schritt ' + k + (stoff ? '' : ' für ' + sts.length + ' Gerüche' + (teams.length > 1 ? ' bei ' + teams.length + ' Teams' : '')) + ' gesetzt' : 'War schon so gesetzt.');
      };
    }

    // ---------------- Trainingsmodus ----------------
    const tr = { stoff: '' };
    function training(stoff) {
      if (!stoffe().length) return;
      tr.stoff = stoffe().includes(stoff) ? stoff : stoffe()[0];
      ctx.go('training'); renderTraining();
    }
    function renderTraining() {
      const v = $('#v-training'); if (!v || v.classList.contains('hidden')) return;
      const team = ctx.currentTeam(); if (!team) return;
      const s = tr.stoff, n = schritt(team, s);
      $('#trTeam').textContent = teamTitel(team);
      $('#trStoff').textContent = s;
      const sts = stoffe();
      $('#trSeg').innerHTML = sts.map(x => '<button type="button" data-trs="' + esc(x) + '"' + (x === s ? ' class="on"' : '') + '>' + esc(x) + '</button>').join('');
      $('#trSeg').classList.toggle('zg-grid2', sts.length === 2 || sts.length === 4);
      $('#trHeute').textContent = heute(team, s);
      $('#trGesamt').textContent = (ctx.selDate() === ctx.today() ? 'heute' : WBK.isoToDe(ctx.selDate()).slice(0, 6)) + ' · gesamt ' + gesamt(team, s);
      $('#trSchritt').innerHTML = schritte().length ? punkte(n) + esc(n ? 'Schritt ' + n : 'Schritt setzen') : '';
      renderStatus();
    }
    function trainingClick(e) {
      const b = e.target.closest('[data-trs]'); if (b) { tr.stoff = b.dataset.trs; renderTraining(); return; }
      if (e.target.closest('#trUndo')) { const team = ctx.currentTeam(); if (heute(team, tr.stoff) > 0) { eintragen(team, tr.stoff, -1); ctx.toast('−1 bei ' + tr.stoff, 1500); } else ctx.toast('Heute ist noch nichts gezählt.'); return; }
      if (e.target.closest('#trSchritt')) { schrittWahl(tr.stoff); return; }
      if (e.target.closest('#trZahl')) { zahl(tr.stoff); return; }
    }

    function renderAll() { renderTeam(); renderTraining(); }

    return {
      renderEinst, renderGerueche, renderSchritte, renderTeam, renderTraining, renderAll,
      fillForm, formChange, formClick, readForm, flush, istSpuer,
      // Einstellungen-Schlüssel, die mit Google Drive abgeglichen werden
      KEYS: ['gerueche', 'geruchVorlagen', 'schrittVorlagen'],
      bind() {
        $('#zgSeg').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { zgTab = b.dataset.tab; renderGerueche(); } });
        $('#zgAdd').addEventListener('submit', geruchHinzufuegen);
        $('#zgAddOk').addEventListener('mousedown', e => e.preventDefault());
        $('#zgEigene').addEventListener('click', e => { const b = e.target.closest('[data-eg]'); if (b) eigenerGeruch(Number(b.dataset.eg)); });
        $('#zgPanelV').addEventListener('click', e => { const b = e.target.closest('[data-gv]'); if (b) geruchVorlage(b.dataset.gv); });
        if (MIT_SCHRITTEN) $('#v-schritte').addEventListener('click', e => { const b = e.target.closest('[data-sv]'); if (b) schrittVorlage(b.dataset.sv); });
        $('#zgPlusBtn').addEventListener('click', () => { if (zgTab === 'v') geruchVorlage('neu'); else $('#zgNeu').focus(); });
        if (MIT_SCHRITTEN) $('#svPlusBtn').addEventListener('click', () => schrittVorlage('neu'));
        $('#zgBox').addEventListener('click', teamClick);
        initPlus($('#zgBox')); initPlus($('#v-training'));
        $('#v-training').addEventListener('click', trainingClick);
        document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
        window.addEventListener('online', () => planFlush(500));
      }
    };
  };
})(window);
