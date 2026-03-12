# TafForge

Custom Tonie TAF Builder als Docker-Container neben TeddyCloud.

Audio-Dateien konvertieren, Kapitel verwalten, Metadaten anlegen, Cover-Bilder zuweisen und Labels/Coins als PDF erstellen - alles in einer Web-Oberflaeche.

> **Aktueller Release-Stand:** `v0.2.1` bringt die vollstaendige DE/EN-System-UI, Light-/Dark-Mode sowie neutrale Placeholder auf den bereits stabilisierten TonieToolbox-nahen Encoderpfad.
>
> **Hinweis:** Dieses Projekt befindet sich weiter in aktiver Entwicklung. Bug-Reports und Feedback sind willkommen unter [GitHub Issues](https://github.com/vr6syncro/TeddyTafForge/issues).

## Release v0.2.1

- Vollstaendige DE/EN-System-UI fuer Builder, Bibliothek, Editoren und Hilfsdialoge
- Persistenter Sprachumschalter und Light-/Dark-Mode im Frontend
- Neutrale Placeholder statt markenbezogener Beispieltexte und serverseitiges Bereinigen alter `demo`-Metadaten
- Docker-Workflow baut jetzt auch `feat/**`-Branches fuer Test-Images

## Release v0.2.0

- Neuer Toolbox-naher Encoderpfad: FFmpeg/libopus pro Kapitel, anschliessend OGG-Repacking mit 4K-Ausrichtung
- Reale Toniebox-Probleme mit bestimmten Kapitel-/YouTube-TAFs beseitigt
- Diagnose-Endpoint fuer TAF-Struktur, CRCs, Kapitel-Offsets und OGG-Pages
- Release-Automation ergaenzt: Dependabot, CI sowie Sicherheits-/CVE-Scanning

## Features

- **TAF-Erstellung**: Audio-Dateien (MP3, FLAC, WAV, OGG, M4A, ...) in das Toniebox TAF-Format konvertieren
- **Neuer Encoder-Kern**: TonieToolbox-naher Buildpfad fuer robustere OGG-/Opus-Struktur auf echter Toniebox
- **Online-Import via yt-dlp**: Optionaler Download von YouTube und weiteren unterstuetzten Seiten (mit Rechtshinweis), inkl. Single-Track, Auto-Kapitel, Multi-Link
- **Kapitel-System**: Einzelne Dateien pro Kapitel oder eine Datei mit Timestamps (Splitter-Modus)
- **Metadaten**: Automatische Registrierung als Custom Tonie in TeddyCloud (`tonies.custom.json`)
- **Cover-Bilder**: Kreis-Crop-Editor mit Drag & Zoom (PNG/JPG/SVG, Export als 1024x1024 PNG)
- **Label-Generator**: Runde Coins oder eckige Labels als druckfertiges PDF
- **Forge-Status**: CLI-aehnliche Statusausgabe beim Build, optionaler Error-Log-Download, Reset mit Temp-Cleanup
- **Bibliothek**: Uebersicht aller erstellten Tonies mit Edit, Delete, ZIP-Export
- **Import/Backup**: Separater Tab fuer ZIP/TAF-Import und Multi-Projekt-Backup/Restore mit optionaler AES-256 Verschluesselung
- **Custom Tonies Editor**: `tonies.custom.json` direkt im Browser bearbeiten
- **ZIP-Export**: Fertigen Tonie als ZIP-Paket herunterladen
- **TeddyCloud-Plugin**: Direkter Link aus dem TeddyCloud-Menue
- **GitHub-Automation**: Dependabot, CI-Builds und Trivy-/Dependency-Review-Scans fuer Release-Hygiene

## Schnellstart

### docker-compose.yml

```yaml
services:
  teddycloud:
    image: ghcr.io/toniebox-reverse-engineering/teddycloud:latest
    container_name: teddycloud
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - teddycloud_config:/teddycloud/config
      - teddycloud_library:/teddycloud/library
      - teddycloud_content:/teddycloud/data/content
      - teddycloud_certs:/teddycloud/certs
      - teddycloud_plugins:/teddycloud/data/www/plugins
    restart: unless-stopped

  tafforge:
    image: ghcr.io/vr6syncro/teddytafforge:latest
    container_name: tafforge
    ports:
      - "3000:3000"
    volumes:
      - teddycloud_config:/teddycloud/config
      - teddycloud_library:/teddycloud/library
      - teddycloud_content:/teddycloud/data/content
      - teddycloud_plugins:/teddycloud/data/www/plugins
    environment:
      - TEDDYCLOUD_URL=http://teddycloud:80
      - TAFFORGE_PORT=3000
    depends_on:
      - teddycloud
    restart: unless-stopped

volumes:
  teddycloud_config:
  teddycloud_library:
  teddycloud_content:
  teddycloud_certs:
  teddycloud_plugins:
```

```bash
docker compose up -d
```

TafForge ist danach unter `http://<server-ip>:3000` erreichbar.

## Umgebungsvariablen

| Variable | Pflicht | Standard | Beschreibung |
|---|---|---|---|
| `TEDDYCLOUD_URL` | Ja | `http://teddycloud:80` | Interne URL zu TeddyCloud (Docker-Netzwerk) |
| `TAFFORGE_PORT` | Nein | `3000` | Port auf dem TafForge laeuft |
| `TAFFORGE_URL` | Nein | - | Volle externe URL (z.B. `https://tafforge.meinserver.de`). Ueberschreibt die automatische Port-Erkennung im Plugin |
| `DEBUG` | Nein | `false` | Aktiviert Debug-Logging und erweiterte Fehlerdetails bei yt-dlp |
| `LIBRARY_PATH` | Nein | `/teddycloud/library` | Pfad zur TeddyCloud-Bibliothek im Container |
| `CONTENT_PATH` | Nein | `/teddycloud/data/content` | Pfad zum TeddyCloud-Content-Verzeichnis |
| `CONFIG_PATH` | Nein | `/teddycloud/config` | Pfad zur TeddyCloud-Konfiguration |
| `ALLOW_NON_YOUTUBE_SOURCES` | Nein | `true` | Erlaubt neben YouTube auch weitere durch yt-dlp unterstuetzte Seiten |
| `YTDLP_ALLOWED_DOMAINS` | Nein | - | Komma-Liste erlaubter Domains, z.B. `youtube.com,youtu.be,soundcloud.com` |
| `YTDLP_ENABLE_YOUTUBE_CLIENT_FALLBACK` | Nein | `true` | YouTube-Client-Fallbacks (`android`, `web_safari`, `tv`, `ios/web`) |
| `YTDLP_OPTIONS` | Nein | - | JSON fuer zusaetzliche yt-dlp Optionen |

## Shared Volumes

TafForge benoetigt Zugriff auf dieselben Docker-Volumes wie TeddyCloud:

| Volume | Zweck |
|---|---|
| `teddycloud_config` | Zugriff auf `tonies.custom.json` (Metadaten lesen/schreiben) |
| `teddycloud_library` | TAF-Dateien werden hier abgelegt (`library/custom_taf/`) |
| `teddycloud_content` | Cover-Bilder fuer Custom Tonies |
| `teddycloud_plugins` | Plugin-Verzeichnis - automatische Installation beim Container-Start |

## TeddyCloud Plugin

TafForge installiert sich beim Start automatisch als Plugin in TeddyCloud. Dafuer wird `/teddycloud/data/www/plugins` als gemeinsames Volume benoetigt.

### Wie es funktioniert

1. Beim Container-Start kopiert `entrypoint.sh` die Plugin-Dateien nach `/teddycloud/data/www/plugins/teddytafforge/`
2. TeddyCloud erkennt das Plugin und zeigt es im Menue unter "Tonies" an
3. Ein Klick auf "TafForge oeffnen" oeffnet die App in einem neuen Tab

### Plugin-URL Konfiguration

**Standard (gleicher Host, anderer Port):**
```yaml
environment:
  - TAFFORGE_PORT=3000
```
Das Plugin baut die URL automatisch: `http://<teddycloud-hostname>:3000`

**Hinter einem Reverse Proxy:**
```yaml
environment:
  - TAFFORGE_URL=https://tafforge.meinserver.de
```

### Plugin manuell installieren

Falls kein gemeinsames Plugin-Volume genutzt wird:

```bash
docker cp tafforge:/app/plugin/. teddycloud:/teddycloud/data/www/plugins/teddytafforge/
docker exec teddycloud sed -i 's|__TAFFORGE_PORT__|3000|g' /teddycloud/data/www/plugins/teddytafforge/index.html
```

## Verwendung

### 1. Metadaten

- **Titel** (Pflicht): Name des Custom Tonies (Sonderzeichen werden automatisch entfernt)
- **Serie** (Optional): z.B. "Bibi Blocksberg"
- **Cover-Bild** (Optional): PNG/JPG/SVG, wird im Kreis-Editor zugeschnitten

### 2. Audio-Quelle

**Einzelne Dateien pro Kapitel:**
Jedes Kapitel bekommt eine eigene Audio-Datei. Unterstuetzte Formate: MP3, WAV, FLAC, OGG, M4A, AAC, WMA, Opus.

**Eine Datei + Timestamps (Splitter):**
Eine grosse Audio-Datei hochladen und Kapitel per Start-/End-Timestamp definieren (Format: `HH:MM:SS` oder `MM:SS`).

**Online-Quelle via yt-dlp (optional):**
- URL-Download aktivieren (einmaliger Rechtshinweis)
- Modi:
  - Ein Link = ein Kapitel (optional Start/Ende schneiden + Vorschau)
  - Ein Link + manuelle Kapitel-Timestamps
  - Ein Link + automatische Kapitel (falls vorhanden)
  - Mehrere Links (je Link ein Kapitel)
- Audio wird direkt ins Projekt geladen und dann in TAF konvertiert

### 3. Einstellungen

- **Bitrate**: Automatisch nach Kategorie (96/128 kbps)
- **Custom Tonie registrieren**: Traegt den Tonie automatisch in `tonies.custom.json` ein

### 4. Label/Coin PDF

Optional ein druckfertiges PDF:
- **Form**: Rund (Coin) oder eckig (Label)
- **Groesse**: 20-80 mm
- **Text**: Zwei Zeilen, automatisch aus Titel/Serie

### 5. Build starten

Klick auf "Forge TAF" startet den Build-Prozess:
1. Audio-Dateien werden hochgeladen
2. Audio wird in Opus/OGG konvertiert (48 kHz, Stereo)
3. TAF-Datei wird mit neuem FFmpeg/libopus-Encode plus Toolbox-nahem OGG-Repacking erstellt
4. Metadaten werden in TeddyCloud registriert
5. Optional: Label-PDF wird generiert

### 6. Bibliothek

- **Bibliothek-Tab**: Projekte anzeigen, bearbeiten, als ZIP exportieren oder loeschen
- **Backup-Export**: Mehrere Projekte als ZIP, optional AES-256 verschluesselt
- **Import/Backup-Tab**: Backup-ZIP, einzelne ZIP oder TAF-Dateien importieren

## FAQ / Troubleshooting

### Build bricht bei ca. 75% ab oder die Box blinkt rot

Typische Meldungen: `Unexpected padding at granule`, `Not enough space in block`, `'B' format requires 0 <= number <= 255`

Die bekannte Klasse problematischer Kapitel-/YouTube-TAFs ist seit `v0.2.0` durch den neuen Encoderpfad adressiert. Falls es trotzdem auftritt:
1. Container auf neuesten Stand bringen
2. Build erneut starten
3. Forge-Log exportieren und als Issue melden

### URL-Download liefert Fehler

- Video privat, geo-blockiert, altersbeschraenkt oder temporar nicht abrufbar
- Rate-Limit oder Anti-Bot-Schutz der Plattform
- `DEBUG=true` setzen fuer erweiterte Fehlerdetails
- Optional `YTDLP_OPTIONS` oder `YTDLP_ALLOWED_DOMAINS` anpassen
- Bei Bedarf auf `autoupdate` Docker-Tag wechseln

### Backup-Import: Passwort falsch

Beim Export gesetztes Passwort muss beim Import identisch angegeben werden. Die ZIP-Datei ist mit AES-256 verschluesselt und kann auch mit 7-Zip oder WinRAR geoeffnet werden.

### Speicherplatz

Temporaere Quell-Audios werden nach dem Build automatisch bereinigt. Mit "Neu" im Builder wird zusaetzlich Temp-State aufgeraeumt.

## Selber bauen

```bash
git clone https://github.com/vr6syncro/TeddyTafForge.git
cd TeddyTafForge
docker build -t tafforge .
```

Fuer lokale Nicht-Docker-Checks im Repo:

```bash
cd frontend && npm ci && npm run build
python -m compileall backend
```

## Technologie

- **Frontend**: React 19, TypeScript, Vite, Ant Design (Dark Theme)
- **Backend**: Python 3.13, FastAPI, uvicorn
- **Audio**: FFmpeg + libopus
- **TAF**: Toolbox-naher Encoderpfad mit Protobuf-Header und OGG-Repacking (4K-Block-Alignment)
- **Label**: reportlab (PDF-Generierung)
- **Container**: Multi-Stage Docker Build (Node 24 Alpine + Python 3.13 slim)

## GitHub Automation

- **CI**: Frontend-Build und Backend-Compile-Checks auf `main`, `fix/**`, `upgrade/**`, `feat/**` und `test/**`
- **Dependabot**: Updates fuer GitHub Actions, Docker, Python und Frontend-NPM
- **Security**: Trivy-Scan (Vulns, Secrets, Config) plus GitHub Dependency Review auf PRs

## Docker Tags

| Tag | Wann wird gebaut? | Fuer wen? |
|---|---|---|
| `latest` | Bei jeder Code-Aenderung auf `main` | Empfohlen fuer die meisten Nutzer. Enthaelt immer den neuesten Code und die aktuellste yt-dlp Version. |
| `<semver>` | Bei Git-Tags wie `v0.2.1` | Reproduzierbare Release-Staende, z.B. `ghcr.io/vr6syncro/teddytafforge:0.2.1` |
| `autoupdate` | Taeglich automatisch, sobald eine neue yt-dlp Version erscheint | Ideal wenn du keine Code-Updates brauchst, aber yt-dlp immer aktuell haben willst (z.B. bei YouTube-Aenderungen). |
| `autoupdate-ytdlp-<version>` | Einmalig pro yt-dlp Release | Zum Pinnen auf eine bestimmte yt-dlp Version, z.B. `autoupdate-ytdlp-2025.01.15`. |

**Welchen Tag soll ich nehmen?**

- **`latest`** ist die beste Wahl fuer die meisten Nutzer. Du bekommst alle neuen Features, Bugfixes und die aktuellste yt-dlp Version.
- **`0.2.1`** ist der aktuelle feste Release-Tag mit UI-Sprachumschaltung, Theme-Switch und neutralen Placeholdern.
- **`autoupdate`** ist sinnvoll, wenn du TafForge produktiv nutzt und nicht bei jedem Code-Update wechseln willst, aber trotzdem moechtest, dass YouTube-Downloads funktionieren, wenn YouTube seine Schnittstellen aendert.

```yaml
# Standard (empfohlen)
image: ghcr.io/vr6syncro/teddytafforge:latest

# Fester Release-Stand
image: ghcr.io/vr6syncro/teddytafforge:0.2.1

# Automatisches yt-dlp Update ohne Code-Aenderungen
image: ghcr.io/vr6syncro/teddytafforge:autoupdate
```

## Lizenz

MIT
