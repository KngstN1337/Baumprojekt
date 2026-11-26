# LTR – Stilregeln

Die App sieht aus wie eine iOS-App: ruhig, hell/dunkel automatisch, wenige Farben. **Jede neue Funktion verwendet nur die Bausteine aus `css/design.css`.** Seitenspezifisches (z. B. Tageleiste, Aufnahme-Fenster) steht in `css/style.css`. Keine Emojis als Icons, keine eigenen Farben, keine Schatten- oder Rahmen-Experimente.

## Farben (CSS-Variablen, hell und dunkel)
| Variable | Wofür |
|---|---|
| `--bg` | Seitenhintergrund (grau, im Dunkeln schwarz) |
| `--card` | Hintergrund von Listen und Karten |
| `--label` | normaler Text |
| `--sec` | Nebentext, Untertitel, Abschnittsüberschriften |
| `--ter` | sehr leise Elemente (Pfeile) |
| `--sep` | Trennlinien |
| `--fill` | graue Flächen (runde Knöpfe, Eingabefelder, Segmente) |
| `--tint` | Akzentfarbe für Links, Text-Knöpfe, aktive Tabs |
| `--fill-tint` | Akzentfarbe als Fläche mit weißer Schrift (Hauptknopf, gewählter Tag) |
| `--red` / `--green` / `--orange` | Aufnahme / erledigt / Warnung |

Nie feste Farbwerte (#…) im Code verwenden, nur diese Variablen. Dann stimmt der Dunkelmodus von selbst.

## Schrift
Systemschrift (auf dem iPhone SF Pro). Größen: Großer Titel 34 px fett · Text 17 px · Untertitel 15 px · Abschnittsüberschrift 13 px in Großbuchstaben · Kleintext 13 px. Keine weiteren Größen erfinden.

## Seitenaufbau
```html
<section id="v-xyz" class="view hidden">
  <div class="title-row"><h1 class="large-title">Titel</h1><button class="nav-icon" aria-label="Neu"><svg><use href="#i-plus"/></svg></button></div>
  <label class="subtitle picker"><b>Gewählter Wert</b><svg><use href="#i-updown"/></svg><span class="rest"> · Zusatz</span><select>…</select></label>
  <div class="section-h">Abschnitt</div>
  <div class="group">
    <div class="cell"><div class="cell-tx"><b>Zeile</b><span>Unterzeile</span></div></div>
    <button class="cell link-cell">Aktion als Link</button>
  </div>
</section>
```
- **Oben nichts Wichtiges direkt unter die Statusleiste setzen.** iOS legt dort einen Unschärfe-Verlauf über die Seite. `main` hat deshalb oben extra Abstand; Aktionen gehören in die `title-row` neben den großen Titel, nicht in eine eigene Leiste darüber.
- Unterseiten (z. B. Team) haben eine `.navbar`: links `nav-btn back` (Zurück mit `#i-back`), rechts höchstens ein kurzes Wort als `nav-btn`.
- Abstände kommen aus den Klassen (16 px Seitenrand, 28 px zwischen Gruppen). Keine eigenen `margin`/`padding` an Bausteinen.

## Bausteine
| Klasse | Verwendung |
|---|---|
| `.group` + `.cell` | Gruppierte Liste (iOS-Tabelle). Trennlinien entstehen automatisch. `.cell-tx` für Titel/Unterzeile, `.cell-st` für Status rechts, `.chev` als Pfeil, `.link-cell` für Aktionen. `.cell-tx.wrap` erlaubt Zeilenumbruch. |
| `.picker` | Zelle mit Auswahlmenü: `<label class="cell picker"><div class="cell-tx"><b>Gewählter Wert</b></div><span class="val">Wechseln<svg><use href="#i-updown"/></svg></span><select>…</select></label>`. Für alle Auswahllisten, die lang werden können (statt Radio-Listen). |
| `.danger-cell` | Zerstörende Aktion als Zeile (rot, eigene Gruppe ganz unten). Immer mit Sicherheitsabfrage, die sagt, was passiert und ob es wiederherstellbar ist. |
| `.swipe` | Wischzeile wie in iOS-Listen: Antippen öffnet, nach links wischen zeigt Aktionen. Aufbau `<div class="swipe" data-ni="…"><div class="swipe-acts"><button class="swipe-act" data-act="edit">…</button><button class="swipe-act del" data-act="del">…</button></div><div class="swipe-row">Inhalt</div></div>`, verdrahtet mit `initSwipe(liste, beiAntippen, beiAktion)` in app.js. Löschen (`.del`, rot) immer ganz rechts und mit Sicherheitsabfrage. |
| `.avatar` | Runder Kreis mit Initialen; `.big` für Kopfbereich. |
| `.btn-filled` | Hauptaktion (eine pro Ansicht). `.btn-gray` für die zweite Aktion daneben. In `.actions` nebeneinander. |
| `.text-btn` | Kleiner Text-Knopf in Akzentfarbe. |
| `.nav-icon` / `.round` / `.play` | Runde Icon-Knöpfe (Navigationsleiste / groß / klein). |
| `.segmented` | Umschalter mit 2–4 Optionen (Buttons mit `.on` oder Radio-Labels). |
| `.switch` | Ein/Aus-Schalter (`<input type="checkbox" class="switch">`). |
| `.form .field` | Formularzeile in einer `.group`: Beschriftung links, Eingabe rechts. |
| `.card` | Freier Text (Hilfe, Erklärungen). `details.card` zum Aufklappen. |
| `.tag` | Kleines Schlagwort (z. B. „am PC“). |
| `.empty` | Hinweis, wenn eine Liste leer ist. |
| `.sheet` + `.dim` | Fenster von unten (wie Aufnahme). Öffnen über `body.sheet-open`. |
| `.banner`, `toast()`, `busy()` | Hinweise oben, kurze Meldung unten, Warte-Anzeige. |
| `.tabs` | Tab-Leiste unten. Höchstens 5 Einträge. |

Unterseiten bekommen oben links einen Zurück-Knopf `.nav-btn.back` in der `.navbar`. Dann funktioniert automatisch auch das Zurückwischen vom linken Bildschirmrand (`initEdgeBack` in app.js). Hauptseiten der Tabs haben keinen.

## Icons
Alle Icons sind SVG-Symbole am Ende von `index.html` (`<symbol id="i-…">`) und werden mit `<svg><use href="#i-name"/></svg>` eingebunden. Sie übernehmen die Textfarbe. Neue Icons im gleichen Stil (gefüllt, 24×24) dort ergänzen.

## Texte
Deutsch, kurz, in der Du-Form. Knöpfe mit Verb („Speichern“, „Weiter aufnehmen“). App-Name immer „LTR“ (Loben, Toben, Raus), nie „Baumprojekt“ oder „Baumi“. Der Name des Entwicklers steht nirgends in der App.
