(function () {
  'use strict';
  const WBK = window.BaumiWorkbook;
  const S = window.BaumiServices;
  const CFG = window.BAUMI_CONFIG || {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => WBK.dateToIso(new Date());
  const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // ---------------- Zustand ----------------
  const settings = Object.assign({ mode: 'drive', clientId: '', openaiKey: '', sttModel: CFG.sttModel || 'gpt-4o-transcribe', llmModel: CFG.llmModel || 'gpt-4.1-mini' },
    JSON.parse(localStorage.getItem('baumi.settings') || '{}'));
  const clientId = () => settings.clientId || CFG.googleClientId || '';
  const store = () => (settings.mode === 'local' ? S.Local : S.Drive);
  let courses = [];
  let activeId = localStorage.getItem('baumi.active.' + settings.mode) || '';
  let course = null; // geparster aktiver Lehrgang
  let segments = [];
  let noteTime = nowTime();
  let editing = false;

  // ---------------- UI-Helfer ----------------
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3000); }
  function busy(msg) { $('#busyText').textContent = msg || 'Bitte warten …'; $('#busy').classList.toggle('hidden', !msg); }
  function show(el, on) { (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on); }
  function go(view) {
    document.querySelectorAll('.view').forEach(v => show(v, v.id === 'v-' + view));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
    if (view === 'tag') renderDay();
    if (view === 'lehrgang') refreshCourses();
    if (view === 'einst') fillSettings();
  }
  function banner(html, onClick) {
    const b = $('#banner'); b.innerHTML = html; show(b, !!html);
    const btn = b.querySelector('button'); if (btn && onClick) btn.onclick = onClick;
  }

  // Führt eine Aktion aus; fehlt die Google-Anmeldung, wird ein Verbinden-Knopf angeboten und danach wiederholt.
  async function withStore(label, fn) {
    try { busy(label); const r = await fn(); busy(); return r; }
    catch (e) {
      busy();
      if (e.needsLogin) {
        banner('<span>Google Drive ist nicht verbunden.</span><button>Mit Google verbinden</button>', async () => {
          try { await S.Drive.connect(clientId()); banner(''); updateDriveStatus(); await withStore(label, fn); } catch (err) { toast(err.message, 5000); }
        });
      } else { console.error(e); toast(e.message || String(e), 6000); }
      throw e;
    }
  }

  // ---------------- Lehrgang laden ----------------
  function setActive(id) { activeId = id; localStorage.setItem('baumi.active.' + settings.mode, id || ''); }
  async function loadActive() {
    if (!activeId) { course = null; renderHeader(); return; }
    const cached = await S.KV.get('course:' + activeId);
    if (cached) { course = cached; renderHeader(); }
    try {
      const buf = await store().load(activeId);
      course = await WBK.parse(buf);
      await S.KV.set('course:' + activeId, course);
    } catch (e) { if (!e.needsLogin && !cached) toast(e.message, 5000); }
    renderHeader();
  }
  function renderHeader() {
    $('#courseBtn').textContent = course ? (course.meta.titel || 'Lehrgang') + ' ▾' : 'Lehrgang wählen ▾';
    updateDayLabel();
  }
  function updateDayLabel() {
    const d = $('#noteDate').value;
    if (!course || !d) { $('#noteDayLabel').textContent = ''; return; }
    const i = WBK.dayIndex(course.meta.start, d), max = course.meta.wochen * 7;
    $('#noteDayLabel').textContent = WBK.weekday(d) + ' · Tag ' + i + (i < 1 || i > max ? ' (außerhalb des Lehrgangs)' : ' von ' + max);
  }

  // Lesen – ändern – zurückschreiben. So bleiben Änderungen, die am PC in Excel gemacht wurden, erhalten.
  async function modifyCourse(fn) {
    const buf = await store().load(activeId);
    const c = await WBK.parse(buf);
    fn(c);
    await store().save(activeId, await WBK.toBuffer(c));
    course = c;
    await S.KV.set('course:' + activeId, c);
    renderHeader();
  }

  // ---------------- Aufnahme ----------------
  let rec = null, chunks = [], recStart = 0, recTimer = null, wakeLock = null;
  async function startRec() {
    if (!course) { toast('Bitte zuerst einen Lehrgang anlegen oder wählen.'); go('lehrgang'); return; }
    if (!settings.openaiKey) { toast('Bitte zuerst den OpenAI-Schlüssel eintragen.'); go('einst'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('Kein Zugriff aufs Mikrofon: ' + e.message, 5000); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
      noteTime = nowTime();
      await S.KV.set('lastAudio', { blob, datum: $('#noteDate').value, uhrzeit: noteTime });
      processAudio(blob);
    };
    rec.start(1000);
    recStart = Date.now();
    $('#recBtn').classList.add('on');
    recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('#recTime').textContent = '● ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' – tippen zum Beenden'; }, 250);
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* nicht überall verfügbar */ }
  }
  function stopRec() {
    clearInterval(recTimer);
    $('#recBtn').classList.remove('on');
    $('#recTime').textContent = 'Tippen zum Aufnehmen';
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  async function processAudio(blob) {
    try {
      busy('Spracherkennung läuft …');
      const hint = 'Hundetraining. Teams: ' + course.teams.map(t => t.teilnehmer + ' mit ' + t.hund).join(', ') + '.';
      const text = await S.transcribe(blob, { key: settings.openaiKey, model: settings.sttModel, hint });
      busy();
      $('#transcript').value = text;
      showStep('text');
      if (text) await doAssign();
    } catch (e) { busy(); toast('Spracherkennung fehlgeschlagen: ' + e.message + ' – die Aufnahme ist gesichert.', 7000); show('#lastAudioBtn', true); }
  }

  // ---------------- Zuordnung & Vorschau ----------------
  function showStep(s) { show('#step-record', s === 'record'); show('#step-text', s === 'text'); show('#step-preview', s === 'preview'); }
  async function doAssign() {
    const text = $('#transcript').value.trim();
    if (!text) { toast('Kein Text vorhanden.'); return; }
    if (!settings.openaiKey) { toast('Bitte zuerst den OpenAI-Schlüssel eintragen.'); go('einst'); return; }
    try {
      busy('Ordne den Teams zu …');
      segments = await S.assign(text, course.teams, { key: settings.openaiKey, model: settings.llmModel });
      busy();
      await S.KV.set('draft', { segments, datum: $('#noteDate').value, uhrzeit: noteTime, transcript: text });
      renderSegments(); showStep('preview');
    } catch (e) { busy(); toast('Zuordnung fehlgeschlagen: ' + e.message, 6000); }
  }
  function renderSegments() {
    const teamOpts = sel => ['Unklar', ...course.teams.map(t => t.name)].map(n => '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    const katOpts = sel => S.KATEGORIEN.map(k => '<option' + (k === sel ? ' selected' : '') + '>' + esc(k) + '</option>').join('');
    $('#segments').innerHTML = segments.map((s, i) =>
      '<div class="card seg-card' + (s.team === 'Unklar' ? ' warn' : '') + '" data-i="' + i + '">' +
      '<div class="row"><select data-f="team">' + teamOpts(s.team) + '</select><select data-f="kategorie">' + katOpts(s.kategorie) + '</select>' +
      '<button class="icon" data-del="' + i + '" title="Löschen">✕</button></div>' +
      '<textarea data-f="text" rows="3">' + esc(s.text) + '</textarea></div>').join('') || '<p class="muted">Keine Abschnitte.</p>';
  }
  function syncSegmentsFromUi() {
    document.querySelectorAll('.seg-card').forEach(card => {
      const s = segments[card.dataset.i];
      card.querySelectorAll('[data-f]').forEach(el => { s[el.dataset.f] = el.value.trim(); });
    });
    S.KV.set('draft', { segments, datum: $('#noteDate').value, uhrzeit: noteTime, transcript: $('#transcript').value });
  }
  async function saveSegments() {
    syncSegmentsFromUi();
    const list = segments.filter(s => s.text);
    if (!list.length) { toast('Nichts zu speichern.'); return; }
    if (list.some(s => s.team === 'Unklar')) { toast('Bitte bei allen Abschnitten ein Team auswählen (oder den Abschnitt löschen).', 5000); return; }
    const datum = $('#noteDate').value || today();
    const neu = list.map(s => ({ datum, uhrzeit: noteTime, team: s.team, kategorie: s.kategorie, text: s.text, quelle: 'Sprachnotiz' }));
    try {
      await withStore('Speichere im Lehrgang …', () => modifyCourse(c => { c.notes.push(...neu); }));
      await S.KV.del('draft'); await S.KV.del('lastAudio');
      segments = []; $('#transcript').value = ''; show('#lastAudioBtn', false);
      showStep('record');
      toast('✓ ' + neu.length + ' Notiz' + (neu.length > 1 ? 'en' : '') + ' gespeichert');
    } catch (e) { /* Meldung kam schon; Entwurf bleibt erhalten */ }
  }

  // ---------------- Tagesansicht ----------------
  function renderDay() {
    const d = $('#dayDate').value || today();
    $('#dayDate').value = d;
    if (!course) { $('#dayList').innerHTML = '<p class="muted">Kein Lehrgang gewählt.</p>'; $('#dayLabel').textContent = ''; return; }
    const i = WBK.dayIndex(course.meta.start, d);
    $('#dayLabel').textContent = WBK.weekday(d) + ' ' + WBK.isoToDe(d) + ' · Tag ' + i;
    const notes = WBK.sortNotes(course.notes.filter(n => n.datum === d));
    const names = course.teams.map(t => t.name);
    notes.forEach(n => { if (!names.includes(n.team)) names.push(n.team); });
    $('#dayList').innerHTML = names.map(name => {
      const mine = notes.filter(n => n.team === name);
      return '<div class="card"><h4>' + esc(name) + '</h4>' + (mine.length
        ? '<ul>' + mine.map(n => '<li><span class="tag">' + esc(n.kategorie) + '</span> ' + esc(n.text) + ' <span class="muted small">' + esc(n.uhrzeit) + '</span></li>').join('') + '</ul>'
        : '<p class="muted small">Noch keine Notiz an diesem Tag.</p>') + '</div>';
    }).join('');
  }
  function shiftDay(n) { $('#dayDate').value = WBK.addDays($('#dayDate').value || today(), n); renderDay(); }

  // ---------------- Lehrgänge verwalten ----------------
  async function refreshCourses() {
    $('#driveLink').classList.add('hidden');
    try { courses = await withStore('Lade Lehrgänge …', () => store().list()); } catch (e) { courses = []; }
    $('#courseList').innerHTML = courses.length
      ? courses.map(f => '<label class="card course-item"><input type="radio" name="course" value="' + esc(f.id) + '"' + (f.id === activeId ? ' checked' : '') + '><span>' + esc(f.name.replace(/\.xlsx$/, '')) + '<br><span class="muted small">geändert ' + new Date(f.modifiedTime).toLocaleString('de-DE') + '</span></span></label>').join('')
      : '<p class="muted">Noch keine Lehrgänge. Lege den ersten an.</p>';
    const cur = courses.find(f => f.id === activeId);
    if (cur && cur.webViewLink) { $('#driveLink').href = cur.webViewLink; show('#driveLink', true); }
  }
  function teamRow(t) {
    t = t || {};
    return '<div class="team-row"><input placeholder="Teilnehmer/in" data-k="teilnehmer" value="' + esc(t.teilnehmer) + '"><input placeholder="Hund" data-k="hund" value="' + esc(t.hund) + '"><input placeholder="Rasse / Alter" data-k="rasse" value="' + esc(t.rasse) + '"><input type="hidden" data-k="bemerkung" value="' + esc(t.bemerkung) + '"><button type="button" class="icon" data-rm>✕</button></div>';
  }
  function openCourseForm(edit) {
    editing = edit;
    const f = $('#courseForm');
    f.reset();
    $('#courseFormTitle').textContent = edit ? 'Lehrgang bearbeiten' : 'Neuer Lehrgang';
    const c = edit ? course : { meta: { start: today(), wochen: 4 }, teams: [{}, {}, {}, {}, {}] };
    f.titel.value = c.meta.titel || ''; f.trainer.value = c.meta.trainer || localStorage.getItem('baumi.trainer') || ''; f.ort.value = c.meta.ort || '';
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
    localStorage.setItem('baumi.trainer', meta.trainer);
    try {
      if (editing) {
        await withStore('Speichere …', () => modifyCourse(c => {
          // Umbenannte Teams auch in vorhandenen Notizen umbenennen (gleiche Position in der Liste)
          c.teams.forEach((old, i) => { if (teams[i] && old.name !== teams[i].name) c.notes.forEach(n => { if (n.team === old.name) n.team = teams[i].name; }); });
          c.meta = meta; c.teams = teams;
        }));
      } else {
        const c = { meta, teams, notes: [], gesamt: {} };
        const name = 'Lehrgang ' + meta.titel.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx';
        const id = await withStore('Lege Datei an …', async () => store().create(name, await WBK.toBuffer(c)));
        setActive(id); course = c; await S.KV.set('course:' + id, c);
      }
      show('#courseForm', false); renderHeader(); refreshCourses(); toast('✓ Gespeichert');
    } catch (e) { /* gemeldet */ }
  }
  async function download() {
    if (!activeId) return toast('Kein Lehrgang gewählt.');
    try {
      const buf = await withStore('Lade Datei …', () => store().load(activeId));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: S.XLSX_MIME }));
      a.download = 'Lehrgang ' + ((course && course.meta.titel) || '') + '.xlsx';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { /* gemeldet */ }
  }

  // ---------------- Einstellungen ----------------
  function fillSettings() {
    const f = $('#settingsForm');
    f.querySelector('input[name=mode][value=' + settings.mode + ']').checked = true;
    f.clientId.value = settings.clientId; f.clientId.placeholder = CFG.googleClientId || '…apps.googleusercontent.com';
    f.openaiKey.value = settings.openaiKey; f.sttModel.value = settings.sttModel; f.llmModel.value = settings.llmModel;
    show('#driveBox', settings.mode === 'drive'); updateDriveStatus();
  }
  function updateDriveStatus() {
    $('#driveStatus').textContent = S.Drive.connected() ? '✓ Verbunden' : (clientId() ? 'Nicht verbunden' : '⚠ Noch keine Google-Client-ID eingerichtet – siehe Anleitung. Zum Testen „Nur auf diesem Gerät“ wählen.');
  }
  function saveSettings(ev) {
    if (ev) ev.preventDefault();
    const f = $('#settingsForm');
    const oldMode = settings.mode;
    settings.mode = f.querySelector('input[name=mode]:checked').value;
    settings.clientId = f.clientId.value.trim(); settings.openaiKey = f.openaiKey.value.trim();
    settings.sttModel = f.sttModel.value.trim() || CFG.sttModel; settings.llmModel = f.llmModel.value.trim() || CFG.llmModel;
    localStorage.setItem('baumi.settings', JSON.stringify(settings));
    if (settings.openaiKey && (settings.mode === 'local' || clientId())) banner('');
    if (oldMode !== settings.mode) { activeId = localStorage.getItem('baumi.active.' + settings.mode) || ''; course = null; loadActive(); }
    toast('✓ Einstellungen gespeichert');
  }

  // ---------------- Start ----------------
  async function restoreDraft() {
    const d = await S.KV.get('draft');
    if (d && d.segments && d.segments.length && course) {
      segments = d.segments; noteTime = d.uhrzeit || nowTime(); $('#noteDate').value = d.datum || today(); $('#transcript').value = d.transcript || '';
      renderSegments(); showStep('preview'); toast('Nicht gespeicherter Entwurf wiederhergestellt.', 4000);
    }
    if (await S.KV.get('lastAudio')) show('#lastAudioBtn', true);
  }

  function bind() {
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    $('#noteDate').value = today(); $('#dayDate').value = today();
    $('#noteDate').addEventListener('change', updateDayLabel);
    $('#recBtn').addEventListener('click', () => (rec && rec.state === 'recording' ? stopRec() : startRec()));
    $('#typeBtn').addEventListener('click', () => { if (!course) { toast('Bitte zuerst einen Lehrgang wählen.'); return go('lehrgang'); } noteTime = nowTime(); showStep('text'); $('#transcript').focus(); });
    $('#lastAudioBtn').addEventListener('click', async () => { const a = await S.KV.get('lastAudio'); if (a) { noteTime = a.uhrzeit; $('#noteDate').value = a.datum; processAudio(a.blob); } });
    $('#discardText').addEventListener('click', () => { $('#transcript').value = ''; showStep('record'); });
    $('#assignBtn').addEventListener('click', doAssign);
    $('#backToText').addEventListener('click', () => { syncSegmentsFromUi(); showStep('text'); });
    $('#addSeg').addEventListener('click', () => { syncSegmentsFromUi(); segments.push({ team: 'Unklar', kategorie: 'Sonstiges', text: '' }); renderSegments(); });
    $('#segments').addEventListener('click', e => { const i = e.target.dataset.del; if (i != null) { syncSegmentsFromUi(); segments.splice(Number(i), 1); renderSegments(); } });
    $('#segments').addEventListener('change', e => { if (e.target.dataset.f === 'team') e.target.closest('.seg-card').classList.toggle('warn', e.target.value === 'Unklar'); syncSegmentsFromUi(); });
    $('#saveBtn').addEventListener('click', saveSegments);
    $('#dayPrev').addEventListener('click', () => shiftDay(-1));
    $('#dayNext').addEventListener('click', () => shiftDay(1));
    $('#dayDate').addEventListener('change', renderDay);
    $('#dayAdd').addEventListener('click', () => { $('#noteDate').value = $('#dayDate').value; updateDayLabel(); showStep('record'); go('notiz'); });
    $('#courseList').addEventListener('change', async e => { if (e.target.name === 'course') { setActive(e.target.value); await withStore('Lade Lehrgang …', loadActive).catch(() => {}); refreshCourses(); } });
    $('#newCourseBtn').addEventListener('click', () => openCourseForm(false));
    $('#editCourseBtn').addEventListener('click', () => (course ? openCourseForm(true) : toast('Kein Lehrgang gewählt.')));
    $('#addTeam').addEventListener('click', () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow()));
    $('#teamRows').addEventListener('click', e => { if (e.target.hasAttribute('data-rm')) e.target.closest('.team-row').remove(); });
    $('#cancelCourse').addEventListener('click', () => show('#courseForm', false));
    $('#courseForm').addEventListener('submit', submitCourse);
    $('#downloadBtn').addEventListener('click', download);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#settingsForm').addEventListener('change', e => { if (e.target.name === 'mode') show('#driveBox', e.target.value === 'drive'); });
    $('#connectBtn').addEventListener('click', async () => {
      saveSettings();
      try { await S.Drive.connect(clientId()); banner(''); updateDriveStatus(); toast('✓ Mit Google Drive verbunden'); loadActive(); } catch (e) { toast(e.message, 6000); }
    });
    $('#disconnectBtn').addEventListener('click', () => { S.Drive.disconnect(); updateDriveStatus(); });
    $('#wipeBtn').addEventListener('click', async () => {
      if (!confirm('Wirklich alle Baumi-Daten auf diesem Gerät löschen?')) return;
      localStorage.clear(); indexedDB.deleteDatabase('baumi'); location.reload();
    });
  }

  async function init() {
    bind();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!settings.openaiKey || (settings.mode === 'drive' && !clientId())) {
      banner('<span>Willkommen! Bitte zuerst die Einstellungen ausfüllen.</span><button>Einstellungen</button>', () => { banner(''); go('einst'); });
    } else if (settings.mode === 'drive' && activeId) {
      banner('<span>Für das Speichern einmal mit Google verbinden.</span><button>Verbinden</button>', async () => {
        try { await S.Drive.connect(clientId()); banner(''); await loadActive(); } catch (e) { toast(e.message, 6000); }
      });
    }
    await loadActive();
    await restoreDraft();
  }
  init();
})();
