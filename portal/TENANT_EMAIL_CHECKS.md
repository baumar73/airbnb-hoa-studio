# Gegenprüfung: Mieter-Fragen → Software-Anforderungen (Unit 405D)

Stand: 2026-09-xx. Dieses Register überführt **reale Fragen, die frühere Gäste und
Mieter über E-Mail/Airbnb gestellt haben** in überprüfbare Anforderungen an das
Genehmigungs-Portal. Es ist die operative Gegenprüfung für die Kernaufgabe des
Portals: **die erforderlichen Formulare korrekt abzubilden und das
Genehmigungsverfahren lückenlos durchzuführen.**

Datenschutz-/Identitätsregel: Dieses Repo ist öffentlich. Echte Personennamen,
Reservierungscodes, E-Mail-Adressen, Message-IDs und private Äußerungen gehören
nicht hierher — sie bleiben im privaten gbrain-Archiv. Unten stehen daher nur
anonymisierte Fall-Kategorien ("Fall A", "Fall B", …) und die **Sachfrage ohne**
jede Zuordnung zu einer Person. Die Originalbelege liegen im privaten Archiv und
sind hier nur als Quellen-Gattung referenziert.

## Zweck

- **FAQ auf der öffentlichen Seite** beantwortet die standardisierten
  Gastfragen vor der Buchung und während des Aufenthalts (`HOME_FAQ` in
  `functions/[[path]].js`, sichtbar unter `/`).
- Jede hier gelistete Frage ist einer **verifizierbaren Regel** im Workflow
  (`functions/lib/*.js`) bzw. einem **Regressionstest** (`portal/test/*`) zugeordnet.
- Status: `abgedeckt` (Code+Test vorhanden) / `teilweise` (Lücke) / `offen`
  (Anforderung noch nicht umgesetzt).

## Fragenregister

| # | Sachfrage (anonymisiert, aus echten Gäste-/Mieterkontakten) | Zugeordnete Anforderung | Datei | Status |
|---|-----------------------------------------------------------|-------------------------|-------|--------|
| 1 | „Muss ich wirklich eine Kaution/Gebühr zahlen, wem gehört sie, und wie bezahle ich?" | $100-Fee-Verantwortung (Mieter), Zahlungsweg check/money order only, kein Doppelversand | `functions/lib/compliance.js`, `functions/lib/hoa-evidence.js`; FAQ `[[path]].js` | abgedeckt |
| 2 | „Der Aufenthalt ist genau 30 Nächte — bin ich Gast oder Mieter?" | Exakt-30-Grenze: nicht stillschweigend einordnen, sondern klären | `functions/lib/workflow.js:62`, Rechts-Inventur R1/R3 | **teilweise** |
| 3 | „Warum reichten die Unterlagen nicht — ein weiteres Formular wurde nachträglich verlangt?" | Gesonderte Formulare (z. B. Tenant Check Form) als eigenständige Workflow-Nachforderung | `functions/lib/hoa-evidence.js` (HOA_ITEMS) | **offen** |
| 4 | „Ist das eine Miete oder ein kürzerer Gastaufenthalt? Was ist der Unterschied?" | Route: volle HOA-Mieterstrecke vs. vereinfachte Gast-Registrierung | `functions/[[path]].js:61`, `functions/lib/journey.js` | abgedeckt |
| 5 | „Wann bekomme ich Zugang / Parken / Türcodes?" | Check-in erst nach belastbarem Board-Approval; keine Weitergabe davor | `functions/lib/workflow.js`, `guestView` | abgedeckt |
| 6 | „Passt die Ausstattung (Waschmaschine/Internet) zur Anzeige?" | Listing ⇄ tatsächliche Ausstattung dürfen nicht auseinanderlaufen | `HOME_DESC`/FAQ `[[path]].js` | teilweise |
| 7 | „Darf mein Haustier mit? Helfen mir Assistenztiere?" | Keine Haustiere für Mieter, Assistenztiere nur unter Fair-Housing-Ausnahmen | FAQ `[[path]].js`, `/fair-housing` | abgedeckt |
| 8 | „Kann meine KI die Unterlagen mitschreiben? Muss ich selbst unterschreiben?" | KI-Assistent-Unterstützung erlaubt, Signatur bleibt beim Mieter | FAQ `[[path]].js` | abgedeckt |
| 9 | „Ich brauche länger, um mich zu entscheiden / muss verschieben." | Buchungsänderung: alte Belege für veraltet markieren, neue Zustimmung | `functions/lib/hoa-evidence.js` (reconcileContext) | abgedeckt |
| 10 | „Ist das Zahlungs-/Genehmigungsstatus sicher (kein Doppelversand)?" | Durable Claims: kein Doppelversand, keine automatische Wiederholung | `functions/lib/delivery.js`, `test/atomic-storage.test.js` | abgedeckt |

## Verifizierbare Regeln aus den offenen/teilweisen Punkten

### Regel 2 — exakt 30 Nächte (teilweise)
- **Soll (Rechts-Inventur R1/R3, Zeilen 22/87):** „Bei exakt 30 tatsächlichen
  Mietnächten … nicht stillschweigend als Gast oder Miete einordnen →
  `clarification_required`."
- **Ist (Code `validateAirbnbCaseInput`, workflow.js:62):** `nights >= 30` wird
  ausnahmslos als volle Miete (`pathType:'full'`) validiert. Exakt 30 wird damit
  derzeit **stillschweigend als Miete** eingeordnet — ein Widerspruch zur
  Regel-Doku.
- **Maßnahme:** Grenzfall exakt 30 → `clarification_required` (fail-closed), Test ergänzen.

### Regel 3 — gesonderte Formulare (offen)
- **Soll (aus Fällen mit nachgereichten Formularen):** Verlangt die HOA nach der
  Kernmappe ein weiteres Formular (z. B. Tenant Check Form / Background Check
  Form), muss dies als **eigenständige Nachforderung** (nicht Anhang der
  Dokumente) modelliert, signalisiert und bis zur Quell-Bestätigung offen sein.
- **Ist (HOA_ITEMS, hoa-evidence.js):** Nur `application_details`, `documents`,
  `signatures`, `identity_documents`, `payment`. Kein eigener Code für
  „gesondertes Formular".
- **Maßnahme:** `HOA_ITEMS` um `supplementary_form` erweitern, Text + Blocking-Logik + Test.

## Abgedeckte Regeln (Wiederbeleg)

Die abgedeckten Zeilen korrespondieren mit bestehenden grünen Tests. Belegspuren:
`node --test test/*.test.js` (aktuell 327, alle grün) — vgl. `npm test`.