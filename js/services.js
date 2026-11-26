// Baumprojekt – Dienste: OpenAI (Transkription + Zuordnung), Google Drive, lokaler Speicher.
// Alles läuft im Browser des Nutzers. Es gibt keinen eigenen Server.
(function (global) {
  'use strict';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const KATEGORIEN = ['Leinenführigkeit', 'Gehorsam', 'Rückruf', 'Verhalten', 'Sozialverhalten', 'Hausaufgabe', 'Halter/in', 'Sonstiges'];

  const safeName = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()); };

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

  // Schreibstile wie im Diktiersystem des Fidus-K9-Lexikons, ergänzt um Beamtendeutsch.
  const STILE = [
    { id: 'fliesstext', name: 'Fließtext', text: 'Dein Wortlaut, nur Namen, Rechtschreibung und Satzzeichen korrigiert.', regeln: [
      '- Wörtlich übernehmen. Nicht umformulieren, nicht kürzen, nicht zusammenfassen, nichts ergänzen, nicht umstellen.',
      '- Nur korrigieren: falsch erkannte Namen und Fachbegriffe, Rechtschreibung, Satzzeichen. Reine Laute wie „äh“ weglassen.',
      '- Längere Abschnitte in Absätze teilen (Leerzeile), wo ein Gedanke abgeschlossen ist. Am Wortlaut ändert das nichts.'] },
    { id: 'buchtext', name: 'Buchtext', text: 'Sauberer, gut lesbarer Fließtext in Ich-Form, Wiederholungen raus, Gedanken geordnet.', regeln: [
      '- Mach aus dem Eingesprochenen einen sauberen Fließtext wie in einem Fachbuch, in der Ich-Form des Trainers (ich, nicht wir).',
      '- Ordnen: Zusammengehöriges zusammenführen, logische Reihenfolge (Beobachtung, Erklärung, Folgerung, Beispiel).',
      '- Wiederholungen zusammenfassen, Füllwörter und abgebrochene Ansätze weglassen. Ganze Sätze, sachlicher, seriöser Fachstil.',
      '- Sinnabschnitte mit Leerzeile. Keine Überschriften, keine Aufzählungszeichen.'] },
    { id: 'stichpunkte', name: 'Stichpunkte', text: 'Nur die Kernaussagen als kurze Liste.', regeln: [
      '- Jede Zeile ein Stichpunkt, beginnend mit „• “. Kurz und knapp, gern ohne ganze Sätze. Keine Überschriften, keine Leerzeilen.',
      '- Jede inhaltliche Aussage kommt vor, Wiederholungen nur einmal. Reihenfolge wie gesprochen.'] },
    { id: 'beamtendeutsch', name: 'Beamtendeutsch', text: 'Seriös, sachlich und behördentauglich, z. B. für Amt, Gericht oder Versicherung.', regeln: [
      '- Formuliere wie in einem amtlichen Bericht oder Gutachten, das einer Behörde (z. B. Veterinär- oder Ordnungsamt) vorgelegt wird.',
      '- Dritte Person und neutrale Form, keine Ich-Form: „Der Ausbilder stellte fest …“, „Die Teilnehmerin [Name] führte den Hund [Name] …“.',
      '- Präteritum für Beobachtungen, Präsens für bleibende Zustände. Vollständige, eindeutige und nachvollziehbare Sätze.',
      '- Keine Umgangssprache, keine Gefühlswörter, keine Übertreibungen, keine Abkürzungen außer gängigen (z. B., ca.).',
      '- Beobachtungen und Bewertungen klar trennen; Bewertungen nur, wenn der Trainer sie ausgesprochen hat, und dann als seine Einschätzung kennzeichnen.',
      '- Fachbegriffe korrekt verwenden. Konkrete Angaben (Übung, Dauer, Verhalten, Ergebnis) vollständig übernehmen.',
      '- Sinnabschnitte mit Leerzeile. Keine Überschriften, keine Aufzählungszeichen.'] }
  ];
  const GEMEINSAM = '- Für alle Stile: Nichts erfinden, nichts weglassen, keine eigenen Schlüsse ergänzen. Namen von Teilnehmern und Hunden so schreiben wie in der Teamliste. ' +
    'Diktierbefehle wie „Absatz“, „neue Zeile“, „Punkt“, „Komma“ als Formatierung bzw. Satzzeichen umsetzen, nur wenn sie eindeutig als Befehl gemeint sind.';
  // Glossar (wie im Fidus-K9-Lexikon): Fachbegriffe gehen an die Spracherkennung und an die Formulierung
  const GLOSSAR_REGELN = '- Fachbegriffe so schreiben wie im Glossar. Steht dort eine typische Fehlerkennung, korrigiere sie.\n' +
    '- unklar: Wörter im Text, die vermutlich falsch erkannt wurden und die du nicht sicher korrigieren kannst (z. B. unbekannte Fachbegriffe, Namen, sinnlose Wörter). ' +
    'wort genau so, wie es in text steht; vorschlag ist deine beste Vermutung oder "". Höchstens 5, sonst leer lassen.';
  const glossarListe = g => (g || []).map(x => x.begriff + (x.falsch ? ' (oft erkannt als: ' + x.falsch + ')' : '')).join('\n') || '(leer)';
  const glossarHinweis = g => (g || []).map(x => x.begriff).join(', ');
  const stilVon = id => STILE.find(s => s.id === id) || STILE[0];

  async function assign(transcript, teams, opts) {
    const stil = stilVon(opts.stil);
    const names = teams.map(t => t.name);
    const teamInfo = teams.map(t => '- "' + t.name + '": Teilnehmer/in ' + (t.teilnehmer || '?') + ', Hund ' + (t.hund || '?') + (t.rasse ? ' (' + t.rasse + ')' : '')).join('\n');
    const system =
      'Du bist Assistent eines Hundetrainers. Er spricht frei Notizen zu mehreren Teams (Teilnehmer/in mit Hund) ein. ' +
      'Zerlege das Transkript in Abschnitte und ordne jeden Abschnitt genau einem Team zu. Erkenne Teams an Personen- oder Hundenamen, ' +
      'auch wenn die Spracherkennung sie leicht falsch geschrieben hat. Folgen mehrere Sätze ohne neuen Namen, gehören sie zum zuletzt genannten Team. ' +
      'Betrifft eine Aussage alle Teams (z. B. "alle haben heute ..."), erzeuge für jedes Team einen eigenen Abschnitt. ' +
      'Ist ein Abschnitt keinem Team zuzuordnen, nimm "Unklar". ' +
'Hausaufgaben oder Übungsaufträge für zu Hause bekommen die Kategorie "Hausaufgabe" und einen eigenen Abschnitt.\n\n' +
      'Regeln für text (Schreibstil „' + stil.name + '“):\n' + stil.regeln.join('\n') + '\n' + GEMEINSAM + '\n\nTeams:\n' + teamInfo;
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
      this.fromRedirect();
      try { const t = JSON.parse(localStorage.getItem('baumprojekt.token') || 'null'); if (t && t.expires > Date.now() + 60000) { this.token = t.token; this.expires = t.expires; } } catch (e) { /* ignore */ }
      return this.connected();
    },
    // Anmeldung ohne Popup: Die Seite wechselt zu Google und kommt danach zurück (bleibt so in der App, kein neuer Tab).
    // Voraussetzung: Die Adresse der App ist in der Google Cloud Console als „Autorisierte Weiterleitungs-URI“ eingetragen.
    redirectUri() { const c = (global.BAUMPROJEKT_CONFIG || {}).redirectUri; return c && c.startsWith(location.origin) ? c : location.origin + location.pathname.replace(/index\.html$/, ''); },
    connectRedirect(clientId, chooseAccount) {
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('baumprojekt.oauthState', state);
      const p = new URLSearchParams({ client_id: clientId, redirect_uri: this.redirectUri(), response_type: 'token', scope: 'https://www.googleapis.com/auth/drive.file', include_granted_scopes: 'true', state });
      if (chooseAccount) p.set('prompt', 'select_account');
      location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
      return new Promise(() => {}); // Seite wird verlassen
    },
    loginError: '',
    fromRedirect() {
      if (!/[#&](access_token|error)=/.test(location.hash)) return;
      const p = new URLSearchParams(location.hash.slice(1));
      history.replaceState(null, '', location.pathname + location.search);
      const expected = localStorage.getItem('baumprojekt.oauthState'); localStorage.removeItem('baumprojekt.oauthState');
      if (!expected || p.get('state') !== expected) { this.loginError = 'Anmeldung konnte nicht bestätigt werden. Bitte erneut anmelden.'; return; }
      if (p.get('error')) { this.loginError = p.get('error') === 'access_denied' ? 'Zugriff verweigert. Dieses Google-Konto ist nicht freigeschaltet.' : 'Google: ' + p.get('error'); return; }
      if (!/drive\.file/.test(p.get('scope') || '')) { this.loginError = 'Bitte bei der Google-Anmeldung den Zugriff auf Google Drive erlauben (Häkchen setzen).'; return; }
      this.token = p.get('access_token'); this.expires = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
      localStorage.setItem('baumprojekt.token', JSON.stringify({ token: this.token, expires: this.expires }));
    },
    // Muss direkt aus einem Klick heraus aufgerufen werden (Popup)
    connect(clientId, chooseAccount) {
      if ((global.BAUMPROJEKT_CONFIG || {}).loginRedirect && clientId) return this.connectRedirect(clientId, chooseAccount);
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
    logout() { this.token = null; this.expires = 0; this.user = null; localStorage.removeItem('baumprojekt.token'); localStorage.removeItem('baumprojekt.folderId'); Object.keys(localStorage).filter(k => k.startsWith('baumprojekt.folders.')).forEach(k => localStorage.removeItem(k)); },
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
    // Aufbau in Drive:  Baumprojekt Lehrgänge / <Lehrgang> / Lehrgang <Name>.xlsx
    //                                                      / Aufnahmen  (Audio + Rohtext je Diktat)
    //                                                      / Sicherungen (Stand der Excel vor jedem Speichern)
    async list() {
      const q = encodeURIComponent("appProperties has { key='baumprojekt' and value='1' } and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink,parents,ownedByMe,owners(displayName,emailAddress))');
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
    async query(q, fields) {
      let out = [], token = '';
      do {
        const r = await this.req('https://www.googleapis.com/drive/v3/files?pageSize=1000&q=' + encodeURIComponent(q) + '&fields=nextPageToken,files(' + fields + ')' + (token ? '&pageToken=' + token : ''));
        const j = await r.json(); out = out.concat(j.files || []); token = j.nextPageToken || '';
      } while (token);
      return out;
    },
    async folder(name, parent, neu) {
      if (neu) return this.newFolder(name, parent);
      const q = "mimeType='application/vnd.google-apps.folder' and name='" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + parent + "' in parents and trashed=false";
      const found = await this.query(q, 'id');
      if (found.length) return found[0].id;
      return this.newFolder(name, parent);
    },
    async newFolder(name, parent) {
      const c = await this.req('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
      return (await c.json()).id;
    },
    // Ordner eines Lehrgangs finden. Liegt die Datei noch im alten Aufbau direkt in „Baumprojekt Lehrgänge“,
    // bekommt sie hier ihren eigenen Ordner (verschoben, nicht kopiert – es geht nichts verloren).
    async withFolders(id, fn) {
      try { return await fn(await this.courseFolders(id)); }
      catch (e) { if (!/ 404/.test(e.message)) throw e; localStorage.removeItem('baumprojekt.folders.' + id); return fn(await this.courseFolders(id)); }
    },
    async courseFolders(id) {
      const key = 'baumprojekt.folders.' + id;
      try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c; } catch (e) { /* ignore */ }
      const root = await this.folderId();
      const f = await (await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=name,parents,ownedByMe')).json();
      let folder = (f.parents || [])[0];
      if (!f.ownedByMe) {
        // Geteilter Lehrgang: nie verschieben und nichts doppelt anlegen, nur die vorhandenen Ordner des Kollegen nutzen
        const sub = async name => {
          const q = "mimeType='application/vnd.google-apps.folder' and name='" + name + "' and '" + folder + "' in parents and trashed=false";
          const found = folder ? await this.query(q, 'id') : [];
          if (!found.length) throw Object.assign(new Error('Kein Zugriff auf den Ordner „' + name + '“ des geteilten Lehrgangs. Bitte unter Lehrgänge „Geteilten Lehrgang hinzufügen“ tippen und alles im Ordner auswählen.'), { noAccess: true });
          return found[0].id;
        };
        const out = { folder, aufnahmen: await sub('Aufnahmen'), sicherungen: await sub('Sicherungen'), shared: true };
        localStorage.setItem(key, JSON.stringify(out));
        return out;
      }
      if (!folder || folder === root) {
        folder = await this.folder(safeName(f.name.replace(/\.xlsx$/i, '').replace(/^Lehrgang /, '')) || 'Lehrgang', root, true);
        await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?addParents=' + folder + (f.parents && f.parents.length ? '&removeParents=' + f.parents.join(',') : '') + '&fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      }
      const out = { folder, aufnahmen: await this.folder('Aufnahmen', folder), sicherungen: await this.folder('Sicherungen', folder) };
      localStorage.setItem(key, JSON.stringify(out));
      return out;
    },
    async upload(meta, body, mime) {
      const boundary = 'baumprojekt' + Math.random().toString(36).slice(2);
      const b = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n', body, '\r\n--' + boundary + '--']);
      const r = await this.req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: b });
      return (await r.json()).id;
    },
    async load(id) { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media'); return r.arrayBuffer(); },
    async loadBlob(id) { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media'); return r.blob(); },
    async create(titel, buf) {
      const folder = await this.folder(safeName(titel) || 'Lehrgang', await this.folderId(), true);
      const id = await this.upload({ name: 'Lehrgang ' + safeName(titel) + '.xlsx', mimeType: XLSX_MIME, parents: [folder], appProperties: { baumprojekt: '1' } }, buf, XLSX_MIME);
      await this.courseFolders(id);
      return id;
    },
    // Vor jedem Überschreiben: aktuellen Stand nach „Sicherungen“ kopieren. Klappt das nicht, wird nicht überschrieben.
    // expectedRev: Stand beim Einlesen. Hat inzwischen jemand anderes gespeichert (zweiter Trainer), wird nicht überschrieben.
    async save(id, buf, expectedRev) {
      await this.withFolders(id, f => this.backup(id, f));
      if (expectedRev && (await this.revision(id)) !== expectedRev) throw Object.assign(new Error('Die Datei wurde gerade woanders geändert.'), { conflict: true });
      await this.req('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': XLSX_MIME }, body: new Blob([buf], { type: XLSX_MIME }) });
      this.pruneBackups(id).catch(() => {});
    },
    async backup(id, f) {
      const cur = await (await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=name')).json();
      await this.req('https://www.googleapis.com/drive/v3/files/' + id + '/copy?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cur.name.replace(/\.xlsx$/i, '') + ' – Sicherung ' + stamp() + '.xlsx', parents: [f.sicherungen], appProperties: { baumprojekt: '0', bpTyp: 'sicherung', kurs: id } }) });
    },
    // Sicherungen der letzten 14 Tage bleiben alle, davor die letzte jedes Tages. Aussortiertes geht in den Drive-Papierkorb.
    async pruneBackups(id) {
      const list = await this.query("appProperties has { key='kurs' and value='" + id + "' } and appProperties has { key='bpTyp' and value='sicherung' } and trashed=false", 'id,createdTime');
      const grenze = Date.now() - 14 * 86400000, perDay = {};
      list.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      for (const f of list) {
        if (new Date(f.createdTime).getTime() > grenze) continue;
        const d = f.createdTime.slice(0, 10);
        if (!perDay[d]) { perDay[d] = 1; continue; }
        await this.req('https://www.googleapis.com/drive/v3/files/' + f.id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      }
    },
    async revision(id) {
      const j = await (await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=headRevisionId,md5Checksum,modifiedTime')).json();
      return (j.headRevisionId || '') + '|' + (j.md5Checksum || '') + '|' + (j.modifiedTime || '');
    },
    async info(id) {
      const r = await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id,name,shared,ownedByMe,owners(displayName,emailAddress),appProperties,parents');
      const j = await r.json();
      const p = j.appProperties || {};
      j.sharedKey = [0, 1, 2, 3].map(i => p['bk' + i] || '').join('');
      j.sharedKeyBy = p.bkVon || '';
      return j;
    },
    // OpenAI-Schlüssel des Einladenden für den Lehrgang freigeben (oder mit key=null zurücknehmen).
    // Er liegt als App-Eigenschaft an der Lehrgangsdatei: nicht in der Excel, nicht in Downloads, nur für Baumprojekt lesbar.
    async setSharedKey(id, key, von) {
      const props = { bkVon: key ? String(von || '').slice(0, 100) : null };
      const chunks = key ? key.match(/.{1,110}/g) || [] : [];
      if (chunks.length > 4) throw new Error('Schlüssel zu lang.');
      [0, 1, 2, 3].forEach(i => { props['bk' + i] = chunks[i] || null; });
      await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: props }) });
    },
    // Freigabe des Lehrgangsordners (Excel, Aufnahmen, Sicherungen) an einen zweiten Trainer
    async share(folderId, email, message) {
      await this.req('https://www.googleapis.com/drive/v3/files/' + folderId + '/permissions?sendNotificationEmail=true&emailMessage=' + encodeURIComponent(message) + '&fields=id', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }) });
    },
    async shares(folderId) {
      const r = await this.req('https://www.googleapis.com/drive/v3/files/' + folderId + '/permissions?fields=permissions(id,emailAddress,displayName,role,type)');
      return ((await r.json()).permissions || []).filter(p => p.role !== 'owner' && p.type === 'user');
    },
    async unshare(folderId, permId) { await this.req('https://www.googleapis.com/drive/v3/files/' + folderId + '/permissions/' + permId, { method: 'DELETE' }); },
    // Lehrgangsdatei in einem (geteilten) Ordner finden
    async courseIn(folderId) {
      const f = await this.query("'" + folderId + "' in parents and appProperties has { key='baumprojekt' and value='1' } and trashed=false", 'id');
      return f[0] ? f[0].id : null;
    },
    // Ganzen Lehrgangsordner in den Papierkorb (Drive hält ihn 30 Tage, danach endgültig gelöscht)
    async trashCourse(id) {
      const f = await this.courseFolders(id);
      const patch = fid => this.req('https://www.googleapis.com/drive/v3/files/' + fid + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      if (f.shared) throw new Error('Geteilte Lehrgänge kann nur der Besitzer löschen.');
      if (f.folder && f.folder !== await this.folderId()) await patch(f.folder); // nie den Hauptordner „Baumprojekt Lehrgänge“
      await patch(id).catch(() => {}); // falls die Datei (noch) nicht im Ordner liegt
      localStorage.removeItem('baumprojekt.folders.' + id);
    },
    async rename(id, titel) {
      const f = await this.courseFolders(id);
      const patch = (fid, name) => this.req('https://www.googleapis.com/drive/v3/files/' + fid + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      await patch(f.folder, safeName(titel)); await patch(id, 'Lehrgang ' + safeName(titel) + '.xlsx');
    },
    // Aufnahme (Audio) bzw. Rohtext eines Diktats im Ordner „Aufnahmen“ ablegen
    saveRecording(r, kind) { return this.withFolders(r.courseId, f => this.putRecording(r, kind, f)); },
    async putRecording(r, kind, f) {
      const base = r.datum + ' ' + r.uhrzeit.replace(':', '-') + ' (' + r.aid.slice(-4) + ')';
      const props = { bpTyp: kind, kurs: r.courseId, aid: r.aid, datum: r.datum, uhrzeit: r.uhrzeit };
      if (r.von) props.von = r.von.slice(0, 60);
      if (r.team) props.team = r.team.slice(0, 50);
      if (kind === 'aufnahme') {
        const ext = /mp4|m4a|aac/.test(r.mime) ? 'm4a' : /ogg/.test(r.mime) ? 'ogg' : 'webm';
        return this.upload({ name: base + ' Aufnahme.' + ext, mimeType: r.mime.split(';')[0], parents: [f.aufnahmen], appProperties: props }, r.blob, r.mime);
      }
      const txt = (r.team ? 'Team: ' + r.team + '\r\n' : '') + (r.von ? 'Eingesprochen von: ' + r.von + '\r\n' : '') + 'Rohtext der Aufnahme vom ' + r.datum.split('-').reverse().join('.') + ', ' + r.uhrzeit + ' Uhr\r\n(unverändertes Ergebnis der Spracherkennung)\r\n\r\n' + r.transcript + '\r\n';
      return this.upload({ name: base + ' Rohtext.txt', mimeType: 'text/plain', parents: [f.aufnahmen], appProperties: props }, new Blob(['﻿' + txt]), 'text/plain; charset=UTF-8');
    },
    async listRecordings(courseId) {
      const files = await this.query("appProperties has { key='kurs' and value='" + courseId + "' } and trashed=false", 'id,name,mimeType,appProperties,createdTime');
      const by = {};
      files.forEach(f => {
        const p = f.appProperties || {};
        if (p.bpTyp !== 'aufnahme' && p.bpTyp !== 'rohtext') return;
        const r = by[p.aid] || (by[p.aid] = { aid: p.aid, datum: p.datum, uhrzeit: p.uhrzeit, team: p.team || '', von: p.von || '' });
        if (p.bpTyp === 'aufnahme') r.audioId = f.id; else r.textId = f.id;
      });
      return Object.values(by).sort((a, b) => (b.datum + b.uhrzeit).localeCompare(a.datum + a.uhrzeit));
    }
  };

  // ---------------- Lokaler Speicher (IndexedDB) – Testmodus ohne Google und Ablage für Aufnahmen ----------------
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('baumprojekt', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'aid' });
      };
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
  // Warteschlange: Aufnahmen und Rohtexte bleiben auf dem Gerät, bis sie sicher in Google Drive liegen.
  const Outbox = {
    all: () => tx('outbox', 'readonly', s => s.getAll()),
    get: k => tx('outbox', 'readonly', s => s.get(k)),
    put: v => tx('outbox', 'readwrite', s => s.put(v)),
    del: k => tx('outbox', 'readwrite', s => s.delete(k))
  };


  // Eine Aufnahme zu EINEM bekannten Team im gewählten Stil formulieren.
  async function formulate(transcript, team, opts) {
    const stil = stilVon(opts.stil);
    const alle = !team;
    const system =
      'Du bist Assistent eines Hundetrainers. Er hat eine Notiz ' + (alle ? 'für ALLE Teams seines Lehrgangs' : 'zu genau einem Team (Teilnehmer/in mit Hund)') + ' eingesprochen. ' +
      'Schreibe daraus den Notiztext.\n\n' +
      (alle ? '' : 'Team: Teilnehmer/in ' + (team.teilnehmer || '?') + ', Hund ' + (team.hund || '?') + (team.rasse ? ' (' + team.rasse + ')' : '') + '\n\n') +
      'Regeln für text (Schreibstil „' + stil.name + '“):\n' + stil.regeln.join('\n') + '\n' + GEMEINSAM + '\n' + GLOSSAR_REGELN +
      '\n\nGlossar (Begriff, dahinter typische Fehlerkennungen der Spracherkennung):\n' + glossarListe(opts.glossar);
    const schema = { type: 'object', additionalProperties: false, required: ['text', 'unklar'],
      properties: { text: { type: 'string' },
        unklar: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['wort', 'vorschlag'], properties: { wort: { type: 'string' }, vorschlag: { type: 'string' } } } } } };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || 'gpt-4.1-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'Transkript:\n' + transcript }],
        response_format: { type: 'json_schema', json_schema: { name: 'notiz', strict: true, schema } }
      })
    });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const r = JSON.parse(content || '{"text":"","unklar":[]}');
    // Nur Rückfragen behalten, deren Wort wirklich im Text steht
    r.unklar = (r.unklar || []).filter(u => u.wort && r.text.toLowerCase().indexOf(u.wort.toLowerCase()) >= 0 && u.wort !== u.vorschlag);
    return r;
  }
  // ---------------- Google Picker: geteilten Lehrgang auswählen (nötig wegen drive.file) ----------------
  function loadScript(src) {
    return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Google-Auswahl konnte nicht geladen werden.')); document.head.appendChild(s); });
  }
  let pickerReady = null;
  async function pick(opts) {
    if (!pickerReady) pickerReady = (global.gapi ? Promise.resolve() : loadScript('https://apis.google.com/js/api.js')).then(() => new Promise(r => gapi.load('picker', r)));
    try { await pickerReady; } catch (e) { pickerReady = null; throw e; }
    const P = google.picker;
    return new Promise(resolve => {
      const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(P.DocsViewMode.LIST);
      if (opts.parent) view.setParent(opts.parent); else view.setOwnedByMe(false);
      const b = new P.PickerBuilder().addView(view).enableFeature(P.Feature.MULTISELECT_ENABLED).setOAuthToken(opts.token)
        .setAppId(opts.appId).setLocale('de').setTitle(opts.title || 'Geteilten Lehrgang auswählen')
        .setCallback(d => { if (d.action === P.Action.PICKED) resolve(d.docs || []); else if (d.action === P.Action.CANCEL) resolve(null); });
      if (opts.apiKey) b.setDeveloperKey(opts.apiKey);
      if (opts.origin) b.setOrigin(opts.origin);
      b.build().setVisible(true);
    });
  }

  global.BaumprojektServices = { glossarHinweis, pick, transcribe, assign, formulate, STILE, Drive, KV, Outbox, KATEGORIEN, XLSX_MIME };
})(window);
