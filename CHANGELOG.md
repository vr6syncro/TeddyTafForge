# Changelog

## v0.2.2

- GitHub-Automation aktualisiert: aktuelle Action-Majors, breitere Branch-Coverage fuer CI/Docker, `concurrency` und Timeouts.
- Trivy/CVE-Scanning auf aktuellen Stand gezogen und Release-/Branch-Builds weiter gehaertet.
- Docker-Basis auf Node 24 und Python 3.13 angehoben; Frontend-Toolchain auf aktuelle stabile TafForge-Staende aktualisiert.
- TeddyCloud-Plugin-Installation in `entrypoint.sh` gegen das erwartete Plugin-Schema geprueft und robuster gemacht.
- Frontend-Build weiter optimiert: Vendor-Chunk-Splitting beseitigt den frueheren Vite-Warnhinweis.
- URL-Import im Builder vereinfacht: kompakter kombinierter Vorbereitungs-Flow mit kleiner 0-100%-Fortschrittsanzeige.

## v0.2.1

- Vollstaendige DE/EN-System-UI mit persistenter Sprachumschaltung im Frontend.
- Persistenter Light-/Dark-Mode fuer die gesamte Oberflaeche.
- Neutrale, nicht markenbezogene Placeholder fuer Titel/Serie/Episode und serverseitiges Bereinigen alter `demo`-Metadaten.
- Docker-Workflow erweitert, damit auch `feat/**`-Branches testbare Images bauen.

## v0.2.0

- Encoder grundlegend auf einen TonieToolbox-nahen Buildpfad umgestellt: FFmpeg/libopus pro Kapitel plus OGG-Repacking mit 4K-Ausrichtung.
- Problematische TAFs mit YouTube-/Kapitel-Workflows laufen damit auf echter Toniebox wieder stabil.
- Neue TAF-Diagnose-Route und Bibliothekslink fuer schnelle Strukturpruefungen.
- Build- und Metadatenpfad weiter gehaertet, inklusive eindeutiger `audio_id`-Nutzung.
- GitHub-Automation fuer CI, Dependabot und Sicherheits-Scanning vorbereitet.

## v0.1.0

- Erster veroeffentlichter Stand von TafForge.
