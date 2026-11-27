// LTR – Dienste: OpenAI (Transkription + Zuordnung), Google Drive, lokaler Speicher.
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

  // Spracherkennung: Standard ist „gpt-transcribe“ (genauer bei Namen und Fachbegriffen, günstiger als gpt-4o-transcribe).
  // Ist es für das Konto (noch) nicht freigeschaltet, wird automatisch gpt-4o-transcribe genommen.
  const STT_RUECKFALL = 'gpt-4o-transcribe';
  async function transcribe(blob, opts) {
    const ext = /mp4|m4a|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm';
    const senden = async model => {
      const fd = new FormData();
      fd.append('file', blob, 'notiz.' + ext);
      fd.append('model', model);
      fd.append('language', 'de');
      if (opts.hint) fd.append('prompt', opts.hint);
      return fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + opts.key }, body: fd });
    };
    const model = opts.model || 'gpt-transcribe';
    let res = await senden(model);
    if (!res.ok && model !== STT_RUECKFALL && (res.status === 404 || res.status === 400 || res.status === 403)) {
      const e = await oaiError(res.clone());
      if (/model|modell/i.test(e.message)) res = await senden(STT_RUECKFALL);
    }
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    return (j.text || '').trim();
  }
  // Kontext für die Spracherkennung: ein kurzer, korrekt geschriebener Vortext mit allen Namen und Fachwörtern des Lehrgangs.
  // So schreibt die Erkennung „Detlef“, „Semtex“ oder „Malinois“ richtig, statt ähnlich klingende Wörter zu raten.
  function sttHinweis(teams, glossar, stoffe) {
    const uniq = a => Array.from(new Set(a.map(x => String(x || '').trim()).filter(Boolean)));
    const tn = uniq((teams || []).map(t => t.teilnehmer)), hu = uniq((teams || []).map(t => t.hund));
    const be = uniq((teams || []).map(t => t.behoerde)), ra = uniq((teams || []).map(t => t.rasse));
    const fach = uniq((glossar || []).map(g => g.begriff)), st = uniq(stoffe || []);
    const teile = ['Notiz eines Diensthundetrainers zum Lehrgang, auf Deutsch.'];
    if (tn.length) teile.push('Teilnehmer: ' + tn.join(', ') + '.');
    if (hu.length) teile.push('Hunde: ' + hu.join(', ') + '.');
    if (ra.length) teile.push('Rassen: ' + ra.join(', ') + '.');
    if (be.length) teile.push('Behörden: ' + be.join(', ') + '.');
    if (st.length) teile.push('Zielgerüche: ' + st.join(', ') + '.');
    if (fach.length) teile.push('Fachbegriffe: ' + fach.join(', ') + '.');
    return teile.join(' ').slice(0, 2000);
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
    { id: 'beamtendeutsch', name: 'Beamtendeutsch', text: 'Seriös, sachlich und unpersönlich („Es wurde festgestellt …“), z. B. für Amt, Gericht oder Versicherung.', regeln: [
      '- Formuliere wie in einem amtlichen Bericht oder Gutachten, das einer Behörde (z. B. Veterinär- oder Ordnungsamt) vorgelegt wird.',
      '- Unpersönlich formulieren: keine Ich-Form und den Trainer nie in der dritten Person nennen (nicht „Der Ausbilder …“, „Der Trainer …“).',
      '  Stattdessen Passiv oder unpersönliche Form: „Es wurde festgestellt, dass …“, „Es wurde beobachtet …“, „Die Übung wurde wiederholt.“',
      '  Teilnehmer und Hunde sind Satzsubjekt, wo sie handeln: „Die Hündin [Name] zeigte …“, „Die Teilnehmerin [Name] führte den Hund …“.',
      '- Präteritum für Beobachtungen, Präsens für bleibende Zustände. Vollständige, eindeutige und nachvollziehbare Sätze.',
      '- Keine Umgangssprache, keine Gefühlswörter, keine Übertreibungen, keine Abkürzungen außer gängigen (z. B., ca.).',
      '- Beobachtungen und Bewertungen klar trennen; Bewertungen nur, wenn der Trainer sie ausgesprochen hat, und dann unpersönlich als Einschätzung kennzeichnen („Es wird eingeschätzt, dass …“).',
      '- Fachbegriffe korrekt verwenden. Konkrete Angaben (Übung, Dauer, Verhalten, Ergebnis) vollständig übernehmen.',
      '- Sinnabschnitte mit Leerzeile. Keine Überschriften, keine Aufzählungszeichen.'] }
  ];
  const GEMEINSAM = '- Für alle Stile: Nichts erfinden, nichts weglassen, keine eigenen Schlüsse ergänzen. Namen von Teilnehmern und Hunden so schreiben wie in der Teamliste. ' +
    'Diktierbefehle wie „Absatz“, „neue Zeile“, „Punkt“, „Komma“ als Formatierung bzw. Satzzeichen umsetzen, nur wenn sie eindeutig als Befehl gemeint sind.\n' +
    '- Namen: Klingt ein Wort wie ein Name aus der Namensliste (Teilnehmer, Hunde, Behörden) oder wie ein Zielgeruch bzw. Glossarbegriff, schreibe es genau so wie dort. ' +
    'Namen und Fachbegriffe nie umschreiben, übersetzen, beugen oder durch andere Wörter ersetzen.\n' +
    '- Kein Artikel direkt vor Vor- oder Hundenamen: „Detlef führte …“, nicht „die Detlef“ oder „der Detlef“; „Rex zeigte …“, nicht „der Rex“. ' +
    'Steht in der Aufnahme ein Artikel vor einem Namen (umgangssprachlich oder falsch erkannt), lass ihn weg. Erlaubt bleibt eine Rolle davor, z. B. „die Teilnehmerin Anna“, „der Rüde Rex“.';
  // Glossar (wie im Fidus-K9-Lexikon): Fachbegriffe gehen an die Spracherkennung und an die Formulierung
  const GLOSSAR_REGELN = '- Fachbegriffe so schreiben wie im Glossar. Steht dort eine typische Fehlerkennung, korrigiere sie.\n' +
    '- unklar: Wörter im Text, die vermutlich falsch erkannt wurden und die du nicht sicher korrigieren kannst (z. B. unbekannte Fachbegriffe, Namen, sinnlose Wörter). ' +
    'wort genau so, wie es in text steht; vorschlag ist deine beste Vermutung oder "". Höchstens 5, sonst leer lassen.';
  const glossarListe = g => (g || []).map(x => x.begriff + (x.falsch ? ' (oft erkannt als: ' + x.falsch + ')' : '')).join('\n') || '(leer)';
  const glossarHinweis = g => (g || []).map(x => x.begriff).join(', ');
  const namensListe = (teams, stoffe) => {
    const z = (teams || []).filter(t => t && (t.teilnehmer || t.hund)).map(t => '- ' + (t.teilnehmer || '?') + ' mit Hund ' + (t.hund || '?') + (t.rasse ? ' (' + t.rasse + ')' : '') + (t.behoerde ? ', ' + t.behoerde : ''));
    return (z.length ? 'Namensliste aller Teams im Lehrgang (genaue Schreibweise):\n' + z.join('\n') + '\n\n' : '') +
      ((stoffe || []).length ? 'Zielgerüche im Lehrgang: ' + stoffe.join(', ') + '\n\n' : '');
  };
  const stilVon = id => STILE.find(s => s.id === id) || STILE[0];
  // Ansagewort „nächster Punkt“: teilt ein Transkript in mehrere Stichpunkte (untereinander in einer Notiz).
  // Robust gegen „Nächster Punkt.“, „nächster Punkt,“, „Nächster-Punkt“ und „naechster Punkt“; das Ansagewort selbst fällt weg.
  const ANSAGE = /(?<![\p{L}\p{N}])n(?:ä|ae)chster[\s\-]+punkt(?![\p{L}\p{N}])[\s.,;:!?…]*/giu;
  // Mehrere Teile → je eine Zeile „• …“ (Absätze innerhalb eines Punkts werden zu einer Zeile); ein Teil bleibt wie er ist
  const alsStichpunkte = teile => { const t = teile.map(x => String(x || '').trim()).filter(Boolean); return t.length > 1 ? t.map(x => '• ' + x.replace(/^•\s*/, '').replace(/\s*\n+\s*/g, ' ')).join('\n') : (t[0] || ''); };
  const splitPunkte = t => String(t || '').split(ANSAGE).map(p => p.replace(/^[\s.,;:!?…\-]+/, '').replace(/[\s,;:\-]+$/, '').trim()).filter(Boolean);

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

  // ---------------- Google Drive (Scope drive.file: nur von der App angelegte Dateien) ----------------
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
    // Hauptordner „LTR Lehrgänge“. Früher hieß er „Baumprojekt Lehrgänge“: Der alte Ordner wird weiter gefunden
    // und nur umbenannt (gleiche Ordner-ID, Inhalt bleibt unverändert). Es wird nie ein zweiter Ordner angelegt, wenn der alte da ist.
    async folderId() {
      const NAME = 'LTR Lehrgänge', ALT = 'Baumprojekt Lehrgänge';
      const rename = async (id, name) => {
        if (name !== ALT) return;
        try { await this.req('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAME }) }); }
        catch (e) { if (e.needsLogin) throw e; console.warn('Ordner umbenennen später erneut', e); }
      };
      const cached = localStorage.getItem('baumprojekt.folderId');
      if (cached) {
        try { const r = await this.req('https://www.googleapis.com/drive/v3/files/' + cached + '?fields=id,name,trashed'); const j = await r.json(); if (!j.trashed) { await rename(cached, j.name); return cached; } } catch (e) { if (e.needsLogin) throw e; }
      }
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and (name='" + NAME + "' or name='" + ALT + "') and trashed=false");
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=createdTime&fields=files(id,name)');
      const files = (await r.json()).files || [];
      // Gibt es beide, gewinnt der alte (dort liegen die bisherigen Lehrgänge)
      const f = files.find(x => x.name === ALT) || files[0];
      let id = f && f.id;
      if (id) await rename(id, f.name);
      else {
        const c = await this.req('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAME, mimeType: 'application/vnd.google-apps.folder' }) });
        id = (await c.json()).id;
      }
      localStorage.setItem('baumprojekt.folderId', id);
      return id;
    },
    // Aufbau in Drive:  LTR Lehrgänge / <Lehrgang> / Lehrgang <Name>.xlsx
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
      const r = await this.req('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
      const f = ((await r.json()).files || [])[0];
      // Alter Dateiname „Baumprojekt-Einstellungen …“ → „LTR-Einstellungen …“ (nur der Name, Inhalt bleibt)
      if (f && /^Baumprojekt-/.test(f.name || '')) {
        try { await this.req('https://www.googleapis.com/drive/v3/files/' + f.id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name.replace(/^Baumprojekt-/, 'LTR-') }) }); }
        catch (e) { if (e.needsLogin) throw e; }
      }
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
      const meta = { name: 'LTR-Einstellungen (nicht löschen).json', mimeType: 'application/json', parents: [parent], appProperties: { baumprojektSettings: '1' } };
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
    // Ordner eines Lehrgangs finden. Liegt die Datei noch im alten Aufbau direkt im Hauptordner,
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
    // Er liegt als App-Eigenschaft an der Lehrgangsdatei: nicht in der Excel, nicht in Downloads, nur für die App lesbar.
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
      if (f.folder && f.folder !== await this.folderId()) await patch(f.folder); // nie den Hauptordner „LTR Lehrgänge“
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
      namensListe(opts.teams, opts.stoffe) +
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
  // Fertige Notiz auf die Spalten des Tagesprotokolls verteilen (Trainingsort, Zielgerüche, Inhalt, Motivation, Anzeigeverhalten,
  // Beobachtungen / nächster Schritt, Bemerkungen). Der Wortlaut bleibt, nichts wird erfunden; Unklares kommt unter Beobachtungen.
  const FELD_KEYS = ['ort', 'zielgerueche', 'inhalt', 'motivation', 'anzeige', 'beobachtung', 'bemerkung'];
  async function aufteilen(text, opts) {
    const system = 'Du ordnest die Notiz eines Diensthundetrainers den Spalten seines Tagesprotokolls zu. Behalte den Wortlaut der Notiz bei, ' +
      'kürze nichts weg und erfinde nichts. Jeder Satz der Notiz kommt in genau EINE Spalte. Spalten, zu denen nichts gesagt wurde, bleiben leer ("").\n\n' +
      'Spalten:\n' +
      '- ort: Trainingsort, Gebäude, Bereich oder Raum (z. B. "Halle A · Lochwand"). Nur den Ort, kurz.\n' +
      '- zielgerueche: genannte Zielgerüche/Stoffe als kurze Aufzählung mit Komma (z. B. "SIM-Karte, SD-Karte").\n' +
      '- inhalt: Trainingsinhalt und Aufbau: was geübt wurde, Stationen, Anzahl Verstecke, Ablauf.\n' +
      '- motivation: Aussagen zu Motivation, Arbeitsfreude, Ausdauer, Konzentration des Hundes.\n' +
      '- anzeige: Aussagen zum Anzeigeverhalten (Anzeige an der Quelle, Ablegen, Verweisen, zögerlich, sicher).\n' +
      '- beobachtung: weitere Beobachtungen und der nächste Schritt. Ein genannter nächster Schritt steht in einer eigenen Zeile "Nächster Schritt: …". Alles, was in keine andere Spalte passt, kommt hierher.\n' +
      '- bemerkung: Wissenswertes am Rande (Gesundheit, Pfote geschont, Organisatorisches, Hinweise an die Teilnehmenden).\n\n' +
      'Schulnoten: Nur wenn für Motivation oder Anzeigeverhalten ausdrücklich eine Note gesagt wurde (sehr gut, gut, befriedigend, ausreichend, mangelhaft, ungenügend), ' +
      'hänge in dieser Spalte eine eigene letzte Zeile "Bewertung: <note>" an (Note klein geschrieben). Sonst keine Bewertung schreiben, nie eine Note schätzen.\n' +
      'Stichpunkte („• “-Zeilen) bleiben Stichpunkte, verteile sie einzeln. Antworte nur mit dem JSON.';
    const props = {}; FELD_KEYS.forEach(k => { props[k] = { type: 'string' }; });
    const schema = { type: 'object', additionalProperties: false, required: FELD_KEYS, properties: props };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || 'gpt-4.1-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: 'Notiz:\n' + text }],
        response_format: { type: 'json_schema', json_schema: { name: 'tagesprotokoll', strict: true, schema } } })
    });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    const r = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
    const f = {}; FELD_KEYS.forEach(k => { f[k] = String(r[k] || '').trim(); });
    // Sicherheitsnetz: kam gar nichts zurück, steht die ganze Notiz unter Beobachtungen
    if (FELD_KEYS.every(k => !f[k])) f.beobachtung = text;
    return f;
  }
  // Schreibstil für Wochenberichte (Zusammenfassung, daher nicht wörtlich)
  const WB_STIL = {
    fliesstext: 'Schreibstil „Fließtext“: schlicht und sachlich, nah an den Formulierungen des Trainers, ohne Behördensprache.',
    buchtext: 'Schreibstil „Buchtext“: gut lesbarer, geordneter Fachtext in der Ich-Form des Trainers (ich, nicht wir), ganze Sätze.',
    beamtendeutsch: 'Schreibstil „Amtlich“: sachlich und unpersönlich im Behördenstil („Es wurde …“, nie „ich“, nie „der Ausbilder“ oder „der Trainer“).'
  };
  const WB_TEAM_FELDER = 'fortschritte (was gut geklappt hat), defizite (Auffälligkeiten/Defizite, was noch hakt), foerderung (Fördermaßnahmen/nächste Schritte), ' +
    'bewertung (NUR wenn eine Schulnote gesagt wurde, ausgeschrieben und klein: sehr gut, gut, befriedigend, ausreichend, mangelhaft, ungenügend; sonst ""), ' +
    'hinweise (besondere Hinweise an das Team), bemerkungen (Wissenswertes wie Gesundheit, Organisatorisches)';
  const WB_T_SCHEMA = { type: 'object', additionalProperties: false, required: ['team', 'fortschritte', 'defizite', 'foerderung', 'bewertung', 'hinweise', 'bemerkungen'],
    properties: { team: { type: 'string' }, fortschritte: { type: 'string' }, defizite: { type: 'string' }, foerderung: { type: 'string' }, bewertung: { type: 'string' }, hinweise: { type: 'string' }, bemerkungen: { type: 'string' } } };
  // Eingesprochenen Wochenbericht (Schritt für Schritt: je Abschnitt bzw. Team eine Aufnahme) auf die Felder verteilen
  async function wochenDiktat(teile, opts) {
    const stil = stilVon(opts.stil);
    const system = 'Ein Diensthundetrainer hat seinen Wochenbericht Schritt für Schritt eingesprochen. Jede Aufnahme gehört zu einem Abschnitt (in der Überschrift genannt). ' +
      'Schreibe daraus die Felder des Wochenberichts.\n\n' + namensListe(opts.teams, opts.stoffe) +
      'Regeln (Schreibstil „' + stil.name + '“):\n' + stil.regeln.join('\n') + '\n' + GEMEINSAM + '\n' + GLOSSAR_REGELN.split('\n')[0] + '\n' +
      '- Abschnitte inhalte, ueberblick, gesamt, hinweise: der Text der jeweiligen Aufnahme.\n' +
      '- Team-Aufnahmen: verteile den Inhalt auf die Felder ' + WB_TEAM_FELDER + '. team genau wie in der Überschrift. Jeder Satz kommt in genau ein Feld, nichts doppelt.\n' +
      '- Aufnahme „Ganzer Bericht“: der Trainer spricht alles am Stück und sagt jeweils an, worum es geht (Abschnitt oder Team-Name, auch nur Teilnehmer- oder Hundename). Ordne jeden Satz dem angesagten Abschnitt bzw. Team zu.\n' +
      '- Ansagen für mehrere Teams umsetzen: Sagt der Trainer z. B. „übernimm das für alle anderen Teams“, „gilt für alle Teams“ oder „bei Sabine genauso wie bei Detlef“, ' +
      'dann trage die betreffenden Felder bei diesen Teams genauso ein (Namen von Teilnehmer und Hund passend ersetzen, Note mit übernehmen). Was danach für ein Team einzeln gesagt wird, ergänzt bzw. ersetzt das Übernommene bei diesem Team. Die Ansage selbst nicht in den Text schreiben.\n' +
      '- Erwähnt eine Aufnahme ausdrücklich etwas, das zu einem anderen Abschnitt oder Team gehört, ordne es dort ein.\n' +
      '- nicht_zugeordnet: Sätze, die in kein Feld passen. Sonst "". Felder ohne Inhalt bleiben "".\n' +
      '- Keine Überschriften, keine Aufzählungszeichen, keine Feldnamen im Text.\n\n' +
      'Glossar (Begriff, dahinter typische Fehlerkennungen der Spracherkennung):\n' + glossarListe(opts.glossar);
    const schema = { type: 'object', additionalProperties: false, required: ['inhalte', 'ueberblick', 'gesamt', 'hinweise', 'teams', 'nicht_zugeordnet'],
      properties: { inhalte: { type: 'string' }, ueberblick: { type: 'string' }, gesamt: { type: 'string' }, hinweise: { type: 'string' }, teams: { type: 'array', items: WB_T_SCHEMA }, nicht_zugeordnet: { type: 'string' } } };
    const user = teile.map(t => '## ' + t.titel + '\n' + t.text).join('\n\n');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || 'gpt-4.1-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: 'wochendiktat', strict: true, schema } } })
    });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    return JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
  }
  // Wochenbericht aus den Tagesprotokollen einer Woche vorschlagen (Trainer prüft und ändert danach)
  async function wochenbericht(woche, opts) {
    const system = 'Du schreibst für einen Diensthundetrainer den internen Wochenbericht eines Lehrgangs aus seinen Tagesprotokollen. ' +
      WB_STIL[stilVon(opts.stil).id] + ' Knapp, vollständige Sätze. ' +
      'Nur verwenden, was in den Protokollen steht, nichts erfinden, keine Namen von Trainern. Leere Felder ("") wenn es nichts dazu gibt.\n\n' +
      'Felder:\n- inhalte: Ausbildungsinhalte und Schwerpunkte der Woche (was wurde wo mit welchen Zielgerüchen geübt), 1–3 Sätze.\n' +
      '- ueberblick: Gesamtüberblick über die Gruppe in dieser Woche, 1–3 Sätze.\n' +
      '- gesamt: Gesamtbewertung der Ausbildungsgruppe, 1–2 Sätze.\n- hinweise: Hinweise, die an die Ausbildungsgruppe gegeben wurden (nur wenn in den Protokollen genannt).\n' +
      '- teams: für JEDES genannte Team ein Eintrag mit team (exakt der Name aus der Liste), fortschritte, defizite (Auffälligkeiten/Defizite, mit Wochentagen in Klammern wie „(Di, Mi)“), ' +
      'foerderung (Fördermaßnahmen/nächste Schritte), bewertung (eine Schulnote ausgeschrieben, die die Bewertungen der Woche zusammenfasst: sehr gut, gut, befriedigend, ausreichend, mangelhaft, ungenügend; "" wenn keine Bewertungen vorkommen), ' +
      'hinweise (besondere Hinweise, sonst "Keine besonderen Hinweise"), bemerkungen (Wissenswertes wie Gesundheit, sonst "").';
    const T = { type: 'object', additionalProperties: false, required: ['team', 'fortschritte', 'defizite', 'foerderung', 'bewertung', 'hinweise', 'bemerkungen'],
      properties: { team: { type: 'string' }, fortschritte: { type: 'string' }, defizite: { type: 'string' }, foerderung: { type: 'string' }, bewertung: { type: 'string' }, hinweise: { type: 'string' }, bemerkungen: { type: 'string' } } };
    const schema = { type: 'object', additionalProperties: false, required: ['inhalte', 'ueberblick', 'gesamt', 'hinweise', 'teams'],
      properties: { inhalte: { type: 'string' }, ueberblick: { type: 'string' }, gesamt: { type: 'string' }, hinweise: { type: 'string' }, teams: { type: 'array', items: T } } };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || 'gpt-4.1-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: woche }],
        response_format: { type: 'json_schema', json_schema: { name: 'wochenbericht', strict: true, schema } } })
    });
    if (!res.ok) throw await oaiError(res);
    const j = await res.json();
    return JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
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

  global.BaumprojektServices = { glossarHinweis, sttHinweis, splitPunkte, alsStichpunkte, pick, transcribe, assign, formulate, aufteilen, wochenbericht, wochenDiktat, STILE, Drive, KV, Outbox, KATEGORIEN, XLSX_MIME };
})(window);
