# Airbnb HOA Studio – Unit 405D guest & HOA portal

Versionierte Arbeitsumgebung fuer den Airbnb-Vermietungsablauf von Unit 405D,
St. Petersburg, FL (HOA-Guest-Registration und Lease-Approval).

**Status:** oeffentliches Repo · owner-operated · kein Public-Product fuer Dritte.

## Identitaet & Datenminimierung

- Dieses Repo ist **oeffentlich**, aber der Code fuehrt eine **anonymisierte
  Code-Identitaet** (Platzhalter "Example Island" / "Demo Unit"). Der echte
  Anlagename, personenbezogene Daten, Live-Produktions-IDs und Secrets stehen
  **nicht** in diesem Repo — sie liegen in der privaten Doku / dem privaten
  gbrain-Archiv.
- Die HOA-Original-PDFs (Rules & Regulations, Lease-Application,
  Guest-Registration, Declaration, Amendments) bleiben im **privaten** Archiv.
  Im Repo liegen nur blanke Formular-Templates (SHA-256-verifiziert) und die
  aufbereitete Rechts-Inventur (siehe `portal/HOA_STATUTES_AIRBNB_BASIS.md`).
- Fuer die Softwareentwicklung massgeblich ist die Rechts- und Regel-Inventur:
  HOA-Regeln, anwendbare Florida-Statuten (inkl. Fair Housing) und
  Airbnb-Host-Bedingungen — `portal/HOA_STATUTES_AIRBNB_BASIS.md`.

## Ziel

Buchungen fluessig ohne Rueckfragen an den Eigentuemer durchfuehren:

- **Automatische Ueberwachung:** Airbnb-Buchungen werden geparst und als Faelle
  angelegt; Stornierungen und HOA-Antworten erkundet; Unklares alarmiert via
  Telegram.
- **Regeln eingehalten:** die relevanten Formulare und Regelwerke sind
  versioniert Teil dieses Repos; Formulardaten werden per testbelegtem
  Koordinaten-Overlay exakt eingetragen (nie erraten, nie gegen live
  unterschriebene Dokumente substituiert).

## Formulare

- Echte Form-Templates: `portal/public/forms/` –
  `lease-application.pdf` (SHA-256 `256cb293…`), `guest-registration.pdf`
  (SHA-256 `d40d0012…`).
- Der Gast bekommt die vorausgefuellten, korrekten Formulare vorgelegt zum
  Pruefen, Abzeichnen, Unterschreiben (kundengerecht).
- Template-Updates laufen ueber TDD und Commits, die die SHA-256 tragen.

## CI

Jeder Push auf `main` und jeder Pull Request laeuft durch GitHub Actions
(`.github/workflows/ci.yml`): `npm test` · `npm run check` · `npm run build` ·
`npm audit` (Portal) plus Python-Syntax-Check (Operations).

## Sicherheit & Review

Die Härtung ist in Tests + CI abgesichert (`portal/test/csp.test.js`,
`portal/test/admin-auth.test.js`, `portal/test/secure-compare.test.js`):

- **Strikte Content-Security-Policy ohne `unsafe-inline`:** pro Antwort wird ein
  kryptografischer Nonce rotiert und in jeden `<script>`/`<style>`-Tag injiziert
  (CSP `script-src`/`style-src 'self' 'nonce-…'`). Inline-`style=`-Attribute und
  `onsubmit`-Handler wurden in Utility-Klassen bzw. zentrale Nonce-Script-Logik
  (`data-confirm`/`data-pct`) umgebaut.
- **Constant-time Auth:** Admin-Basic-Auth und Review-Token-Vergleich laufen
  ueber `tolerantCompare` (SHA-256-Digest + XOR-Akkumulator, kein Kurzschluss),
  `functions/lib/secure-compare.js`.
- **Sicherheits-Header:** HSTS, nosniff, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, restriktive Permissions-Policy.

## Doku

- `STUDIO_BRIEF.md` – Regeln/Tests.
- `ARCHITECTURE.md` – Aufbau, Datenfluss, Deploy, Formular-Pfade.
- `portal/HOA_STATUTES_AIRBNB_BASIS.md` – Rechts- & Regel-Inventur
  (HOA-Regeln, Florida-Statuten, Airbnb-Bedingungen → Software-Anforderungen).

## Checks (lokal)

`npm test` · `npm run check` · `npm run build` · `npm audit --json`
(330 tests, audit-sauber).