# Beleggebundene HOA- und Tenant-Evaluation-Rückmeldungen

Stand: 2026-09-05. Lokal implementiert und mit synthetischen Nachrichten getestet. Nicht in Produktion aktiviert; keine reale Nachricht bearbeitet, kein Versand und keine reale Genehmigung vorgenommen.

## Ablauf

1. Der bestehende Mail-Poller archiviert einen verschlüsselten Textauszug und ordnet ihn konservativ zu. `HOA_MAIL_SENDERS` und optional `TENANT_EVALUATION_MAIL_SENDERS` enthalten ausdrücklich geprüfte Einzeladressen. Eine Absenderliste ist kein Echtheitsnachweis; keine Anbieteradresse wird geraten.
2. Der Eigentümer öffnet den Beleg unter `/admin/hoa-mail/:hash`, prüft Original, Absenderberechtigung, Buchung und Mietzeitraum. Nicht zugeordnete Quellen können über diese Seite nach Prüfung einem Vorgang zugeordnet werden. Eine bereits vorhandene andere Zuordnung wird nicht still überschrieben.
3. Die Prüfung erfasst getrennt: Antrag erhalten, Zahlung erhalten, Dokumente vollständig, offizieller Antrag/Screening vollständig und ausdrückliche HOA-Zustimmung. Kein Ergebnis impliziert ein anderes. Unklare oder negative Antworten bleiben Prüffälle; sie stornieren keine Buchung.
4. Bestätigte Nachforderungen erzeugen Gastaufgaben für Angaben, Dokumente, Unterschriften, sichere Ausweisübergabe oder Klärung des Zahlungsstatus. Nur fest definierte Texte gelangen zum Gast, niemals kopierte Mail-Anweisungen oder fremde Zahlungslinks. Details bleiben im offiziellen Antragsverfahren. Es gibt keine zweite Antrags- oder Zahlungsaufforderung bei bereits laufender Bearbeitung.
5. Die Gastseite zeigt diese Aufgaben auch nach bereits erfolgter Einreichung. Der Gast kann einzelne Aufgaben als erledigt melden; sie bleiben bis zur belegten Bestätigung offen. Weitere Aufgaben bleiben erinnerungsfähig. Ein späterer geprüfter Beleg kann bestimmte Aufgaben abschließen oder erneut anfordern.
6. Die bestehende Erinnerungsautomatik übernimmt offene Aufgaben. Sie bleibt separat freizuschalten; fehlende Gast-E-Mail und der Airbnb-Nachfassweg sind weiterhin eigene offene Arbeitspunkte. Diese Änderung versendet nichts beim Speichern.

## Schutz gegen falschen Abschluss

- Mail-Kategorien sind ausschließlich Vorprüfung, keine Statusfreigabe. Noch ungeprüfte Nachrichten mit fehlenden Angaben, negativem Ergebnis oder unklarem Inhalt setzen den zugeordneten Fall auf Prüfbedarf und blockieren Versand und automatische Gast-Erinnerungen bis zur Klärung.
- Neue bestätigte Nachforderungen entwerten betroffene Vollständigkeits-/Freigabeflags. Historische Belege und bereits erfolgte Einreichungen bleiben erhalten. Das widerruft keine tatsächlich erteilte Genehmigung und storniert nicht die Airbnb-Buchung; die aktuelle Verwendbarkeit des früheren Status muss geprüft werden.
- Genehmigung und Zahlung können nicht mehr über ein unbelegtes Status-Häkchen gesetzt oder entfernt werden. Änderungen laufen über eine ausdrückliche Eigentümerprüfung am archivierten Beleg. Die Software leitet sie nicht selbst aus Mailtext ab.
- Jede Quellenprüfung enthält Bearbeiter, Zeitpunkt, Buchungskontext und ausgewählte Fakten/Aufgaben. Derselbe Beleg kann nicht mehrfach Entscheidungen anwenden. Eine neue Nachforderung erhöht die Aufgabenversion; alte Browserformulare können sie nicht erledigen.
- Änderungen an Mietzeitraum, Belegung, Gast oder Antragsweg machen vorhandene Belege gegebenenfalls veraltet. Erneute Verwendung erfordert eine ausdrückliche Neubewertung anhand einer weiteren Quelle; alte Aufgaben werden als überholt protokolliert, nicht still als erledigt markiert.
- Schreibzugriffe benötigen den atomaren Fallspeicher. Eigentümerformulare prüfen die geladene Fallrevision; gleichzeitige Änderungen führen zu einem Konflikt statt Datenverlust. Gastmeldungen bestätigen nie Zahlung, Vollständigkeit oder Zustimmung.
- Stornierte/abgeschlossene Aufenthalte bleiben geschlossen. Laufender oder unklarer Versand darf nicht durch eine Quellenprüfung überschrieben werden. Eine abgeschlossene Einreichung mit erhaltenem Versandbeleg verhindert dagegen keine späteren Nachforderungen.
- Quellen bleiben eigentümergeschützt und verschlüsselt; Gastseiten zeigen keine E-Mail-Auszüge. Mail-HTML wird nicht ausgeführt. Gesetzte rechtliche Aufbewahrungssperren und verlängerte Aufenthalte werden bei der Archivaufbewahrung berücksichtigt.

## Grenzen und ausstehende Abnahme

Dies schließt die technische Lücke zwischen Beleg, Fallstatus, Nachforderung, Gastmeldung und Erinnerungsplanung. Es ist noch kein vollständig unbeaufsichtigter Mail-Entscheider: Tatsächliche Tenant-Evaluation-/HOA-Nachrichten einschließlich Originalheadern und nötigen Anhängen wurden für diese Änderung nicht ausgewertet oder als reale Testfälle verwendet. Die Existenz einer signierten Anbieter-API oder maschinenprüfbarer Zahlungs-/Genehmigungsbestätigungen wird nicht angenommen.

Vor Aktivierung sind die tatsächlichen Absender, Nachrichtenformate, Fallreferenzen und Nachweisarten zu prüfen. Eine automatische positive Entscheidung darf erst mit belastbarer Authentizitäts- und Inhaltsprüfung entwickelt und separat freigegeben werden. Bis dahin bleibt die ausdrückliche Belegprüfung beim Eigentümer. Echte End-to-End-Abnahme, Speicheraktivierung und Live-Rollout stehen aus. Keine Migration oder Produktionsänderung ist durch diese Dokumentation autorisiert.

## Tests

`test/hoa-mail.test.js` enthält synthetische Tests für Quellenprüfung, getrennte Statusnachweise, Nachforderungen nach Einreichung, Teil-Erledigungen, Wiederholungen, geänderte Aufenthalte, atomare Schreibkonflikte, Authentifizierung, fremde Origins, stornierte Fälle, unveränderte manuelle Zuordnung beim nächsten Poll und den Erinnerungsversand mit vollständig gemocktem Transport.

Ausführen: `npm test`, `npm run check`, `npm run build`, `npm audit --json`; zusätzlich `python3 -m unittest discover -s test -p 'test_*.py'`. Erfolgreiche lokale Tests sind keine Aussage über eine reale HOA-Zustimmung oder einen vollständig abgenommenen Live-Ablauf.
