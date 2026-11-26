# Baumprojekt – Prototyp Lehrgangsnotizen

## Was die App macht
1. Trainer wählt den Tag (Standard: heute, jeder Tag des Lehrgangs ist wählbar, auch nachträglich).
2. Roter Knopf: frei sprechen, z. B. „Kira war heute super beim Rückruf. Bei Anna und Balu …“.
3. OpenAI erkennt die Sprache und teilt den Text auf die Teams auf (mit Kategorie, z. B. Rückruf, Hausaufgabe).
4. Vorschau: Team, Kategorie und Text lassen sich korrigieren, Abschnitte löschen oder ergänzen. Nicht erkannte Abschnitte sind gelb markiert und müssen einem Team zugeordnet werden.
5. Speichern: Die Notizen landen in der Excel-Datei des Lehrgangs in Google Drive.

Weitere Ansichten: **Tag** zeigt pro Tag alle Teams mit ihren Notizen. **Lehrgang** legt Lehrgänge an (Name, Trainer, Ort, erster Tag, 4 oder 10 Wochen, Teams) und lädt die Excel-Datei herunter.

Wenn etwas schiefgeht (kein Netz, Google abgemeldet), bleiben Aufnahme und Vorschau auf dem Handy gespeichert und können später erneut verarbeitet bzw. gespeichert werden.

## Ablage in Google Drive
```
Baumprojekt Lehrgänge/
  <Lehrgangsname>/
    Lehrgang <Name>.xlsx
    Aufnahmen/     <Datum> <Uhrzeit> (xxxx) Aufnahme.webm|m4a  +  … Rohtext.txt
    Sicherungen/   Lehrgang <Name> – Sicherung <Zeitstempel>.xlsx
```
- Jede Aufnahme wird direkt nach dem Beenden in einer Warteschlange auf dem Gerät (IndexedDB) abgelegt und von dort nach Drive hochgeladen, noch vor der KI-Verarbeitung. Ohne Netz bleibt sie auf dem Gerät und wird beim nächsten Online-Sein, beim Öffnen der App oder alle 2 Minuten nachgeladen. Der Rohtext der Spracherkennung folgt genauso.
- Vor jedem Überschreiben der Excel wird der bisherige Stand nach `Sicherungen` kopiert. Schlägt das fehl, wird nicht gespeichert. Die letzten 14 Tage bleiben alle Sicherungen, ältere eine pro Tag (Rest in den Drive-Papierkorb).
- Aufnahmen sind in der App unter **Tag** (pro Tag) und **Lehrgang** (alle) abspielbar, mit Rohtext.
- Lehrgänge aus dem alten Aufbau (Excel direkt in „Baumprojekt Lehrgänge“) werden nach der Anmeldung automatisch in einen eigenen Ordner verschoben.
- Zuordnung über `appProperties` (`baumprojekt=1` für die Lehrgangsdatei, `bpTyp`/`kurs`/`aid` für Aufnahmen und Sicherungen), daher unabhängig von Ordner- und Dateinamen.

## Excel-Datei (eine pro Lehrgang)
Aufbau wie die erste Vorlage:
- **Übersicht**: Zeilen = Teams, Spalten = jeder Kalendertag des Lehrgangs (4 Wochen = 28, 10 Wochen = 70 Spalten), danach „Gesamteindruck“. Erste Spalte und Kopfzeile sind fixiert.
- **Notizen (Rohdaten)**: eine Zeile je Notiz (Datum, Lehrgangstag, Uhrzeit, Team, Kategorie, Notiz, Quelle), mit Filter.
- **Teams**: Teilnehmer/in, Hund, Rasse/Alter, Bemerkung.
- Ein verstecktes Blatt `_baumprojekt` mit Startdatum und Dauer.

Wichtig: Die Übersicht wird bei jedem Speichern aus den Rohdaten neu aufgebaut. Änderungen am PC daher im Blatt **Notizen (Rohdaten)** machen (Text ändern, Zeile löschen, Zeile ergänzen). Die Spalte **Gesamteindruck** in der Übersicht darf direkt beschrieben werden, sie bleibt erhalten. Die Datei nicht gleichzeitig am PC offen haben und am Handy speichern.

Am Windows-PC: Mit „Google Drive für Desktop“ erscheint Drive als Laufwerk (z. B. `G:\Meine Ablage\Baumprojekt Lehrgänge`), dort die Datei direkt mit Excel öffnen.

## Datenschutz
- Kein eigener Server. Die App ist eine statische Webseite; alles läuft im Browser des Handys.
- Google-Zugriff mit dem Recht `drive.file`: Die App sieht nur Dateien, die sie selbst angelegt hat (Ordner „Baumprojekt Lehrgänge“), nicht den Rest des Drives.
- Der OpenAI-Schlüssel liegt auf dem Gerät und im eigenen Google Drive des Nutzers und wird direkt an OpenAI geschickt. Audio und Text gehen nur an OpenAI (zur Erkennung) und ins eigene Google Drive.
- Der Herausgeber der App (Hendrik) hat keinen Zugriff auf Notizen, Dateien oder Schlüssel.

## Zugang (Whitelist)
Die App ist nur nach Google-Anmeldung nutzbar. Solange die Google-App im Status *Test* ist, können sich nur die Konten anmelden, die in der Google Cloud Console unter „OAuth-Zustimmungsbildschirm → Testnutzer“ eingetragen sind (max. 100). Alle anderen bekommen „Zugriff blockiert“. Neue Nutzer freischalten = dort ihre Gmail-Adresse hinzufügen. Bitte die App NICHT veröffentlichen, sonst kann sich jeder anmelden.

Nach dem Abmelden, auf einem neuen Handy oder nach gelöschten Browserdaten: wieder anmelden, die Lehrgänge kommen aus Google Drive zurück. Der OpenAI-Schlüssel wird als Datei „Baumprojekt-Einstellungen (nicht löschen).json“ im eigenen Drive-Ordner gespeichert und nach der Anmeldung automatisch geladen.

## Veröffentlichen (einmalig, durch Hendrik)
1. **Hosting**: Den Ordner `app/` in ein GitHub-Repository legen und GitHub Pages aktivieren (Settings → Pages → Branch `main`, Ordner `/`). Ergebnis z. B. `https://<name>.github.io/baumprojekt/`.
2. **Google-Client-ID** (kostenlos, gibt keinen Datenzugriff):
   - https://console.cloud.google.com → neues Projekt „Baumprojekt“.
   - „APIs & Dienste → Bibliothek“: **Google Drive API** aktivieren.
   - „OAuth-Zustimmungsbildschirm“: Typ *Extern*, App-Name „Baumprojekt“, Bereich `.../auth/drive.file` hinzufügen. Die App im Status *Test* lassen und die Google-Konten der Nutzer als Testnutzer eintragen (das ist die Whitelist).
   - „Anmeldedaten → OAuth-Client-ID → Webanwendung“, bei „Autorisierte JavaScript-Quellen“ die Pages-Adresse eintragen (nur `https://<name>.github.io`).
   - Client-ID in `config.js` bei `googleClientId` eintragen (ist erledigt).
3. Fertig. Link weitergeben.

## Einrichtung für jeden Nutzer
1. Link im Handy-Browser öffnen, „Zum Startbildschirm hinzufügen“.
2. „Mit Google anmelden“, dann unter **Einstellungen** den OpenAI-Schlüssel eintragen (platform.openai.com → API keys).
3. **Lehrgang → Neuer Lehrgang** anlegen.

Die Google-Anmeldung gilt jeweils ca. 1 Stunde; danach fragt die App mit einem Knopf „Mit Google verbinden“ nach (ein Tipp, meist ohne erneute Passworteingabe).

## Kosten (OpenAI, grob)
Spracherkennung `gpt-4o-transcribe` ca. 0,6 Cent pro Minute, Zuordnung `gpt-4.1-mini` deutlich unter 1 Cent pro Notiz. 10 Minuten am Tag ≈ 2 € im Monat. Modelle sind in den Einstellungen änderbar (z. B. `whisper-1`, `gpt-4o-mini-transcribe`).

## Grenzen des Prototyps
- Einzelne Aufnahmen bis ca. 20 Minuten (Grenze der Spracherkennung).
- Notizen löschen/ändern nach dem Speichern nur in Excel (Blatt Rohdaten).
- Noch nicht auf einem echten iPhone/Android mit echtem Google-Konto getestet.
