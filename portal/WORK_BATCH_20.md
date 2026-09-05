# Nächste 20 lokale Aufgaben

Auftrag vom 2026-09-05: nacheinander fertigstellen, prüfen und auf GitHub main
sichern. Die Punkte unten sind abgegrenzte technische Teilaufgaben der offenen
Portal-Arbeitsliste, keine Produktionsfreigaben. Jeder abgehakte Punkt wurde mit
der gesamten JavaScript-Testsuite geprüft; zusätzliche Runtime-Tests sind am
Ende dokumentiert. Reale Mailzustellung, HOA-Abnahme und Live-Rollout bleiben
gesonderte Arbeit.

- [x] 1. SMTP-Anhänge: Dateinamen vor Header-Einschleusung schützen
- [x] 2. SMTP-Antworten auch bei fragmentierten Netzwerkpaketen korrekt lesen
- [x] 3. Telegram-Störungsmeldungen mit Zeitlimit senden
- [x] 4. Versandabgleich: unmögliche UTC-Zeitangaben abweisen
- [x] 5. Stornierungsmails mit mehreren Buchungscodes nicht automatisch zuordnen
- [x] 6. Explizite Jahreszahlen in Buchungsdaten erhalten
- [x] 7. Prüfversion an Gastname, Verfahrensweg und Kinderzahl binden
- [x] 8. Leere oder strukturell ungültige KI-Prüfberichte abweisen
- [x] 9. Abgereiste Buchungen aus dem Prüfrückstand nehmen
- [x] 10. Beschädigte Prüfwiederholungszähler begrenzen
- [ ] 11. gbrain-Schreibergebnis anhand des tatsächlichen Inhalts prüfen
- [ ] 12. gbrain-Ablaufbereinigung vor überholten Löschständen schützen
- [ ] 13. gbrain-Importe ohne gültige Aufbewahrungsfrist abweisen
- [ ] 14. gbrain-Zustandsgrenze vor neuen Schreibvorgängen durchsetzen
- [ ] 15. Abgelaufene HOA-E-Mail-Belege nicht mehr ausliefern
- [ ] 16. Dokumentenarchiv: ungültige Eingaben vor dem Speichern abweisen
- [ ] 17. Explizit fehlgeschlagene Versandantworten nicht als Erfolg behandeln
- [ ] 18. Tenant-Evaluation-Ablauf mit Nachforderung durchgängig lokal prüfen
- [ ] 19. Fehlgeschlagene Paketvorbereitung im Betriebsstatus sichtbar machen
- [ ] 20. Verschlüsselte lokale Sicherung in getrennten Speicher zurückspielen und prüfen
