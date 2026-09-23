# Airbnb technical conditions — basis for the guest-portal automation path

Datum: 2026-09-23. Recherche zu den technischen und vertraglichen Bedingungen bei
Airbnb, soweit sie den automatisierten Buchungs-Erfassungspfad dieses Portals
betreffen. Zweck: belegen, dass der gewählte Weg (eigene Benachrichtigungs-Mails
per IMAP) gegenüber den Alternativen der vertraglich zulässige und praktikable
ist. Quellen sind am Ende verlinkt; Stand unverbindlich (Airbnb ändert AGB und
Partnerprogramm).

## 1. Kernentscheidung: Web-UI-Scraping ist vertraglich verboten

Die Airbnb Terms of Service verbieten ausdrücklich jede automatisierte Nutzung
der Plattform ohne Zustimmung:

> Do not scrape, hack, reverse engineer, compromise or impair the Airbnb
> Platform. Do not use bots, crawlers, scrapers, or other automated means to
> access or collect data or other content from or otherwise interact with the
> Airbnb Platform.

(Quelle: Airbnb Help Center, "Terms of Service".)

**Folge für das Portal:** Ein Einlesen des Host-Kontos über die Booking-Webseite
oder den Browser (z. B. um den Reservierungscode / die Buchungsbestätigung ab
zu greifen) ist keine tragfähige Grundlage für eine unattendedt Betriebslösung.
Solche Automatisierung verstößt gegen die AGB und kann zu Kontoverlust führen.
Heraus kommt: der **E-Mail-Weg** (eigene Benachrichtigungs-Mails), den dieses
Portal nutzt, bleibt die vertraglich und technisch robusteste Basis.

## 2. Die offizielle Airbnb-Partner-API ist für Einzel-Hosts nicht zugänglich

- Es gibt **keine öffentliche** Airbnb-API, die jeder Host offen bekommt.
- Airbnb vergibt API-Zugriff (intern "Homes API") nur an **Enterprise-Partner**
  (Channel Manager, PMS, Software-Anbieter), die ein strenge Prüfung von
  Datenqualität, Sicherheit und Compliance durchlaufen und den Status
  "Preferred Software Partner" erlangen (2025: 32 Anbieter wie Guesty, Hostaway,
  Hostex, Smoobu u. a.).
- Einzelne Host-Konten erhalten diesen Zugriff nicht automatisch; er ist an das
  *Softwareprodukt* des Partners gebunden, nicht an das Hostkonto.

**Folge für das Portal:** Für einen einzelnen Eigentümer ist die offizielle API
ohne Kopplung an einen Channel-Manager/PMS praktisch nicht erreichbar. Ein
Umstieg würde bedeuten, die Buchungsdaten durch einen Drittanbieter (PMS) zu
vermitteln — nicht nur technisch, sondern als dauerhafte Plattform-Abhängigkeit
mit eigenen Kosten und Zugriffsregeln.

## 3. Die erlaubten "offiziellen" Schnittstellen sind begrenzt

1. **iCal-Kalendersynchronisation** — Airbnb stellt iCal-Links zur Verfügbarkeit
   bereit. Das Portal nutzt bereits AirBnB-iCal (`operations/tools/import_airbnb_ical.py`).
   Achtung: iCal synchronisiert **nur Datenpunkte (Belegung)**, keine
   Gastkontakt-/Formulardaten, keinen Reservierungscode und keine
   Buchungsbestätigung. Es ersetzt den E-Mail-Pfad nicht.
2. **E-Mail-Benachrichtigungen** — Airbnb sendet für administrative Ereignisse
   (Buchungsbestätigung, Stornierung, Änderung) E-Mails an die beim Konto
   hinterlegte Adresse. Das Einlesen der *eigenen* Mailbox ist die legitime,
   AGB-konforme Datenquelle für Buchungsereignisse.

## 4. Belegklärung für den aktuellen Pfad

Der deployte Worker `isla-cron` ruft `pollMail` alle 30 Minuten auf und sucht
gezielt `from:airbnb.com subject:("reservation confirmed" OR buchung)` im
eigenen Postfach (IMAP). Dies nutzt ausschließlich die eigenen
Benachrichtigungs-Mails — **kein Web-Scraping, kein Bot-Zugriff auf die
Airbnb-Platform**. Damit ist der gewählte Weg der zulässige unter den drei
Optionen (Web-Scraping verboten / API nicht verfügbar / E-Mail zulässig).

**Grenzen, die beachtet werden müssen:**
- AirBnB-Bestätigung entsteht erst bei **abgeschlossener** Buchung (Code final).
  Eine "ausstehende"/nicht-bezahlte Buchung erzeugt keine `reservation
  confirmed`-Mail; kein automatischer Fall (bewusst: kein Raten).
- Die E-Mail-Zustellung beruht auf der Konto-E-Mail-Adresse; ein Umzug der
  Kontaktadresse sollte im Worker-Secret `GMAIL_USER` nachgezogen werden.
- Lokale Sicherheitsgrenze: nur Mails der letzten 30 Tage werden verarbeitet.

## 5. Empfehlung für künftige Fälle

- **Weiterbauen auf dem E-Mail-Pfad** (eigene Benachrichtigungs-Mails + IMAP),
  nicht auf Web-Scraping und nicht auf eigener Partner-API-Anbindung.
- iCal weiterhin als *Kalender*-Quelle, aber nicht als Ersatz für Buchungsdaten.
- Wenn eines Tages eine vorhandene Partneranbindung (z. B. über einen
  bestehenden PMS) genutzt werden kann, dann Webhooks des Partners als
  zusätzliche, klar getrennte Quelle — **nicht** ersatzweise, sondern parallel,
  mit eigenständiger AB-Grenze und Test.

## Quellen

- Airbnb Terms of Service (Help Center):
  https://www.airbnb.com/help/article/2908
- Airbnb — Software Partners / Preferred Partners:
  https://www.airbnb.com/software-partners
  https://news.airbnb.com/announcing-our-2025-preferred-software-partners
- Smoobu — "What is the Airbnb API? A Full Breakdown for Hosts" (Stand Mai 2026):
  https://www.smoobu.com/en/blog/airbnb-api/
- Haven — "Direct Airbnb Integration Sync and Webhook Reference" (Stand 9/2026):
  https://www.bookwithhaven.com/help/integrations/connect-airbnb-sync-reference
- Airbnb Community — Zugang zur API nur für Partner:
  https://community.withairbnb.com/t5/Ask-about-your-listing/How-do-I-become-an-Airbnb-partner/

_Hinweis:_ Diese Zusammenfassung ist recherchiert, keine anwaltliche oder
vertragliche Auskunft. AGB und Partnerprogramm ändern sich; vor einem
grundlegenden Umbau die aktuellen Quellen prüfen.