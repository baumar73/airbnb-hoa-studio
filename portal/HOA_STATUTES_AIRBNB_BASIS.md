# HOA-Regeln, Florida-Statuten und Airbnb-Bedingungen — Rechts- und Regel-Inventur für Unit 405D

**Geltungsgegenstand:** Palma Del Mar Condominium No. 2 (Gebäude 669), Unit 405D,
6219 Palma del Mar Blvd S, St. Petersburg, FL 33715. Kurzzeit-/Monatsvermietung
(Airbnb) und kurzfristiger Gastaufenthalt.

**Zweck dieser Datei:** Quellenverankerte Bestandsaufnahme aller HOA-Regeln,
anwendbaren Florida-Statuten und Airbnb-Bedingungen, die als **Bedingungen für die
Softwareentwicklung** des Isla-405D-Gast-/HOA-Portals dienen. Sie ist eine
Dokumentations- und Anforderungsbasis, **kein Rechtsrat**. Originalscan-/PDF-Belege
liegen im privaten Archiv (gbrain), nicht in diesem (öffentlichen) Repo. Daten-
Minimierung: Das Portal erhebt, speichert und überträgt keine sensiblen
Mieterdaten (SSN, Ausweis, Screenings, Finanzdaten).

## Quellen-Hierarchie & Konfliktregel

1. Aufgezeichnete Governing Documents: Declaration of Condominium (1979) + Amendments, Articles of Incorporation, Bylaws.
2. Formell verabschiedete, aktuelle Rules & Regulations; offiziell beschlossene Lease- und Guest-Formulare.
3. Hinweise, Workshop-Minutes, Amtsempfehlungen, Rechtsschreiben des Club-Vertreters → dokumentieren, aber rangieren niedriger.

**Grundsatz der Software (fail-closed):** Bei unaufgelöstem Konflikt oder exakt
30 tatsächlichen Mietnächten (Regel-Grenze 30 Tage) nicht stillschweigend als
Gast oder Miete einordnen → `clarification_required`, schriftliche Klärung.
Regelentscheidungen behalten exakte Quell-IDs, Versions-/Aktualitätsstatus und
unaufgelöste Konflikte. Wartungsblockade-Tage zählen nie als Mietnächte.

---

# Teil A — HOA-Regeln (Palma Del Mar No. 2, Unit 405D)

## A.1 Governing Documents (aufgezeichnete Grunddokumente)

| Dokument | Aufgezeichnet / Quelle | Relevanz für Software |
|---|---|---|
| Declaration of Condominium (1979-12-26), OR Book 4961 p.366 ff. | gbrain `property-florida-isla-hoa/2026-03-31-138-*-declaration-1979` | Rechtsgrundlage Art. 15 (Vermietung) und Art. 25 (Nutzung) |
| Bylaws | `2026-03-31-135-*-bylaws` | Verfahren, Vorstand, Änderung |
| Articles of Incorporation (+Amendments 1983) | `2026-03-31-113-*` | Satzung, Änderungsquoten |
| Amendments 1980 / 1984 / 2014 / 2019 (15.12) / 2022 | `-99/100/101/103/136/102-*` | Assessments, Haustiere 30.07, Miet-Begrenzung 15.12, Bauliche Änderung 21.02 |

### Declaration, Art. 25 — Pflichten/Nutzung des Eigentümers (relevante Absätze)
- **25.03:** Einheit nur als **single family residence** nutzen (keine andere Zweckbestimmung).
- **25.14:** Einheit **nicht** teilen/unterteilen zum Verkauf oder zur Vermietung (ausgenommen Zusammenlegung mit baulich anschließender Einheit zu einer Wohnung).
- **25.15 / 25.16:** keine sichtbar aufgehängte Wäsche, keine Abfallansammlung.
- **25.06:** keine Änderung der Gemeinschaftselemente / Außenseiten ohne vorherige schriftliche Zustimmung der Vereinigung.
- **25.07:** Zutritt für Wartung/Inspektion/Gefahr/Compliance-Prüfung.
- **25.08:** keine Schilder/Werbung an Gemeinschaftselementen oder Einheit.

### Declaration, Art. 15 — Sales, Rental, Lease or Transfer
Durch die **Tenancy Restrictions Notice (2016-03-04)** ausdrücklich als durchsetzbar erklärt:
- **15.01:** Option der Vereinigung auf Kauf/Miete/Lease zu gleichen Bedingungen; Vermietung **ohne vorherige Genehmigung** der Vereinigung ist Vertragsverletzung, **nichtig** und vermittelt dem Mieter keinerlei Titel/Interesse — kann aber durch nachträgliche Genehmigung geheilt werden.
- **15.02:** Vor Annahme eines Angebots: schriftliche Mitteilung an den Vorstand mit Bedingungen, Namen/Anschrift der Person, auf Verlangen ergänzende Unterlagen.
- **15.03:** Vorstand entscheidet innerhalb **10 Tagen** (Zustimmung oder Benennung Dritter).
- **15.04:** Benannter Dritter hat **14 Tage** für bindendes Angebot; ohne solches Angebot gilt dies als **Zustimmung**; Eigentümer kann innerhalb **60 Tagen** nach Mitteilung abschließen.
- **15.06:** Zustimmung in **urdenklicher/recordable Form**, von zwei Amtsträgern unterschrieben.
- **15.07:** Untervermietung/Unterverrentung wie Vermietung; Vereinigung kann **einheitliches Lease-Formular** verlangen; **nur ganze Einheiten** (Mieter + Familie + Gäste) — **keine Zimmervermietung**.
- **15.08:** Bei Unternehmenserthers einfachere Regelung (je nach Konstellation).

### Amendment zu Art. 15.12 (aufgezeichnet 2019-08-22, Pinellas Book 20665 pp.1831-1833)
**Wichtigste Miet-Begrenzung** (Quelle: Certificate of Amendment 15.12, `2026-03-31-136-*`; Text in `-103-*`):
- Kein Condominium-Parcel darf **ohne vorherige schriftliche Genehmigung der Vereinigung** verleast/vermietet werden.
- Verbot, mehr als **zwölf (12) Vermietungen pro Kalenderjahr** und Leasing mit einer Laufzeit von **weniger als 30 Tagen**.

## A.2 Rules & Regulations (Owners/Renters/Visitors)
Stand 3/2025 (Datei `669-PDM R&R 2023 Revised mr 43`; ältere Fassung 10/2018 `-157-*`). Für Software relevante Punkte:

- **E.1 Guest Registration:** Gäste (Personen, die < 1 Monat in der vakanten Einheit wohnen **und** keine Vergütung zahlen) müssen registriert werden; **keine** Application Fee. Firmen/Besuch beim anwesenden Eigentümer müssen nicht registriert werden.
- **E.2 Sale Application:** ≥ 2 Wochen vor Abschluss; $100 Fee.
- **E.3 Lease/Rental Application:** Eintrag an den Vorstand; **$100 Association Application Fee** (nicht erstattbar; Aufschlüsselung $50 Community + $50 Document Processing im aktuellen Lease-Application-Formular). Kann entfallen für **Wiederholungsmieter innerhalb der letzten 12 Monate** (bereits genehmigt & in Akte). Kein automatischer Waiver — Nachweis erforderlich.
- **E.4 Nutzung & Belegung:** nur **single family residence**; Belegung: **2 Schlafzimmer max. 6 Personen**, 1 Schlafzimmer max. 4 Personen (inkl. Kinder).
- **E.5 Mindestdauer:** alle Leases/Vermietungen mindestens **30 Tage / 1 Monat**.
- **E.6 Sanktionen:** Nichtbeachtung → Geldstrafen bis **$1.000** und/oder rechtliche Schritte (auch: `FAILURE TO FILE A LEASE APPLICATION MAY RESULT IN A FINE UP TO $1000.00`).
- **F.1 Haustiere:** Eigentümer dürfen Hund/Katze je nach Gewichtsgrenze; **`GUESTS/RENTERS ARE NOT PERMITTED TO HAVE PETS.`** (Assistance/Service Animals sind keine "Haustiere"; s. Antidiskriminierungsteil F.)
- Sonstige: Pool/Whirlpool-Stunden & -regeln, Parkregeln, Grillverbot, gemeinsame Bereiche, Müll etc. → für den Gastführer relevant, nicht für den Miet-/Bewilligungsfluss.

## A.3 Lease Application (Formular, Stand 03/12/2025)
- Voll ausgefüllter Antrag + unterschriebener Lease-Vertrag + **$100** (Check/Money Order, nicht erstattbar).
- **`Applicant(s) may not take possession of the unit until approval is granted by the Board of Directors.`**
- Jeder Bewohner ab 18 Jahren muss einen Antrag stellen (Additional occupants over 18).
- Application fragt sensibles Material ab (SSN, Geburtsdatum, Geschlecht, Ausweis, Arbeitgeber, Referenzen) → **das Portal sammelt/überträgt dies nicht** (Direktweg über gesicherten HOA-Anbieter).
- **Haustierfeld:** "PETS ARE NOT PERMITTED FOR RENTERS."
- Beiliegende **AUTHORIZATION TO CONDUCT BACKGROUND INVESTIGATION** (First Advantage) und **APPLICANT DISCLOSURE AGREEMENT** → externer Kanal, nicht im Portal.

## A.4 Guest Registration (Formular, Stand 03/28/2025)
- Vom Eigentümer auszufüllen, mit Gast-Unterschrift; an Condominium Associates bei **Abwesenheit** des Eigentümers.
- **Maximale Aufenthaltsdauer: 30 Tage** (Formularangabe "(Maximum 30 Day Period)").
- Bedingungen: keine Haustiere, Gäste erhalten Regeln, Eigentümer haftet, Pool-Tags, **Zertifikat: keine Vergütung gezahlt** (`I CERTIFY THAT COMPENSATION HAS NOT BEEN PAID`).
- **Konflikthinweis:** Guest-Reg sieht max. 30 Tage, Miettexte min. 30 Tage → exakt 30 = unaufgelöster Grenzfall → Software `clarification_required`.

## A.5 Belegungs-/Haustier-Konflikt (dokumentieren, nicht still auflösen)
- R&R F.1: Gewichtsgrenze Eigentümer-Haustier **25 lb**; Tenancy-Notice 2016 F.1 und Declaration-Änderung 30.07 (2014): **20 lb**. Versionsunterschied dokumentieren; nicht automatisch die zuletzt indexierte Seite verwenden.

---

# Teil B — Anwendbare Florida-Statuten (kompakter Überblick)

Nur die Paragraphen, die für diese Vermietung und das Portal gelten, mit Konsequenz für die Software. Volltexte über die verlinkte Flsenate-Online-Sunshine-Quelle.

## B.1 Chapter 718 — Condominium Act
- **718.110(13)** — Änderungen, die Vermietung verbieten/ändern oder Mietfrequenz begrenzen, gelten nur für **zustimmende und künftige Eigentümer** (Grandfathering folgt dem Eigentümer, nicht der Einheit). → Software: eine aus der Declaration geltende 12×/Jahr- und 30-Tage-Schranke nicht als neues Statut behandeln; alte Eigentümerlage separat prüfen (hier Einheit von Markus: Grandfathering-Relevanz anwaltlich klären).
- **718.112(2)(k)** — Genehmigungs-/Transferfee nur, wenn durch Declaration/Articles/Bylaws autorisiert; statistischer Höchstwert; **keine Gebühr bei Verlängerung mit demselben Mieter**.
- **718.303(3)** — Vor Verhängung einer Geldbuße: **14 Tage schriftliche Mitteilung** + Anhörung vor unabhängigem Ausschuss (≥ 3 Mitglieder).
- **718.1255** — Vorklagepflicht ADR (Mediation / nicht bindende Schlichtung) bei Vereinigungssachen.

## B.2 Chapter 720 — Homeowners' Association Act (nur falls anwendbar; BSL/autoritativ)
- **720.306(1)(h)(1)** — Nach dem 01.07.2021 erlassene Miet-Verbots/-Regelungsänderungen gelten nur für zustimmende bzw. künftige Erwerber.
- **720.306(1)(h)(2)** — Ausnahme: Änderung, die Mietdauern auf **< 6 Monate** begrenzt **oder** auf **max. 3× pro Kalenderjahr** beschränkt, bindet **alle** Eigentümer.
- Hinweis: 405D ist eine **Condominium**-Anlage (Ch. 718-Regime), Ch. 720 ist hier referenziert für die STR-Vergleichsanalyse.

## B.3 Chapter 509 — Transient Lodging / Vacation Rentals (DBPR)
- **509.013(4)(a)(1)** — Definition "transient public lodging establishment": mehr als **3× pro Kalenderjahr** vermietet, jeweils **< 30 aufeinanderfolgende Tage**.
- **509.242(1)(c)** — Definition "vacation rental" (transiente Einheit in Condo/Co-op/Einfamilienhaus/…, kein Timeshare).
- **509.032(7)(b)** — **Preemption:** keine lokale Behörde darf Vacation Rentals verbieten oder Dauer/Frequenz regulieren (Ausnahme: vor dem 01.06.2011 verabschiedete Ortsverordnungen). Bindet allerdings **nicht** private Vereinigungen (HOAs/Condos) — deren Begrenzungen aus der Declaration bleiben.
- Konsequenz: Es kann eine **DBPR-Vacation-Rental-Lizenz** bestehen UND zugleich eine Geltung der 30-Tage-Schranke aus der Declaration; beides ist vereinbar. Software trennt "statutory STR"-Status von "HOA-Vertragsregel".

## B.4 Chapter 760 — Fair Housing Act (Florida) + Federal FHA + HUD-Leitlinien
- **760.23** — Diskriminierung beim Verkauf/Vermietung und andere verbotene Praktiken: unzulässig wegen **Rasse, Hautfarbe, nationaler Herkunft, Geschlecht, Behinderung, Familienstand (Anwesenheit von Kindern < 18), Religion**.
- **760.24** — Diskriminierung bei Maklerdiensten: gleiche geschützte Merkmale; ebenso **5a. Federal FHA**.
- **760.27** — Verbotene Diskriminierung bei Unterbringung von Menschen mit Behinderung **oder mit behinderungsbedingtem Bedarf an einem Assistenz-/Emotionalsupport-Tier** (ESA). Keine Diagnose/anstehende Pflegedokumente verlangen; nur zuverlässige, rechtlich zulässige bestätigende Unterlagen anfordern, wenn Behinderung/Bedarf nicht offensichtlich.
- **760.29** — Ausnahmen (u. a. Eigentümer-vermietete Einfamilienhäuser unter Bedingungen; private Clubs) — für diese Mietstruktur genau prüfen, **nicht** generell annehmen.
- **Federal Fair Housing Act (42 U.S.C. §3601ff)** und **HUD Leitlinien zu Assistance Animals** (dreifacher Test: Behinderung — Bedarf — direkte Verbindung; art-/größenspezifische Einschränkungen nur bei direktem Bedrohungs-/Schadensnachweis unter Abwägung von Milderungen).
- **ADA (nur bei öffentlicher Einrichtung; bei reiner Miete i. d. R. nicht der Wohn-Rahmen, aber Reasonable-Accommodation-Grundsätze gelten durch FHA/Ch. 760).**

## B.5 Verbraucher-/Daten-/Vertragsrecht (Portal-Sicherheitspflichten)
- **404.056(5)** — Radon-Notice verbatim im generierten Lease.
- **83.50** — Landlord-Notice (Name/Anschrift) muss konfiguriert sein vor Live-Delivery.
- **83.512** — Flood-Disclosure + Eigentümer-Faktenangaben bei Mietdauer ≥ 1 Jahr.
- **501.171** — Antragsdaten & wiederverwendbare Signaturen verschlüsselt; keine Roh-IP-Speicherung; begrenzte Aufbewahrung; Incident-Response-/Breach-Notice-Prozess.
- **668.50 (Florida UETA)** — elektronische Zustimmung explizit, je Erwachsenem, zweckgebunden, versioniert, mit Inhalts-/Ereignis-Hash; HOA muss Signaturannahme separat bestätigen.
- **Fair Credit Reporting Act (federal)** — adverse Action auf Grundlage eines Consumer-Reports: gesonderte Mitteilung mit Nennung der Agentur und Kopie-/Widerspruchsrechten; Portal bereitet Entwurf vor, **entscheidet/versendet nie automatisch**.

---

# Teil C — Airbnb-Bedingungen (Host-/Plattform-Pflichten)

Diese sind **Plattformvertrag** (vertraglich, nicht Statut), aber Bedingung für den Betrieb des Listings und die Portalfunktion.

## C.1 Off-Platform and Fee Transparency Policy (Airbnb Help 2799)
- **Keine Verschiebung von Buchungen:** Nicht aktuelle/künftige/Wiederholungsbuchungen (inkl. Verlängerungen) von der Plattform wegbewegen; keine Off-Platform-Links in Listings/Nachrichten; keine Rabatte zum Off-Platform-Buchen; keine Buchungen stornieren, um off-platform neu zu buchen.
- **Pflichtgebühren offenlegen:** Sämtliche Pflichtgebühren erfasst durch Gästezahl, Nachtzahl, Haustieranzahl **(explizit: HOA fees)** müssen im passenden Gebührenfeld (oder im Nachtpreis, wenn kein Feld existiert) ausgewiesen sein; Gesamtpreis am Checkout muss stimmen.
- **Keine Zahlung für Reservierungsgebühren außerhalb Airbnb:** Anfordern/Senden/Erhalten von Zahlungen außerhalb der Plattform verboten (Kosten der Reservierung UND gebührenbezogene Zahlungen, z. B. optionale Pool-Heizung).
- **Sicherheitskaution:** die meisten Hosts dürfen keine Kaution verlangen; wo erlaubt → im korrekten Gebührenfeld offenlegen.
- Ausnahmen (dokumentieren, nicht annehmen): ausgewählte Software-verbundene Hosts, Hotels, zulässige Steuern, optionales Zubehör über Resolution Center.

## C.2 Airbnb Terms of Service / Offline Fee Policy (Help 2908)
- **Keine Gebühren außerhalb der Plattform**, sofern nicht von der Offline Fee Policy ausdrücklich autorisiert.
- **`You are responsible for setting your price and establishing rules and requirements for your Listing. You must describe all additional fees and charges in your Listing description... all mandatory fees included in price breakdown.`**
- **Nondiscrimination Policy** einhalten (entspricht Fair-Housing-Merkmalen): keine Diskriminierung in Entscheidungen, House-Rules oder Nachrichten; keine demografischen Nachbarschafts-/Gastangaben preisgeben; Assistance Animals sind **keine** Haustiere (keine Haustier-/Reinigungsgebühr für Service-/ESA in Jurisdiktionen mit Verbot solcher Gebühren).
- **AirCover / Verantwortung des Hosts:** Host haftet für eigene und zugelassene Helfer-Handlungen; Beschädigungs-/Haftungsfälle über AirCover.

## C.3 Konkrete Konsequenz für das Isla-405D-Portal (Verschränkung)
- Die **$100 HOA-Gebühr** ist eine Pflichtgebühr → muss im Airbnb-Gebührenfeld/Fee-Field offengelegt sein, **bevor** das Portal eine Zahlung außerhalb verlangt. Das Portal darf **keine** Zahlung außerhalb Airbnb verlangen (C.1/C.2).
- Der **eigentliche Lease-Mieter-Monatsfluss (≥ 30 Tage)** ist Airbnb-konform (kein STR-<30-Tage-Einwand), solange keine ∑>3 Kurzaufenthalte p. J. unter 30 Tagen im Mix entstehen (B.3) und HOA-30-Tage-Schranke (A.1) eingehalten wird.
- **Instantly-booking/Book-first:** Laut Betreiberentscheidung bleibt Instant Book an; Buchungen dürfen der HOA-Genehmigung **vorausgehen** (Portaldoku BOOKING_HOA_NOTICE). Fehlende Vorab-Genehmigung bestätigt Eintritt/possession aber nicht; Schlüsselübergabe bleibt gesperrt bis validem Board-Approval.
- **Keine automatisierten Stornierungen** wegen HOA-Konflikten; kein automatisches Abschalten von Buchungen; nur Verfügbarkeits-/Hinweis-Steuerung.
- **Keine Off-Platform-Kommunikationsaufforderung** (keine Links/Ermutigung zur Plattformflucht) in Portaltexten oder generierten Nachrichten.

---

# Teil D — Mapping auf Software-Anforderungen (Bedingungen)

| # | Regel/Quelle | Software-Anforderung | Status |
|---|---|---|---|
| R1 | A.1 15.01 / E.3; Board-Approval vor Besitz | `validateRentalPath`: Gate-Schlüsselübergabe/Check-in auf validem Board-Approval (Vorstand/Beauftragter, gültiges nicht-zukünftiges Datum, Sitzungs-/Consent-Referenz, exakter namentlicher Gast). Kein Auto-Approval aus E-Mail-Hinweis. Entfernen/Ungültigmachen widerruft Freigabe | aktiv |
| R2 | A.1 15.12 (max 12×/Jahr, min 30 Tage); A.2 E.5 | Mindest 30 tatsächliche Mietnächte für bezahlte Airbnb-Miete; Jahreszähler + sequenzielle Vertrags-/Genehmigungslogik als **separat getestete Regel**; Wartungstage getrennt. Kein Auto-Cancel | teilw. aktiv / Folgeaufgabe |
| R3 | A.2 E.1 + A.4 (max 30 Tage, keine Vergütung) | Guest-Registration-Pfad nur für vergütungsfreien, < 30-Tage-Aufenthalt; exakt 30 → `clarification_required`; nie für bezahlte Airbnb-Miete | aktiv |
| R4 | A.2 E.4 / A.1 25.03/25.14 | Belegungscheck (1-BR ≤ 4, 2-BR ≤ 6, single family); Zimmervermietung ausgeschlossen; unbekannte Schlafzimmeranzahl → fail-closed | aktiv |
| R5 | A.2 F.1 / 30.07 / 760.27 | Pets≠Renters/Gäste, ABER Assistance-/Service-Animal als Reasonable-Accommodation-Fall in **menschlicher Prüfung**, nicht als normales Haustier; keine Diagnose-/Krankengeschichte; art-/spezifische Limiten nur bei direktem Bedrohungs-/Schadensnachweis | aktiv |
| R6 | A.2 E.3 / 718.112(2)(k) / C.1-C.2 | $100-Fee-Workflow verborgen/gesperrt bis (a) Regierungsdokument-Autorität und (b) HOA-Fee im Airbnb-Fee-Field/Preisaufschlüsselung verifiziert; **keine Off-Platform-Zahlung**; kein Doppel-Waiver bei Wiederholungsmieter ohne Nachweis | aktiv |
| R7 | B.4 760.23/760.24/760.27 + FHA + C.2 | Neutrale, einheitliche Antwort auf alle Inquiries; keine demografischen Angaben; Diskriminierungsverbot; gesonderter Accommodation-Pfad | aktiv |
| R8 | B.5 404.056/83.50/83.512 | Radon-Notice verbatim; Landlord-Notice-Name/Anschrift konfigurieren; Flood-Disclosure + 3 Eigentümer-Faktenangaben bei ≥ 1 Jahr | aktiv |
| R9 | B.5 501.171/668.50/FCRA | Verschlüsselung, keine Roh-IP, begrenzte Aufbewahrung, zweckgebundene signierte e-Consents, adverse-Action-Erst-Mitteilung ohne Autoentscheidung | aktiv |
| R10 | B.3 509.013/509.242/509.032 | Statutory-STR-Status getrennt von HOA-Vertragsregel; DBPR-Lizenz-Pflicht (∑>3×/Jahr, <30 Tage) als späteres Monitoring-Thema, nicht blockierend | Monitoring |

## Offene, separat zu klärende Punkte
1. Grandfathering-Richtung von Amendment 15.12 (2019) für Markus als Eigentümer (Ch. 718.110(13) / Bindung des nicht-zustimmenden Bestandseigentümers) — anwaltlich.
2. Exakter Ablauf "Buchung vor HOA-Genehmigung" (Book-first bei erhaltener Instant-Book-Einstellung) vs. Declaration 15.01/15.02 (vor Annahme-Bescheid) — dokumentierter Konflikt, keine Auto-Entscheidung.
3. HOA-Fee-Offenlegung im Airbnb-Fee-Feld bzw. Nachweis autorisierter Erhebung — Voraussetzung R6.
4. Versionskonflikt Haustier-Gewichtsgrenze (20 vs. 25 lb) und alte vs. neue Rules-Revision (2018 vs. 3/2025) — keine stille Substitution in Live-Signaturprozessen.

## Quellen (Online)
- HOA-Dokumente (Original-PDFs): privates gbrain-Archiv `property-florida-isla-hoa/`; SHA-256-Manifeste im Repo (HOA_DOCUMENT_AUDIT / Sanitization).
- Florida Statutes: https://www.flsenate.gov/Laws/Statutes/2026/718.112 · 718.110 · 718.303 · 509.013 · 509.242 · 509.032; https://www.leg.state.fl.us/statutes/ (Ch. 760 § 760.23, 760.24, 760.27, 760.29; 404.056; 83.50/83.512; 501.171; 668.50)
- HUD: https://www.hud.gov/helping-americans/assistance-animals
- Airbnb: https://www.airbnb.com/help/article/2799 (Off-Platform & Fee Transparency) · 2908 (ToS/Offline Fee) · 251 (host asks for more money)
- DBPR Condominium & Vacation Rental: https://condos.myfloridalicense.com/