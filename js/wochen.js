// LTR – Wochenberichte: je Lehrgangswoche ein Bericht (Abschnitte 1–5 und je Team eine Zeile), von der KI aus den
// Tagesprotokollen vorgeschlagen, vom Trainer geprüft und geändert. Gespeichert als eigener Reiter „Wochenbericht KW nn“ in der Excel.
(function (global) {
  'use strict';
  global.BaumprojektWochen = function (ctx) {
    const WBK = global.BaumprojektWorkbook, S = global.BaumprojektServices;
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const TITEL = { inhalte: 'Ausbildungsinhalte / Schwerpunkte', ueberblick: 'Gesamtüberblick der Ausbilder', gesamt: 'Gesamtbewertung der Ausbildungsgruppe', hinweise: 'Hinweise für die Ausbildungsgruppe' };
    let woche = 0, entwurf = null, stand = '', vorschlagStand = '', stil = '', offen = '', neu = new Set();
    const istLeer = b => !Object.values((b && b.abschnitte) || {}).some(Boolean) && !Object.values((b && b.teams) || {}).some(t => Object.values(t || {}).some(Boolean));
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
      offen = ''; neu = new Set(); stil = stil || ctx.stil();
      ctx.go('woche'); renderEditor(); stand = JSON.stringify(lesen());
      // Neue Woche: LTR schreibt den Bericht gleich aus den Tagesprotokollen vor, der Trainer ändert nur noch
      if (!vorhanden && ctx.openaiKey() && notizenDerWoche(w).length) vorschlagen();
    }

    // ---------------- Bericht bearbeiten ----------------
    const feld = (key, label, wert, rows) => '<label class="wb-feld' + (neu.has(key) ? ' neu' : '') + '"><span>' + esc(label) + (neu.has(key) ? '<em>neu</em>' : '') + '</span><textarea class="wb-ta" data-f="' + key + '" rows="' + (rows || 2) + '">' + esc(wert || '') + '</textarea></label>';
    // Abschnittskopf mit „Leeren“ und Mikrofon nur für diesen Abschnitt bzw. dieses Team
    const secH = (text, keys) => '<div class="wb-sec"><div class="section-h">' + esc(text) + '</div><button type="button" class="text-btn wb-clear" data-leeren="' + esc(keys) + '">Leeren</button>' +
      '<button type="button" class="wb-mic" data-nur="' + esc(keys) + '" aria-label="Nur diesen Teil einsprechen"><svg><use href="#i-mic"/></svg></button></div>';
    function leeren(keys) {
      const ks = keys.split(',');
      document.querySelectorAll('#wbBody .wb-ta:not(.wb-x)').forEach(ta => { const f = ta.dataset.f; if (ks.some(k => f === k || f.startsWith(k + '.'))) { ta.value = ''; groesse(ta); } });
    }
    function renderEditor() {
      const a = start(woche), ab = entwurf.abschnitte || {};
      $('#wbTitle').textContent = woche + '. Woche';
      $('#wbWoSub').textContent = 'KW ' + WBK.isoKW(a) + ' · ' + WBK.isoToDe(a) + ' bis ' + WBK.isoToDe(WBK.addDays(a, 6));
      const da = !!(course().wochenberichte || {})[woche];
      const leer = istLeer(entwurf);
      let h = '<div class="group"><button type="button" class="cell mic-cell" id="wbDiktat"><span class="mc"><svg><use href="#i-mic"/></svg></span><span>Bericht einsprechen<small>Schritt für Schritt, LTR füllt die Felder</small></span></button>' +
        (da ? '<button type="button" class="cell link-cell" id="wbPdf">Wochenbericht als PDF …</button>' : '') + '</div>';
      if (!da) h += '<div class="section-h">' + (leer ? 'Oder von LTR schreiben lassen' : 'Stil des Vorschlags') + '</div><div class="group">' +
        (leer ? '<div class="cell"><div class="cell-tx wrap"><b>Aus den Tagesprotokollen</b><span>LTR fasst die Woche zusammen und füllt alle Felder. Du prüfst nur noch und tippst „Sichern“.</span></div></div>' : '') +
        '<div class="segmented wb-stil" role="radiogroup" aria-label="Schreibstil">' + S.STILE.map(x => '<button type="button" data-stil="' + x.id + '" class="' + (x.id === stil ? 'on' : '') + '">' + (x.id === 'beamtendeutsch' ? 'Amtlich' : esc(x.name)) + '</button>').join('') + '</div>' +
        (leer ? '<button type="button" class="cell link-cell" id="wbKi">Bericht schreiben lassen</button>' : '<p class="wb-stil-hint">Anderen Stil antippen, dann schreibt LTR den Vorschlag neu.</p>') + '</div>';
      if (offen) h += '<div class="group wb-offen"><label class="wb-feld"><span>Nicht zugeordnet – bitte selbst einsortieren (wird nicht gesichert, die Aufnahme liegt in Google Drive)</span><textarea class="wb-ta wb-x" rows="2">' + esc(offen) + '</textarea></label></div>';
      h += secH('Gruppe', 'a.inhalte,a.ueberblick') + '<div class="group">' + ['inhalte', 'ueberblick'].map(k => feld('a.' + k, TITEL[k], ab[k], 3)).join('') + '</div>';
      teams().forEach(t => {
        const tb = (entwurf.teams || {})[t.name] || {}, n = WBK.einheiten(course(), t.name, woche);
        h += secH(t.name + ' · ' + n + (n === 1 ? ' Tagesprotokoll' : ' Tagesprotokolle'), 't.' + t.name) + '<div class="group">' +
          WBK.WB_TEAM.map(([k, l]) => feld('t.' + t.name + '.' + k, l, tb[k], k === 'bewertung' ? 1 : 2)).join('') + '</div>';
      });
      h += secH('Abschluss', 'a.gesamt,a.hinweise') + '<div class="group">' + ['gesamt', 'hinweise'].map(k => feld('a.' + k, TITEL[k], ab[k], 2)).join('') + '</div>';
      h += '<div class="actions wb-actions"><button type="button" class="btn-filled" id="wbSave2">Sichern</button></div>' +
        (da || !leer ? '<button type="button" class="text-btn danger-text" id="wbDel">Bericht löschen</button>' : '');
      $('#wbBody').innerHTML = h;
      document.querySelectorAll('.wb-ta').forEach(groesse);
    }
    function groesse(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(44, ta.scrollHeight) + 'px'; }
    function lesen() {
      const b = { abschnitte: {}, teams: {} };
      document.querySelectorAll('#wbBody .wb-ta:not(.wb-x)').forEach(ta => {
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
      ctx.busy('LTR schreibt den Wochenbericht aus den Tagesprotokollen …');
      try {
        const fuer = woche, r = await S.wochenbericht(txt, { key: ctx.openaiKey(), model: ctx.llmModel(), stil });
        if (fuer !== woche || $('#v-woche').classList.contains('hidden')) return; // Seite inzwischen verlassen
        entwurf = { abschnitte: { inhalte: r.inhalte || '', ueberblick: r.ueberblick || '', gesamt: r.gesamt || '', hinweise: r.hinweise || '' }, teams: {} };
        (r.teams || []).forEach(x => { const t = tl.find(y => y.name === x.team); if (t) { const tb = {}; WBK.WB_TEAM.forEach(([k]) => { tb[k] = x[k] || ''; }); entwurf.teams[t.name] = tb; } });
        neu = new Set(); offen = ''; renderEditor(); vorschlagStand = JSON.stringify(lesen());
        ctx.toast('Vorschlag fertig. Bitte prüfen und dann „Sichern“ tippen.', 4000);
      } catch (e) { ctx.toast('Vorschlag fehlgeschlagen: ' + e.message, 6000); }
      finally { ctx.busy(''); }
    }
    const ohneLeere = o => JSON.stringify(Object.keys(o || {}).sort().filter(k => o[k]).map(k => [k, o[k]]));
    async function sichern() {
      const b = lesen(), w = woche;
      if (istLeer(b)) return loeschen(true);
      try {
        await ctx.withStore('Speichere Wochenbericht …', () => ctx.modifyCourse(c => { c.wochenberichte = c.wochenberichte || {}; c.wochenberichte[w] = b; },
          c => ohneLeere(((c.wochenberichte || {})[w] || {}).abschnitte) === ohneLeere(b.abschnitte)));
        stand = JSON.stringify(b); offen = ''; neu = new Set();
        ctx.toast('✓ Wochenbericht gespeichert (Excel-Reiter „Wochenbericht KW ' + WBK.isoKW(start(w)) + '“)', 3500);
        ctx.go('wochen');
      } catch (e) { /* gemeldet */ }
    }
    // Ganzen Bericht der Woche löschen (alle Felder leer, Excel-Reiter fällt weg)
    function loeschen(stumm) {
      const w = woche, da = !!(course().wochenberichte || {})[w];
      const weg = async () => {
        ctx.closeModal();
        if (da) {
          try { await ctx.withStore('Lösche Wochenbericht …', () => ctx.modifyCourse(c => { if (c.wochenberichte) delete c.wochenberichte[w]; }, c => !(c.wochenberichte || {})[w])); }
          catch (e) { return; }
        }
        entwurf = { abschnitte: {}, teams: {} }; offen = ''; neu = new Set(); renderEditor(); stand = JSON.stringify(lesen());
        ctx.toast(da ? '✓ Wochenbericht gelöscht' : 'Alle Felder geleert', 3000);
      };
      if (stumm === true && !da) { ctx.toast('Der Bericht ist leer, es gibt nichts zu sichern.', 3000); return; }
      ctx.openModal('<h3>' + (stumm === true ? 'Leeren Bericht sichern?' : 'Wochenbericht löschen?') + '</h3><p class="modal-sub">' + (stumm === true ? 'Alle Felder sind leer. Dann wird der Wochenbericht der ' + w + '. Woche gelöscht' : 'Alle Felder der ' + w + '. Woche werden geleert') +
        (da ? ' und der Reiter „Wochenbericht KW ' + WBK.isoKW(start(w)) + '“ verschwindet aus der Excel-Datei.' : '.') + ' Die Tagesprotokolle bleiben erhalten.</p>' +
        '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" style="background:var(--red)" id="wbDelOk">Löschen</button></div>');
      $('#wbDelOk').onclick = weg;
    }

    // ---------------- Bericht einsprechen: Schritt für Schritt, je Abschnitt bzw. Team eine Aufnahme ----------------
    let einzeln = false, schritte = [], si = 0, stream = null, rec = null, teile = [], timer = 0, raf = 0, actx = null, an = null, wake = null;
    let modus = localStorage.getItem('ltr.wbModus') || 'schritt';
    let pausiert = false, laufzeit = 0, seit = 0, abbruch = false;
    const sekunden = () => Math.floor((laufzeit + (pausiert ? 0 : Date.now() - seit)) / 1000);
    const mmss = x => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
    function schrittListe() {
      const l = [{ key: 'a.inhalte', titel: TITEL.inhalte, fragen: ['Was wurde diese Woche geübt?', 'Wo und mit welchen Zielgerüchen?'] },
        { key: 'a.ueberblick', titel: TITEL.ueberblick, fragen: ['Wie lief die Woche für die ganze Gruppe?'] }];
      teams().forEach(t => l.push({ key: 't.' + t.name, team: t.name, titel: t.name, fragen: ['Fortschritte: Was hat gut geklappt?', 'Auffälligkeiten: Wo hakt es noch?', 'Nächste Schritte: Was wird gefördert?', 'Note für die Woche (z. B. „gut“)', 'Gilt für alle? Sag „übernimm das für alle Teams“'] }));
      l.push({ key: 'a.gesamt', titel: TITEL.gesamt, fragen: ['Wie steht die Gruppe insgesamt?'] },
        { key: 'a.hinweise', titel: TITEL.hinweise, fragen: ['Was wurde der Gruppe mitgegeben?'] });
      return l;
    }
    function zeigeSchritt() {
      const alle = istAlle(), x = schritte[si], letzt = alle || si === schritte.length - 1;
      document.querySelectorAll('#wdModus [data-modus]').forEach(b => b.classList.toggle('on', b.dataset.modus === modus));
      show('#wdSchritt', !alle); show('#wdAlle', alle);
      if (alle) {
        const tl = teams();
        $('#wdAlle').innerHTML = '<p class="wd-say">Sag jeweils kurz, worüber du sprichst, z. B. „' + esc(tl[0] ? tl[0].name.replace(' & ', ' und ') : 'Gesamtüberblick') + ' …“. Gilt etwas für alle, sag „übernimm das für alle Teams“.</p>' +
          [[TITEL.inhalte, 'Was wurde geübt, wo, mit welchen Zielgerüchen?'], [TITEL.ueberblick, 'Wie lief die Woche für die ganze Gruppe?'], ['Je Team', 'Fortschritte · Auffälligkeiten · nächste Schritte · Note'], [TITEL.gesamt, 'Wie steht die Gruppe insgesamt?'], [TITEL.hinweise, 'Was wurde der Gruppe mitgegeben?']]
            .map(([t, f], i) => '<div class="wd-row"><span class="wd-num">' + (i + 1) + '</span><div><b>' + t + '</b><span>' + f + '</span>' + (i === 2 ? '<div class="wd-teams">' + tl.map(t => esc(t.name)).join('<br>') + '</div>' : '') + '</div></div>').join('');
      } else {
        $('#wdDots').innerHTML = schritte.map((_, i) => '<i class="' + (i < si ? 'ok' : i === si ? 'on' : '') + '"></i>').join('');
        $('#wdStep').textContent = schritte.length > 1 ? 'Schritt ' + (si + 1) + ' von ' + schritte.length : 'Ergänzen';
        show('#wdDots', schritte.length > 1);
        $('#wdTitel').textContent = x.titel;
        $('#wdFragen').innerHTML = x.fragen.map(f => '<li>' + esc(f) + '</li>').join('');
      }
      $('#wdNextLbl').textContent = letzt ? 'Fertig' : 'Weiter';
      $('#wdNext').setAttribute('aria-label', letzt ? 'Fertig' : 'Weiter zum nächsten Punkt');
      show('#wdEnde', !letzt);
      $('#wdHint').textContent = alle ? 'Reihenfolge egal. Am Ende „Fertig“ tippen.' : '„Weiter“ geht zum nächsten Punkt. Nichts zu sagen? Einfach „Weiter“ tippen.';
    }
    // Umschalten während der Aufnahme: Bisheriges bleibt als eigener Teil erhalten, dann geht es im neuen Modus weiter
    async function modusWechsel(m) {
      if (m === modus) return;
      const p = rec ? schrittEnde() : null;
      modus = m; localStorage.setItem('ltr.wbModus', m);
      if (m === 'schritt') si = 0;
      zeigeSchritt(); if (rec) aufnahme(); if (p) await p;
    }
    const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
    const istAlle = () => !einzeln && modus === 'alle';
    async function diktatStart(nur) {
      if (!ctx.openaiKey()) return ctx.toast('Zum Einsprechen wird der OpenAI-Schlüssel gebraucht (Einstellungen).', 5000);
      if (rec) return;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
      catch (e) { return ctx.toast('Kein Zugriff aufs Mikrofon: ' + e.message, 5000); }
      const ks = nur ? nur.split(',') : null; einzeln = !!ks;
      schritte = schrittListe().filter(x => !ks || ks.includes(x.key)); si = 0; teile = []; abbruch = false;
      show('#wdModus', !einzeln);
      $('#wdSub').textContent = woche + '. Woche · KW ' + WBK.isoKW(start(woche));
      document.body.classList.add('wb-open');
      zeigeSchritt(); aufnahme(); welle();
      try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* nicht überall */ }
    }
    function aufnahme() {
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => global.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined);
      const ch = rec._ch = []; pausiert = false; laufzeit = 0; seit = Date.now(); pauseUi();
      rec.ondataavailable = e => e.data.size && ch.push(e.data);
      rec.start(1000);
      clearInterval(timer); timer = setInterval(() => { $('#wdTime').textContent = '● ' + mmss(sekunden()); }, 250);
      $('#wdTime').textContent = '● 0:00';
    }
    // Aktuellen Schritt beenden: Aufnahme sofort sichern (Gerät → Google Drive) und Spracherkennung im Hintergrund starten
    function schrittEnde() {
      const r = rec, x = istAlle() ? { key: 'alle', titel: 'Ganzer Bericht' } : schritte[si], dauer = sekunden();
      return new Promise(ok => {
        r.onstop = async () => {
          if (abbruch || dauer < 2) return ok();
          const blob = new Blob(r._ch, { type: r.mimeType || 'audio/webm' });
          const aid = await ctx.aufnahmeSichern(blob, 'Wochenbericht ' + woche + '. Woche · ' + x.titel);
          teile.push({ key: x.key, team: x.team, titel: x.key === 'alle' ? 'Ganzer Bericht (Abschnitte und Teams werden angesagt)' : x.team ? 'Team ' + x.titel : x.titel, text: S.transcribe(blob, { key: ctx.openaiKey(), model: ctx.sttModel(), hint: ctx.sttHint() })
            .then(t => { if (t) ctx.rohtextSichern(aid, t); return t; }) });
          ok();
        };
        if (r.state !== 'inactive') r.stop(); else r.onstop();
      });
    }
    async function weiter(sofortFertig) {
      if (!rec) return;
      const p = schrittEnde();
      if (!sofortFertig && !istAlle() && si < schritte.length - 1) { si++; zeigeSchritt(); aufnahme(); await p; return; }
      await p; beenden(); auswerten();
    }
    function beenden() {
      clearInterval(timer); cancelAnimationFrame(raf);
      if (actx) { actx.close().catch(() => {}); actx = null; }
      if (wake) { wake.release().catch(() => {}); wake = null; }
      if (rec && rec.state !== 'inactive') rec.stop();
      if (stream) stream.getTracks().forEach(t => t.stop());
      rec = null; stream = null;
      document.body.classList.remove('wb-open');
    }
    function abbrechen() {
      if (teile.length && !confirm('Einsprechen abbrechen? Das bisher Gesagte kommt nicht in den Bericht. Die Aufnahmen bleiben in Google Drive gesichert.')) return;
      abbruch = true; beenden();
    }
    function pauseUi() {
      $('#wdPauseLbl').textContent = pausiert ? 'Weiter' : 'Pause';
      $('#wdPause').innerHTML = '<svg><use href="#' + (pausiert ? 'i-mic' : 'i-pause') + '"/></svg>';
      $('#wdPause').classList.toggle('on', pausiert);
      $('#wbSheet').classList.toggle('paused', pausiert);
    }
    function pause() {
      if (!rec || rec.state === 'inactive') return;
      if (!pausiert) { rec.pause(); laufzeit += Date.now() - seit; pausiert = true; } else { rec.resume(); seit = Date.now(); pausiert = false; }
      pauseUi();
    }
    function welle() {
      const cv = $('#wdWave'), g = cv.getContext('2d'), rot = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff3b30', dpr = global.devicePixelRatio || 1;
      cv.width = Math.round(cv.clientWidth * dpr) || 600; cv.height = Math.round(cv.clientHeight * dpr) || 80;
      try { actx = new (global.AudioContext || global.webkitAudioContext)(); an = actx.createAnalyser(); an.fftSize = 1024; actx.createMediaStreamSource(stream).connect(an); if (actx.state === 'suspended') actx.resume().catch(() => {}); } catch (e) { an = null; }
      const d = new Uint8Array(an ? an.fftSize : 1), STEP = 9 * dpr, BAR = 3 * dpr, n = Math.ceil(cv.width / STEP) + 2, bars = new Array(n).fill(0);
      let lvl = 0, off = 0, last = performance.now();
      const loop = now => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(64, now - last); last = now; let z = 0;
        if (!pausiert && an) { an.getByteTimeDomainData(d); let q = 0; for (let i = 0; i < d.length; i++) { const v = d[i] - 128; q += v * v; } z = Math.min(1, Math.sqrt(q / d.length) / 28); }
        lvl += (z - lvl) * Math.min(1, dt / 60);
        if (!pausiert) { off += dt * 0.06 * dpr; while (off >= STEP) { off -= STEP; bars.push(lvl); bars.shift(); } }
        const w = cv.width, h = cv.height; g.clearRect(0, 0, w, h); g.fillStyle = rot; g.globalAlpha = pausiert ? 0.4 : 1;
        for (let i = 0; i < n; i++) { const x = w - (n - 1 - i) * STEP - off, bh = Math.max(BAR, (i === n - 1 ? lvl : bars[i]) * (h - 4 * dpr)); g.beginPath(); if (g.roundRect) g.roundRect(x - BAR / 2, h / 2 - bh / 2, BAR, bh, BAR / 2); else g.rect(x - BAR / 2, h / 2 - bh / 2, BAR, bh); g.fill(); }
      };
      raf = requestAnimationFrame(loop);
    }
    // Alle Aufnahmen erkennen lassen, auf die Felder verteilen und an vorhandenen Text anhängen
    async function auswerten() {
      if (!teile.length) return ctx.toast('Es wurde nichts aufgenommen.', 3000);
      ctx.busy('Spracherkennung läuft …');
      try {
        const fertig = [];
        for (const t of teile) { try { const x = await t.text; if (x) fertig.push({ titel: t.titel, text: x }); } catch (e) { ctx.toast('Ein Teil wurde nicht erkannt (' + t.titel + '). Die Aufnahme ist in Google Drive gesichert.', 6000); } }
        if (!fertig.length) { ctx.toast('Es wurde nichts verstanden.', 4000); return; }
        ctx.busy('Verteile auf die Felder …');
        const r = await S.wochenDiktat(fertig, { key: ctx.openaiKey(), model: ctx.llmModel(), stil, teams: course().teams, glossar: ctx.glossar(), stoffe: ctx.stoffe() });
        const b = lesen(), dazu = (alt, x) => { x = String(x || '').trim(); return !x ? alt : alt ? alt + '\n' + x : x; };
        neu = new Set();
        ['inhalte', 'ueberblick', 'gesamt', 'hinweise'].forEach(k => { if (String(r[k] || '').trim()) { b.abschnitte[k] = dazu(b.abschnitte[k], r[k]); neu.add('a.' + k); } });
        (r.teams || []).forEach(x => {
          const t = teams().find(y => y.name === x.team); if (!t) return;
          const tb = b.teams[t.name] = b.teams[t.name] || {};
          WBK.WB_TEAM.forEach(([k]) => { if (!String(x[k] || '').trim()) return; tb[k] = k === 'bewertung' ? String(x[k]).trim() : dazu(tb[k], x[k]); neu.add('t.' + t.name + '.' + k); });
        });
        offen = dazu(offen, r.nicht_zugeordnet);
        entwurf = b; renderEditor();
        ctx.toast(neu.size + (neu.size === 1 ? ' Feld' : ' Felder') + ' gefüllt. Bitte prüfen und „Sichern“ tippen.', 5000);
      } catch (e) { ctx.toast('Verteilen fehlgeschlagen: ' + e.message + '. Die Aufnahmen sind in Google Drive gesichert.', 7000); }
      finally { ctx.busy(''); }
    }

    function bind() {
      $('#wbOpen').addEventListener('click', () => { if (!course()) return ctx.toast('Kein Lehrgang gewählt.'); ctx.go('wochen'); });
      $('#wbBack').addEventListener('click', () => ctx.go('lehrgang'));
      $('#wbList').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) oeffnen(Number(b.dataset.w)); });
      $('#wbWoBack').addEventListener('click', () => ctx.go('wochen'));
      $('#wbSave').addEventListener('click', sichern);
      $('#wdPause').addEventListener('click', pause);
      $('#wdNext').addEventListener('click', () => weiter(false));
      $('#wdEnde').addEventListener('click', () => weiter(true));
      $('#wdCancel').addEventListener('click', abbrechen);
      $('#wdModus').addEventListener('click', e => { const b = e.target.closest('[data-modus]'); if (b) modusWechsel(b.dataset.modus); });
      $('#wbBody').addEventListener('click', async e => {
        const st = e.target.closest('[data-stil]');
        if (st) {
          if (st.dataset.stil === stil) return;
          const hatText = !istLeer(lesen());
          if (hatText && JSON.stringify(lesen()) !== vorschlagStand && !confirm('Der Vorschlag wird im Stil „' + st.textContent + '“ neu geschrieben. Deine Änderungen in den Feldern gehen dabei verloren. Weiter?')) return;
          stil = st.dataset.stil; document.querySelectorAll('.wb-stil [data-stil]').forEach(x => x.classList.toggle('on', x === st));
          if (hatText) vorschlagen();
          return;
        }
        if (e.target.closest('#wbDiktat')) diktatStart();
        const nu = e.target.closest('[data-nur]'); if (nu) diktatStart(nu.dataset.nur);
        const le = e.target.closest('[data-leeren]'); if (le) leeren(le.dataset.leeren);
        if (e.target.closest('#wbSave2')) sichern();
        if (e.target.closest('#wbDel')) loeschen();
        if (e.target.closest('#wbKi')) vorschlagen();
        if (e.target.closest('#wbPdf')) { const w = woche; if (geaendert()) { await sichern(); if (geaendert()) return; } ctx.pdfWoche(w); }
      });
      $('#wbBody').addEventListener('input', e => { if (e.target.classList.contains('wb-ta')) groesse(e.target); });
    }
    return { bind, renderListe, geaendert, verwerfen: () => { stand = JSON.stringify(lesen()); }, speichern: sichern };
  };
})(typeof window !== 'undefined' ? window : globalThis);
