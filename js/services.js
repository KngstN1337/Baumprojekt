// Baumi – Dienste: OpenAI (Transkription + Zuordnung), Google Drive, lokaler Speicher.
// Alles läuft im Browser des Nutzers. Es gibt keinen eigenen Server.
(function (global) {
  'use strict';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const KATEGORIEN = ['Leinenführigkeit', 'Gehorsam', 'Rückruf', 'Verhalten', 'Sozialverhalten', 'Hausaufgabe', 'Halter/in', 'Sonstiges'];

  // ---------------- OpenAI ----------------
  async function oaiError(res) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
    if (res.status === 401) msg = 'OpenAI-Schlüssel ungültig (' + msg + ')';
    return new Error(msg);
  }

  async function transcribe(blob, opts) {
    const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm';
    const fd = new FormData();
    fd.append('file', blob, 'notiz.' + ext);
    fd.append('model', opts.model || 'gpt-4o-transcribe');
    fd.append('language', 'de');
    if (opts.hint) fd.append('prompt', opts.hint);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + opts.key }, body: fd });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    return (j.text || '').trim();
  }

  async function assign(transcript, teams, opts) {
    const names = teams.map(t => t.name);
    const teamInfo = teams.map(t => '- "' + t.name + '": Teilnehmer/in ' + (t.teilnehmer || '?') + ', Hund ' + (t.hund || '?') + (t.rasse ? ' (' + t.rasse + ')' : '')).join('\n');
    const system =
      'Du bist Assistent eines Hundetrainers. Er spricht frei Notizen zu mehreren Teams (Teilnehmer/in mit Hund) ein. ' +
      'Zerlege das Transkript in Abschnitte und ordne jeden Abschnitt genau einem Team zu. Erkenne Teams an Personen- oder Hundenamen, ' +
      'auch wenn die Spracherkennung sie leicht falsch geschrieben hat. Folgen mehrere Sätze ohne neuen Namen, gehören sie zum zuletzt genannten Team. ' +
      'Betrifft eine Aussage alle Teams (z. B. "alle haben heute ..."), erzeuge für jedes Team einen eigenen Abschnitt. ' +
      'Ist ein Abschnitt keinem Team zuzuordnen, nimm "Unklar". ' +
      'Formuliere jeden Abschnitt als kurze, sachliche Notiz in ganzen Sätzen auf Deutsch, ohne Inhalt wegzulassen oder zu erfinden. Entferne Füllwörter und Versprecher. ' +
      'Hausaufgaben oder Übungsaufträge für zu Hause bekommen die Kategorie "Hausaufgabe" und einen eigenen Abschnitt.\n\nTeams:\n' + teamInfo;
    const schema = {
      type: 'object', additionalProperties: false, required: ['abschnitte'],
      properties: {
        abschnitte: {
          type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['team', 'kategorie', 'text'],
            properties: { team: { type: 'string', enum: [...names, 'Unklar'] }, kategorie: { type: 'string', enum: KATEGORIEN }, text: { type: 'string' } }
          }
        }
      }
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || 'gpt-4.1-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'Transkript:\n' + transcript }],
        response_format: { type: 'json_schema', json_schema: { name: 'zuordnung', strict: true, schema } }
      })
    });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return JSON.parse(content || '{"abschnitte":[]}').abschnitte;
  }

  // ---------------- Google Drive (Scope drive.file: nur von Baumi angelegte Dateien) ----------------
  const Drive = {
    token: null, expires: 0, client: null, clientId: null,
    ready() { return !!(global.google && google.accounts && google.accounts.oauth2); },
    connected() { return !!this.token && Date.now() < this.expires - 60000; },
    // Muss direkt aus einem Klick heraus aufgerufen werden (Popup)
    connect(clientId, silent) {
      return new Promise((resolve, reject) => {
        if (!this.ready()) return reject(new Error('Google-Anmeldung noch nicht geladen. Internetverbindung prüfen.'));
        if (!clientId) return reject(new Error('Keine Google-Client-ID eingerichtet (siehe Einstellungen).'));
        if (!this.client || this.clientId !== clientId) {
          this.clientId = clientId;
          this.client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
        }
        this.client.callback = r => {
          if (r.error) return reject(new Error('Google: ' + r.error));
          this.token = r.access_token; this.expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          localStorage.setItem('baumi.driveConnectedOnce', '1');
          resolve();
        };
        this.client.error_callback = e => reject(new Error('Google-Anmeldung abgebrochen (' + (e && e.type) + ')'));
        this.client.requestAccessToken({ prompt: silent ? '' : (localStorage.getItem('baumi.driveConnectedOnce') ? '' : 'consent') });
      });
    },
    disconnect() { if (this.token && this.ready()) google.accounts.oauth2.revoke(this.token, () => {}); this.token = null; this.expires = 0; localStorage.removeItem('baumi.driveConnectedOnce'); },
    async req(url, init = {}) {
      if (!this.connected()) throw Object.assign(new Error('Bitte mit Google verbinden.'), { needsLogin: true });
      init.headers = Object.assign({ Authorization: 'Bearer ' + this.token }, init.headers || {});
      const res = await fetch(url, init);
      if (res.status === 401) { this.token = null; throw Object.assign(new Error('Google-Anmeldung abgelaufen. Bitte neu verbinden.'), { needsLogin: true }); }
      if (!res.ok) { let t = ''; try { t = (await res.json()).error.message; } catch (e) { /* ignore */ } throw new Error('Google Drive: ' + res.status + ' ' + t); }
      return res;
    },
    async folderId() {
      const cached = localStorage.getItem('baumi.folderId');
      if (cached) {
        try { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + cached + '?fields=id,trashed'); const j = await r.json(); if (!j.trashed) return cached; } catch (e) { if (e.needsLogin) throw e; }
      }
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='Baumi Lehrgänge' and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)');
      const j = await r.json();
      let id = j.files && j.files[0] && j.files[0].id;
      if (!id) {
        const c = await this.req('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Baumi Lehrgänge', mimeType: 'application/vnd.google-apps.folder' }) });
        id = (await c.json()).id;
      }
      localStorage.setItem('baumi.folderId', id);
      return id;
    },
    async list() {
      const q = encodeURIComponent("appProperties has { key='baumi' and value='1' } and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)');
      return (await r.json()).files || [];
    },
    async load(id) { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media'); return r.arrayBuffer(); },
    async create(name, buf) {
      const parent = await this.folderId();
      const meta = { name, mimeType: XLSX_MIME, parents: [parent], appProperties: { baumi: '1' } };
      const boundary = 'baumi' + Math.random().toString(36).slice(2);
      const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + XLSX_MIME + '\r\n\r\n', buf, '\r\n--' + boundary + '--']);
      const r = await this.req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      return (await r.json()).id;
    },
    async save(id, buf) { await this.req('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: new Blob([buf], { type: XLSX_MIME }) }); }
  };

  // ---------------- Lokaler Speicher (IndexedDB) – Testmodus ohne Google und Ablage für Aufnahmen ----------------
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('baumi', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async function tx(store, mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode); const s = t.objectStore(store); let out;
      const req = fn(s); if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error);
    });
  }
  const KV = {
    get: k => tx('kv', 'readonly', s => s.get(k)),
    set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
    del: k => tx('kv', 'readwrite', s => s.delete(k))
  };
  const Local = {
    async list() { const all = (await tx('files', 'readonly', s => s.getAll())) || []; return all.map(f => ({ id: f.id, name: f.name, modifiedTime: f.modified })).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)); },
    async load(id) { const f = await tx('files', 'readonly', s => s.get(id)); if (!f) throw new Error('Datei nicht gefunden'); return f.buf; },
    async create(name, buf) { const id = 'local-' + Date.now(); await tx('files', 'readwrite', s => s.put({ id, name, buf, modified: new Date().toISOString() })); return id; },
    async save(id, buf) { const f = await tx('files', 'readonly', s => s.get(id)); await tx('files', 'readwrite', s => s.put({ ...f, buf, modified: new Date().toISOString() })); }
  };

  global.BaumiServices = { transcribe, assign, Drive, Local, KV, KATEGORIEN, XLSX_MIME };
})(window);
