# Gesamtstatus und Übergabe zur kontrollierten Abnahme

Stand: 2026-09-05. Der [Arbeitsblock mit 20 Teilaufgaben](WORK_BATCH_20.md) ist
vollständig implementiert, lokal geprüft und einzeln auf GitHub `main` gesichert.
Das Gesamtziel eines unbeaufsichtigten Gästeablaufs ist **noch nicht erreicht**.
Insbesondere existiert der gbrain-Zielschreiber noch nicht; der lokale Consumer
ist keine aktivierte Synchronisierung. HOA-Quellen werden weiterhin ausdrücklich
geprüft, nicht allein durch eine KI-Klassifizierung bestätigt.

## Wiederholbare technische Prüfung

`npm run verify` in `portal/` führt die vollständige lokale Prüfkette aus und
stoppt beim ersten Fehler. Verifiziert: 286 JavaScript- und 34 Python-Tests,
Syntaxprüfung, workerd/SQLite-Integration, zwei Neustarts, Wiederherstellung einer
kalten Sicherung in getrenntem temporärem Speicher, Pages-Build und Dry-run-Builds
für Cron und Fallspeicher. `npm audit --json`: null gemeldete Schwachstellen bei
96 Abhängigkeiten. Das ist keine vollständige Sicherheitsprüfung.

Die Tests verwenden synthetische Daten. Sie bestätigen weder eine tatsächliche
Mailzustellung noch die Akzeptanz der Unterlagen durch die HOA. Die Sicherung
ist kein Offsite-Backup; ordentliches Beenden ist kein physischer Stromausfall.

## Die sechs Hauptpakete

| Hauptpaket | Lokal belegt | Noch zu erledigen / nächste belastbare Abnahme |
|---|---|---|
| Tenant Evaluation / HOA | Getrennte Belege für Antrag, Zahlung, Dokumente und Zustimmung; Teil-Nachforderungen, Gastmeldung, Wiedereröffnung, Sperren; zusammenhängender synthetischer Ablauf | Tatsächliche Rückmeldungen und Absender nachweisen; sichere Zuordnung an Originalmails prüfen; echte Antrags-/Vertragsabdeckung feststellen. Keine pauschale automatische positive Entscheidung einführen. |
| Erinnerungen / Airbnb | Konkrete fehlende Aufgaben; Parallelität, Abmeldung, verspätete Antworten, Stornierung, Timeout; geprüfter Airbnb-Relay-Fallback und Zustellhinweise | Den tatsächlichen Antwortweg einschließlich Ankunft im Airbnb-Chat kontrolliert testen. Automatische Erstzuordnung ist noch nicht implementiert; der vorhandene Weg benötigt Eigentümerprüfung. Aktivierung nach dokumentiertem Test. |
| Buchungsabgleich | Synthetische Bestätigungen, Änderungen und Stornierungen; mehrdeutige Codes, explizite Jahre, Versionswechsel und überholte Versandbelege | Reale Airbnb-Formate gegen den Parser abgleichen; bestehende unvollständige Gastnamen anhand ihrer Quelle berichtigen, nicht erraten. Bereits dokumentierte Sieben-Tage-Einstellung nicht erneut verändern. |
| Dokumente / Zahlung | Paketgrenzen, immutable verschlüsselte Archive, Versandnachweis, unsicherer Ausgang, Schutz vor Doppelzahlung/-versand | Reale Vorlagen mit ausschließlich synthetischen Personen und Testsignaturen visuell prüfen; Empfänger und Zustellung separat abnehmen. Sicheren Ausweisweg, Tenant-Evaluation-Dokumentenumfang und tatsächlich zulässige Zahlungsanleitung belegen. |
| Betrieb / Veröffentlichung | Atomare Fallspeicherung, isolierte Runtime, Neustart- und lokale Backup-Restore-Tests; technische Fehler werden sichtbar | Bestehendes Zielsystem und genaue Bindings bestätigen, kontrollierten Cutover vorbereiten, unabhängigen Alarmweg samt Probealarm abnehmen, echte externe Sicherung/Wiederherstellung und Host-Wiederanlauf vor Login prüfen; Rollback und Freigaben protokollieren. |
| gbrain / Hermes | Direkter MCP-Identitätscheck; Export-Allowlist, revisionsbasierter Consumer, Inhaltsprüfung, Grenzen, Ablauf-/Löschstände | Vollständigen Test der separaten OAuth-Identität nachholen. Zielseitige atomare Versionskontrolle, unabhängige Ablaufbereinigung sowie Entfernung aus Suche/Chunks/Versionen verifizieren und erst darauf den Zielschreiber aufbauen. Live-Import bleibt aus. |

## Konkrete Grenzen dieses Arbeitsbereichs

- Das Studio enthält absichtlich keine echten HOA-PDF-Vorlagen und verwendet
  Platzhalter für Namen, Adressen, Empfänger und Speicherkennungen. Es darf nicht
  unverändert als Produktivkonfiguration veröffentlicht werden.
- Vorbestehende lokale Oberflächenänderungen in `functions/[[path]].js` sind
  nicht Teil dieses Arbeitsblocks. Sie wurden weder verworfen noch mitgepusht.
- Der direkte MCP-Identitätscheck am 2026-09-05 bestätigt Legacy-Zugriff mit
  `read/write/admin`, nicht den eingeschränkten Sync-Client. Kein Schlüssel oder
  Gastinhalt wurde dabei ausgegeben oder in das Repository übernommen. Dieser
  Zugang ist kein Ersatz für den noch offenen Berechtigungsnachweis.
- Die bisherige private HOA-Korrespondenz ist in `BOOKING_HOA_NOTICE.md` nur als
  Nachweiszusammenfassung dokumentiert. Sie bestätigt zwei Verfahrenswege, nicht
  sämtliche Online-Vertragsunterlagen, Kartenarten oder eine sichere Ausweis-
  Ersatzlösung. Fehlende Belege bleiben fehlend.

## Nächster freizugebender Arbeitsschritt

Auf dem bestehenden System zuerst einen lesenden Bestandsabgleich im privaten
Produktivbestand durchführen: Commitstand, Vorlagen, Konfiguration, Bindings,
Mailpfade und vorhandene Dienste feststellen. Keine Übernahme der Studio-
Platzhalter, kein Dienstumzug, kein Neustart und kein realer Versand dabei.
Danach den konkreten isolierten Test und Rollout mit Zielsystem, Empfängern,
Datensicherung und Rückfall festlegen und bestätigen lassen. Die vorherigen
Abschnitte sind keine pauschale Genehmigung, diese Grenzen zu überspringen.

Der Ablauf und die Schalterreihenfolge stehen in
[ACTIVATION_CHECKLIST.md](ACTIVATION_CHECKLIST.md). Private Abnahmebelege bleiben
außerhalb von GitHub. Die 17 offenen Hauptlisten-Checkboxen werden nicht allein
wegen bestandener lokaler Tests abgehakt; die zusätzliche Untergliederung in
20 Technikaufgaben darf nicht als 20 weitere unabhängige Hauptpunkte gezählt
werden.
