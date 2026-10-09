# ruff: noqa: E501  (fictional dialogue lines)
"""Fill an existing dev account with fictional demo data: clients, consents, sessions,
transcripts, captures and session notes (approved and draft).

    uv run python scripts/seed_demo.py someone@example.com

Dev/test databases only. All people and content are invented. Refuses to run if the account
already has clients. Prints ids and counts only."""

import os
import secrets
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import get_settings  # noqa: E402
from app.core.data_crypto import encrypt_bytes, encrypt_json  # noqa: E402
from app.db.models import (  # noqa: E402
    AuditLog,
    Capture,
    Client,
    Consent,
    ConsentText,
    Notification,
    Report,
    ReportVersion,
    Session,
    Transcript,
)
from app.db.session import user_session  # noqa: E402
from app.domain.report_draft import (  # noqa: E402
    NameList,
    default_content,
    names_aad,
    report_aad,
    wording_hits,
)
from app.domain.report_template import (  # noqa: E402
    PROMPT_VERSION,
    TEMPLATE_CODE,
    TEMPLATE_VERSION,
)

# 1x1 transparent PNG: stands in for a drawn signature.
SIGNATURE = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

T, C = "1", "2"  # speaker labels: therapist, client

# --- fictional content ------------------------------------------------------------------
# Report statements: (field, kind, text, [transcript line indexes]).
# `open` marks a draft statement the therapist still has to keep, edit or delete.

CLIENTS: list[dict[str, Any]] = [
    {
        "name": "Lena Hoffmann",
        "dob": "1991-04-17",
        "email": "lena.hoffmann@example.de",
        "phone": "+49 151 2345 6789",
        "lang": "de",
        "consents": ("recording", "ai_processing", "product_improvement"),
        "hidden": ["Markus"],
        "sessions": [
            {
                "days_ago": 21,
                "hour": 9,
                "report": "approved",
                "type": "probatory",
                "lines": [
                    (T, "Guten Morgen, Frau Hoffmann. Schön, dass Sie da sind. Wie war die Anreise?"),
                    (C, "Ganz okay, danke. Ich war ein bisschen zu früh, deshalb habe ich unten noch einen Kaffee getrunken."),
                    (T, "Beim letzten Mal hatten Sie erzählt, dass Sie nachts oft wach liegen. Wie war das in den letzten zwei Wochen?"),
                    (C, "Ähnlich. Ich schlafe meistens gegen Mitternacht ein und bin um drei oder vier wieder wach. Dann geht mir die Arbeit durch den Kopf."),
                    (T, "Was genau geht Ihnen dann durch den Kopf?"),
                    (C, "Vor allem das Projekt mit dem neuen Kunden. Die Deadline ist Ende des Monats und mein Teamleiter hat noch zwei Aufgaben dazugegeben."),
                    (T, "Sie haben gesagt, es geht Ihnen durch den Kopf. Was machen Sie in dem Moment, wenn Sie wach liegen?"),
                    (C, "Meistens nehme ich das Handy und schaue in die Mails. Ich weiß, dass das nicht hilft."),
                    (T, "Ich würde Ihnen gern ein Schlaftagebuch vorschlagen. Sie notieren morgens, wann Sie ins Bett gegangen sind, wann Sie aufgewacht sind und was Sie in der Wachphase gemacht haben."),
                    (C, "Das kann ich machen. Auf Papier oder im Handy?"),
                    (T, "Lieber auf Papier, damit das Handy nachts außer Reichweite bleiben kann."),
                    (C, "Okay. Ich lege es auf den Nachttisch."),
                    (T, "Dann sehen wir uns nächste Woche Donnerstag wieder, gleiche Uhrzeit, und schauen gemeinsam auf die Einträge."),
                    (C, "Passt. Donnerstag um neun."),
                ],
                "statements": [
                    ("current_situation", "reported", "Die Klientin berichtet, seit zwei Wochen gegen Mitternacht einzuschlafen und gegen drei oder vier Uhr wieder aufzuwachen.", [3]),
                    ("current_situation", "reported", "Sie berichtet von einer Projektdeadline Ende des Monats; ihr Teamleiter habe zwei zusätzliche Aufgaben übertragen.", [5]),
                    ("topics", "reported", "Nächtliches Aufwachen und Gedanken an die Arbeit.", [3, 5]),
                    ("topics", "reported", "Umgang mit dem Handy in Wachphasen.", [7]),
                    ("interventions", "intervention", "Die Therapeutin schlägt ein Schlaftagebuch vor (Zubettgehzeit, Aufwachzeit, Tätigkeit in der Wachphase); die Klientin stimmt zu.", [8, 9]),
                    ("agreements", "agreement", "Die Klientin führt ein Schlaftagebuch auf Papier; das Handy bleibt nachts außer Reichweite.", [10, 11]),
                    ("next_session", "plan", "Nächster Termin: Donnerstag nächster Woche, 9 Uhr; Besprechung der Tagebucheinträge.", [12, 13]),
                ],
                "therapist": {
                    "mental_status": "Wach, bewusstseinsklar, allseits orientiert. Konzentration subjektiv bei Müdigkeit eingeschränkt, im Gespräch unauffällig. Formales Denken geordnet.",
                    "understanding": "Ein- und Durchschlafstörung bei beruflicher Belastung; Handynutzung in nächtlichen Wachphasen als aufrechterhaltender Faktor vermutet.",
                    "progress": "Probatorik. Klientin nimmt Vorschlag zum Schlaftagebuch an, gut motiviert.",
                    "crisis": "",
                    "notable": "",
                },
                "captures": [("action_item", 8, "Schlaftagebuch führen"), ("date", 12, "Donnerstag 9:00")],
            },
            {
                "days_ago": 14,
                "hour": 9,
                "report": "approved",
                "type": "short_term",
                "lines": [
                    (T, "Hallo Frau Hoffmann. Haben Sie das Schlaftagebuch mitgebracht?"),
                    (C, "Ja, hier. Ich habe es an sechs von sieben Tagen ausgefüllt. Am Samstag habe ich es vergessen."),
                    (T, "Sechs von sieben ist viel. Was fällt Ihnen selbst auf, wenn Sie draufschauen?"),
                    (C, "Dass ich an den Tagen, an denen ich abends noch Mails gelesen habe, früher aufgewacht bin."),
                    (T, "An wie vielen Tagen war das?"),
                    (C, "An vier Tagen. An den anderen zwei habe ich nach acht nicht mehr reingeschaut und bis halb sechs geschlafen."),
                    (T, "Sie sagen, an den zwei Tagen ohne Mails haben Sie bis halb sechs geschlafen. Wie war das für Sie?"),
                    (C, "Ich war tagsüber weniger müde. Ich hatte im Meeting mehr Geduld mit meinem Kollegen Markus."),
                    (T, "Ich möchte Ihnen eine Abendroutine vorschlagen: ab zwanzig Uhr keine Arbeitsmails, und eine feste Zeit, zu der Sie das Licht ausmachen."),
                    (C, "Zwanzig Uhr ist schwierig, manchmal schreibt mein Teamleiter noch spät. Vielleicht einundzwanzig Uhr?"),
                    (T, "Einverstanden, einundzwanzig Uhr. Und das Licht?"),
                    (C, "Halb elf."),
                    (T, "Dann führen Sie das Tagebuch weiter und notieren zusätzlich, ob Sie die Mail-Grenze eingehalten haben."),
                    (C, "Mache ich. Nächste Woche wieder Donnerstag?"),
                    (T, "Ja, Donnerstag um neun."),
                ],
                "statements": [
                    ("homework_followup", "reported", "Die Klientin hat das Schlaftagebuch an sechs von sieben Tagen ausgefüllt.", [1]),
                    ("homework_followup", "reported", "Sie berichtet, an vier Tagen mit abendlichem Mail-Lesen früher aufgewacht zu sein; an zwei Tagen ohne Mails nach 20 Uhr habe sie bis 5:30 Uhr geschlafen.", [3, 5]),
                    ("current_situation", "reported", "Die Klientin berichtet, an den Tagen mit längerem Schlaf tagsüber weniger müde gewesen zu sein.", [7]),
                    ("topics", "reported", "Auswertung des Schlaftagebuchs.", [1, 3]),
                    ("topics", "reported", "Abendliche Erreichbarkeit für Arbeitsmails.", [9]),
                    ("interventions", "intervention", "Die Therapeutin schlägt eine Abendroutine vor (keine Arbeitsmails ab 20 Uhr, feste Licht-aus-Zeit); die Klientin schlägt 21 Uhr vor.", [8, 9]),
                    ("agreements", "agreement", "Keine Arbeitsmails ab 21 Uhr, Licht aus um 22:30 Uhr.", [10, 11]),
                    ("agreements", "agreement", "Schlaftagebuch weiterführen und Einhaltung der Mail-Grenze notieren.", [12]),
                    ("next_session", "plan", "Nächster Termin: Donnerstag, 9 Uhr.", [13, 14]),
                ],
                "therapist": {
                    "mental_status": "Keine Veränderung.",
                    "understanding": "Tagebuch stützt Zusammenhang zwischen abendlicher Mail-Nutzung und frühem Erwachen.",
                    "progress": "Hausaufgabe weitgehend erledigt (6 von 7 Tagen). Klientin gestaltet die Mail-Grenze aktiv mit; gute Mitarbeit.",
                    "crisis": "",
                    "notable": "",
                },
                "captures": [("action_item", 12, "Mail-Grenze 21 Uhr notieren")],
            },
            {
                "days_ago": 2,
                "hour": 9,
                "report": "draft",
                "type": "short_term",
                "lines": [
                    (T, "Guten Morgen. Wie ist es mit der Mail-Grenze gelaufen?"),
                    (C, "Besser als gedacht. Ich habe es an fünf Abenden geschafft. Am Dienstag hat Markus noch spät eine dringende Frage geschickt."),
                    (T, "Und was haben Sie am Dienstag gemacht?"),
                    (C, "Ich habe kurz geantwortet und dann das Handy in die Küche gelegt. Danach bin ich trotzdem um zwei aufgewacht."),
                    (T, "Wie oft sind Sie in dieser Woche insgesamt nachts aufgewacht?"),
                    (C, "Laut Tagebuch zweimal. Vorher war es fast jede Nacht."),
                    (T, "Sie haben vorhin den neuen Kunden erwähnt. Wie steht es mit dem Projekt?"),
                    (C, "Die Deadline wurde um zwei Wochen verschoben. Das hat etwas Druck rausgenommen."),
                    (T, "Ich möchte heute mit Ihnen eine kurze Übung zur Gedankenpause ausprobieren. Sie schreiben abends drei offene Punkte für den nächsten Tag auf einen Zettel und legen ihn weg."),
                    (C, "Also eine Art To-do-Liste für den Kopf?"),
                    (T, "Genau. Probieren wir das jetzt einmal mit dem, was morgen ansteht."),
                    (C, "Kundentermin um zehn, Präsentation fertig machen, Zahnarzt anrufen."),
                    (T, "Wie ist es, das so aufzuschreiben?"),
                    (C, "Irgendwie aufgeräumter. Ich probiere das diese Woche jeden Abend."),
                    (T, "Gut. Dann sehen wir uns in zwei Wochen, ich bin nächste Woche nicht in der Praxis."),
                    (C, "Okay, dann am vierundzwanzigsten."),
                ],
                "statements": [
                    ("homework_followup", "reported", "Die Klientin berichtet, die Mail-Grenze an fünf Abenden eingehalten zu haben.", [1]),
                    ("homework_followup", "reported", "Laut Schlaftagebuch sei sie in dieser Woche zweimal nachts aufgewacht, vorher fast jede Nacht.", [5]),
                    ("current_situation", "reported", "Die Projektdeadline wurde laut Klientin um zwei Wochen verschoben.", [7]),
                    ("current_situation", "reported", "Die Klientin wirkte durch die Verschiebung deutlich entlastet.", [7], "open"),
                    ("topics", "reported", "Umsetzung der Abendroutine.", [1, 3]),
                    ("topics", "reported", "Projektstand und Deadline.", [7]),
                    ("interventions", "intervention", "Die Therapeutin leitet eine Übung zur Gedankenpause an: abends drei offene Punkte auf einen Zettel schreiben und weglegen; die Übung wird in der Sitzung einmal durchgeführt.", [8, 10, 11]),
                    ("agreements", "agreement", "Die Klientin schreibt jeden Abend drei offene Punkte für den nächsten Tag auf.", [13]),
                    ("next_session", "plan", "Nächster Termin in zwei Wochen, am 24.", [14, 15], "open"),
                ],
                "therapist": {
                    "mental_status": "Keine Veränderung zum Vorbefund. Wach, orientiert, Konzentration ungestört.",
                    "understanding": "Ein- und Durchschlafstörung im Kontext beruflicher Belastung; aufrechterhaltend wirken abendliche Erreichbarkeit und Grübeln in Wachphasen. Arbeitshypothese: fehlende Abgrenzung zwischen Arbeit und Erholung.",
                    "progress": "Deutlicher Fortschritt: nächtliches Erwachen von nahezu täglich auf zweimal pro Woche reduziert. Hausaufgaben zuverlässig umgesetzt, Motivation hoch.",
                    "crisis": "",
                    "notable": "Therapeutin nächste Woche abwesend; nächster Termin in zwei Wochen.",
                },
                "captures": [("action_item", 8, "Gedankenpause: 3 Punkte abends aufschreiben"), ("date", 15, "24. – nächster Termin")],
            },
        ],
    },
    {
        "name": "Jonas Becker",
        "dob": "1986-11-02",
        "email": "j.becker@example.de",
        "phone": "+49 170 9876 5432",
        "lang": "de",
        "consents": ("recording", "ai_processing"),
        "hidden": ["Clara"],
        "sessions": [
            {
                "days_ago": 10,
                "hour": 14,
                "report": "approved",
                "type": "consultation",
                "lines": [
                    (T, "Herr Becker, willkommen. Was führt Sie zu mir?"),
                    (C, "Meine Hausärztin hat mir das empfohlen. Seit der Trennung von Clara im Sommer komme ich nicht richtig in den Alltag zurück."),
                    (T, "Was heißt für Sie, nicht in den Alltag zurückkommen?"),
                    (C, "Ich gehe nicht mehr zum Fußball, ich koche kaum noch. Nach der Arbeit liege ich meistens auf dem Sofa."),
                    (T, "Seit wann ist das so?"),
                    (C, "Seit ungefähr August. Also drei Monate."),
                    (T, "Gibt es Menschen, mit denen Sie gerade Kontakt haben?"),
                    (C, "Mein Bruder ruft jeden Sonntag an. Mit den Leuten vom Verein habe ich seit dem Sommer nicht mehr gesprochen."),
                    (T, "Ich erkläre Ihnen kurz, wie es weitergehen kann: Wir haben heute eine Sprechstunde, danach folgen bis zu vier probatorische Sitzungen, bevor wir eine Therapie beantragen."),
                    (C, "Okay. Muss ich dafür etwas bei der Krankenkasse machen?"),
                    (T, "Das übernehmen wir gemeinsam, ich gebe Ihnen das Formular PTV 11 mit."),
                    (C, "Danke."),
                    (T, "Bis zum nächsten Mal: Schreiben Sie bitte auf, welche Aktivitäten Ihnen früher wichtig waren."),
                    (C, "Mache ich. Wann sehen wir uns?"),
                    (T, "Nächsten Mittwoch um vierzehn Uhr."),
                ],
                "statements": [
                    ("current_situation", "reported", "Der Klient berichtet, seit der Trennung im Sommer (ca. drei Monate) nicht in den Alltag zurückzufinden.", [1, 5]),
                    ("current_situation", "reported", "Er gehe nicht mehr zum Fußball, koche kaum und liege nach der Arbeit meist auf dem Sofa.", [3]),
                    ("current_situation", "reported", "Kontakt bestehe zum Bruder (sonntägliche Anrufe), nicht mehr zum Verein.", [7]),
                    ("topics", "reported", "Anlass der Vorstellung (Empfehlung der Hausärztin).", [1]),
                    ("topics", "reported", "Veränderter Alltag seit der Trennung.", [3, 5]),
                    ("interventions", "intervention", "Die Therapeutin erläutert den Ablauf (Sprechstunde, bis zu vier probatorische Sitzungen, Antrag) und händigt das Formular PTV 11 aus.", [8, 10]),
                    ("agreements", "agreement", "Der Klient notiert Aktivitäten, die ihm früher wichtig waren.", [12, 13]),
                    ("next_session", "plan", "Nächster Termin: Mittwoch, 14 Uhr.", [14]),
                ],
                "therapist": {
                    "mental_status": "Bewusstseinsklar, orientiert. Stimmung gedrückt, Antrieb reduziert, Interessenverlust für Hobbys berichtet. Kein Anhalt für formale oder inhaltliche Denkstörungen.",
                    "understanding": "Belastungsreaktion nach Trennung mit sozialem Rückzug und Aktivitätsverlust; weitere Abklärung in der Probatorik.",
                    "progress": "Erstkontakt (Sprechstunde). Klient kommt auf Empfehlung der Hausärztin, Änderungsmotivation vorhanden.",
                    "crisis": "Suizidalität exploriert: Klient verneint aktuelle Suizidgedanken und -pläne, glaubhaft distanziert. Keine akuten Maßnahmen erforderlich.",
                    "notable": "PTV 11 ausgehändigt. Überweisung durch Hausärztin.",
                },
                "captures": [("term", 10, "PTV 11"), ("action_item", 12, "Liste früherer Aktivitäten")],
            },
            {
                "days_ago": 1,
                "hour": 14,
                "report": "draft",
                "type": "probatory",
                "lines": [
                    (T, "Hallo Herr Becker. Haben Sie die Liste mitgebracht?"),
                    (C, "Ja. Fußball, Kochen mit Freunden, Radfahren am Wochenende und Gitarre spielen."),
                    (T, "Welche davon könnten Sie sich vorstellen, in den nächsten zwei Wochen wieder aufzunehmen?"),
                    (C, "Radfahren vielleicht. Das kann ich allein machen."),
                    (T, "Wie könnte das konkret aussehen?"),
                    (C, "Samstagvormittag die Runde am Kanal, ungefähr eine Stunde."),
                    (T, "Sie hatten letzte Woche erzählt, dass Ihr Bruder sonntags anruft. Hat er das diese Woche auch?"),
                    (C, "Ja, und er hat gefragt, ob ich mal wieder zum Essen komme. Ich habe gesagt, ich überlege es mir."),
                    (T, "Ich schlage vor, dass wir mit einem Wochenplan arbeiten. Sie tragen für jeden Tag eine kleine Aktivität ein und haken ab, was geklappt hat."),
                    (C, "Okay. Und wenn ich es nicht schaffe?"),
                    (T, "Dann notieren Sie das einfach auch. Es geht ums Beobachten, nicht ums Bewerten."),
                    (C, "Gut. Und das Essen bei meinem Bruder trage ich für Sonntag ein."),
                    (T, "Dann sehen wir uns nächsten Mittwoch wieder um vierzehn Uhr."),
                ],
                "statements": [
                    ("homework_followup", "reported", "Der Klient hat eine Liste früherer Aktivitäten mitgebracht: Fußball, Kochen mit Freunden, Radfahren, Gitarre.", [1]),
                    ("current_situation", "reported", "Der Bruder habe angerufen und ihn zum Essen eingeladen; der Klient habe gesagt, er überlege es sich.", [7]),
                    ("topics", "reported", "Wiederaufnahme früherer Aktivitäten.", [1, 3]),
                    ("topics", "reported", "Kontakt zum Bruder.", [7]),
                    ("interventions", "intervention", "Die Therapeutin führt einen Wochenplan ein (eine Aktivität pro Tag, Abhaken des Erledigten) und betont das Beobachten statt Bewerten.", [8, 10]),
                    ("interventions", "intervention", "Der Klient war anfangs unkooperativ gegenüber dem Wochenplan.", [9], "open"),
                    ("agreements", "agreement", "Samstagvormittag ca. eine Stunde Radfahren am Kanal.", [5]),
                    ("agreements", "agreement", "Essen beim Bruder am Sonntag im Wochenplan eintragen.", [11]),
                    ("next_session", "plan", "Nächster Termin: Mittwoch, 14 Uhr.", [12]),
                ],
                "therapist": {
                    "mental_status": "Stimmung weiterhin gedrückt, Antrieb vermindert. Formales Denken geordnet, im Kontakt zugewandt.",
                    "understanding": "Verlust von Verstärkerquellen nach der Trennung; Rückzug hält die gedrückte Stimmung aufrecht (verhaltenstherapeutisches Modell). Aktivitätenaufbau als erster Ansatzpunkt.",
                    "progress": "Probatorik 1. Hausaufgabe erledigt. Anfängliche Zurückhaltung gegenüber dem Wochenplan, nach Erläuterung zugestimmt.",
                    "crisis": "Suizidalität erneut kurz erfragt: Klient verneint Suizidgedanken. Keine Maßnahmen erforderlich.",
                    "notable": "Konsiliarbericht der Hausärztin vor Antragstellung anfordern.",
                },
                "captures": [("action_item", 8, "Wochenplan führen")],
            },
        ],
    },
    {
        "name": "Sarah Mitchell",
        "dob": "1995-08-23",
        "email": "sarah.mitchell@example.com",
        "phone": "+49 160 5550 1234",
        "lang": "en",
        "consents": ("recording", "ai_processing", "product_improvement"),
        "hidden": ["Tom"],
        "sessions": [
            {
                "days_ago": 8,
                "hour": 11,
                "report": "approved",
                "type": "short_term",
                "lines": [
                    (T, "Hi Sarah, good to see you. How have the last two weeks been?"),
                    (C, "Busy. My German course started, and I had my first presentation at work in German."),
                    (T, "How did the presentation go?"),
                    (C, "I prepared a lot. I stumbled twice, but my manager said the content was clear."),
                    (T, "Last time we talked about writing down what you expect before a situation and what actually happened. Did you try that?"),
                    (C, "Yes, for the presentation. I wrote that people would laugh at my accent. Afterwards I wrote that nobody laughed and two colleagues asked questions."),
                    (T, "What do you notice when you put those two notes side by side?"),
                    (C, "That the prediction was much worse than what happened."),
                    (T, "Let's keep using that. I'll give you a two-column sheet: prediction on the left, outcome on the right."),
                    (C, "Okay. I have a call with a supplier next week, I can use it for that."),
                    (T, "Good. And you mentioned your partner Tom is travelling a lot at the moment?"),
                    (C, "Yes, he's in Hamburg until the end of the month. We talk every evening."),
                    (T, "Let's meet again in two weeks, same time."),
                ],
                "statements": [
                    ("homework_followup", "reported", "The client reports having written down her expectation before a work presentation and the actual outcome afterwards.", [5]),
                    ("current_situation", "reported", "The client reports that her German course has started and that she gave her first work presentation in German.", [1]),
                    ("current_situation", "reported", "She reports stumbling twice; her manager said the content was clear.", [3]),
                    ("topics", "reported", "First presentation at work in German.", [1, 3]),
                    ("topics", "reported", "Comparing predictions with outcomes.", [5, 7]),
                    ("interventions", "intervention", "The therapist asks the client to compare her prediction and the outcome side by side; the client says the prediction was much worse than what happened.", [6, 7]),
                    ("interventions", "intervention", "The therapist provides a two-column worksheet (prediction / outcome).", [8]),
                    ("agreements", "agreement", "The client will use the worksheet for a supplier call next week.", [9]),
                    ("next_session", "plan", "Next session in two weeks, same time.", [12]),
                ],
                "therapist": {
                    "mental_status": "No change.",
                    "understanding": "Anxiety in work situations in German, maintained by negative predictions about others' judgement; behavioural experiments planned.",
                    "progress": "Homework done; first prediction disconfirmed. Worksheet handed out.",
                    "crisis": "",
                    "notable": "",
                },
                "captures": [("action_item", 8, "Two-column sheet: prediction / outcome")],
            },
            {
                "days_ago": 0,
                "hour": 8,
                "report": "draft",
                "type": "short_term",
                "lines": [
                    (T, "Good morning Sarah. Did you get to use the worksheet?"),
                    (C, "Yes, twice. Once for the supplier call and once for a dinner with Tom's colleagues."),
                    (T, "What did you write for the supplier call?"),
                    (C, "Prediction: I won't understand them and they'll switch to English. Outcome: they spoke slowly, I understood almost everything."),
                    (T, "And the dinner?"),
                    (C, "I predicted I would sit there silently. In the end I talked a lot with one colleague about hiking."),
                    (T, "You've done this four times now. Is there a pattern you notice?"),
                    (C, "My predictions are always about people judging me. And it hasn't happened yet."),
                    (T, "I'd like to try a short role play. I'll be the supplier, and you open the next call in German."),
                    (C, "Okay. Guten Tag, hier ist Sarah Mitchell von der Firma Lindner."),
                    (T, "That was clear. What was it like?"),
                    (C, "Easier than I thought, because I had the first sentence ready."),
                    (T, "So for the next week: prepare your first sentence before calls."),
                    (C, "Yes. And keep the worksheet going."),
                ],
                "statements": [
                    ("homework_followup", "reported", "The client reports having used the worksheet twice: for a supplier call and for a dinner with her partner's colleagues.", [1]),
                    ("homework_followup", "reported", "For the supplier call she predicted not understanding them; she reports having understood almost everything.", [3]),
                    ("homework_followup", "reported", "For the dinner she predicted staying silent; she reports a long conversation about hiking with one colleague.", [5]),
                    ("topics", "reported", "Patterns in the client's predictions.", [7]),
                    ("topics", "reported", "Preparing work calls in German.", [8, 11]),
                    ("interventions", "intervention", "The therapist conducts a role play in which the client opens a supplier call in German; the client says having the first sentence ready made it easier.", [8, 9, 11]),
                    ("interventions", "reported", "The client seemed more confident than in previous sessions.", [11], "open"),
                    ("agreements", "agreement", "The client prepares her first sentence before calls and continues the worksheet.", [12, 13]),
                ],
                "therapist": {
                    "mental_status": "No change.",
                    "understanding": "Social-evaluative anxiety when using a second language at work; predictions of negative judgement maintain anticipatory worry. Behavioural experiments consistently disconfirm the predictions.",
                    "progress": "Good progress: four prediction/outcome records completed, all disconfirming. Client now uses the worksheet on her own initiative.",
                    "crisis": "",
                    "notable": "Partner working away until the end of the month.",
                },
                "captures": [("action_item", 12, "Prepare first sentence before calls")],
            },
        ],
    },
    {
        "name": "Mehmet Yılmaz",
        "dob": "1978-02-09",
        "email": "m.yilmaz@example.de",
        "phone": "+49 176 1122 3344",
        "lang": "de",
        "consents": ("recording", "ai_processing"),
        "hidden": [],
        "sessions": [],
    },
    {
        "name": "Anna Schulz",
        "dob": "2001-06-30",
        "email": "anna.schulz@example.de",
        "phone": None,
        "lang": "de",
        # Missing ai_processing: shows the "not ready to record" state.
        "consents": ("recording",),
        "hidden": [],
        "sessions": [],
    },
]


# --- helpers ------------------------------------------------------------------------------


def uuid7(at: datetime) -> uuid.UUID:
    ms = int(at.timestamp() * 1000)
    rand = int.from_bytes(secrets.token_bytes(10), "big")
    value = (ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((rand >> 62) & 0xFFF) << 64
    value |= 0b10 << 62
    value |= rand & ((1 << 62) - 1)
    return uuid.UUID(int=value)


def timed_segments(lines: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """Speech at ~14 characters per second, with short pauses between turns."""
    out, at = [], 2_000
    for speaker, line in lines:
        length = max(1_500, len(line) * 70)
        out.append({"speaker": speaker, "start_ms": at, "end_ms": at + length, "text": line})
        at += length + 900
    return out


def statement(item: tuple[Any, ...], segments: list[dict[str, Any]], approved: bool) -> dict[str, Any]:
    field, kind, body, lines = item[:4]
    is_open = len(item) > 4 and item[4] == "open" and not approved
    return {
        "id": uuid.uuid4().hex[:12],
        "text": body,
        "kind": kind,
        "refs": [[segments[i]["start_ms"], segments[i]["end_ms"]] for i in lines],
        "notes": [],
        "support": "partly" if is_open else "supported",
        "ai_wording": wording_hits(body) if is_open else [],
        "third_party_name": False,
        "origin": "ai",
        "resolved": approved,
    }


def report_content(spec: dict[str, Any], segments: list[dict[str, Any]], approved: bool, no: int):
    content = default_content()
    content["header"]["session_type"] = spec["type"]
    content["header"]["session_no"] = str(no) if approved else None
    for item in spec["statements"]:
        if item[4:5] == ("open",) and approved:
            continue
        field = content["ai"][item[0]]
        field["status"] = "content"
        field["statements"].append(statement(item, segments, approved))
    for code, value in spec["therapist"].items():
        content["therapist"][code] = value
    return content


# --- seeding ------------------------------------------------------------------------------


def main(email: str) -> None:
    settings = get_settings()
    if settings.app_env not in ("dev", "test"):
        sys.exit(f"refusing to seed in APP_ENV={settings.app_env}")

    from app.db.session import get_engine

    engine = get_engine()
    with engine.connect() as conn:
        user_id = conn.execute(
            text("SELECT auth_user_id_by_email(:e)"), {"e": email.strip().lower()}
        ).scalar_one_or_none()
    if user_id is None:
        sys.exit("no account with that email")

    now = datetime.now(UTC)
    counts = dict.fromkeys(("clients", "sessions", "transcripts", "reports", "captures"), 0)

    with user_session(user_id) as db:
        if db.scalar(select(Client.id).where(Client.user_id == user_id).limit(1)):
            sys.exit("account already has clients; not seeding twice")
        latest: dict[tuple[str, str], ConsentText] = {}
        for t in db.scalars(select(ConsentText)):
            key = (t.kind, t.language)
            if key not in latest or t.version > latest[key].version:
                latest[key] = t
        worker_rows: list[Any] = []  # tables only the worker role may insert into
        display_name = db.scalar(text("SELECT display_name FROM users WHERE id = :u"), {"u": user_id})

        for spec in CLIENTS:
            client_id = uuid.uuid4()
            identity = {
                "name": spec["name"],
                "date_of_birth": spec["dob"],
                "email": spec["email"],
                "phone": spec["phone"],
            }
            first_day = spec["sessions"][0]["days_ago"] if spec["sessions"] else 5
            db.add(
                Client(
                    id=client_id,
                    user_id=user_id,
                    identity_enc=encrypt_json(identity, f"client:{client_id}:identity"),
                    preferred_language=spec["lang"],
                    hidden_names_enc=encrypt_json(
                        {"names": spec["hidden"]}, f"client:{client_id}:hidden-names"
                    )
                    if spec["hidden"]
                    else None,
                    created_at=now - timedelta(days=first_day + 3),
                )
            )
            db.flush()
            counts["clients"] += 1

            for kind in spec["consents"]:
                consent_text = latest.get((kind, spec["lang"]))
                if consent_text is None:
                    sys.exit(f"consent text missing: {kind}/{spec['lang']}")
                consent_id = uuid.uuid4()
                db.add(
                    Consent(
                        id=consent_id,
                        client_id=client_id,
                        kind=kind,
                        consent_text_id=consent_text.id,
                        method="tablet_signature",
                        signature_enc=encrypt_bytes(
                            SIGNATURE.encode(), f"consent:{consent_id}:signature"
                        ),
                        granted_at=now - timedelta(days=first_day + 3),
                    )
                )
            db.flush()

            for no, s in enumerate(spec["sessions"], start=1):
                started = (now - timedelta(days=s["days_ago"])).replace(
                    hour=s["hour"], minute=0, second=0, microsecond=0
                )
                if started > now:
                    started -= timedelta(hours=3)
                segments = timed_segments(s["lines"])
                duration = segments[-1]["end_ms"] + 3_000
                session_id = uuid7(started)
                approved = s["report"] == "approved"
                names = NameList(
                    client=[spec["name"]],
                    therapist=[display_name] if display_name else [],
                    others=spec["hidden"],
                )
                db.add(
                    Session(
                        id=session_id,
                        client_id=client_id,
                        user_id=user_id,
                        started_at=started,
                        ended_at=started + timedelta(milliseconds=duration),
                        status="transcribed",
                        audio_state="shredded",
                        total_chunks=-(-duration // 10_000),
                        duration_ms=duration,
                        retention_deadline=started + timedelta(days=30),
                        mime_type="audio/webm;codecs=opus",
                        llm_names_enc=encrypt_json(names.to_json(), names_aad(session_id)),
                    )
                )
                db.flush()
                worker_rows.append(
                    Transcript(
                        session_id=session_id,
                        segments_enc=encrypt_json(
                            {"segments": segments}, f"transcript:{session_id}:segments"
                        ),
                        speaker_roles={"therapist": T},
                        language=spec["lang"],
                        stt_model="chirp_3",
                        refine_status="done",
                        created_at=started + timedelta(milliseconds=duration + 20_000),
                    )
                )
                counts["sessions"] += 1
                counts["transcripts"] += 1

                for kind, line, body in s["captures"]:
                    at_ms = segments[line]["start_ms"]
                    capture_id = uuid.uuid4()
                    db.add(
                        Capture(
                            id=capture_id,
                            session_id=session_id,
                            kind=kind,
                            key=f"{kind}:{at_ms}",
                            at_ms=at_ms,
                            payload_enc=encrypt_json({"text": body}, f"capture:{capture_id}:payload"),
                            status="confirmed",
                        )
                    )
                    counts["captures"] += 1

                report_id = uuid.uuid4()
                drafted_at = started + timedelta(milliseconds=duration, minutes=2)
                draft_content = report_content(s, segments, approved=False, no=no)
                content = report_content(s, segments, approved, no) if approved else draft_content
                approved_at = drafted_at + timedelta(hours=5) if approved else None
                db.add(
                    Report(
                        id=report_id,
                        session_id=session_id,
                        template_code=TEMPLATE_CODE,
                        template_version=TEMPLATE_VERSION,
                        status="approved" if approved else "draft",
                        draft_enc=encrypt_json(
                            {"fields": draft_content["ai"], "model": settings.llm_model},
                            report_aad(report_id, "draft"),
                        ),
                        content_enc=encrypt_json(content, report_aad(report_id, "content")),
                        llm_model=settings.llm_model,
                        prompt_version=PROMPT_VERSION,
                        created_at=drafted_at,
                        updated_at=approved_at or drafted_at,
                        approved_at=approved_at,
                        approved_by=user_id if approved else None,
                    )
                )
                db.flush()
                if approved:
                    snapshot = {
                        "content": content,
                        "template": {"code": TEMPLATE_CODE, "version": TEMPLATE_VERSION},
                        "ai_assisted": True,
                        "llm_model": settings.llm_model,
                        "prompt_version": PROMPT_VERSION,
                        "approved_at": approved_at.isoformat(),  # type: ignore[union-attr]
                        "approved_by": str(user_id),
                    }
                    db.add(
                        ReportVersion(
                            report_id=report_id,
                            version=1,
                            kind="approval",
                            content_enc=encrypt_json(snapshot, report_aad(report_id, "version:1")),
                            created_by=user_id,
                            created_at=approved_at,
                        )
                    )
                    db.add(
                        AuditLog(
                            actor_user_id=user_id,
                            action="report_approved",
                            entity="session",
                            entity_id=str(session_id),
                        )
                    )
                for kind, at in (("transcript_ready", 0), ("report_ready", 2)):
                    worker_rows.append(
                        Notification(
                            id=uuid.uuid4(),  # worker role cannot read rows back
                            user_id=user_id,
                            kind=kind,
                            session_id=session_id,
                            created_at=started + timedelta(milliseconds=duration, minutes=at),
                            read_at=approved_at,
                        )
                    )
                counts["reports"] += 1
                time.sleep(0.002)  # distinct uuid7 timestamps

        db.flush()
        db.execute(text("SET LOCAL ROLE sessio_worker"))
        db.add_all(worker_rows)
        db.flush()

    summary = " ".join(f"{k}={v}" for k, v in counts.items())
    print(f"seeded user_id={user_id} {summary}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: seed_demo.py <email>")
    main(sys.argv[1])
