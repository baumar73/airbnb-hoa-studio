# TODOS — Automatischer Gäste- und HOA-Ablauf

Stand: 2026-09-05. Gesicherte Arbeitsliste aus der Portalprüfung; kein Release und keine Freigabe für den unbeaufsichtigten Live-Betrieb.

## Ziel und Status

Der Eigentümer soll Gäste nicht mehr manuell an Unterlagen, Nachforderungen und die HOA-Gebühr erinnern müssen. Routinefälle sollen automatisch bearbeitet werden; unklare Rückmeldungen, Ablehnungen und technische Fehler müssen als nachvollziehbare Ausnahmen sichtbar werden.

Die Oberfläche ist weiter als der durchgehend automatische Ablauf. „Lokal programmiert“, „lokal getestet“ und „in Produktion aktiviert und abgenommen“ sind getrennte Zustände. Kein offener Punkt unten gilt allein durch vorhandenen Code als erledigt.

Priorität: zuerst den Tenant-Evaluation-Ablauf schließen — Buchung → Online-Antrag → konkrete Nachforderungen → Erinnerungen → nachgewiesener Abschluss → HOA-Entscheidung.

## Vier lokale Zuverlässigkeitsaufgaben (2026-09-05)

- [x] Buchungsimport: fehlerhafte Änderungen erhalten den bestehenden Fall;
  unvollständige Mails bleiben zur Prüfung sichtbar. Unveränderte Bestätigungen
  erzeugen weder Schreibzugriffe noch falsche Änderungszähler. Vier neue Tests
  einschließlich zwölf ungültiger Eingabevarianten, insgesamt 258 JS-Tests.
- [x] Erinnerungsversand: neue Zustellhinweise, geänderte Versandreservierungen,
  deaktivierte Automatik und neue Wartefristen werden vor SMTP erneut geprüft.
  Gelöschte Fälle oder verlorene Versandreservierungen gelten nach SMTP nicht als
  gespeicherter Erfolg. Zwei neue Tests mit acht Ausfallvarianten; 260 JS-Tests.
- [x] Prüfdienst: beschädigte, strukturell ungültige oder weit in der Zukunft
  liegende Heartbeats gelten als fehlend/ungesund und können vom nächsten Lauf
  ersetzt werden. Ungeprüfte Statuswerte werden nicht veröffentlicht; echte
  Speicherfehler bleiben sichtbar. Vier neue Tests, insgesamt 264 JS-Tests.
- [x] Wiederanlauf: `npm run test:runtime` prüft die reale lokale workerd-Runtime
  und zwei Neustarts mit persistentem temporärem Speicher. Verschlüsselte
  Entwürfe, 150-KB-Dokumentenarchiv, Versandsperren, Prüfauftrag-Neuübernahme,
  alte Schreibversuche, Export-Cursor und Löschungen sind geprüft. Falsche
  Entschlüsselungsschlüssel werden abgewiesen. Kein physischer Stromausfalltest,
  kein Produktionsneustart und kein Backup-Wiederherstellungsnachweis.

Diese Teilaufgaben belegen lokale Technik, keine Live-Abnahme.

## Tenant Evaluation und HOA-Rückmeldungen

### Verifizierbare Rückmeldungen und Nachforderungen verarbeiten

**What:** Abschluss, Zahlung, Vollständigkeit und HOA-Entscheidung getrennt und anhand belastbarer Nachweise erfassen.
**Why:** Die Selbstauskunft des Gastes „erledigt“ ersetzt keine Bestätigung; sonst bleibt die Nachverfolgung beim Eigentümer.
**Context:** E-Mail-Auswertung und Zuordnung sind vorbereitet, dienen aber zunächst der Prüfung. Eine eingehende E-Mail oder KI-Klassifizierung darf nicht als automatische Genehmigung behandelt werden.
**Effort:** L
**Priority:** P1

**Lokaler Fortschritt 2026-09-05:** Beleggebundene Eigentümerprüfung, getrennte Bestätigungen, konkrete Gastaufgaben, Teil-Erledigungen, erneutes Öffnen nach Einreichung, Versionsprüfung und Versandsperren sind implementiert. Details und Grenzen: [HOA-Evidence-Ablauf](HOA_EVIDENCE.md). Kein Live-Rollout; keine automatische positive Entscheidung aus Mailtext. Die folgenden Abnahmepunkte bleiben offen, soweit sie echte Nachrichten oder den Live-Betrieb voraussetzen.

- [ ] Festlegen und anhand tatsächlicher Rückmeldungen prüfen, welche Nachweise Tenant Evaluation und HOA für die einzelnen Schritte liefern.
- [ ] HOA-Nachforderungen nach sicherer Zuordnung als konkrete offene Gastaufgaben abbilden; erledigte Vorgänge bei neuen Anforderungen kontrolliert wieder öffnen.
- [ ] Mehrdeutige, widersprüchliche oder nicht sicher zuordenbare Nachrichten zur Prüfung vorlegen, ohne einen positiven Status zu erfinden.
- [ ] Durchgängigen Testfall vom Antrag bis zur belegten HOA-Entscheidung einschließlich Nachforderung abnehmen.

## Erinnerungen und Erreichbarkeit

### Zuverlässigen Nachfassweg für jeden Gast schließen

**What:** Statusabhängige Erinnerungen aktivieren und einen verlässlichen Weg für Gäste ohne bekannte E-Mail-Adresse ergänzen.
**Why:** Unterschiedliche Antwortzeiten und teilweise ausgefüllte Unterlagen dürfen keine manuelle Merkliste erfordern.
**Context:** Gezielte E-Mail-Erinnerungen sind lokal programmiert, aber nicht aktiviert. Ohne Gast-E-Mail fehlt noch ein verlässlicher Nachfassweg über Airbnb.
**Effort:** L
**Priority:** P1
**Depends on:** Eindeutige offene Aufgaben und belastbare Statusänderungen.

**Lokaler Fortschritt 2026-09-05:** Freiwilliger, verschlüsselt gespeicherter E-Mail-Erinnerungswunsch auch ohne Papierformular; Abmeldung verhindert den Rückfall auf eine alte Formularadresse. Fehlende Erreichbarkeit erscheint im Verwaltungsbereich und bei fälligen Erinnerungen als überwachte Ausnahme. Parallelität, späte Erledigung/Stornierung und Abmeldung unmittelbar vor Versand sind getestet. Details: [Gast-Erinnerungen](GUEST_REMINDERS.md). Zusätzlich ist der bereits von Hermes genutzte Airbnb-Antwortweg per Gmail als standardmäßig deaktivierter Fallback implementiert: verschlüsselte Kandidaten, Originalprüfung durch Eigentümer, buchungsgebundene Freigabe, Antwort-Header und gemeinsamer Schutz vor doppeltem Versand. Strukturierte Zustellberichte werden nun optional anhand der stabilen Versand-ID und eines Empfänger-Hashs als Prüfhinweis erfasst; sie lösen weder Wiederholung noch Statusfreigabe aus. Details: [Airbnb-Antwortweg](AIRBNB_RELAY.md). Automatische Erstzuordnung ohne Eigentümerprüfung, Rückläuferabgleich im realen Postfach und kontrollierte Live-Abnahme bleiben offen. Der Gesamtpunkt ist daher nicht abgeschlossen.

- [ ] E-Mail-Erreichbarkeit und den zulässigen Airbnb-Nachfassweg klären und testen.
- [x] Erinnerungen konkret auf fehlende Angaben, Unterlagen, Zahlung oder Nachforderungen beziehen.
- [x] Versandfehler, doppelte Ausführung und verspätete Antworten mit synthetischen Fällen testen; erledigte, stornierte und gelöschte Fälle nicht weiter erinnern.
- [ ] Erinnerungen erst nach kontrolliertem Test und ausdrücklicher Betriebsfreigabe aktivieren.

## Airbnb-Buchungsabgleich

### Änderungen automatisch übernehmen

**What:** Änderungen an Reisedaten, Belegung und Buchungsstatus zuverlässig in den Fall übernehmen.
**Why:** Veraltete Angaben können falsche Dokumente, Fristen und Erinnerungen auslösen.
**Context:** Der automatische Abgleich ist noch nicht vollständig; relevante Änderungen müssen gegebenenfalls neue Unterlagen und eine erneute Prüfung auslösen.
**Effort:** L
**Priority:** P1

**Lokaler Fortschritt 2026-09-05:** Wiederholte Bestätigungen mit derselben
Buchungsnummer werden nicht mehr blind als Duplikat verworfen. Abweichende
Reisedaten, Belegung oder Gastdaten markieren den Vorgang als ausstehende
Buchungsänderung, kennzeichnen alte Schritte/Pakete als überholt und halten den
Gästeablauf bis zur Eigentümerprüfung an. Der Eigentümer kann den neuen
Aufenthaltskontext nun im geschützten Verwaltungsbereich ausdrücklich bestätigen.
Es erfolgt keine automatische
Stornierung oder Freigabe; der Abgleich bleibt mit echten Airbnb-Formaten und
einem kontrollierten Testfall abzunehmen.

**Zusätzliche lokale Absicherung 2026-09-05:** Änderungen während eines
ungeklärten Paketversands erhalten die dauerhafte Versandsperre und die Referenz
auf das bisherige Paket. Auch das Bestätigen der neuen Buchungsdaten hebt diese
Sperre nicht auf. Ein später Versandbeleg darf keine Schritte der neuen Buchung
als erledigt markieren; dazu werden Prüfversion und Paket-ID/-Hash beim
Speichern erneut abgeglichen. Vier neue Tests einschließlich eines simulierten
Buchungswechsels während SMTP bestätigen dieses Verhalten. 245 JavaScript-Tests
und Syntaxprüfungen bestanden; der reale Abgleich einer unklaren Sendung bleibt
eine gesonderte Betreiberprüfung.

- [x] Änderungen und Stornierungen mit synthetischen Airbnb-Nachrichten zuverlässig zuordnen und wiederholte Verarbeitung ohne doppelte Nebenwirkungen testen; echte Airbnb-Formate bleiben abzunehmen.
- [x] Veraltete Dokumentenpakete und Prüfungen bei relevanten Änderungen als überholt markieren; die tatsächliche End-to-End-Abnahme bleibt offen.
- [x] Sieben Tage Buchungsvorlauf und erforderliche HOA-Zustimmung vor Bezug im Inserat und Portal konsistent halten; nicht als garantierte Bearbeitungsfrist darstellen.

## Dokumente und Zahlungsablauf

### Echten Dokumenten- und Versandweg vollständig abnehmen

**What:** Papier- und Online-Weg mit den tatsächlichen Anforderungen Ende zu Ende prüfen.
**Why:** Lokale Tests ersetzen weder echte Vorlagen noch den Nachweis, dass alle erforderlichen Vertragsunterlagen beim richtigen Empfänger ankommen.
**Context:** Automatischer Papierpaket-Versand mit der für diesen Zweck freigegebenen hinterlegten Unterschrift ist vorbereitet. Tests mit tatsächlichen Vorlagen und echtem Versandweg stehen aus. Für den Online-Weg ist zu klären, welche Vertragsunterlagen Tenant Evaluation tatsächlich abdeckt.
**Effort:** L
**Priority:** P1

- [ ] Dokumentenabdeckung von Tenant Evaluation klären und verbleibende Vertragslücken schließen.
- [ ] PDF-Ausgabe, Unterschriftenzuordnung, unveränderliche Archivierung und richtigen Empfängerkreis mit echten Vorlagen kontrolliert testen.
- [ ] Sichere Ausweisübergabe für den Papierweg klären; keine SSN- oder Ausweis-Uploads im Portal und keine unsichere Ersatzlösung einführen.
- [ ] Zahlungsanleitung auf nachgewiesene elektronische Möglichkeiten und Gebühren beschränken; keine unbestätigten Karten- oder PayPal-Optionen versprechen.
- [ ] Gast zahlt direkt an HOA beziehungsweise deren Antragsdienst; kein Eigentümer-Aufschlag und keine doppelte Zahlung bei einem Wechsel des Verfahrens.
- [x] Versand-Timeouts und unklaren Versandausgang mit synthetischen Ausfällen im tatsächlichen Paket-Dispatcher testen, ohne doppelte Pakete zu versenden; reale SMTP-/Neustart-Abnahme bleibt offen.

**Lokaler Fortschritt 2026-09-05 — Paketversand:** Acht zusätzliche Tests prüfen
Parallelität, Timeout, fehlgeschlagene Belegspeicherung, späte Stornierung oder
fehlenden Zahlungsnachweis, Benachrichtigungsausfall, Prozessabbruch und Löschung
während des Versands. Mailserver-Annahme ohne gespeicherten Versandnachweis wird
nicht mehr als gesicherter Erfolg gemeldet. Die dauerhafte Versandsperre bleibt
für den manuellen Abgleich erhalten. Ungefilterte Provider-Fehlermeldungen werden
nicht mehr im Fall gespeichert. Alle 238 JavaScript-Tests und Syntaxprüfungen
bestanden; keine echten E-Mails, kein Live-Rollout.

**Lokaler Fortschritt 2026-09-05 — Widerruf vor Versand:** Der Dispatcher liest
nach der Paketvorbereitung den Live-Schalter erneut und prüft Dauerfreigabe sowie
die aktuelle grüne Paketprüfung. Ein bereits beanspruchter Automatikversand
wird bei ausgeschaltetem Live-Modus auch nicht als Test-E-Mail ausgeführt.
Drei Regressionstests (einschließlich fünf Widerrufsvarianten) reproduzierten
zunächst unerwünschten Versand und bestehen nach der Korrektur. Gesamter
JavaScript-Prüfstand: 241 Tests. Bereits an SMTP übergebene Nachrichten können
durch einen späteren Widerruf nicht zurückgeholt werden; die Prüfung liegt vor
dem Transportaufruf und ist keine atomare Transaktion mit Gmail.

**Lokaler Fortschritt 2026-09-05 — Abgleich bestätigter Sendungen:** Für einen
gesperrten Vorgang mit unverändertem archiviertem Paket kann der Eigentümer jetzt
die im Gesendet-Ordner geprüfte Originalmail mit Nachrichten-ID und UTC-Sendezeit
erfassen. Das speichert den bisherigen Versand; es sendet nichts und genehmigt
weder HOA noch Check-in. Geänderte Vorgänge und weiterhin unklare Sendungen
bleiben gesperrt. Details und Grenzen: [Paketversand-Abgleich](PACKAGE_RECONCILIATION.md).
Neun zusätzliche Tests; insgesamt 254 JavaScript-Tests, Syntaxprüfung und
Functions-Build bestanden. Kein Live-Rollout.

## Produktionssicherheit und Veröffentlichung

### Betriebsreife belegen, dann kontrolliert aktivieren

**What:** Sichere Datenänderungen, Wiederanlauf, unabhängige Ausfallwarnungen und wiederherstellbare Sicherungen in Betrieb nehmen.
**Why:** Stromausfälle, Neustarts und parallele Bearbeitung dürfen keine Vorgänge verlieren oder doppelte Aktionen auslösen.
**Context:** Entsprechende Bausteine sind vorbereitet, aber noch nicht durchgehend aktiviert und im realen Betrieb abgenommen. Vor Infrastruktur- oder Produktionsänderungen sind Zielsystem und Annahmen ausdrücklich zu bestätigen; diese Liste autorisiert keinen Umzug oder Rollout.
**Effort:** L
**Priority:** P0 — vor Aktivierung des unbeaufsichtigten Betriebs; blockiert reine Dokumentationsänderungen nicht.

**Lokaler Fortschritt 2026-09-05:** Eine getrennte
[Aktivierungs-Checkliste](ACTIVATION_CHECKLIST.md) beschreibt die aktuelle
Reihenfolge der Schalter, synthetische Abnahmeschritte, Stromausfall-/Claim-
Wiederaufnahme und den Rückfall. Sie ersetzt keine reale Betriebsfreigabe.

- [ ] Atomaren Fallspeicher kontrolliert aktivieren und gleichzeitige Änderungen testen.
- [ ] Wiederanlauf und ausstehende Aufgaben nach Prozessabbruch, Stromausfall und Neustart praktisch nachweisen.
- [ ] Unabhängige Ausfallüberwachung mit wirksamem Alarmweg einrichten und einen Probealarm testen.
- [ ] Verschlüsselte Sicherungen und tatsächliche Wiederherstellung testen; Aufbewahrung und Zugriff dokumentieren, ohne Geheimnisse ins Repository zu schreiben.
- [ ] Fehlende Betriebsfreigaben, sichere Rückkehr zum vorherigen Stand und Ende-zu-Ende-Abnahme dokumentieren.
- [ ] Ausstehende Programmänderungen separat prüfen, auf GitHub sichern und nach Freigabe veröffentlichen.

### GitHub-Sicherung und Live-Veröffentlichung

Zum Zeitpunkt dieser Bestandsaufnahme lag GitHub `main` bei `1a151ac`; lokal waren drei weitere Commits vorhanden:

- `c1eb474` — Prepare protected revisioned guest knowledge export
- `d5f6e01` — Clarify booking notice and prepare scoped guest knowledge access
- `f88beef` — Highlight Tenant Evaluation for new guest applications

Diese drei Commits und der Beleg-/Nachforderungsablauf wurden am 2026-09-05 bis einschließlich `6c23084` auf GitHub `main` gesichert. Die zusätzliche atomare E-Mail-Belegzuordnung verhindert, dass zwei parallele Prüfungen denselben Beleg für verschiedene Buchungen verwenden. Das ist kein Live-Deployment. Daneben vorhandene lokale Oberflächenänderungen bleiben weiterhin getrennt.

## gbrain / Hermes

### Gästedaten-Synchronisierung ergänzen

**What:** Geschützte, revisionsbasierte Gästedaten-Synchronisierung mit nachvollziehbaren Zugriffsrechten umsetzen.
**Why:** Der Eigentümer soll Fälle wiederfinden und später über Hermes damit arbeiten können.
**Context:** Der direkte MCP-Zugang zu gbrain besteht; die laufende Gästedaten-Synchronisierung fehlt noch. Sie soll den Kernablauf nicht verzögern. Export, Schreibzugriff, Löschung und Berechtigungen müssen getrennt geprüft werden.
**Effort:** L
**Priority:** P2
**Depends on:** Stabiler Kernablauf und sichere Fallrevisionen.

- [x] Lokalen Consumer für Synchronisierung, Aktualisierung, Löschung und Zugriffsbeschränkungen mit synthetischen Daten testen; echte Zielrechte und der Live-Roundtrip bleiben offen.
- [x] Repository-Sicherheitsprüfung durchgeführt: keine Schlüssel-/Credential-/Gastdokument-Dateien in den getrackten Dateien; Export-Allowlist und synthetische Tests halten den gbrain-Umfang zweckgebunden. Vor jedem weiteren Import erneut prüfen.

## Prüfstand und Abnahmeregeln

Nach der lokalen Ergänzung des Airbnb-Antwortwegs, der optionalen Zustellüberwachung, des Buchungsabgleichs, des gbrain-Consumer-Scaffolds, der ausfallsicheren Poller-Benachrichtigung, der konservativeren Stornierungsanalyse, der robusteren Erinnerungszustellung, des ausfallsicheren Cron-Alarmpfads, der beschädigungsfesten Statusüberwachung und des Bearer-Link-Schutzes in Cron-Hinweisen bestanden 230 JavaScript- und 34 Python-Tests (2026-09-05). Die früheren Prüfstände lagen bei 156/34, 177/34, 179/34, 189/34, 206/34 und 212/34. Das belegt lokale Technik, keinen vollständig getesteten Live-Ablauf.

- Neue Abläufe brauchen Tests für vollständige, unvollständige, verspätete, geänderte und stornierte Buchungen sowie technische Ausfälle.
- Eine Buchung kann vor HOA-Zustimmung bestehen; Bezug erst nach erforderlicher Zustimmung. Ablehnungen und mögliche Stornierungen bleiben gesondert zu prüfende Ausnahmen, keine automatische Schuldzuweisung an den Gast.
- Gäste verwenden ausschließlich die vorgesehenen .com-Seiten.
- Gast-Speichern bleibt Entwurfsspeicherung; keine implizite HOA-Einreichung oder Genehmigung.
- Details und bestehende Sicherheitsgrenzen: [Reparaturstatus](REPAIR_STATUS.md), [Hybridbetrieb](HYBRID_OPERATIONS.md), [MCP-Anbindung](GBRAIN_MCP.md).

## Completed

Noch kein oben aufgeführter Ende-zu-Ende-Arbeitspunkt ist als produktiv abgenommen markiert.
