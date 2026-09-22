# Airbnb HOA Studio – Isla 405D

Private versionierte Arbeitsumgebung fuer den Airbnb-Vermietungsablauf von Unit 405D, Isla del Sol, St. Petersburg, FL (HOA-Guest-Registration und Lease-Approval).

**Status:** privat · owner-operated · kein Public-Product.



## Ziel

Buchungen flüssig ohne Rueckfragen an den Eigentuemer durchfuehren:

- **Automatische Ueberwachung:** Airbnb-Buchungen werden geparstund als Faelle angelegt; Stornierungenund HOA-Anworten erkundet; Unklares alarmiert via Telegram.



- **Regeln eingehalten:** die relevanten Formulareund Regelwerke sind versioniert Teil dieses Repos; Formulardaten werden per testbelegtem Koordinaten-Overlay exakt eingetragen(nie erraten, nie gegen live unterschriebene Dokumente substituiert).



## Formulare

- Echte Form-Templates: `portal/public/forms/` –
  `lease-application.pdf`(SHA-256 `256cb293…`), `guest-registration.pdf`(SHA-256 `d40d0012…`).
- Der Gast bekommt die vorausgefuellten, korrekten Formulare vorgelegt zum Pruefen, Abzeichnen, Unterschreiben(kundengerecht).
- Template-Updates laufen ueber TDD und Commits, die die SHA-256 tragen.



## Doku

- `STUDIO_BRIEF.md` – Regeln/Tests.
- `ARCHITECTURE.md` – Aufbau, Datenfluss, Deploy, Formular-Pfade(fuer jede KI durchsuchbar.



## Checks

`npm test` · `npm run check` · `npm run build` · `npm audit --json`(313 tests, audit-sauber).