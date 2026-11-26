// Baumprojekt – Dienste: OpenAI (Transkription + Zuordnung), Google Drive, lokaler Speicher.
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

  // ---------------- Google Drive (Scope drive.file: nur von Baumprojekt angelegte Dateien) ----------------
  const Drive = {
    token: null, expires: 0, client: null, clientId: null, user: null,
    ready() { return !!(global.google && google.accounts && google.accounts.oauth2); },
    connected() { return !!this.token && Date.now() < this.expires - 60000; },
    // Anmeldung der letzten Stunde wiederherstellen (überlebt Neuladen der Seite)
    restore() {
      try { const t = JSON.parse(localStorage.getItem('baumprojekt.token') || 'null'); if (t && t.expires > Date.now() + 60000) { this.token = t.token; this.expires = t.expires; } } catch (e) { /* ignore */ }
      return this.connected();
    },
    // Muss direkt aus einem Klick heraus aufgerufen werden (Popup)
    connect(clientId, chooseAccount) {
      return new Promise((resolve, reject) => {
        if (!this.ready()) return reject(new Error('Google-Anmeldung lädt noch. Bitte kurz warten und erneut tippen.'));
        if (!clientId) return reject(new Error('Keine Google-Client-ID eingerichtet.'));
        if (!this.client || this.clientId !== clientId) {
          this.clientId = clientId;
          this.client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
        }
        this.client.callback = r => {
          if (r.error) return reject(new Error(r.error === 'access_denied' ? 'Zugriff verweigert. Dieses Google-Konto ist nicht freigeschaltet.' : 'Google: ' + r.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/drive.file')) return reject(new Error('Bitte bei der Google-Anmeldung den Zugriff auf Google Drive erlauben (Häkchen setzen).'));
          this.token = r.access_token; this.expires = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          localStorage.setItem('baumprojekt.token', JSON.stringify({ token: this.token, expires: this.expires }));
          resolve();
        };
        this.client.error_callback = e => reject(new Error(e && e.type === 'popup_closed' ? 'Anmeldefenster geschlossen.' : 'Google-Anmeldung fehlgeschlagen (' + (e && e.type) + ')'));
        this.client.requestAccessToken({ prompt: chooseAccount ? 'select_account' : '' });
      });
    },
    // Abmelden: nur auf diesem Gerät. Die Freigabe bei Google bleibt, damit nach dem nächsten Login alle Dateien wieder da sind.
    logout() { this.token = null; this.expires = 0; this.user = null; localStorage.removeItem('baumprojekt.token'); localStorage.removeItem('baumprojekt.folderId'); },
    async me() {
      const r = await this.req('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)');
      this.user = (await r.json()).user || null;
      return this.user;
    },
    async req(url, init = {}) {
      if (!this.connected()) throw Object.assign(new Error('Bitte mit Google verbinden.'), { needsLogin: true });
      init.headers = Object.assign({ Authorization: 'Bearer ' + this.token }, init.headers || {});
      const res = await fetch(url, init);
      if (res.status === 401) { this.logout(); throw Object.assign(new Error('Google-Anmeldung abgelaufen. Bitte neu verbinden.'), { needsLogin: true }); }
      if (!res.ok) { let t = ''; try { t = (await res.json()).error.message; } catch (e) { /* ignore */ } throw new Error('Google Drive: ' + res.status + ' ' + t); }
      return res;
    },
    async folderId() {
      const cached = localStorage.getItem('baumprojekt.folderId');
      if (cached) {
        try { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + cached + '?fields=id,trashed'); const j = await r.json(); if (!j.trashed) return cached; } catch (e) { if (e.needsLogin) throw e; }
      }
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='Baumprojekt Lehrgänge' and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)');
      const j = await r.json();
      let id = j.files && j.files[0] && j.files[0].id;
      if (!id) {
        const c = await this.req('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Baumprojekt Lehrgänge', mimeType: 'application/vnd.google-apps.folder' }) });
        id = (await c.json()).id;
      }
      localStorage.setItem('baumprojekt.folderId', id);
      return id;
    },
    async list() {
      const q = encodeURIComponent("appProperties has { key='baumprojekt' and value='1' } and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)');
      return (await r.json()).files || [];
    },
    // Einstellungen (OpenAI-Schlüssel, Modelle) als kleine Datei im eigenen Drive – damit sie auf allen Geräten da sind
    async findSettingsFile() {
      const q = encodeURIComponent("appProperties has { key='baumprojektSettings' and value='1' } and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)');
      const f = ((await r.json()).files || [])[0];
      return f ? f.id : null;
    },
    async loadSettings() {
      const id = await this.findSettingsFile();
      if (!id) return null;
      const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media');
      try { return JSON.parse(await r.text()); } catch (e) { return null; }
    },
    async saveSettings(obj) {
      const body = JSON.stringify(obj, null, 2);
      const id = await this.findSettingsFile();
      if (id) { await this.req('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); return; }
      const parent = await this.folderId();
      const meta = { name: 'Baumprojekt-Einstellungen (nicht löschen).json', mimeType: 'application/json', parents: [parent], appProperties: { baumprojektSettings: '1' } };
      const boundary = 'bp' + Math.random().toString(36).slice(2);
      const mp = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
      await this.req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: mp });
    },
    async load(id) { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media'); return r.arrayBuffer(); },
    async create(name, buf) {
      const parent = await this.folderId();
      const meta = { name, mimeType: XLSX_MIME, parents: [parent], appProperties: { baumprojekt: '1' } };
      const boundary = 'baumprojekt' + Math.random().toString(36).slice(2);
      const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + XLSX_MIME + '\r\n\r\n', buf, '\r\n--' + boundary + '--']);
      const r = await this.req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      return (await r.json()).id;
    },
    async save(id, buf) { await this.req('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: new Blob([buf], { type: XLSX_MIME }) }); }
  };

  // ---------------- Lokaler Speicher (IndexedDB) – Testmodus ohne Google und Ablage für Aufnahmen ----------------
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('baumprojekt', 1);
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

  global.BaumprojektServices = { transcribe, assign, Drive, KV, KATEGORIEN, XLSX_MIME };
})(window);
