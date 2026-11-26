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
  const settings = Object.assign({ openaiKey: '', sttModel: CFG.sttModel || 'gpt-4o-transcribe', llmModel: CFG.llmModel || 'gpt-4.1-mini', stil: 'fliesstext' },
    JSON.parse(localStorage.getItem('baumprojekt.settings') || '{}'));
  const clientId = () => CFG.googleClientId || '';
  const store = () => S.Drive;
  let courses = [];
  let activeId = localStorage.getItem('baumprojekt.active') || '';
  let course = null; // geparster aktiver Lehrgang
  let selDate = today();
  let currentTeam = null; // geöffnete Team-Seite
  let editing = false;

  // ---------------- UI-Helfer ----------------
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3000); }
  function busy(msg) { $('#busyText').textContent = msg || 'Bitte warten …'; $('#busy').classList.toggle('hidden', !msg); }
  function show(el, on) { (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on); }
  function go(view) {
    document.querySelectorAll('.view').forEach(v => show(v, v.id === 'v-' + view));
    const tab = view === 'team' ? 'heute' : view;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
    if (view === 'heute') renderToday();
    if (view === 'lehrgang') refreshCourses();
    if (view === 'einst') fillSettings();
    window.scrollTo(0, 0);
  }
  function banner(html, onClick) {
    const b = $('#banner'); b.innerHTML = html; show(b, !!html);
    const btn = b.querySelector('button'); if (btn && onClick) btn.onclick = onClick;
  }
  const FARBEN = ['#5e8fbf', '#8e7cc3', '#c48a5a', '#5aa58a', '#c46b7d', '#6f9a4e', '#b07fb0', '#4f9aa8', '#c4935a', '#7f8cc4'];
  function initials(t) { return ((t.teilnehmer || t.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase(); }
  function avatar(t, i, cls) { return '<div class="avatar ' + (cls || '') + '" style="background:' + FARBEN[i % FARBEN.length] + '">' + esc(initials(t)) + '</div>'; }

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
  function setActive(id) { activeId = id; localStorage.setItem('baumprojekt.active', id || ''); }
  async function loadActive() {
    if (!activeId) {
      // z. B. nach gelöschten Browserdaten oder auf neuem Handy: Lehrgänge kommen aus Google Drive
      try { const list = await store().list(); if (list.length) setActive(list[0].id); } catch (e) { /* Anmeldung fehlt */ }
    }
    if (!activeId) { course = null; renderToday(); return; }
    const cached = await S.KV.get('course:' + activeId);
    if (cached) { course = cached; clampDate(); renderToday(); }
    try {
      const buf = await store().load(activeId);
      course = await WBK.parse(buf);
      await S.KV.set('course:' + activeId, course);
    } catch (e) {
      if (/404/.test(e.message)) { setActive(''); course = null; return loadActive(); }
      if (!e.needsLogin && !cached) toast(e.message, 5000);
    }
    clampDate(); renderToday();
  }
  // Ausgewählter Tag: heute, wenn er im Lehrgang liegt, sonst der nächstgelegene Lehrgangstag
  function clampDate() {
    if (!course) return;
    const max = course.meta.wochen * 7, i = WBK.dayIndex(course.meta.start, selDate);
    if (i < 1) selDate = course.meta.start; else if (i > max) selDate = WBK.addDays(course.meta.start, max - 1);
  }

  // Lesen – ändern – zurückschreiben. So bleiben Änderungen, die am PC in Excel gemacht wurden, erhalten.
  async function modifyCourse(fn) {
    const buf = await store().load(activeId);
    const c = await WBK.parse(buf);
    fn(c);
    await store().save(activeId, await WBK.toBuffer(c));
    course = c;
    await S.KV.set('course:' + activeId, c);
  }

  // ---------------- Heute: Tag wählen, Teams ----------------
  function renderToday() {
    if (!course) {
      $('#dayTitle').textContent = 'Heute';
      $('#courseBtn').textContent = 'Kein Lehrgang gewählt – hier tippen';
      $('#days').innerHTML = ''; $('#teamsHead').textContent = 'Teams';
      $('#teamList').innerHTML = '<div class="empty">Lege unter „Lehrgänge“ deinen ersten Lehrgang an.</div>';
      return;
    }
    const max = course.meta.wochen * 7, idx = WBK.dayIndex(course.meta.start, selDate), t = today();
    $('#dayTitle').textContent = selDate === t ? 'Heute' : longDate(selDate);
    $('#courseBtn').textContent = (course.meta.titel || 'Lehrgang') + ' · Woche ' + Math.ceil(idx / 7) + ' von ' + course.meta.wochen;
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
    $('#teamDog').textContent = tm.hund ? 'mit ' + tm.hund + (tm.rasse ? ' · ' + tm.rasse : '') : '';
    $('#teamBack').lastChild.textContent = selDate === today() ? 'Heute' : 'Zurück';
    renderTeamNotes();
    go('team');
    renderRecordings($('#teamRecs'), r => r.team === name);
  }
  function renderTeamNotes() {
    const notes = WBK.sortNotes(course.notes.filter(n => n.team === currentTeam)).reverse();
    const dates = [...new Set([selDate, ...notes.map(n => n.datum)])].sort().reverse();
    $('#teamNotes').innerHTML = dates.map(d => {
      const mine = notes.filter(n => n.datum === d);
      if (!mine.length && d !== selDate) return '';
      return '<div class="section-h">' + esc(longDate(d)) + (d === today() ? ' · Heute' : '') + '</div><div class="group">' + (mine.length
        ? mine.map(n => '<div class="note"><div class="note-m"><span>' + esc(n.uhrzeit) + ' Uhr</span><span class="tag">' + esc(n.kategorie) + '</span></div><div class="note-t">' + esc(n.text) + '</div></div>').join('')
        : '<div class="empty">Noch keine Notiz an diesem Tag.</div>') + '</div>';
    }).join('');
  }

  // ---------------- Aufnahme-Fenster ----------------
  // job: { team: Name oder ALLE, datum, uhrzeit, aid, transcript, text, kategorie }
  let job = null;
  function sheetState(st, msg) {
    show('#sheetRec', st === 'rec'); show('#sheetRecBtns', st === 'rec');
    show('#sheetBusy', st === 'busy'); if (st === 'busy') $('#sheetBusyText').textContent = msg || 'Bitte warten …';
    show('#sheetEdit', st === 'edit'); show('#sheetEditBtns', st === 'edit');
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
    if (!settings.openaiKey) { toast('Bitte zuerst den OpenAI-Schlüssel eintragen.', 5000); go('einst'); return true; }
    return false;
  }
  function typeNote(teamName) {
    if (!course) return needSetup();
    job = { team: teamName, datum: selDate, uhrzeit: nowTime(), transcript: '', text: '', kategorie: 'Sonstiges' };
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
      const item = { aid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), courseId: activeId, datum: job.datum, uhrzeit, team: teamName,
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
      const hint = 'Hundetraining. Teams: ' + course.teams.map(t => t.teilnehmer + ' mit ' + t.hund).join(', ') + '.';
      const text = await S.transcribe(blob, { key: settings.openaiKey, model: settings.sttModel, hint });
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
      const r = await S.formulate(quelle, tm, { key: settings.openaiKey, model: settings.llmModel, stil: settings.stil });
      job.text = r.text; job.kategorie = r.kategorie;
      fillEdit(); sheetState('edit'); saveDraft();
    } catch (e) {
      // Ohne KI weiter: Rohtext zum Bearbeiten anbieten
      job.text = job.text || quelle; fillEdit(); sheetState('edit'); saveDraft();
      toast('Formulieren fehlgeschlagen: ' + e.message, 6000);
    }
  }
  function fillEdit() {
    $('#noteKat').innerHTML = S.KATEGORIEN.map(k => '<option' + (k === job.kategorie ? ' selected' : '') + '>' + esc(k) + '</option>').join('');
    $('#noteText').value = job.text || '';
  }
  function saveDraft() { if (job) { job.text = $('#noteText').value; job.kategorie = $('#noteKat').value; S.KV.set('draft2', Object.assign({ courseId: activeId }, job)); } }
  async function saveNote() {
    saveDraft();
    const text = job.text.trim();
    if (!text) { toast('Kein Text vorhanden.'); return; }
    const teams = job.team === ALLE ? course.teams.map(t => t.name) : [job.team];
    const neu = teams.map(team => ({ datum: job.datum, uhrzeit: job.uhrzeit, team, kategorie: job.kategorie, text, quelle: job.transcript ? 'Sprachnotiz' : 'Eingetippt' }));
    try {
      await withStore('Speichere im Lehrgang …', () => modifyCourse(c => { c.notes.push(...neu); }));
      if (job.aid) await S.KV.del('lastAudio');
      closeSheet(); banner('');
      toast('✓ Gespeichert');
      renderToday(); if (currentTeam && !$('#v-team').classList.contains('hidden')) renderTeamNotes();
    } catch (e) { /* Meldung kam schon; Entwurf bleibt erhalten */ }
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
    (await S.Outbox.all()).filter(it => it.courseId === activeId && it.blob).forEach(it => list.unshift({ aid: it.aid, datum: it.datum, uhrzeit: it.uhrzeit, team: it.team || '', local: it }));
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
      '<div class="cell-tx"><b>' + esc(longDate(r.datum)) + '</b><span>' + esc(r.uhrzeit) + ' Uhr' + (filter && r.team ? '' : r.team ? ' · ' + esc(r.team) : '') + (r.local ? ' · noch nicht in Drive' : '') + '</span></div>' +
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
  async function refreshCourses() {
    $('#driveLink').classList.add('hidden');
    try { courses = await withStore('Lade Lehrgänge …', () => store().list()); } catch (e) { courses = []; }
    $('#courseList').innerHTML = courses.length
      ? courses.map(f => '<label class="cell"><input type="radio" name="course" value="' + esc(f.id) + '"' + (f.id === activeId ? ' checked' : '') + '><div class="cell-tx"><b>' + esc(f.name.replace(/\.xlsx$/, '').replace(/^Lehrgang /, '')) + '</b><span>geändert ' + new Date(f.modifiedTime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) + '</span></div></label>').join('')
      : '<div class="empty">Noch keine Lehrgänge. Tippe oben rechts auf „Neu“.</div>';
    const cur = courses.find(f => f.id === activeId);
    if (cur) S.Drive.withFolders(cur.id, f => f).then(f => { $('#driveLink').href = 'https://drive.google.com/drive/folders/' + f.folder; show('#driveLink', true); }).catch(() => {});
    $('#allRecs').open = false;
  }
  function teamRow(t) {
    t = t || {};
    return '<div class="team-row"><input placeholder="Teilnehmer/in" data-k="teilnehmer" value="' + esc(t.teilnehmer) + '"><input placeholder="Hund" data-k="hund" value="' + esc(t.hund) + '"><input placeholder="Rasse/Alter" data-k="rasse" value="' + esc(t.rasse) + '"><input type="hidden" data-k="bemerkung" value="' + esc(t.bemerkung) + '"><button type="button" class="rm" data-rm aria-label="Team entfernen">⊖</button></div>';
  }
  function openCourseForm(edit) {
    editing = edit;
    const f = $('#courseForm');
    f.reset();
    $('#courseFormTitle').textContent = edit ? 'Lehrgang bearbeiten' : 'Neuer Lehrgang';
    const c = edit ? course : { meta: { start: today(), wochen: 4 }, teams: [{}, {}, {}, {}, {}] };
    f.titel.value = c.meta.titel || ''; f.trainer.value = c.meta.trainer || localStorage.getItem('baumprojekt.trainer') || ''; f.ort.value = c.meta.ort || '';
    f.start.value = c.meta.start; f.querySelector('input[name=wochen][value="' + (c.meta.wochen == 10 ? 10 : 4) + '"]').checked = true;
    $('#teamRows').innerHTML = c.teams.map(teamRow).join('');
    show(f, true); f.scrollIntoView({ behavior: 'smooth' });
  }
  async function submitCourse(ev) {
    ev.preventDefault();
    const f = ev.target;
    const meta = { titel: f.titel.value.trim(), trainer: f.trainer.value.trim(), ort: f.ort.value.trim(), start: f.start.value, wochen: Number(f.querySelector('input[name=wochen]:checked').value) };
    const teams = [...document.querySelectorAll('.team-row')].map(r => { const t = {}; r.querySelectorAll('[data-k]').forEach(i => { t[i.dataset.k] = i.value.trim(); }); return t; })
      .filter(t => t.teilnehmer || t.hund).map(t => ({ ...t, name: WBK.teamName(t) }));
    if (!teams.length) { toast('Bitte mindestens ein Team eintragen.'); return; }
    localStorage.setItem('baumprojekt.trainer', meta.trainer);
    try {
      if (editing) {
        const oldTitel = course.meta.titel;
        await withStore('Speichere …', () => modifyCourse(c => {
          // Umbenannte Teams auch in vorhandenen Notizen umbenennen (gleiche Position in der Liste)
          c.teams.forEach((old, i) => { if (teams[i] && old.name !== teams[i].name) c.notes.forEach(n => { if (n.team === old.name) n.team = teams[i].name; }); });
          c.meta = meta; c.teams = teams;
        }));
        if (oldTitel !== meta.titel) await S.Drive.rename(activeId, meta.titel).catch(e => toast('Ordner konnte nicht umbenannt werden: ' + e.message, 5000));
      } else {
        const c = { meta, teams, notes: [], gesamt: {} };
        const id = await withStore('Lege Lehrgang an …', async () => store().create(meta.titel, await WBK.toBuffer(c)));
        setActive(id); course = c; await S.KV.set('course:' + id, c);
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
    updateDriveStatus();
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
  async function syncSettingsToDrive() {
    try { await S.Drive.saveSettings({ openaiKey: settings.openaiKey, sttModel: settings.sttModel, llmModel: settings.llmModel }); }
    catch (e) { toast('Schlüssel nur auf diesem Gerät gespeichert (Google Drive nicht erreichbar).', 5000); }
  }
  // Nach dem Login: Einstellungen aus Google Drive holen (oder dorthin übertragen, falls nur hier vorhanden)
  async function loadSettingsFromDrive() {
    let remote = null;
    try { remote = await S.Drive.loadSettings(); } catch (e) { return; }
    if (remote && remote.openaiKey) {
      Object.assign(settings, { openaiKey: remote.openaiKey, sttModel: remote.sttModel || settings.sttModel, llmModel: remote.llmModel || settings.llmModel });
      localStorage.setItem('baumprojekt.settings', JSON.stringify(settings));
    } else if (settings.openaiKey) { syncSettingsToDrive(); }
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
    await restoreDraft();
    migrate();
    syncOutbox();
    if (!settings.openaiKey) banner('<span>Fast fertig: Für die Spracherkennung brauchst du einmalig einen OpenAI-Schlüssel.</span><button>Zur Anleitung</button>', () => { banner(''); go('einst'); });
    else if (!course) { go('lehrgang'); }
  }
  async function login(chooseAccount) {
    $('#loginMsg').textContent = '';
    try { await S.Drive.connect(clientId(), chooseAccount); await afterLogin(); }
    catch (e) { $('#loginMsg').textContent = e.message; }
  }
  function logout() {
    S.Drive.logout(); course = null; setActive('');
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
    $('#teamBack').addEventListener('click', () => { currentTeam = null; go('heute'); });
    $('#teamRec').addEventListener('click', () => startRec(currentTeam));
    $('#typeBtn').addEventListener('click', () => typeNote(currentTeam));
    $('#stopBtn').addEventListener('click', () => stopRec(false));
    $('#cancelRec').addEventListener('click', () => stopRec(true));
    $('#pauseBtn').addEventListener('click', togglePause);
    $('#moreRec').addEventListener('click', () => startRec(job && job.team, true));
    $('#dim').addEventListener('click', () => { if (rec && rec.state !== 'inactive') return; if ($('#sheetEdit').classList.contains('hidden') && $('#sheetErrBtns').classList.contains('hidden')) return; saveDraft(); document.body.classList.remove('sheet-open'); });
    $('#saveNote').addEventListener('click', saveNote);
    $('#discardNote').addEventListener('click', () => { if (!$('#noteText').value.trim() || confirm('Notiz verwerfen? Die Aufnahme selbst bleibt in Google Drive gesichert.')) { S.KV.del('lastAudio'); closeSheet(); } });
    $('#noteText').addEventListener('input', saveDraft);
    $('#noteKat').addEventListener('change', saveDraft);
    $('#retryBtn').addEventListener('click', async () => { const a = await S.KV.get('lastAudio'); if (a) { if (a.append) { job.append = true; job.transcript = a.prev; } processAudio(a.blob); } else closeSheet(); });
    $('#errClose').addEventListener('click', () => { closeSheet(); restoreDraft(); });
    renderStil();
    $('#stilSeg').addEventListener('click', e => { const b = e.target.closest('[data-stil]'); if (b) chooseStil(b.dataset.stil); });
    $('#courseList').addEventListener('change', async e => { if (e.target.name === 'course') { setActive(e.target.value); selDate = today(); await withStore('Lade Lehrgang …', loadActive).catch(() => {}); refreshCourses(); } });
    $('#newCourseBtn').addEventListener('click', () => openCourseForm(false));
    $('#editCourseBtn').addEventListener('click', () => (course ? openCourseForm(true) : toast('Kein Lehrgang gewählt.')));
    $('#addTeam').addEventListener('click', () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow()));
    $('#teamRows').addEventListener('click', e => { if (e.target.hasAttribute('data-rm')) e.target.closest('.team-row').remove(); });
    $('#cancelCourse').addEventListener('click', () => show('#courseForm', false));
    $('#courseForm').addEventListener('submit', submitCourse);
    $('#downloadBtn').addEventListener('click', download);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#checkKeyBtn').addEventListener('click', () => { saveSettings(); });
    $('#logoutBtn').addEventListener('click', logout);
    $('#switchBtn').addEventListener('click', () => { logout(); login(true); });
    $('#loginBtn').addEventListener('click', () => login(false));
    $('#allRecs').addEventListener('toggle', () => { if ($('#allRecs').open) renderRecordings($('#allRecList')); });
    window.addEventListener('online', syncOutbox);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncOutbox(); if (course && !document.body.classList.contains('sheet-open')) renderToday(); } });
    setInterval(syncOutbox, 120000);
    $('#wipeBtn').addEventListener('click', async () => {
      const offen = (await S.Outbox.all()).filter(it => it.blob || (it.transcript && !it.textId)).length;
      if (offen && !confirm('Achtung: ' + offen + ' Aufnahme(n) sind noch nicht in Google Drive gesichert und gehen beim Löschen verloren. Trotzdem löschen?')) return;
      if (!confirm('Wirklich alle Baumprojekt-Daten auf diesem Gerät löschen? Die Dateien in Google Drive bleiben erhalten.')) return;
      Object.keys(localStorage).filter(k => k.startsWith('baumprojekt.')).forEach(k => localStorage.removeItem(k)); indexedDB.deleteDatabase('baumprojekt'); location.reload();
    });
  }

  async function init() {
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
