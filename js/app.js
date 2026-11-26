(function () {
  'use strict';
  const WBK = window.BaumprojektWorkbook;
  const S = window.BaumprojektServices;
  const CFG = window.BAUMPROJEKT_CONFIG || {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => WBK.dateToIso(new Date());
  const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ALLE = '*';
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const longDate = iso => { const d = WBK.isoToDate ? WBK.isoToDate(iso) : new Date(iso + 'T12:00'); return TAGE[d.getDay()] + ', ' + d.getDate() + '. ' + MONATE[d.getMonth()]; };
  const STIL_KURZ = { beamtendeutsch: 'Amtlich' };
  const svg = id => '<svg><use href="#' + id + '"/></svg>';
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  // ---------------- Zustand ----------------
  const settings = Object.assign({ openaiKey: '', sttModel: CFG.sttModel || 'gpt-4o-transcribe', llmModel: CFG.llmModel || 'gpt-4.1-mini', stil: 'fliesstext', glossar: [], ausgeblendet: [] },
    JSON.parse(localStorage.getItem('baumprojekt.settings') || '{}'));
  const clientId = () => CFG.googleClientId || '';
  const store = () => S.Drive;
  let courses = [];
  let activeId = localStorage.getItem('baumprojekt.active') || '';
  let course = null; // geparster aktiver Lehrgang
  let selDate = today();
  let currentTeam = null; // geöffnete Team-Seite
  let editing = false;
  let info = null; // Drive-Angaben zum aktiven Lehrgang (geteilt?, Besitzer, freigegebener Schlüssel)
  let lastRev = '';
  const myName = () => (S.Drive.user && (S.Drive.user.displayName || S.Drive.user.emailAddress)) || '';
  // Geteilter Lehrgang mit freigegebenem Schlüssel des Einladenden → dieser, sonst der eigene
  // Glossar: eigenes (im eigenen Drive, gilt für alle Lehrgänge) plus Begriffe des Kollegen aus dem geteilten Lehrgang
  const lc = s => String(s || '').toLowerCase();
  const fremdGlossar = () => ((course && course.glossar) || []).filter(g => g.von !== myName() && !settings.glossar.some(x => lc(x.begriff) === lc(g.begriff)));
  // Vordefinierte Begriffe (js/vordefiniert.js) gelten für alle; ein eigener Eintrag mit gleichem Begriff geht vor
  const vordefGlossar = () => ((window.BaumprojektVordefiniert || {}).glossar || []).filter(g => !settings.glossar.some(x => lc(x.begriff) === lc(g.begriff)) && !fremdGlossar().some(x => lc(x.begriff) === lc(g.begriff)));
  const glossarAktiv = () => settings.glossar.concat(fremdGlossar(), vordefGlossar());
  const openaiKey = () => (info && info.id === activeId && !info.ownedByMe && info.sharedKey) || settings.openaiKey;

  // ---------------- UI-Helfer ----------------
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3000); }
  function busy(msg) { $('#busyText').textContent = msg || 'Bitte warten …'; $('#busy').classList.toggle('hidden', !msg); }
  function show(el, on) { (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on); }
  function go(view) {
    document.querySelectorAll('audio').forEach(a => { if (!a.paused) a.pause(); }); // Wiedergabe stoppt beim Seitenwechsel
    document.querySelectorAll('.view').forEach(v => show(v, v.id === 'v-' + view));
    const tab = ['team', 'training', 'zgteam', 'notizen', 'aufnahmen'].includes(view) ? 'heute' : ['glossar', 'gerueche'].includes(view) ? 'einst' : view;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
    if (view === 'heute') renderToday();
    if (view === 'lehrgang') refreshCourses();
    if (view === 'einst') fillSettings();
    if (view === 'glossar') renderGlossar();
    if (view === 'gerueche') SP.renderGerueche();
    window.scrollTo(0, 0);
  }
  // Vom linken Rand nach rechts wischen = eine Ebene zurück (wie in iOS), auf Hauptseiten passiert nichts
  function zurueckKnopf() {
    const v = document.querySelector('.view:not(.hidden)'); if (!v) return null;
    return v.querySelector('.navbar .back') || (v.id === 'v-training' ? $('#trDone') : null);
  }
  function initEdgeBack() {
    let d = null;
    const setX = (v, x, anim) => { v.style.transition = anim ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none'; v.style.transform = x > 0 ? 'translateX(' + x + 'px)' : ''; v.classList.toggle('edge-drag', x > 0); };
    document.addEventListener('touchstart', e => {
      d = null;
      if (e.touches.length !== 1 || e.touches[0].clientX > 28) return;
      if (document.body.classList.contains('sheet-open') || document.body.classList.contains('modal-open')) return;
      const btn = zurueckKnopf(); if (!btn) return;
      d = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, x: 0, t0: Date.now(), on: false, btn, v: btn.closest('.view') };
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!d) return;
      const dx = e.touches[0].clientX - d.x0, dy = e.touches[0].clientY - d.y0;
      if (!d.on) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; if (dx <= Math.abs(dy)) { d = null; return; } d.on = true; }
      e.preventDefault(); d.x = Math.max(0, dx); setX(d.v, d.x, false);
    }, { passive: false });
    const ende = () => {
      if (!d || !d.on) { d = null; return; }
      const { v, x, t0, btn } = d; d = null;
      const w = window.innerWidth, schnell = x / Math.max(1, Date.now() - t0) > 0.5;
      if (x > w * 0.35 || (schnell && x > 50)) {
        setX(v, w, true);
        setTimeout(() => { v.style.transition = 'none'; v.style.transform = ''; v.classList.remove('edge-drag'); btn.click(); }, 280);
      } else setX(v, 0, true);
    };
    document.addEventListener('touchend', ende); document.addEventListener('touchcancel', ende);
  }
  function banner(html, onClick) {
    const b = $('#banner'); b.innerHTML = html; show(b, !!html);
    const btn = b.querySelector('button'); if (btn && onClick) btn.onclick = onClick;
  }
  const FARBEN = ['#5e8fbf', '#8e7cc3', '#c48a5a', '#5aa58a', '#c46b7d', '#6f9a4e', '#b07fb0', '#4f9aa8', '#c4935a', '#7f8cc4'];
  function initials(t) { return ((t.teilnehmer || t.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase(); }
  function avatar(t, i, cls) { return '<div class="avatar ' + (cls || '') + '" style="background:' + FARBEN[i % FARBEN.length] + '">' + esc(initials(t)) + '</div>'; }

  // Spürhund-Lehrgänge (Zielgerüche, Belohnungen, Schritte) – eigener Baustein in js/spuerhund.js
  const SP = window.BaumprojektSpuerhund({
    settings, course: () => course, activeId: () => activeId, selDate: () => selDate, today, myName, currentTeam: () => currentTeam,
    teamByName: n => teamByName(n), toast, show, go: v => go(v), openModal: h => openModal(h), closeModal: () => closeModal(),
    modifyCourse: (fn, check) => modifyCourse(fn, check),
    saveSettings: () => { localStorage.setItem('baumprojekt.settings', JSON.stringify(settings)); syncSettingsToDrive(true); }
  });

  // Führt eine Aktion aus; fehlt die Google-Anmeldung, wird ein Verbinden-Knopf angeboten und danach wiederholt.
  async function withStore(label, fn) {
    try { busy(label); const r = await fn(); busy(); return r; }
    catch (e) {
      busy();
      if (e.needsLogin) {
        banner('<span>Google-Anmeldung abgelaufen.</span><button>Neu verbinden</button>', async () => {
          try { await S.Drive.connect(clientId()); banner(''); updateDriveStatus(); await withStore(label, fn); } catch (err) { toast(err.message, 5000); }
        });
      } else { console.error(e); toast(e.message || String(e), 6000); }
      throw e;
    }
  }

  // ---------------- Lehrgang laden ----------------
  // Gewählter Lehrgang wird auf dem Gerät und in den Einstellungen in Google Drive gemerkt (auch für andere Geräte / nach dem Abmelden)
  function setActive(id, merken) {
    const neu = id !== activeId;
    activeId = id; localStorage.setItem('baumprojekt.active', id || '');
    if (merken && id && neu) syncSettingsToDrive(true);
  }
  async function loadActive() {
    if (!activeId) {
      // z. B. nach gelöschten Browserdaten oder auf neuem Handy: Lehrgänge kommen aus Google Drive
      try { const list = await listCourses(); if (list.length) setActive(list[0].id); } catch (e) { /* Anmeldung fehlt */ }
    }
    if (!activeId) { course = null; renderToday(); return; }
    const cached = await S.KV.get('course:' + activeId);
    if (cached) { course = cached; clampDate(); renderToday(); }
    try {
      const rev = await store().revision(activeId);
      const buf = await store().load(activeId);
      course = await WBK.parse(buf); lastRev = rev;
      await S.KV.set('course:' + activeId, course);
      // Am PC in der Übersicht geändert: übernehmen und gleich sauber zurückschreiben (vorher wird gesichert)
      if (course.amPcGeaendert) {
        const n = course.amPcGeaendert;
        toast('✓ ' + n + (n > 1 ? ' Änderungen' : ' Änderung') + ' aus der Excel-Übersicht übernommen', 5000);
        modifyCourse(() => {}).then(() => { renderToday(); if (currentTeam) renderTeamNotes(); SP.renderAll(); }).catch(e => console.warn('Übernahme später erneut', e));
      }
      await loadInfo();
    } catch (e) {
      if (/40[34]/.test(e.message)) { setActive(''); course = null; return loadActive(); }
      if (!e.needsLogin && !cached) toast(e.message, 5000);
    }
    clampDate(); renderToday(); SP.renderAll(); SP.flush();
  }
  // Ausgewählter Tag: heute, wenn er im Lehrgang liegt, sonst der nächstgelegene Lehrgangstag
  function clampDate() {
    if (!course) return;
    const max = course.meta.wochen * 7, i = WBK.dayIndex(course.meta.start, selDate);
    if (i < 1) selDate = course.meta.start; else if (i > max) selDate = WBK.addDays(course.meta.start, max - 1);
  }

  async function loadInfo() {
    try { info = await S.Drive.info(activeId); } catch (e) { return; }
    renderShare(); renderToday();
  }
  // Neuen Stand des Lehrgangs holen, wenn ein anderer Trainer (oder der PC) etwas gespeichert hat
  async function refreshIfChanged() {
    if (!activeId || !S.Drive.connected() || document.body.classList.contains('sheet-open')) return;
    try { if ((await store().revision(activeId)) !== lastRev) await loadActive(); } catch (e) { /* später */ }
  }

  // Lesen – ändern – zurückschreiben. So bleiben Änderungen, die am PC in Excel oder vom zweiten Trainer gemacht wurden, erhalten.
  // fn muss mehrfach aufrufbar sein: Hat in der Zwischenzeit jemand anderes gespeichert, wird neu eingelesen und wiederholt.
  // check prüft nach dem Speichern, ob die Änderung wirklich in der Datei steht.
  async function modifyCourse(fn, check) {
    for (let i = 0; i < 5; i++) {
      const rev = await store().revision(activeId);
      const c = await WBK.parse(await store().load(activeId));
      fn(c);
      try { await store().save(activeId, await WBK.toBuffer(c), rev); }
      catch (e) { if (e.conflict) { await new Promise(r => setTimeout(r, 800 + Math.random() * 1500)); continue; } throw e; }
      if (check) {
        const now = await WBK.parse(await store().load(activeId));
        if (!check(now)) { await new Promise(r => setTimeout(r, 800 + Math.random() * 1500)); continue; }
      }
      course = c; lastRev = await store().revision(activeId).catch(() => '');
      await S.KV.set('course:' + activeId, c);
      return;
    }
    throw new Error('Speichern gerade nicht möglich, weil die Datei ständig geändert wird. Die Notiz bleibt erhalten, bitte gleich nochmal tippen.');
  }

  // ---------------- Heute: Tag wählen, Teams ----------------
  function renderToday() {
    if (!course) {
      $('#dayTitle').textContent = 'Heute';
      $('#courseBtn').textContent = 'Lehrgang wählen oder anlegen'; $('#weekInfo').textContent = '';
      $('#days').innerHTML = ''; $('#teamsHead').textContent = 'Teams';
      $('#teamList').innerHTML = '<div class="empty">Lege unter „Lehrgänge“ deinen ersten Lehrgang an.</div>';
      return;
    }
    const max = course.meta.wochen * 7, idx = WBK.dayIndex(course.meta.start, selDate), t = today();
    $('#dayTitle').textContent = selDate === t ? 'Heute' : longDate(selDate);
    $('#courseBtn').textContent = course.meta.titel || 'Lehrgang';
    $('#weekInfo').textContent = ' · Woche ' + Math.ceil(idx / 7) + ' von ' + course.meta.wochen;
    const withNotes = new Set(course.notes.map(n => n.datum));
    let html = '';
    for (let i = 0; i < max; i++) {
      const d = WBK.addDays(course.meta.start, i), dt = new Date(d + 'T12:00');
      if (i && i % 7 === 0) html += '<span class="week-sep"></span>';
      html += '<button class="day' + (d === selDate ? ' on' : '') + (d === t ? ' today' : '') + (withNotes.has(d) ? ' has' : '') + '" data-d="' + d + '" aria-label="' + esc(longDate(d)) + '"><small>' + WBK.weekday(d).slice(0, 2) + '</small><b>' + dt.getDate() + '</b><i></i></button>';
    }
    const days = $('#days');
    if (days.dataset.key !== activeId + max + [...withNotes].join() + selDate + t) {
      days.innerHTML = html; days.dataset.key = activeId + max + [...withNotes].join() + selDate + t;
      const on = days.querySelector('.day.on'); if (on) days.scrollLeft = on.offsetLeft - days.clientWidth / 2 + on.clientWidth / 2;
    }
    const notes = course.notes.filter(n => n.datum === selDate);
    const done = course.teams.filter(tm => notes.some(n => n.team === tm.name)).length;
    $('#teamsHead').textContent = 'Teams · ' + done + ' von ' + course.teams.length + ' erledigt';
    $('#teamList').innerHTML = course.teams.map((tm, i) => {
      const n = notes.filter(x => x.team === tm.name).length;
      return '<div class="cell" data-team="' + esc(tm.name) + '">' + avatar(tm, i) + '<div class="cell-tx"><b>' + esc(tm.teilnehmer || tm.name) + '</b><span>' + (tm.hund ? 'mit ' + esc(tm.hund) : '&nbsp;') + '</span></div>' +
        '<div class="cell-st">' + (n ? svg('i-check') + (n > 1 ? n : '') : '') + '</div><button class="mic" aria-label="Aufnahme für ' + esc(tm.name) + '">' + svg('i-mic') + '</button></div>';
    }).join('') || '<div class="empty">Dieser Lehrgang hat noch keine Teams.</div>';
    updateSyncInfo();
  }
  function teamByName(name) { return course && course.teams.find(t => t.name === name); }

  // ---------------- Team-Seite ----------------
  function openTeam(name) {
    const tm = teamByName(name); if (!tm) return;
    currentTeam = name;
    const i = course.teams.indexOf(tm);
    $('#teamAvatar').outerHTML = avatar(tm, i, 'big').replace('class="avatar big"', 'class="avatar big" id="teamAvatar"');
    $('#teamName').textContent = tm.teilnehmer || tm.name;
    $('#teamDog').textContent = tm.hund ? 'mit ' + tm.hund + (tm.behoerde ? ' · ' + tm.behoerde : '') : '';
    $('#teamBack').lastChild.textContent = selDate === today() ? 'Heute' : 'Zurück';
    document.querySelectorAll('.akte-back').forEach(el => { el.textContent = tm.teilnehmer || tm.name; });
    document.querySelectorAll('.akte-sub').forEach(el => { el.textContent = (tm.teilnehmer || tm.name) + (tm.hund ? ' mit ' + tm.hund : ''); });
    renderTeamNotes(); SP.renderTeam();
    go('team');
    $('#recsInfo').textContent = 'Lade …';
    recordings().then(l => { if (currentTeam !== name) return; const n = l.filter(r => r.team === name).length; $('#recsInfo').textContent = n ? n + (n === 1 ? ' Aufnahme' : ' Aufnahmen') : 'noch keine'; }).catch(() => { $('#recsInfo').textContent = ''; });
  }
  // Akte: Kurzinfo zu den Notizen (Anzahl, zuletzt)
  function renderTeamInfo() {
    const notes = course.notes.filter(n => n.team === currentTeam), last = WBK.sortNotes(notes).pop();
    $('#notesInfo').textContent = notes.length ? notes.length + (notes.length === 1 ? ' Notiz' : ' Notizen') + ' · zuletzt ' + (last.datum === today() ? 'heute' : WBK.isoToDe(last.datum).slice(0, 6)) : 'noch keine';
  }
  function renderTeamNotes() {
    renderTeamInfo();
    const notes = WBK.sortNotes(course.notes.filter(n => n.team === currentTeam)).reverse();
    const mehrere = new Set(course.notes.map(n => n.von).filter(Boolean)).size > 1;
    const dates = [...new Set([selDate, ...notes.map(n => n.datum)])].sort().reverse();
    $('#teamNotes').innerHTML = dates.map(d => {
      const mine = notes.filter(n => n.datum === d);
      if (!mine.length && d !== selDate) return '';
      return '<div class="section-h">' + esc(longDate(d)) + (d === today() ? ' · Heute' : '') + '</div><div class="group">' + (mine.length
        ? mine.map(n => '<div class="swipe" data-ni="' + course.notes.indexOf(n) + '"><div class="swipe-acts"><button type="button" class="swipe-act" data-act="edit">' + svg('i-pencil') + 'Bearbeiten</button><button type="button" class="swipe-act del" data-act="del">' + svg('i-trash') + 'Löschen</button></div><div class="swipe-row note tappable" role="button" tabindex="0" aria-label="Notiz bearbeiten, nach links wischen für mehr"><div class="note-m"><span>' + esc(n.uhrzeit) + ' Uhr' + (mehrere && n.von ? ' · ' + esc(n.von) : '') + '</span>' + (/am PC/.test(n.quelle || '') ? '<span class="tag">am PC</span>' : '') + '<svg class="chev"><use href="#i-chev"/></svg></div><div class="note-t">' + esc(n.text) + '</div></div></div>').join('')
        : '<div class="empty">Noch keine Notiz an diesem Tag.</div>') + '</div>';
    }).join('');
  }

  // ---------------- Aufnahme-Fenster ----------------
  // job: { team: Name oder ALLE, datum, uhrzeit, aid, transcript, text }
  let job = null;
  function sheetState(st, msg) {
    show('#sheetRec', st === 'rec'); show('#sheetRecBtns', st === 'rec');
    show('#sheetBusy', st === 'busy'); if (st === 'busy') $('#sheetBusyText').textContent = msg || 'Bitte warten …';
    show('#sheetEdit', st === 'edit'); show('#sheetEditBtns', st === 'edit');
    show('#deleteNote', st === 'edit' && !!(job && job.editOf)); $('#discardNote').textContent = job && job.editOf ? 'Abbrechen' : 'Verwerfen';
    show('#sheetErrBtns', st === 'err');
    if (st === 'err') $('#sheetSub').textContent = msg;
    else $('#sheetSub').textContent = longDate(job.datum);
  }
  function openSheet(teamName, state) {
    const tm = teamName === ALLE ? null : teamByName(teamName);
    $('#sheetTitle').textContent = tm ? (tm.teilnehmer || tm.name) + (tm.hund ? ' & ' + tm.hund : '') : 'Alle Teams';
    document.body.classList.add('sheet-open');
    sheetState(state);
  }
  function closeSheet() { document.body.classList.remove('sheet-open'); job = null; S.KV.del('draft2'); }
  // Fenster schließen (Wischen nach unten, Tipp daneben, „Abbrechen“/„Verwerfen“). Gibt false zurück, wenn es offen bleibt.
  // Während Aufnahme oder Spracherkennung bleibt es offen. Ungespeicherter Text wird nur nach Rückfrage verworfen.
  function requestDismiss(knopf) {
    if (!document.body.classList.contains('sheet-open')) return true;
    if (rec && rec.state !== 'inactive') return false;
    if (!$('#sheetBusy').classList.contains('hidden')) return false;
    if (!$('#sheetErrBtns').classList.contains('hidden')) { closeSheet(); restoreDraft(); return true; }
    if ($('#sheetEdit').classList.contains('hidden')) return false;
    const text = $('#noteText').value.trim();
    if (job && job.editOf) {
      if (text !== job.editOf.text.trim() && !confirm('Änderungen verwerfen?\n\nDie Notiz bleibt so, wie sie vorher war.')) return false;
      closeSheet(); return true;
    }
    if (text && !confirm('Notiz verwerfen? Die Aufnahme selbst bleibt in Google Drive gesichert.')) return false;
    S.KV.del('lastAudio'); closeSheet(); return true;
  }
  // Fenster wie in iOS nach unten wegwischen (am Griff oder überall, solange der Inhalt ganz oben steht)
  function initSheetDrag() {
    const sh = $('#sheet'); let d = null;
    const setY = (y, anim) => { sh.style.transition = anim ? '' : 'none'; sh.style.transform = y > 0 ? 'translateY(' + y + 'px)' : ''; };
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const t = e.target, amGriff = !!t.closest('.grab-zone');
      if (!amGriff && (t.closest('textarea,input,select,.segmented,.chips') || sh.scrollTop > 0)) return;
      d = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, y: 0, t0: Date.now(), on: false };
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (!d) return;
      const dy = e.touches[0].clientY - d.y0, dx = e.touches[0].clientX - d.x0;
      if (!d.on) { if (dy < 8 || Math.abs(dx) > dy) { if (Math.abs(dx) > 8 || dy < -8) d = null; return; } d.on = true; }
      e.preventDefault(); d.y = dy; setY(dy, false);
    }, { passive: false });
    const ende = () => {
      if (!d) return; const { y, t0, on } = d; d = null; if (!on) return;
      const schnell = y / Math.max(1, Date.now() - t0) > 0.6;
      if ((y > sh.offsetHeight * 0.3 || (schnell && y > 40)) && requestDismiss()) { sh.style.transition = ''; requestAnimationFrame(() => { sh.style.transform = ''; }); }
      else setY(0, true);
    };
    sh.addEventListener('touchend', ende); sh.addEventListener('touchcancel', ende);
  }
  function renderStil() {
    $('#stilSeg').innerHTML = S.STILE.map(st => '<button type="button" role="radio" aria-checked="' + (st.id === settings.stil) + '" data-stil="' + st.id + '"' + (st.id === settings.stil ? ' class="on"' : '') + ' title="' + esc(st.text) + '">' + esc(STIL_KURZ[st.id] || st.name) + '</button>').join('');
  }
  function chooseStil(id) {
    if (!id || id === settings.stil) return;
    settings.stil = id;
    localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
    renderStil();
    // Text schon da: gleich im neuen Stil neu formulieren
    if (job && !$('#sheetEdit').classList.contains('hidden')) {
      const quelle = job.transcript || $('#noteText').value.trim();
      if (quelle) formulate(quelle);
    }
  }
  function needSetup() {
    if (!course) { toast('Bitte zuerst einen Lehrgang anlegen oder wählen.'); go('lehrgang'); return true; }
    if (!openaiKey()) { toast('Bitte zuerst den OpenAI-Schlüssel eintragen.', 5000); go('einst'); return true; }
    return false;
  }
  function typeNote(teamName) {
    if (!course) return needSetup();
    job = { team: teamName, datum: selDate, uhrzeit: nowTime(), transcript: '', text: '' };
    fillEdit(); openSheet(teamName, 'edit'); $('#noteText').focus();
  }

  // Aufnahme mit Tonwelle, Pause und Weiter-Aufnehmen
  let rec = null, chunks = [], recTimer = null, wakeLock = null, audioCtx = null, analyser = null, raf = 0, cancelled = false;
  let elapsed = 0, runStart = 0, paused = false; // Aufnahmezeit ohne Pausen
  const recSeconds = () => Math.floor((elapsed + (paused ? 0 : Date.now() - runStart)) / 1000);
  // append = true: an die bestehende Notiz anhängen (nach „Fertig“ weiter aufnehmen)
  async function startRec(teamName, append) {
    if (needSetup()) return;
    if (rec && rec.state !== 'inactive') return;
    if (!append || !job) { job = { team: teamName, datum: selDate, uhrzeit: nowTime() }; openSheet(teamName, 'rec'); }
    else { saveDraft(); job.append = true; sheetState('rec'); }
    elapsed = 0; paused = false; setPauseUi();
    $('#recTime').textContent = '0:00';
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { if (append) sheetState('edit'); else closeSheet(); toast('Kein Zugriff aufs Mikrofon: ' + e.message, 5000); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    chunks = []; cancelled = false;
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (cancelled) return;
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
      const uhrzeit = nowTime();
      if (!job.append) job.uhrzeit = uhrzeit;
      // Sofort sichern: erst auf dem Gerät, dann (sobald Netz da ist) in Google Drive – noch vor der KI-Verarbeitung.
      // Jeder Teil (auch angehängte) ist eine eigene Aufnahme.
      const teamName = job.team === ALLE ? 'Alle Teams' : job.team;
      const item = { aid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), courseId: activeId, datum: job.datum, uhrzeit, team: teamName, von: myName(),
        mime: blob.type || 'audio/webm', blob, transcript: null, created: Date.now() };
      job.aid = item.aid;
      await S.Outbox.put(item);
      await S.KV.set('lastAudio', { blob, aid: item.aid, datum: item.datum, uhrzeit: job.uhrzeit, team: job.team, append: !!job.append, prev: job.append ? (job.transcript || job.text || '') : '' });
      syncOutbox();
      processAudio(blob);
    };
    rec.start(1000);
    runStart = Date.now();
    recTimer = setInterval(() => { $('#recTime').textContent = mmss(recSeconds()); }, 250);
    drawWave(stream);
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* nicht überall verfügbar */ }
  }
  function setPauseUi() {
    $('#pauseLbl').textContent = paused ? 'Weiter' : 'Pause';
    $('#pauseBtn').innerHTML = svg(paused ? 'i-mic' : 'i-pause');
    $('#pauseBtn').classList.toggle('on', paused);
    $('#pauseBtn').setAttribute('aria-label', paused ? 'Aufnahme fortsetzen' : 'Pause');
    $('#sheet').classList.toggle('paused', paused);
  }
  function togglePause() {
    if (!rec || rec.state === 'inactive') return;
    if (!paused) { rec.pause(); elapsed += Date.now() - runStart; paused = true; }
    else { rec.resume(); runStart = Date.now(); paused = false; }
    setPauseUi();
  }
  // Flüssige Tonwelle: jedes Bild neu gezeichnet, Balken gleiten weich nach links, Pegel geglättet
  function drawWave(stream) {
    const cv = $('#wave'), g = cv.getContext('2d'), red = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff3b30';
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * dpr) || 600; cv.height = Math.round(cv.clientHeight * dpr) || 112;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (e) { analyser = null; }
    const data = new Uint8Array(analyser ? analyser.fftSize : 1);
    const STEP = 9 * dpr, BAR = 3 * dpr, SPEED = 0.06; // Balkenabstand, -breite, Pixel pro ms
    const n = Math.ceil(cv.width / STEP) + 2, bars = new Array(n).fill(0);
    let level = 0, offset = 0, last = performance.now();
    const loop = now => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(64, now - last); last = now;
      let target = 0;
      if (!paused && analyser) { analyser.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = data[i] - 128; sum += v * v; } target = Math.min(1, Math.sqrt(sum / data.length) / 28); }
      level += (target - level) * Math.min(1, dt / 60);
      if (!paused) { offset += dt * SPEED * dpr; while (offset >= STEP) { offset -= STEP; bars.push(level); bars.shift(); } }
      const w = cv.width, h = cv.height, mid = h / 2;
      g.clearRect(0, 0, w, h); g.fillStyle = red; g.globalAlpha = paused ? 0.4 : 1;
      for (let i = 0; i < n; i++) {
        const x = w - (n - 1 - i) * STEP - offset;
        const bh = Math.max(BAR, (i === n - 1 ? level : bars[i]) * (h - 4 * dpr));
        g.beginPath(); if (g.roundRect) g.roundRect(x - BAR / 2, mid - bh / 2, BAR, bh, BAR / 2); else g.rect(x - BAR / 2, mid - bh / 2, BAR, bh); g.fill();
      }
    };
    raf = requestAnimationFrame(loop);
  }
  function stopRec(cancel) {
    cancelled = !!cancel;
    clearInterval(recTimer); cancelAnimationFrame(raf);
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (rec && rec.state !== 'inactive') rec.stop();
    paused = false; setPauseUi();
    if (cancel) { if (job && job.append) { job.append = false; sheetState('edit'); } else closeSheet(); }
    else sheetState('busy', 'Spracherkennung läuft …');
  }
  async function processAudio(blob) {
    try {
      sheetState('busy', 'Spracherkennung läuft …');
      const fach = S.glossarHinweis(glossarAktiv());
      const hint = ('Hundetraining. Teams: ' + course.teams.map(t => t.teilnehmer + ' mit ' + t.hund).join(', ') + '.' + (fach ? ' Fachbegriffe: ' + fach + '.' : '')).slice(0, 2000);
      const text = await S.transcribe(blob, { key: openaiKey(), model: settings.sttModel, hint });
      if (job.aid && text) await keepTranscript(job.aid, text);
      const vorher = job.append ? (job.transcript || job.text || '').trim() : '';
      job.append = false;
      if (!text) { if (!vorher) job.text = ''; fillEdit(); sheetState('edit'); toast('Es wurde nichts verstanden.' + (vorher ? '' : ' Du kannst den Text eintippen.'), 5000); return; }
      job.transcript = vorher ? vorher + '\n\n' + text : text;
      await formulate(job.transcript);
    } catch (e) { sheetState('err', 'Spracherkennung fehlgeschlagen: ' + e.message + '. Die Aufnahme ist gesichert.'); }
  }
  async function formulate(quelle) {
    try {
      sheetState('busy', 'Formuliere im Stil „' + (STIL_KURZ[settings.stil] || (S.STILE.find(s => s.id === settings.stil) || S.STILE[0]).name) + '“ …');
      const tm = job.team === ALLE ? null : teamByName(job.team);
      const r = await S.formulate(quelle, tm, { key: openaiKey(), model: settings.llmModel, stil: settings.stil, glossar: glossarAktiv() });
      job.text = r.text; job.unklar = r.unklar;
      fillEdit(); sheetState('edit'); saveDraft();
    } catch (e) {
      // Ohne KI weiter: Rohtext zum Bearbeiten anbieten
      job.text = job.text || quelle; fillEdit(); sheetState('edit'); saveDraft();
      toast('Formulieren fehlgeschlagen: ' + e.message, 6000);
    }
  }
  function fillEdit() {
    $('#noteText').value = job.text || '';
    renderUnklar();
  }

  // ---------------- „Meinst du …?“ – unsichere Wörter klären (wie im Fidus-K9-Lexikon) ----------------
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Groß-/Kleinschreibung und Leerzeichen müssen nicht exakt passen; nur ganze Wörter
  const wortMuster = w => new RegExp('(?<![\\p{L}\\p{N}])' + reEsc(w.trim()).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'giu');
  const wortKern = w => String(w || '').replace(/^[\s„“"'‚‘(]+|[\s„“"'‚‘).,;:!?]+$/g, '');
  function renderUnklar() {
    const box = $('#unklarBox'), text = $('#noteText').value;
    const liste = ((job && job.unklar) || []).map((u, i) => ({ u, i })).filter(x => wortMuster(x.u.wort).test(text));
    box.innerHTML = liste.map(x => '<button type="button" class="chip" data-unklar="' + x.i + '">' + (x.u.vorschlag ? 'Meinst du „' + esc(x.u.vorschlag) + '“?' : 'Stimmt „' + esc(x.u.wort) + '“?') + '<small>erkannt: ' + esc(x.u.wort) + '</small></button>').join('');
    show(box, liste.length > 0);
  }
  function openMeinst(i) {
    const u = job && job.unklar && job.unklar[i]; if (!u) return;
    const v = (u.vorschlag || '').trim();
    openModal('<h3>Meinst du …?</h3><p class="modal-sub">Erkannt wurde <mark>' + esc(u.wort) + '</mark></p>' +
      '<div class="group m-group">' +
      (v ? '<label class="cell"><input type="radio" name="mw" value="v" checked><div class="cell-tx wrap"><b>' + esc(v) + '</b><span>Vorschlag</span></div></label>' : '') +
      '<label class="cell"><input type="radio" name="mw" value="s"><div class="cell-tx wrap"><b>„' + esc(u.wort) + '“ stimmt so</b></div></label>' +
      '<label class="cell"><input type="radio" name="mw" value="a"' + (v ? '' : ' checked') + '><input class="m-input" id="mwAnders" placeholder="Anderes Wort …" autocomplete="off" autocorrect="off"></label></div>' +
      '<div class="group m-group"><label class="cell"><div class="cell-tx"><b>Ins Glossar übernehmen</b></div><input type="checkbox" class="switch" id="mwGl" checked></label></div>' +
      '<p class="modal-foot" id="mwFuss"></p>' +
      '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="mwOk">Übernehmen</button></div>');
    const wahl = () => ($('#modal input[name=mw]:checked') || {}).value;
    const richtig = () => wahl() === 'v' ? v : wahl() === 'a' ? $('#mwAnders').value.trim() : '';
    const upd = () => {
      const gl = $('#mwGl').checked, r = richtig();
      $('#mwOk').disabled = wahl() !== 's' && !r;
      $('#mwFuss').textContent = !gl ? 'Nur diese Notiz wird geändert.' : wahl() === 's' ? '„' + wortKern(u.wort) + '“ kommt als Fachbegriff ins Glossar und wird künftig so erkannt.' : r ? 'Künftig wird „' + wortKern(u.wort) + '“ als „' + r + '“ erkannt.' : 'Die Korrektur kommt ins Glossar.';
    };
    $('#modal').oninput = $('#modal').onchange = upd;
    $('#mwAnders').addEventListener('focus', () => { $('#modal input[name=mw][value=a]').checked = true; upd(); });
    $('#mwAnders').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#mwOk').disabled) $('#mwOk').click(); });
    $('#mwOk').addEventListener('click', () => { korrigieren(u, richtig(), $('#mwGl').checked); closeModal(); });
    upd();
  }
  function korrigieren(u, richtig, insGlossar) {
    const ta = $('#noteText');
    let ersetzt = 0;
    if (richtig) ta.value = ta.value.replace(wortMuster(u.wort), () => { ersetzt++; return richtig; });
    job.unklar = job.unklar.filter(x => x !== u);
    saveDraft(); renderUnklar();
    const kern = wortKern(u.wort);
    if (insGlossar && richtig && lc(richtig) !== lc(kern)) {
      const g = settings.glossar.find(x => lc(x.begriff) === lc(richtig));
      if (g) { if ((g.falsch || '').split(/,\s*/).indexOf(kern) < 0) g.falsch = g.falsch ? g.falsch + ', ' + kern : kern; }
      else settings.glossar.push({ begriff: richtig, falsch: kern });
      saveGlossar();
    } else if (insGlossar && kern && !richtig) {
      if (!settings.glossar.some(x => lc(x.begriff) === lc(kern))) { settings.glossar.push({ begriff: kern, falsch: '' }); saveGlossar(); }
    }
    if (richtig && !ersetzt) toast('„' + u.wort + '“ steht so nicht mehr im Text. Bitte von Hand ändern.', 5000);
    else toast(insGlossar ? '✓ Übernommen, Glossar ergänzt' : '✓ Übernommen');
  }

  // ---------------- Glossar pflegen ----------------
  function saveGlossar() {
    settings.glossar.sort((a, b) => a.begriff.localeCompare(b.begriff, 'de'));
    localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
    syncSettingsToDrive();
    renderGlossar();
  }
  function renderGlossar() {
    const zeile = (g, attr) => '<button type="button" class="cell" ' + attr + '><div class="cell-tx wrap"><b>' + esc(g.begriff) + '</b>' + (g.falsch ? '<span>oft erkannt als: ' + esc(g.falsch) + '</span>' : '') + '</div><svg class="chev"><use href="#i-chev"/></svg></button>';
    const n = settings.glossar.length, v = vordefGlossar(), ges = glossarAktiv().length;
    $('#glossCount').textContent = ges === 1 ? '1 Begriff' : ges + ' Begriffe';
    $('#glossH').textContent = 'Meine Begriffe (' + n + ')';
    $('#glossList').innerHTML = settings.glossar.map((g, i) => zeile(g, 'data-gl="' + i + '"')).join('') || '<div class="empty">Noch keine Begriffe.</div>';
    const f = fremdGlossar();
    show('#glossFremdBox', f.length > 0);
    $('#glossFremd').innerHTML = f.map((g, i) => zeile(Object.assign({}, g, { falsch: (g.falsch ? g.falsch + ' · ' : '') + 'von ' + (g.von || 'Kollege') }), 'data-glf="' + i + '"')).join('');
    show('#glossVordefBox', v.length > 0);
    $('#glossVordefH').textContent = 'Vordefiniert (' + v.length + ')';
    $('#glossVordef').innerHTML = v.map((g, i) => zeile(g, 'data-glv="' + i + '"')).join('');
  }
  function openBegriff(i, vorlage) {
    const alt = i >= 0 ? settings.glossar[i] : vorlage || null;
    openModal('<h3>' + (i >= 0 ? 'Begriff' : 'Neuer Begriff') + '</h3>' +
      '<div class="group form m-group"><label class="field"><span>Begriff</span><input id="gB" placeholder="z. B. Hetzarm" autocomplete="off" value="' + esc(alt ? alt.begriff : '') + '"></label>' +
      '<label class="field"><span>Oft erkannt als</span><input id="gF" placeholder="optional" autocomplete="off" value="' + esc(alt ? (alt.falsch || '') : '') + '"></label></div>' +
      '<p class="modal-foot">Mehrere Fehlerkennungen mit Komma trennen, z. B. „Hetz Arm, Hetzerarm“.</p>' +
      '<div class="actions"><button class="btn-gray" data-m="close">Abbrechen</button><button class="btn-filled" id="gOk">Sichern</button></div>' +
      (i >= 0 ? '<button class="danger" id="gDel">Begriff löschen</button>' : ''));
    const upd = () => { $('#gOk').disabled = !$('#gB').value.trim(); };
    $('#modal').oninput = upd; $('#modal').onchange = null; upd();
    if (!alt) setTimeout(() => $('#gB').focus(), 50);
    $('#gOk').addEventListener('click', () => {
      const neu = { begriff: $('#gB').value.trim(), falsch: $('#gF').value.trim().replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '') };
      if (!neu.begriff) return;
      const dop = settings.glossar.findIndex((x, j) => j !== i && lc(x.begriff) === lc(neu.begriff));
      if (dop >= 0 && i < 0) { const d = settings.glossar[dop]; neu.falsch = [d.falsch, neu.falsch].filter(Boolean).join(', '); settings.glossar[dop] = neu; }
      else if (i >= 0) settings.glossar[i] = neu; else settings.glossar.push(neu);
      saveGlossar(); closeModal(); toast('✓ Glossar gespeichert');
    });
    if (i >= 0) $('#gDel').addEventListener('click', () => { if (!confirm('„' + alt.begriff + '“ aus dem Glossar löschen?')) return; settings.glossar.splice(i, 1); saveGlossar(); closeModal(); });
  }
  // Oben auf der Glossar-Seite: hinzufügen, Felder leeren, gleich das nächste Wort eintippen (Tastatur bleibt offen)
  function glossarHinzufuegen(ev) {
    ev.preventDefault();
    const b = $('#gaB').value.trim(), f = $('#gaF').value.trim().replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '');
    if (!b) { $('#gaB').focus(); return; }
    const d = settings.glossar.find(x => lc(x.begriff) === lc(b));
    if (d) { if (f) d.falsch = [d.falsch, f].filter(Boolean).join(', '); }
    else settings.glossar.push({ begriff: b, falsch: f });
    saveGlossar();
    $('#gaB').value = ''; $('#gaF').value = ''; $('#gaB').focus();
    toast('✓ „' + b + '“ ' + (d ? 'ergänzt' : 'hinzugefügt'), 1500);
  }
  function openModal(html) { $('#modalCard').innerHTML = html; document.body.classList.add('modal-open'); }
  function closeModal() { document.body.classList.remove('modal-open'); $('#modal').oninput = $('#modal').onchange = null; }
  function saveDraft() { if (job) { job.text = $('#noteText').value; S.KV.set('draft2', Object.assign({ courseId: activeId }, job)); } }
  // Eigenes Glossar im Lehrgang ablegen, damit der zweite Trainer es mitbenutzt (eigene Zeilen werden ersetzt)
  function glossarInKurs(c) {
    const me = myName() || 'Trainer';
    c.glossar = (c.glossar || []).filter(g => g.von !== me).concat(settings.glossar.map(g => ({ begriff: g.begriff, falsch: g.falsch || '', von: me })));
  }
  async function saveNote() {
    saveDraft();
    const text = job.text.trim();
    if (!text) { toast('Kein Text vorhanden.'); return; }
    if (job.editOf) return saveEdit(text);
    const teams = job.team === ALLE ? course.teams.map(t => t.name) : [job.team];
    const neu = teams.map(team => ({ datum: job.datum, uhrzeit: job.uhrzeit, team, text, quelle: job.transcript ? 'Sprachnotiz' : 'Eingetippt', von: myName() }));
    const drin = (c, n) => c.notes.some(m => m.datum === n.datum && m.uhrzeit === n.uhrzeit && m.team === n.team && m.text === n.text.trim());
    try {
      await withStore('Speichere im Lehrgang …', () => modifyCourse(c => { c.notes.push(...neu.filter(n => !drin(c, n))); glossarInKurs(c); }, c => neu.every(n => drin(c, n))));
      if (job.aid) await S.KV.del('lastAudio');
      closeSheet(); banner('');
      toast('✓ Gespeichert');
      renderToday(); if (currentTeam) renderTeamNotes();
    } catch (e) { /* Meldung kam schon; Entwurf bleibt erhalten */ }
  }

  // ---------------- Gespeicherte Notiz bearbeiten / löschen ----------------
  // Eine Notiz wird an Datum, Uhrzeit, Team, Text und Sprecher erkannt (auch wenn ein Kollege inzwischen etwas ergänzt hat).
  const gleich = (a, b) => a.datum === b.datum && a.uhrzeit === b.uhrzeit && a.team === b.team && (a.text || '').trim() === (b.text || '').trim() && (a.von || '') === (b.von || '');
  function editNote(i) {
    const n = course.notes[i]; if (!n) return;
    job = { team: n.team, datum: n.datum, uhrzeit: n.uhrzeit, transcript: '', text: n.text, editOf: { datum: n.datum, uhrzeit: n.uhrzeit, team: n.team, text: n.text, von: n.von || '' } };
    fillEdit(); openSheet(n.team, 'edit');
  }
  async function saveEdit(text) {
    const alt = job.editOf;
    if (text === alt.text.trim()) { closeSheet(); return; }
    let gefunden = true;
    try {
      await withStore('Speichere Änderung …', () => modifyCourse(c => {
        const n = c.notes.find(m => gleich(m, alt));
        if (n) { n.text = text; n.quelle = (n.quelle || 'Sprachnotiz').replace(/ \(bearbeitet\)$/, '') + ' (bearbeitet)'; gefunden = true; }
        else if (!c.notes.some(m => m.datum === alt.datum && m.uhrzeit === alt.uhrzeit && m.team === alt.team && m.text === text)) { gefunden = false; c.notes.push({ datum: alt.datum, uhrzeit: alt.uhrzeit, team: alt.team, text, quelle: 'Bearbeitet', von: myName() }); }
      }, c => c.notes.some(m => m.datum === alt.datum && m.team === alt.team && m.text === text)));
      closeSheet();
      toast(gefunden ? '✓ Änderung gespeichert' : 'Die Notiz wurde inzwischen woanders geändert. Deine Fassung ist zusätzlich gespeichert.', gefunden ? 3000 : 6000);
      renderToday(); if (currentTeam) renderTeamNotes();
    } catch (e) { /* gemeldet, Entwurf bleibt */ }
  }
  // Löschen aus dem Bearbeiten-Fenster (alt = job.editOf) oder per Wischen in der Liste (alt = Notiz)
  async function deleteNote(alt, ausSheet) {
    if (!alt) return;
    if (!confirm('Diese Notiz löschen?\n\nVor dem Löschen legt die App automatisch eine Sicherung der Excel-Datei im Ordner „Sicherungen“ an. Die Sprachaufnahme bleibt im Ordner „Aufnahmen“ erhalten.')) return false;
    alt = { datum: alt.datum, uhrzeit: alt.uhrzeit, team: alt.team, text: alt.text, von: alt.von || '' };
    try {
      await withStore('Lösche Notiz …', () => modifyCourse(c => { const k = c.notes.findIndex(m => gleich(m, alt)); if (k >= 0) c.notes.splice(k, 1); }, c => !c.notes.some(m => gleich(m, alt))));
      if (ausSheet) closeSheet();
      toast('✓ Notiz gelöscht');
      renderToday(); if (currentTeam) renderTeamNotes();
    } catch (e) { /* gemeldet */ }
  }

  // ---------------- Wischen nach links (iOS-Listenaktionen) ----------------
  // Antippen öffnet die Notiz, nach links wischen zeigt „Bearbeiten“ und „Löschen“.
  // Eigene Zeigerereignisse statt „click“, damit Antippen auf dem iPhone zuverlässig reagiert.
  function initSwipe(list, onTap, onAct) {
    let g = null, open = null, wischte = 0;
    const breite = sw => sw.querySelector('.swipe-acts').offsetWidth;
    const setX = (sw, x, anim) => { const r = sw.querySelector('.swipe-row'); r.style.transition = anim ? '' : 'none'; r.style.transform = x ? 'translateX(' + x + 'px)' : ''; sw.classList.toggle('offen', x < 0); };
    const zu = () => { if (open) { setX(open, 0, true); open = null; } };
    list.addEventListener('pointerdown', e => {
      const sw = e.target.closest('.swipe'); if (!sw || e.button > 0) return;
      if (e.target.closest('.swipe-act')) return;
      g = { sw, x0: e.clientX, y0: e.clientY, dx: 0, start: open === sw ? -breite(sw) : 0, mode: null, id: e.pointerId };
    });
    list.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (g.mode === 'h') { if (open && open !== g.sw) zu(); try { g.sw.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      if (g.mode !== 'h') return;
      const w = breite(g.sw); let x = g.start + dx;
      if (x > 0) x = 0; if (x < -w) x = -w - (-w - x) / 3; // am Ende leicht gebremst
      g.dx = dx; g.x = x; setX(g.sw, x, false);
    });
    const ende = e => {
      if (!g || e.pointerId !== g.id) return;
      const sw = g.sw, mode = g.mode, x = g.x || 0; g = null;
      if (mode === 'h') {
        const w = breite(sw);
        if (x < -w / 2) { setX(sw, -w, true); open = sw; } else { setX(sw, 0, true); if (open === sw) open = null; }
        return;
      }
      if (mode) wischte = Date.now();
    };
    list.addEventListener('pointerup', ende);
    list.addEventListener('pointercancel', ende);
    // Antippen über „click“ (die Zeile hat cursor:pointer, damit iOS es meldet); nach dem Wischen kein Antippen
    list.addEventListener('click', e => {
      const b = e.target.closest('.swipe-act'), sw = e.target.closest('.swipe'); if (!sw) return;
      if (b) { zu(); onAct(b.dataset.act, Number(sw.dataset.ni)); return; }
      if (Date.now() - wischte < 400) return;
      if (open) { zu(); return; } // erstes Antippen schließt nur die offenen Aktionen
      onTap(Number(sw.dataset.ni));
    });
    list.addEventListener('keydown', e => {
      const r = e.target.closest('.swipe-row');
      if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTap(Number(r.closest('.swipe').dataset.ni)); }
    });
    document.addEventListener('pointerdown', e => { if (open && !open.contains(e.target)) zu(); }, true);
    return { zu };
  }

  // ---------------- Sicherung der Aufnahmen (Warteschlange → Google Drive) ----------------
  async function keepTranscript(aid, text) {
    const it = await S.Outbox.get(aid);
    if (it) { it.transcript = text; await S.Outbox.put(it); }
    syncOutbox();
  }
  let syncing = false;
  async function syncOutbox() {
    if (syncing) return;
    syncing = true;
    let changed = false;
    try {
      for (const it of await S.Outbox.all()) {
        if (!S.Drive.connected() || !navigator.onLine) break;
        try {
          if (it.blob && !it.audioId) { it.audioId = await S.Drive.saveRecording(it, 'aufnahme'); it.blob = null; await S.Outbox.put(it); changed = true; }
          if (it.transcript && !it.textId) { it.textId = await S.Drive.saveRecording(it, 'rohtext'); await S.Outbox.put(it); changed = true; }
          // Fertig, wenn Audio und Rohtext in Drive liegen. Ohne Rohtext (Spracherkennung fehlgeschlagen) bleibt der Eintrag 30 Tage stehen.
          if (it.audioId && (it.textId || Date.now() - it.created > 30 * 86400000)) await S.Outbox.del(it.aid);
        } catch (e) { console.warn('Sicherung später erneut', e); if (e.needsLogin) break; }
      }
    } finally { syncing = false; }
    if (changed) recCache = null;
    updateSyncInfo();
  }
  async function updateSyncInfo() {
    const n = (await S.Outbox.all()).filter(it => it.blob || (it.transcript && !it.textId)).length;
    $('#syncInfo').textContent = n ? n + (n > 1 ? ' Aufnahmen warten' : ' Aufnahme wartet') + ' auf die Sicherung in Google Drive (bleibt bis dahin auf dem Handy).' : '';
    show('#syncInfo', !!n);
  }

  // ---------------- Aufnahmen anzeigen und abspielen ----------------
  let recCache = null;
  async function recordings() {
    if (recCache && recCache.id === activeId) return recCache.list;
    const list = await S.Drive.listRecordings(activeId);
    (await S.Outbox.all()).filter(it => it.courseId === activeId && it.blob).forEach(it => list.unshift({ aid: it.aid, datum: it.datum, uhrzeit: it.uhrzeit, team: it.team || '', von: it.von || '', local: it }));
    recCache = { id: activeId, list };
    return list;
  }
  async function renderRecordings(el, filter) {
    if (!activeId) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="empty">Lade Aufnahmen …</div>';
    let list;
    try { list = (await recordings()).filter(r => !filter || filter(r)); } catch (e) { el.innerHTML = '<div class="empty">Aufnahmen konnten nicht geladen werden (' + esc(e.message) + ').</div>'; return; }
    el.innerHTML = list.length ? list.map(r =>
      '<div class="cell rec-cell" data-aid="' + esc(r.aid) + '">' + (r.audioId || r.local ? '<button class="play" data-play aria-label="Anhören">' + svg('i-play') + '</button>' : '') +
      '<div class="cell-tx"><b>' + esc(longDate(r.datum)) + '</b><span>' + esc(r.uhrzeit) + ' Uhr' + (filter && r.team ? '' : r.team ? ' · ' + esc(r.team) : '') + (r.von && r.von !== myName() ? ' · ' + esc(r.von) : '') + (r.local ? ' · noch nicht in Drive' : '') + '</span></div>' +
      (r.textId ? '<button class="text-btn" data-text>Rohtext</button>' : '') + '</div>').join('')
      : '<div class="empty">Noch keine Aufnahmen.</div>';
    el.onclick = async e => {
      const cell = e.target.closest('.rec-cell'); if (!cell) return;
      const r = list.find(x => x.aid === cell.dataset.aid);
      const b = e.target.closest('[data-play]'), tb = e.target.closest('[data-text]');
      if (b) {
        try {
          b.disabled = true;
          const blob = r.local ? r.local.blob : await S.Drive.loadBlob(r.audioId);
          const a = document.createElement('audio'); a.controls = true; a.setAttribute('playsinline', ''); a.src = URL.createObjectURL(blob);
          b.remove(); cell.appendChild(a); a.play().catch(() => {});
        } catch (err) { b.disabled = false; toast(err.message, 5000); }
      }
      if (tb) {
        let box = cell.querySelector('.rohtext');
        if (box) { box.remove(); return; }
        box = document.createElement('div'); box.className = 'rohtext'; box.textContent = 'Lade …'; cell.appendChild(box);
        try { const t = await (await S.Drive.loadBlob(r.textId)).text(); box.textContent = t.replace(/^[\s\S]*?Spracherkennung\)\s*/, ''); }
        catch (err) { box.textContent = err.message; }
      }
    };
  }

  // ---------------- Lehrgänge verwalten ----------------
  // Lehrgänge aus Drive, ohne die vom Nutzer ausgeblendeten (geteilte, die er aus seiner Liste entfernt hat)
  async function listCourses() { const hid = settings.ausgeblendet || []; return (await store().list()).filter(f => !hid.includes(f.id)); }
  // Lehrgang löschen: eigener → Ordner in den Papierkorb (30 Tage wiederherstellbar); geteilter → nur aus der eigenen Liste entfernen
  async function deleteCourse() {
    if (!activeId || !course) return toast('Kein Lehrgang gewählt.');
    const f = courses.find(x => x.id === activeId);
    const name = course.meta.titel || 'Lehrgang';
    const geteilt = f && f.ownedByMe === false;
    const frage = geteilt
      ? '„' + name + '“ aus deiner Liste entfernen?\n\nDer Lehrgang gehört einem anderen Trainer und bleibt bei ihm vollständig erhalten. Du kannst ihn später über „Geteilten Lehrgang hinzufügen“ wieder holen.'
      : '„' + name + '“ wirklich löschen?\n\nDer ganze Lehrgangsordner (Excel-Datei, alle Aufnahmen und Sicherungen) kommt in den Papierkorb deines Google Drive. Dort kannst du ihn 30 Tage lang wiederherstellen, danach ist er endgültig weg.' + (info && info.shared ? '\n\nAchtung: Der Lehrgang ist mit einem anderen Trainer geteilt. Auch er verliert ihn.' : '');
    if (!confirm(frage)) return;
    const id = activeId;
    try {
      if (geteilt) {
        settings.ausgeblendet = [...new Set([...(settings.ausgeblendet || []), id])];
        localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
      } else {
        await withStore('Verschiebe in den Papierkorb …', () => S.Drive.trashCourse(id));
      }
      await S.KV.del('course:' + id); localStorage.removeItem('baumprojekt.folders.' + id);
      course = null; info = null; setActive('');
      await loadActive();
      syncSettingsToDrive(true);
      refreshCourses(); fillCourseSelects();
      toast(geteilt ? '✓ Aus deiner Liste entfernt' : '✓ In den Papierkorb verschoben', 4000);
    } catch (e) { /* gemeldet */ }
  }
  function fillCourseSelects() {
    const nm = f => f.name.replace(/\.xlsx$/, '').replace(/^Lehrgang /, '');
    const cur0 = courses.find(f => f.id === activeId);
    const html = (courses.length
      ? (cur0 ? '' : '<option value="" selected disabled>Bitte wählen</option>') + courses.map(f => '<option value="' + esc(f.id) + '"' + (f.id === activeId ? ' selected' : '') + '>' + esc(nm(f)) + (f.ownedByMe === false ? ' (geteilt)' : '') + '</option>').join('')
      : '<option value="" disabled selected>Noch keine Lehrgänge</option>') + '<option value="__neu">+ Neuer Lehrgang …</option>';
    ['#courseSelect', '#courseSelectTop'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
  }
  async function loadCourseList() { try { courses = await listCourses(); } catch (e) { /* offline */ } fillCourseSelects(); }
  async function switchCourse(e) {
    const v = e.target.value;
    if (v === '__neu') { fillCourseSelects(); go('lehrgang'); openCourseForm(false); return; }
    if (!v || v === activeId) return;
    setActive(v, true); selDate = today();
    await withStore('Lade Lehrgang …', loadActive).catch(() => {});
    fillCourseSelects();
    if (!$('#v-lehrgang').classList.contains('hidden')) refreshCourses();
  }
  async function refreshCourses() {
    $('#driveLink').classList.add('hidden');
    try { courses = await withStore('Lade Lehrgänge …', listCourses); } catch (e) { courses = []; }
    const nm = f => f.name.replace(/\.xlsx$/, '').replace(/^Lehrgang /, '');
    const cur0 = courses.find(f => f.id === activeId);
    fillCourseSelects();
    $('#deleteCourseBtn').textContent = cur0 && cur0.ownedByMe === false ? 'Aus meiner Liste entfernen' : 'Lehrgang löschen';
    show('#deleteCourseBtn', !!cur0);
    $('#courseName').textContent = cur0 ? nm(cur0) : (courses.length ? 'Bitte wählen' : 'Noch keiner');
    $('#courseInfo').textContent = cur0 ? (cur0.ownedByMe === false ? 'geteilt von ' + (((cur0.owners || [])[0] || {}).displayName || 'Kollege') + ' · ' : '') + 'geändert ' + new Date(cur0.modifiedTime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : (courses.length ? courses.length + ' Lehrgänge' : 'Tippe oben rechts auf Plus');
    const cur = courses.find(f => f.id === activeId);
    if (cur) S.Drive.withFolders(cur.id, f => f).then(f => { $('#driveLink').href = 'https://drive.google.com/drive/folders/' + f.folder; show('#driveLink', true); }).catch(() => {});
    $('#allRecs').open = false;
    renderShare();
  }

  // ---------------- Gemeinsame Lehrgänge (zweiter Trainer) ----------------
  async function renderShare() {
    const box = $('#shareBox');
    if (!box) return;
    if (!activeId || !info || info.id !== activeId) { box.innerHTML = ''; show('#shareSec', false); return; }
    show('#shareSec', true);
    if (!info.ownedByMe) {
      const owner = (info.owners || [])[0] || {};
      box.innerHTML = '<div class="cell"><div class="cell-tx wrap"><b>Geteilt von ' + esc(owner.displayName || owner.emailAddress || 'einem Kollegen') + '</b><span>' +
        (info.sharedKey ? 'Für die Spracherkennung wird der OpenAI-Schlüssel von ' + esc(info.sharedKeyBy || owner.displayName || 'deinem Kollegen') + ' genutzt.' : 'Für die Spracherkennung wird dein eigener OpenAI-Schlüssel genutzt.') + '</span></div></div>';
      return;
    }
    let list = [];
    try { const f = await S.Drive.withFolders(activeId, x => x); list = await S.Drive.shares(f.folder); } catch (e) { /* offline */ }
    box.innerHTML = list.map(p => '<div class="cell"><div class="cell-tx"><b>' + esc(p.displayName || p.emailAddress) + '</b><span>' + esc(p.emailAddress || '') + ' · kann einsprechen</span></div><button class="text-btn" data-unshare="' + esc(p.id) + '">Entfernen</button></div>').join('') +
      '<button class="cell link-cell" id="inviteBtn">Trainer einladen</button>' +
      '<label class="cell"><div class="cell-tx wrap"><b>Meinen OpenAI-Schlüssel mitbenutzen lassen</b><span>Eingeladene Trainer sprechen dann über deinen Schlüssel ein (Kosten bei dir). Sonst braucht jeder einen eigenen.</span></div><input type="checkbox" class="switch" id="shareKey"' + (info.sharedKey ? ' checked' : '') + '></label>';
  }
  async function invite() {
    const email = (prompt('E-Mail-Adresse (Google-Konto) des Trainers, der mit einsprechen soll:') || '').trim();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Das ist keine gültige E-Mail-Adresse.');
    const titel = (course && course.meta.titel) || '';
    try {
      await withStore('Lade ein …', async () => {
        const f = await S.Drive.withFolders(activeId, x => x);
        const link = location.origin + location.pathname + '?lehrgang=' + encodeURIComponent(f.folder);
        await S.Drive.share(f.folder, email, myName() + ' hat dich zum Lehrgang „' + titel + '“ in Baumprojekt eingeladen. So machst du mit: ' + link + ' öffnen, mit diesem Google-Konto anmelden und „Hinzufügen“ tippen.');
      });
      toast('✓ Eingeladen. ' + email + ' bekommt eine E-Mail von Google. Wichtig: Das Konto muss für Baumprojekt freigeschaltet sein.', 7000);
      await loadInfo();
    } catch (e) { /* gemeldet */ }
  }
  async function unshare(permId) {
    if (!confirm('Diesen Trainer aus dem Lehrgang entfernen? Er kann dann nichts mehr sehen oder einsprechen. Seine bisherigen Notizen bleiben.')) return;
    try { await withStore('Entferne …', async () => { const f = await S.Drive.withFolders(activeId, x => x); await S.Drive.unshare(f.folder, permId); }); renderShare(); } catch (e) { /* gemeldet */ }
  }
  async function toggleShareKey(on) {
    if (on && !settings.openaiKey) { toast('Bitte zuerst unter Einstellungen deinen OpenAI-Schlüssel eintragen.', 5000); renderShare(); return; }
    if (on && !confirm('Eingeladene Trainer können dann über deinen OpenAI-Schlüssel einsprechen, die Kosten laufen über dein Konto. Einverstanden?')) { renderShare(); return; }
    try { await withStore('Speichere …', () => S.Drive.setSharedKey(activeId, on ? settings.openaiKey : null, myName())); toast(on ? '✓ Schlüssel für diesen Lehrgang freigegeben' : '✓ Freigabe des Schlüssels beendet'); }
    catch (e) { /* gemeldet */ }
    await loadInfo();
  }
  // Eingeladener Trainer: geteilten Lehrgang auswählen. Wegen des eingeschränkten Google-Zugriffs (drive.file)
  // muss er Datei und Ordner einmal selbst in der Google-Auswahl antippen, dann darf die App damit arbeiten.
  async function addShared(folderId) {
    if (!S.Drive.connected()) return toast('Bitte zuerst anmelden.');
    let parent = folderId || '';
    for (let runde = 0; runde < 3; runde++) {
      if (runde || parent) toast(parent ? 'Bitte im nächsten Fenster alles markieren (Excel-Datei, Aufnahmen, Sicherungen) und auf „Auswählen“ tippen.' : 'Bitte den Lehrgangsordner auswählen.', 8000);
      let docs;
      try { docs = await S.pick({ token: S.Drive.token, apiKey: CFG.googleApiKey, appId: clientId().split('-')[0], parent, origin: location.origin }); }
      catch (e) { toast(e.message, 6000); return; }
      if (!docs) return;
      let id = null;
      try {
        busy('Prüfe Freigabe …');
        for (const d of docs) {
          if (d.mimeType === S.XLSX_MIME && !id) id = d.id;
          if (d.mimeType === 'application/vnd.google-apps.folder' && !/^(Aufnahmen|Sicherungen)$/.test(d.name) && !parent) parent = d.id;
        }
        if (!id && parent) id = await S.Drive.courseIn(parent);
        if (id) {
          localStorage.removeItem('baumprojekt.folders.' + id);
          await S.Drive.courseFolders(id); // prüft Zugriff auf Aufnahmen und Sicherungen
          busy();
          localStorage.removeItem('baumprojekt.invite');
          settings.ausgeblendet = (settings.ausgeblendet || []).filter(x => x !== id); localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
          setActive(id, true); selDate = today(); await loadActive(); refreshCourses();
          toast('✓ Geteilter Lehrgang hinzugefügt. Ihr könnt jetzt beide einsprechen.', 5000);
          return;
        }
      } catch (e) { if (!e.noAccess) { busy(); toast(e.message, 6000); return; } }
      busy();
    }
    toast('Der Lehrgang konnte nicht vollständig freigegeben werden. Bitte nochmal versuchen und im Ordner alles markieren.', 8000);
  }
  // Lehrgang anlegen: Die Eingabetaste springt ins nächste Feld (Tastatur zeigt „Weiter“), im letzten Feld schließt sie die Tastatur
  function formFelder(f) { return [...f.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox])')].filter(el => el.offsetParent !== null && !el.disabled); }
  function initWeiter(f) {
    f.addEventListener('focusin', e => {
      if (e.target.tagName !== 'INPUT') return;
      const fs = formFelder(f); e.target.enterKeyHint = fs.indexOf(e.target) === fs.length - 1 ? 'done' : 'next';
    });
    f.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.isComposing) return;
      e.preventDefault();
      const fs = formFelder(f), i = fs.indexOf(e.target);
      if (i >= 0 && i < fs.length - 1) fs[i + 1].focus(); else e.target.blur();
    });
  }
  function teamRow(t) {
    t = t || {};
    return '<div class="team-row"><input placeholder="Teilnehmer/in" data-k="teilnehmer" value="' + esc(t.teilnehmer) + '"><input placeholder="Hund" data-k="hund" value="' + esc(t.hund) + '"><input placeholder="Behörde" data-k="behoerde" value="' + esc(t.behoerde) + '">' +
      '<input type="hidden" data-k="rasse" value="' + esc(t.rasse) + '"><input type="hidden" data-k="bemerkung" value="' + esc(t.bemerkung) + '"><button type="button" class="rm" data-rm aria-label="Team entfernen">⊖</button></div>';
  }

  function openCourseForm(edit) {
    editing = edit;
    const f = $('#courseForm');
    f.reset();
    $('#courseFormTitle').textContent = edit ? 'Lehrgang bearbeiten' : 'Neuer Lehrgang';
    const c = edit ? course : { meta: { start: today(), wochen: 4 }, teams: [{}, {}, {}, {}, {}] };
    f.titel.value = c.meta.titel || ''; f.trainer.value = c.meta.trainer || localStorage.getItem('baumprojekt.trainer') || ''; f.ort.value = c.meta.ort || '';
    const w = Number(c.meta.wochen) || 4, fest = w === 4 || w === 10;
    f.start.value = c.meta.start; f.querySelector('input[name=wochen][value="' + (fest ? w : 'x') + '"]').checked = true;
    f.wochenX.value = fest ? '' : w; show('#wochenX', !fest);
    $('#teamRows').innerHTML = c.teams.map(teamRow).join('');
    SP.fillForm(edit ? course : null);
    show(f, true); f.scrollIntoView({ behavior: 'smooth' });
  }
  async function submitCourse(ev) {
    ev.preventDefault();
    const f = ev.target;
    const meta = { titel: f.titel.value.trim(), trainer: f.trainer.value.trim(), ort: f.ort.value.trim(), start: f.start.value, wochen: 0 };
    const wv = f.querySelector('input[name=wochen]:checked').value;
    meta.wochen = wv === 'x' ? Math.round(Number(f.wochenX.value)) : Number(wv);
    if (!(meta.wochen >= 1 && meta.wochen <= 52)) { toast('Bitte die Anzahl der Wochen eintragen (1 bis 52).'); f.wochenX.focus(); return; }
    const teams = [...document.querySelectorAll('.team-row')].map(r => { const t = {}; r.querySelectorAll('[data-k]').forEach(i => { t[i.dataset.k] = i.value.trim(); }); return t; })
      .filter(t => t.teilnehmer || t.hund).map(t => ({ ...t, name: WBK.teamName(t) }));
    if (!teams.length) { toast('Bitte mindestens ein Team eintragen.'); return; }
    localStorage.setItem('baumprojekt.trainer', meta.trainer);
    const sp = SP.readForm();
    Object.assign(meta, sp.meta);
    try {
      if (editing) {
        const oldTitel = course.meta.titel;
        await withStore('Speichere …', () => modifyCourse(c => {
          // Umbenannte Teams auch in vorhandenen Notizen umbenennen (gleiche Position in der Liste)
          c.teams.forEach((old, i) => { if (teams[i] && old.name !== teams[i].name) [...c.notes, ...(c.zg || [])].forEach(n => { if (n.team === old.name) n.team = teams[i].name; }); });
          c.meta = meta; c.teams = teams;
          if (sp.spuer) c.spuer = sp.spuer;
        }));
        if (oldTitel !== meta.titel) await S.Drive.rename(activeId, meta.titel).catch(e => toast('Ordner konnte nicht umbenannt werden: ' + e.message, 5000));
      } else {
        const c = { meta, teams, notes: [], gesamt: {}, spuer: sp.spuer || { stoffe: [], schritte: [] }, zg: [] };
        const id = await withStore('Lege Lehrgang an …', async () => store().create(meta.titel, await WBK.toBuffer(c)));
        setActive(id, true); course = c; await S.KV.set('course:' + id, c);
      }
      selDate = today(); clampDate();
      show('#courseForm', false); refreshCourses(); toast('✓ Gespeichert');
    } catch (e) { /* gemeldet */ }
  }
  async function download() {
    if (!activeId) return toast('Kein Lehrgang gewählt.');
    try {
      const buf = await withStore('Lade Datei …', () => store().load(activeId));
      const name = 'Lehrgang ' + ((course && course.meta.titel) || '') + '.xlsx';
      const file = new File([buf], name, { type: S.XLSX_MIME });
      // Auf dem Handy: Teilen-Menü (z. B. „In Dateien sichern“) statt eines neuen Fensters
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file] }); } catch (e) { /* abgebrochen */ }
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = name;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { /* gemeldet */ }
  }

  // ---------------- Einstellungen ----------------
  function fillSettings() {
    const f = $('#settingsForm');
    f.openaiKey.value = settings.openaiKey; f.sttModel.value = settings.sttModel; f.llmModel.value = settings.llmModel;
    $('#keyGuide').open = !settings.openaiKey;
    if (!settings.openaiKey) { $('#keyStatus').className = 'key-status warn'; $('#keyStatus').textContent = '⚠ Noch kein Schlüssel eingetragen.'; }
    updateDriveStatus(); renderGlossar(); SP.renderEinst();
  }
  function updateDriveStatus() {
    const u = S.Drive.user;
    $('#driveStatus').textContent = S.Drive.connected() ? '✓ Angemeldet' + (u ? ' als ' + (u.emailAddress || u.displayName) : '') : 'Nicht angemeldet';
  }
  function saveSettings(ev) {
    if (ev) ev.preventDefault();
    const f = $('#settingsForm');
    settings.openaiKey = f.openaiKey.value.trim();
    settings.sttModel = f.sttModel.value.trim() || CFG.sttModel; settings.llmModel = f.llmModel.value.trim() || CFG.llmModel;
    localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
    syncSettingsToDrive();
    if (settings.openaiKey) banner('');
    toast('✓ Einstellungen gespeichert');
    checkKey();
  }

  // Prüft den Schlüssel mit einer winzigen Anfrage (kostet Bruchteile eines Cents) – erkennt auch fehlendes Guthaben
  function keyMsg(kind, text) {
    const st = $('#keyStatus');
    st.className = 'key-status ' + kind; st.textContent = text;
    if (kind !== 'busy') toast(text, 5000);
  }
  async function syncSettingsToDrive(leise) {
    try { await S.Drive.saveSettings({ openaiKey: settings.openaiKey, sttModel: settings.sttModel, llmModel: settings.llmModel, glossar: settings.glossar, gerueche: settings.gerueche, geruchVorlagen: settings.geruchVorlagen, schrittVorlagen: settings.schrittVorlagen, aktiverLehrgang: activeId || '', ausgeblendet: settings.ausgeblendet || [] }); }
    catch (e) { if (!leise) toast('Einstellungen nur auf diesem Gerät gespeichert (Google Drive nicht erreichbar).', 5000); }
  }
  // Nach dem Login: Einstellungen aus Google Drive holen (oder dorthin übertragen, falls nur hier vorhanden)
  async function loadSettingsFromDrive() {
    let remote = null;
    try { remote = await S.Drive.loadSettings(); } catch (e) { return; }
    let hochladen = !remote && (settings.openaiKey || settings.glossar.length);
    if (remote) {
      if (Array.isArray(remote.ausgeblendet)) settings.ausgeblendet = remote.ausgeblendet;
      if (remote.aktiverLehrgang) setActive(remote.aktiverLehrgang); // zuletzt gewählter Lehrgang, auch von einem anderen Gerät
      if (remote.openaiKey) Object.assign(settings, { openaiKey: remote.openaiKey, sttModel: remote.sttModel || settings.sttModel, llmModel: remote.llmModel || settings.llmModel });
      else if (settings.openaiKey) hochladen = true;
      if (Array.isArray(remote.glossar)) settings.glossar = remote.glossar.filter(g => g && g.begriff);
      else if (settings.glossar.length) hochladen = true;
      SP.KEYS.forEach(k => { if (Array.isArray(remote[k])) settings[k] = remote[k]; else if (settings[k] && settings[k].length) hochladen = true; });
      localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
    }
    if (hochladen) syncSettingsToDrive();
  }
  async function checkKey() {
    if (!settings.openaiKey) return keyMsg('warn', '⚠ Noch kein Schlüssel eingetragen.');
    if (!/^sk-/.test(settings.openaiKey)) return keyMsg('err', '✗ Das ist kein gültiger Schlüssel. Er muss mit „sk-“ beginnen. Bitte bei OpenAI erneut kopieren und einfügen.');
    keyMsg('busy', '⏳ Prüfe Schlüssel bei OpenAI …');
    let r, j = {};
    try {
      r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + settings.openaiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.llmModel, messages: [{ role: 'user', content: 'Hallo' }], max_tokens: 1 })
      });
      try { j = await r.json(); } catch (e) { /* ignore */ }
    } catch (e) { return keyMsg('err', '✗ Keine Verbindung zu OpenAI. Bitte Internet prüfen und erneut auf „Schlüssel prüfen“ tippen.'); }
    const code = (j.error && (j.error.code || j.error.type)) || '';
    if (r.ok) return keyMsg('ok', '✓ Schlüssel funktioniert. Du kannst jetzt Notizen aufnehmen.');
    if (r.status === 401) return keyMsg('err', '✗ Schlüssel ungültig. Bitte bei OpenAI neu kopieren (oder neuen erstellen) und hier einfügen.');
    if (code === 'insufficient_quota') return keyMsg('err', '✗ Schlüssel ist richtig, aber es ist kein Guthaben vorhanden. Bitte bei OpenAI unter „Billing“ Guthaben aufladen. Danach kann es ein paar Minuten dauern.');
    if (r.status === 429) return keyMsg('warn', '⚠ OpenAI ist gerade ausgelastet. Schlüssel scheint zu stimmen, bitte später erneut prüfen.');
    if (r.status === 404 || code === 'model_not_found') return keyMsg('err', '✗ Schlüssel ok, aber das Modell „' + settings.llmModel + '“ ist für dein Konto nicht freigeschaltet.');
    if (r.status === 403) return keyMsg('err', '✗ Dieser Schlüssel hat keine Berechtigung. Beim Erstellen „All“ als Berechtigung wählen.');
    keyMsg('err', '✗ OpenAI meldet einen Fehler (' + r.status + '): ' + ((j.error && j.error.message) || ''));
  }

  // ---------------- Anmeldung ----------------
  function lock(on) { document.body.classList.toggle('locked', on); }
  // Lehrgänge aus dem alten Aufbau (Datei direkt in „Baumprojekt Lehrgänge“) in eigene Ordner verschieben
  async function migrate() {
    try {
      const root = await S.Drive.folderId();
      for (const f of await S.Drive.list()) if ((f.parents || []).includes(root)) await S.Drive.courseFolders(f.id);
    } catch (e) { console.warn('Umzug in Lehrgangsordner später erneut', e); }
  }
  async function afterLogin() {
    try { await S.Drive.me(); } catch (e) { if (e.needsLogin) { lock(true); return; } }
    lock(false); banner('');
    await loadSettingsFromDrive();
    await loadActive();
    loadCourseList();
    await restoreDraft();
    migrate();
    syncOutbox();
    if (localStorage.getItem('baumprojekt.invite')) {
      banner('<span>Ein Lehrgang wurde mit dir geteilt.</span><button>Hinzufügen</button>', () => { banner(''); go('lehrgang'); addShared(localStorage.getItem('baumprojekt.invite')); });
      return;
    }
    if (!openaiKey()) banner('<span>Fast fertig: Für die Spracherkennung brauchst du einmalig einen OpenAI-Schlüssel.</span><button>Zur Anleitung</button>', () => { banner(''); go('einst'); });
    else if (!course) { go('lehrgang'); }
  }
  async function login(chooseAccount) {
    $('#loginMsg').textContent = '';
    try { await S.Drive.connect(clientId(), chooseAccount); await afterLogin(); }
    catch (e) { $('#loginMsg').textContent = e.message; }
  }
  function logout() {
    S.Drive.logout(); course = null; info = null; // gewählter Lehrgang bleibt gemerkt
    lock(true); go('heute');
  }

  // ---------------- Start ----------------
  async function restoreDraft() {
    S.KV.del('draft'); // Entwurf aus der alten Version (KI-Verteilung) wird nicht mehr verwendet
    const d = await S.KV.get('draft2');
    if (d && d.courseId === activeId && course && (d.text || d.transcript) && (d.team === ALLE || teamByName(d.team))) {
      job = d; job.append = false; selDate = d.datum; renderToday();
      fillEdit(); openSheet(d.team, 'edit'); toast('Nicht gespeicherte Notiz wiederhergestellt.', 4000);
      return;
    }
    const a = await S.KV.get('lastAudio');
    if (a && course) banner('<span>Eine Aufnahme wurde noch nicht verarbeitet.</span><button>Jetzt verarbeiten</button>', () => {
      banner(''); job = { team: a.team && (a.team === ALLE || teamByName(a.team)) ? a.team : ALLE, datum: a.datum, uhrzeit: a.uhrzeit, aid: a.aid };
      if (a.append) { job.append = true; job.transcript = a.prev; }
      openSheet(job.team, 'busy'); processAudio(a.blob);
    });
  }

  function bind() {
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    $('#days').addEventListener('click', e => { const b = e.target.closest('.day'); if (b) { selDate = b.dataset.d; renderToday(); } });
    $('#v-heute').addEventListener('click', e => {
      const cell = e.target.closest('.cell[data-team]'); if (!cell) return;
      if (e.target.closest('.mic') || cell.dataset.team === ALLE) startRec(cell.dataset.team); else openTeam(cell.dataset.team);
    });
    $('#teamBack').addEventListener('click', () => { SP.flush(); currentTeam = null; go('heute'); });
    $('#teamRec').addEventListener('click', () => startRec(currentTeam));
    $('#typeBtn').addEventListener('click', () => typeNote(currentTeam));
    $('#notesRec').addEventListener('click', () => startRec(currentTeam));
    $('#notesType').addEventListener('click', () => typeNote(currentTeam));
    $('#stopBtn').addEventListener('click', () => stopRec(false));
    $('#cancelRec').addEventListener('click', () => stopRec(true));
    $('#pauseBtn').addEventListener('click', togglePause);
    $('#moreRec').addEventListener('click', () => startRec(job && job.team, true));
    $('#dim').addEventListener('click', () => requestDismiss());
    $('#grab').addEventListener('click', () => requestDismiss());
    initSheetDrag();
    $('#saveNote').addEventListener('click', saveNote);
    $('#deleteNote').addEventListener('click', () => deleteNote(job && job.editOf, true));
    initSwipe($('#teamNotes'), editNote, (act, i) => { if (act === 'edit') editNote(i); else deleteNote(course.notes[i]); });
    $('#discardNote').addEventListener('click', () => requestDismiss(true));
    $('#noteText').addEventListener('input', () => { saveDraft(); renderUnklar(); });
    $('#unklarBox').addEventListener('click', e => { const b = e.target.closest('[data-unklar]'); if (b) openMeinst(Number(b.dataset.unklar)); });
    $('#glossList').addEventListener('click', e => { const b = e.target.closest('[data-gl]'); if (b) openBegriff(Number(b.dataset.gl)); });
    $('#glossOpen').addEventListener('click', () => go('glossar'));
    $('#glossBack').addEventListener('click', () => go('einst'));
    initEdgeBack();
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => go(b.dataset.back)));
    $('#zgOpen').addEventListener('click', () => go('gerueche'));
    $('#trDone').addEventListener('click', () => { SP.flush(); go('zgteam'); SP.renderTeam(); });
    $('#notesOpen').addEventListener('click', () => { renderTeamNotes(); go('notizen'); });
    $('#recsOpen').addEventListener('click', () => { go('aufnahmen'); renderRecordings($('#teamRecs'), r => r.team === currentTeam); });
    document.querySelectorAll('[data-akte]').forEach(b => b.addEventListener('click', () => go('team')));
    $('#zgBack').addEventListener('click', () => { SP.flush(); go('team'); SP.renderTeam(); });
    $('#zgLink').addEventListener('click', e => { if (e.target.closest('#zgOpenTeam')) { go('zgteam'); SP.renderTeam(); } });
    SP.bind();
    $('#glossAdd').addEventListener('submit', glossarHinzufuegen);
    $('#gaOk').addEventListener('mousedown', e => e.preventDefault()); // Tastatur bleibt offen
    $('#gaB').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if ($('#gaB').value.trim()) $('#gaF').focus(); } });
    $('#glossVordef').addEventListener('click', e => { const b = e.target.closest('[data-glv]'); if (b) openBegriff(-1, vordefGlossar()[Number(b.dataset.glv)]); });
    $('#glossFremd').addEventListener('click', e => { const b = e.target.closest('[data-glf]'); if (b) openBegriff(-1, fremdGlossar()[Number(b.dataset.glf)]); });
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-m=close]')) closeModal(); });
    $('#retryBtn').addEventListener('click', async () => { const a = await S.KV.get('lastAudio'); if (a) { if (a.append) { job.append = true; job.transcript = a.prev; } processAudio(a.blob); } else closeSheet(); });
    $('#errClose').addEventListener('click', () => { closeSheet(); restoreDraft(); });
    renderStil();
    $('#stilSeg').addEventListener('click', e => { const b = e.target.closest('[data-stil]'); if (b) chooseStil(b.dataset.stil); });
    initWeiter($('#courseForm'));
    $('#courseSelect').addEventListener('change', switchCourse);
    $('#courseSelectTop').addEventListener('change', switchCourse);
    $('#newCourseBtn').addEventListener('click', () => openCourseForm(false));
    $('#addSharedBtn').addEventListener('click', () => addShared(localStorage.getItem('baumprojekt.invite') || ''));
    $('#shareBox').addEventListener('click', e => { if (e.target.id === 'inviteBtn') invite(); const u = e.target.closest('[data-unshare]'); if (u) unshare(u.dataset.unshare); });
    $('#shareBox').addEventListener('change', e => { if (e.target.id === 'shareKey') toggleShareKey(e.target.checked); });
    $('#deleteCourseBtn').addEventListener('click', deleteCourse);
    $('#editCourseBtn').addEventListener('click', () => (course ? openCourseForm(true) : toast('Kein Lehrgang gewählt.')));
    $('#addTeam').addEventListener('click', () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow()));
    $('#teamRows').addEventListener('click', e => { if (e.target.hasAttribute('data-rm')) e.target.closest('.team-row').remove(); });
    $('#cancelCourse').addEventListener('click', () => show('#courseForm', false));
    $('#courseForm').addEventListener('submit', submitCourse);
    $('#courseForm').addEventListener('click', e => { if (SP.formClick(e)) e.preventDefault(); });
    $('#courseForm').addEventListener('change', e => { if (SP.formChange(e)) return; if (e.target.name === 'wochen') { show('#wochenX', e.target.value === 'x'); if (e.target.value === 'x') $('#courseForm').wochenX.focus(); } });
    $('#downloadBtn').addEventListener('click', download);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#checkKeyBtn').addEventListener('click', () => { saveSettings(); });
    $('#logoutBtn').addEventListener('click', logout);
    $('#switchBtn').addEventListener('click', () => { logout(); login(true); });
    $('#loginBtn').addEventListener('click', () => login(false));
    $('#allRecs').addEventListener('toggle', () => { if ($('#allRecs').open) renderRecordings($('#allRecList')); });
    window.addEventListener('online', syncOutbox);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncOutbox(); refreshIfChanged(); if (course && !document.body.classList.contains('sheet-open')) renderToday(); } });
    setInterval(syncOutbox, 120000);
    // Geteilter Lehrgang: Notizen des Kollegen regelmäßig nachladen
    setInterval(() => { if (!document.hidden && info && info.shared) refreshIfChanged(); }, 60000);
    $('#wipeBtn').addEventListener('click', async () => {
      const offen = (await S.Outbox.all()).filter(it => it.blob || (it.transcript && !it.textId)).length;
      if (offen && !confirm('Achtung: ' + offen + ' Aufnahme(n) sind noch nicht in Google Drive gesichert und gehen beim Löschen verloren. Trotzdem löschen?')) return;
      if (!confirm('Wirklich alle Baumprojekt-Daten auf diesem Gerät löschen? Die Dateien in Google Drive bleiben erhalten.')) return;
      Object.keys(localStorage).filter(k => k.startsWith('baumprojekt.')).forEach(k => localStorage.removeItem(k)); indexedDB.deleteDatabase('baumprojekt'); location.reload();
    });
  }

  async function init() {
    // Einladungslink (…?lehrgang=<Ordner>) merken, auch über die Google-Anmeldung hinweg
    const inv = new URLSearchParams(location.search).get('lehrgang');
    if (inv) { localStorage.setItem('baumprojekt.invite', inv); history.replaceState(null, '', location.pathname + location.hash); }
    bind();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => {});
      // Neue Version installiert → einmal neu laden, damit sie sofort aktiv ist (nicht während einer Aufnahme)
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !window.__reloaded && !(rec && rec.state !== 'inactive') && !job) { window.__reloaded = true; location.reload(); } });
    }
    $('#appVersion').textContent = 'Version ' + (CFG.version || '');
    // Login-Knopf freigeben, sobald die Google-Bibliothek geladen ist
    const wait = setInterval(() => { if (S.Drive.ready() || CFG.loginRedirect) { clearInterval(wait); $('#loginBtn').disabled = false; } }, 200);
    if (S.Drive.restore()) await afterLogin(); else { lock(true); $('#loginMsg').textContent = S.Drive.loginError; }
    updateSyncInfo();
  }
  init();
})();
