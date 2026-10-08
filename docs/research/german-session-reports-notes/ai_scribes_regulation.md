# AI documentation assistants ("KI-Dokumentation", AI scribes) for psychotherapy in Germany/EU: products and regulation (as of Oct 2026)

Note on sources: most product information comes from vendors' own pages (marketing, self-reported). Regulatory dates for the AI Act "Digital Omnibus" come from law-firm and industry commentary, not the Official Journal text I read directly. Some items below say "from the Regulation text (not re-fetched)". Those come from my knowledge of Regulation (EU) 2024/1689 and the MDR. Check them against eur-lex before relying on them.

## 1. Which products exist for German therapists, and how do they produce notes?

### Takeaway
There is a crowded German/EU market of psychotherapy-specific KI-Dokumentation tools: EPIKUR/TINA, Psynex, Doculina, Clara Health, LumaNote, Sesam and VIA HealthTech (the user's own company), plus general-medicine scribes such as Noa Notes (jameda/Doctolib) and Tandem Health. Most of them follow the same pattern:
- record audio only with consent
- transcribe the audio, then have an LLM turn it into a template-based German Verlaufsprotokoll draft
- have the therapist review and approve ("Freigabe") the draft
- delete the audio after processing
- host in the EU or Germany and promise not to train on customer data

US tools (Mentalyc, Upheal) are mostly SOAP/DAP-oriented, and their EU hosting is unverified. Several names in the brief could not be verified as real products.

### Cited Findings
**German/EU psychotherapy-specific tools**
- **EPIKUR – KI module "TINA"** (inside an established German Praxissoftware, e-therapie ONLINE):
  - With patient consent, the therapist starts an audio recording in the Therapeuten-App, and TINA creates a transcript in the background.
  - It produces a draft protocol structured along therapeutic practice: Sitzungsverlauf, changes in the patient's life situation, Interventionen, Vereinbarungen, Ausblick.
  - The protocol is called a "Dokumentationsvorschlag", and the therapist makes the professional assessment and gives final approval.
  - A report assistant drafts PTV-3 applications and other reports from the stored documentation.
  - Transcripts are deleted after 30 days. The page does not say when audio is deleted.
  - EU servers, no passing of data to third parties for training, LLM provider not named.
  - Claimed saving: about 20 minutes per protocol. Free test until 31.10.2026.
  - Source: [EPIKUR KI](https://www.epikur.de/ki/)
- **EPIKUR app consent dialog:** the app asks for patient consent before every recording. The vendor notes that the dialog only documents that consent exists; the therapist must obtain the consent beforehand. — [EPIKUR FAQ](https://faq.epikur.de/en/hc/573349362/442/ki-gestutzte-dokumentation?category_id=90)
- **Psynex:**
  - Data stored only on German servers, AES-256 encryption.
  - Audio and transcripts follow an internal deletion concept, with periods not stated.
  - Outputs: Verlaufsdokumentation (themes, interventions, progress), **ICD-10 diagnosis suggestions** with source references, **Behandlungsplan**, Bericht an den Gutachter in KBV structure, KBV applications, symptom ratings, **suicidality screening**, and a context chat.
  - The AI output is a draft "die Sie nur noch prüfen und freigeben müssen".
  - No MDR or AI Act claims on the page.
  - Source: [Psynex](https://psynex.de/de/dokumentationssoftware-psychotherapie)
- **Doculina** (German):
  - Records in the browser or app. Audio is "nach der Verarbeitung automatisch gelöscht".
  - EU-certified servers. Documentation is stored pseudonymized by default, and there is no training on user data.
  - Templates for session types plus custom templates, with no SOAP mentioned. Protocols cover Erstgespräch, probatorische Sitzungen, regular sessions, and group, couple and family sessions.
  - "Prüfung und Freigabe durch die Therapeut:in".
  - Provides consent wording templates. LLM and subprocessors not named. No MDR statement.
  - Sources: [Doculina FAQ](https://www.doculina.de/faq), [Doculina Dokumentation](https://www.doculina.de/dokumentation)
- **Clara Health** (Adjuva AI GmbH, Hamburg; BMWE-funded):
  - Data stored locally on the device, with AI processing on "C5-zertifizierter Infrastruktur in der EU".
  - Audio is deleted immediately after successful processing, or kept up to 48 hours for a retry if processing fails.
  - Live session recording, dictated memory notes, or uploaded files.
  - Selectable or custom templates with adjustable detail level. The output serves as the basis for the Verlaufsdokumentation, with export to Word, PDF or clipboard.
  - The therapist must review and can mark a note "validiert". Suggestions for the patient profile are transferred only after review.
  - Provides a consent template generator. No MDR claim.
  - Sources: [Clara Health](https://clarahealth.de/ki-dokumentation-psychotherapie); speaker separation and support for VT/TP/AP/Systemische Therapie per [search snippet of same site](https://clarahealth.de/ki-dokumentation-psychotherapie)
- **LumaNote:** claims up to 60% less documentation time, hosting in Germany (vendor claim, not fetched in detail) — [LumaNote](https://lumanote.de/)
- **Sesam:** servers in Frankfurt, ISO-27001 data centres, Arztbriefe for insurers and referrers generated from session data (vendor claim, not fetched in detail) — [Sesam](https://www.meinsesam.de/)
- **VIA HealthTech** (via-health.de, the user's own product): advertises a BSI C5 certificate, and therapists can add their own observations by tablet handwriting or dictation. The company also publishes a blog post on a qualitative study at the Medizinische Hochschule Brandenburg (Jan–Jul 2025) on how practitioners perceive AI documentation (vendor-published, not independent). — [VIA Dokumentation](https://www.via-health.de/dokumentation), [VIA study post](https://www.via-health.de/blog-post-study)

**General-medicine scribes active in Germany**
- **Noa Notes** (jameda GmbH, i.e. the Doctolib group):
  - Audio is "nach der Transkription automatisch und unwiderruflich gelöscht".
  - Servers in Frankfurt am Main, TLS 1.2, ISO 27001, no training on documentation.
  - Markets a psychotherapy use case and integrates with Doctolib and T2med.
  - Its own blog recommends, for psychotherapy, informing the patient before the session, a documented deletion concept, and written consent ("auch wenn laut KBV eine mündliche Zustimmung ausreichen kann", a secondary claim about a KBV position that I could not trace to a KBV primary source).
  - Sources: [Noa Schweigepflicht](https://noa.ai/de/praxiswissen/blog/aerztliche-schweigepflicht), [Noa Psychotherapie](https://noa.ai/de/praxiswissen/blog/ki-dokumentation-fuer-psychotherapeuten), [Noa Notes jameda listing](https://abrechnungsstelle.com/dienstleister/noa/)
- **Tandem Health** (Swedish):
  - Runs entirely on Microsoft Azure in the EU, primary region Sweden Central. All customer and patient data, including backups, stays within the Azure EU data boundary.
  - Lists ISO 27001 and ISO 13485 certifications.
  - Covers medicine, mental health, nursing and other fields, so it is a general platform.
  - Has published content on GDPR and therapy recording for European therapists, including §203 StGB and the point that legitimate interest is not a basis for special-category data.
  - Raised $100M.
  - Sources: [Tandem TOMs](https://tandemhealth.ai/legal/technical-and-organisational-measures), [Tandem therapy article](https://tandemhealth.ai/resources/knowledge/ai-documentation-therapy-european-practitioners), [Tandem GDPR recording](https://tandemhealth.ai/resources/knowledge/gdpr-therapy-session-recording-what-therapists-must-know), [MobiHealthNews](https://www.mobihealthnews.com/news/tandem-health-raises-100m-expand-clinical-ai-across-europe)
- **Nabla** (Paris/New York): data regions US, EU, UK and CA. A third-party comparison describes it as a general-medicine ambient scribe that is less suited to talk-therapy workflows. — [comparetherapyscribe](https://comparetherapyscribe.com/vs/nabla-copilot-vs-mentalyc)

**US therapy-specific tools**
- **Upheal:**
  - A full EHR with AI built in.
  - Claims HIPAA, PHIPA, PIPEDA, GDPR and DPA compliance plus SOC 2 Type II.
  - Session audio is deleted after the note by default, and users can choose to keep it.
  - Hosting location for EU users not found.
  - Source: [Upheal vs Mentalyc](https://www.upheal.io/comparisons/upheal-vs-mentalyc)
- **Mentalyc:**
  - Therapy-specific, with 100+ therapy templates (SOAP, DAP and similar).
  - The sources conflict on GDPR/EU hosting. One comparison rates its GDPR posture "Partial" with regions US and CA, while another says it has US/EU hosting options.
  - Sources: [comparetherapyscribe](https://comparetherapyscribe.com/vs/nabla-copilot-vs-mentalyc), [trytwofold](https://www.trytwofold.com/compare/heidi-vs-mentalyc), [Mentalyc blog](https://www.mentalyc.com/blog/upheal-vs-mentalyc)

**Names that could not be verified**
- No therapy AI product called "Psyntax", "Wovenly" or "Psyfiers" was found.
  - Similar names exist. **Psyntel** (Atlanta): SOAP/DAP notes, ICD-10 suggestions, chat interface, no session recording. **Psynth**: AI drafts of psychological reports.
  - Sources: [Hypepotamus on Psyntel](https://www.hypepotamus.com/atlanta-therapists-ai-psyntel/), [Psynth](https://psynth.ai/articles/ai-for-psychology)

**Austrian comparator**
- Theradocx and Curala target Austria. Under §44 PThG 2024, audio and video recordings need prior **written** consent there. — [Theradocx](https://www.theradocx.at/blog/dokumentationspflicht-psychotherapie-oesterreich-pthg-2024), [Curala](https://www.curala.at/blog/ki-in-der-psychotherapie-erlaubt)

### Inferences
- The de-facto German market standard covers six features:
  1. consent captured before recording
  2. audio deleted right after transcription (or within 48 hours)
  3. transcripts kept for a limited time (EPIKUR: 30 days)
  4. EU or German hosting, often C5 or ISO 27001
  5. no training on customer data
  6. explicit "Entwurf → Prüfung → Freigabe" by the therapist

  A new entrant would need all six to be credible.
- German tools structure output around a German Verlaufsdokumentation (Themen, Interventionen, Vereinbarungen, Ausblick) and the KBV/PTV workflow (Bericht an den Gutachter, PTV 3), not SOAP/DAP. SOAP/DAP is a US-market convention. The BPtK documentation recommendations (2020) are the reference structure — [BPtK Empfehlungen Dokumentation](https://www.ptk-bayern.de/ptk/web.nsf/gfx/med_fdih-bypb6c_ad283/$file/Empfehlungen-der-BPtK-fuer-die-Dokumentation-psychotherapeutischer-Behandlungen-in-der-psychotherapeutischen-Versorgung.pdf).
- Psynex's ICD-10 suggestions, Behandlungsplan and suicidality screening go beyond "administrative KI" as the BPtK defines it. Under MDR Rule 11 they plausibly turn the software into a medical device (see section 3). Psynex makes no MDR claim. This is the competitor feature set to avoid copying without a regulatory strategy.
- Review enforcement is mostly UI-based: a draft status and an approve/"validiert" button. No vendor described technical enforcement, such as blocking export until reviewed.

### Gaps
- LLM provider and subprocessors are not disclosed by EPIKUR, Psynex, Doculina or Clara on the pages read.
- I did not verify Medidok, Avelios, doq, Brainloop or Doctorflow. Medidok and Avelios are known German health-IT/KIS vendors, and Brainloop is a German secure-data-room company. None appeared in searches as psychotherapy AI scribes. Doctorflow returned no results.
- No independent quality evaluation of German-language psychotherapy notes was found. Only a medRxiv simulation study on psychiatric consultations appeared: [medRxiv](https://www.medrxiv.org/content/10.1101/2025.09.21.25336260.full.pdf).
- Pricing was not found.

## 2. EU AI Act: risk class, Art. 50, Art. 4, timelines

### Takeaway
A session-note scribe that only transcribes and summarizes is **not high-risk** under the AI Act. It is not on the Annex III list, and it falls under Art. 6(1) only if it is itself an MDR medical device that needs a notified body.

The Digital Omnibus on AI pushed:
- Annex III high-risk obligations to **2 Dec 2027**
- Annex I (medical-device AI) to **2 Aug 2028**

Art. 50 transparency has applied since 2 Aug 2026, and the AI-literacy duty (Art. 4) was softened but kept.

### Cited Findings
- **Omnibus timeline:**
  - Provisional political agreement on 6 May 2026, confirmed by Council representatives on 13 May. Annex III deferred from 2 Aug 2026 to **2 Dec 2027**. Annex I (AI in regulated products, including medical devices) deferred from 2 Aug 2027 to **2 Aug 2028**.
  - Art. 50 transparency proceeds from **2 Aug 2026**. Systems placed on the market before then get until 2 Dec 2026 for the Art. 50(2) marking/watermarking duty.
  - Source: [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **Omnibus publication:** reported as published in the OJ on 24 July 2026 as Regulation (EU) 2026/1744, in force 27 July 2026 — [Pure Global](https://www.pureglobal.com/news/eu-ai-act-omnibus-high-risk-dates-2028). **Uncertain:** single industry source, and I did not verify it against eur-lex. See also [Sidley](https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/) and [Legalithm tracker](https://www.legalithm.com/en/blog/ai-act-medical-devices-deadlines-omnibus-tracker).
- **Art. 4 AI literacy:** softened. Providers and deployers must now *support* AI-literacy development among staff, rather than ensure a specific level — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **"Safety component" narrowed:** AI used solely for user assistance, performance optimisation, efficiency, automation, convenience or quality control is not high-risk merely because it is embedded in a regulated product, unless a malfunction would endanger health or safety. The Commission can also limit AI Act requirements where sectoral law such as the MDR already imposes equivalent obligations. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **Art. 6(1) test:** an AI system is high-risk if (i) it is a safety component of a product, or is itself a product, covered by Annex I legislation, **and** (ii) that product needs third-party conformity assessment. MDR/IVDR obligations are not postponed, and AI Act QMS duties can be met through the MDR QMS. — [Pure Global](https://www.pureglobal.com/news/eu-ai-act-omnibus-high-risk-dates-2028)
- **BPtK reading of the AI Act:**
  - In health care, AI is high-risk where it is (part of) a medical device of at least class IIa, for example when it gives therapists information or assessments to support diagnosis or treatment. The manufacturer's intended purpose is decisive.
  - Psychotherapists must build KI-Kompetenz: inform all staff working with the system about how it works, its benefits, risks and typical errors, based on the manufacturer's instructions for use.
  - Where AI interacts directly with third parties (e.g. a scheduling chatbot), its use must be disclosed.
  - The PDF text extraction was partial. The BPtK text still names 2 Aug 2026 for deployer duties, which the Omnibus has since changed.
  - Source: [BPtK Praxis-Info Administrative KI](https://api.bptk.de/uploads/bptk_praxisinfo_Administrative_KI_f7ee131776.pdf)
- **From the Regulation text (not re-fetched):**
  - Annex III's health-related entries cover public-benefit/healthcare eligibility, emergency triage, and insurance risk pricing. They do not cover clinical documentation.
  - Annex III point 1(c) lists **emotion recognition systems** as high-risk, and Art. 50(3) requires deployers to inform people exposed to emotion recognition.
  - Art. 50(1) (informing people that they are interacting with an AI) is aimed at systems that interact directly with natural persons.
  - Source: [Regulation (EU) 2024/1689, eur-lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)

### Inferences
- A summarize-only Verlaufsnotiz scribe that the therapist reviews is likely "limited/minimal risk". The duties that apply in practice are Art. 4 AI literacy (deployer = practice; provider should supply training material and instructions) and voluntary transparency. Art. 50(1) is arguably not triggered, because the patient does not interact with the AI. Even so, GDPR transparency and consent still require telling the patient (section 5).
- Design guardrail: do **not** add voice-based affect or emotion inference (e.g. "patient sounded anxious" derived from prosody/biometrics). That risks Annex III 1(c) high-risk status and Art. 50(3) duties. Summarizing what was *said* is different from inferring emotion from biometric signals. This is my interpretation and should be checked with counsel.
- If the product ever adds diagnosis or therapy suggestions, it would become MDR class IIa+ (Rule 11), which requires a notified body, and so become high-risk under Art. 6(1) from 2 Aug 2028.

### Gaps
- I did not read the final Omnibus OJ text, so exact article wording and the number "2026/1744" are unverified.
- No AI Office or Commission guidance specific to ambient clinical scribes was found.

## 3. MDR: when does documentation software become a medical device?

### Takeaway
Under MDCG 2019-11 (Rev.1, June 2025), qualification depends on the manufacturer's **intended purpose**. Software that only stores, archives, communicates or does lossless search, or that serves administrative purposes, is not a medical device. Software that acts on data for the benefit of individual patients, such as diagnosis, prognosis or treatment suggestions, is one. Under MDR Rule 11 such software is usually at least class IIa, which needs a notified body.

No EU guidance explicitly classifies summarizing scribes. The safe position is "documentation of what the clinician said and did, reviewed by the clinician, with no diagnostic or therapeutic suggestions".

### Cited Findings
- **MDCG 2019-11:**
  - The guidance decides qualification and classification. Rev.1 was published June 2025.
  - Qualification "hang[s] almost entirely on your intended purpose".
  - Software performing only storage, archival, communication or simple search is generally not MDSW. Hospital administration and scheduling software are examples outside the definition.
  - Sources: [MDCG 2019-11 (EC PDF)](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=md_mdcg_2019_11_guidance_qualification_classification_software_en.pdf), [OpenRegulatory summary](https://openregulatory.com/mdcg/mdcg-2019-11), [Greenlight Guru](https://www.greenlight.guru/blog/mdcg-2019-11)
- **Other regulators and reviews:**
  - Pure transcription tools are "unlikely to be considered medical devices". Summarization and decision support are the grey zone.
  - Reported regulator positions:
    - Australia (TGA): transcription-only scribes are outside the device framework, but a scribe generating a diagnosis or recommendation the clinician did not state is inside it.
    - UK (MHRA): a summarizing scribe for clinician review is not a device, with clinician review as the key mechanism.
    - NHS England: summarizing scribes need regulatory scrutiny.
  - **Secondary reporting, primary documents not verified.**
  - Sources: [npj Digital Medicine (in press)](https://www.nature.com/articles/s41746-026-02554-0_reference.pdf), [PMC review on scaling ambient scribes](https://pmc.ncbi.nlm.nih.gov/articles/PMC13172454/)
- **BPtK definition of "administrative KI":** AI used in practice organisation but **not** to support Diagnostik, Indikationsstellung or Behandlung. Examples: scheduling, billing, drafts of Anträge/Gutachten, **Transkripte von Audioaufnahmen**, **Dokumentation in der Patientenakte**. The BPtK notes the boundary is not always sharp, and that extra requirements apply if AI supports indication, diagnosis or treatment. — [BPtK Praxis-Info](https://api.bptk.de/uploads/bptk_praxisinfo_Administrative_KI_f7ee131776.pdf)
- **No vendor MDR claims:** none of the German psychotherapy scribes reviewed (EPIKUR, Psynex, Doculina, Clara) makes an MDR claim on its product page. — [EPIKUR](https://www.epikur.de/ki/), [Psynex](https://psynex.de/de/dokumentationssoftware-psychotherapie), [Doculina](https://www.doculina.de/faq), [Clara](https://clarahealth.de/ki-dokumentation-psychotherapie)
- **PTK NRW "Großer Ratschlag KI und Psychotherapie" (3 Dec 2025):**
  - Prof. Sigrid Lorz (medical law): diagnostics, indication and treatment planning cannot be delegated, and AI tools are currently "Neulandmethoden". Liability splits across the manufacturer (product defects), the operator (integration), and the therapist (e.g. adopting AI output unchecked).
  - Dr. Mareike Hillebrand: generative AI "sei kein Medizinprodukt und nicht auf therapeutische Sicherheit ausgelegt".
  - Stefan Lüttke: AI often misses crisis signals and hallucinates.
  - These are speakers' views, not formal Kammer guidance.
  - Source: [PTK NRW](https://www.ptk-nrw.de/aktuelles/meldungen/detail/rueckblick-auf-den-grossen-ratschlag-kuenstliche-intelligenz-ki-und-psychotherapie-am-3-dezember-2025)

### Inferences
- To stay outside the MDR, and therefore outside AI Act high-risk status, the intended purpose and feature set should be: transcribe, structure and summarize what was said and done in the session into the therapist's documentation template, as a draft the therapist must approve.
- Avoid:
  - ICD-10 or diagnosis suggestions
  - risk or suicidality scoring
  - treatment-plan or intervention recommendations
  - symptom severity ratings derived by the AI
  - flagging "red flags" as clinical alerts

  Psynex-style features belong to that category.
- Reproducing a diagnosis the therapist *stated* is documentation. Proposing one is decision support.
- Marketing copy matters, because the intended purpose is read from labelling, IFU and promotional material.

### Gaps
- No German BfArM statement on ambient scribes was found.
- I did not check whether any German psychotherapy scribe holds CE marking.

## 4. Professional bodies and authorities (BPtK, Landeskammern, KBV, DGPPN, BÄK, DSK/BfDI)

### Takeaway
The BPtK has published the most concrete German guidance, the **Praxis-Info "Administrative KI in Ihrer Praxis"** (Nr. 01, Digitale Agenda 2030, presented around the 48th DPT in May 2026). It allows administrative KI, including transcription and documentation, under strict conditions:
- persönliche Leistungserbringung
- critical review by the therapist
- written consent
- EU / adequacy / DPF processing
- an up-to-date C5-Testat for cloud services (§393 SGB V)

The BÄK has general AI statements (2025) stressing plausibility checks. No KBV, DGPPN or DSK statement specifically on psychotherapy scribes was found.

### Cited Findings
**BPtK Praxis-Info "Administrative KI in Ihrer Praxis"** ([PDF](https://api.bptk.de/uploads/bptk_praxisinfo_Administrative_KI_f7ee131776.pdf); text extracted only partially, some sentences fragmentary)
- Editorial by BPtK president Dr. Andrea Benecke. AI for diagnosis or treatment is explicitly out of scope, and a separate BPtK publication on that is in preparation.
- **Persönliche Leistungserbringung:**
  - Anamnese, Indikation and similar services must be performed personally by the therapist. "Entscheidend ist nicht die Zweckbestimmung der KI, sondern die tatsächliche Anwendung."
  - For personally owed services such as Gutachterverfahren applications, AI may only be used "unterstützend und ergänzend, also als Hilfsmittel"; "Die KI darf die eigentliche psychotherapeutische Leistung aber nicht übernehmen."
  - "Sie müssen in jedem Fall selbst das Ergebnis des KI-Systems kritisch prüfen und eigenverantwortlich entscheiden".
- **Data protection checklist:**
  - AVV (data processing agreement)
  - DSFA where needed (link to the BfDI Art. 35 list)
  - TOMs
  - deletion: "Prüfung, ob das KI-System gewährleistet, dass personenbezogene und Gesundheitsdaten, darunter auch Ton- und Bildaufnahmen, gelöscht werden können"
  - data minimisation, pseudonymisation or encryption
  - It refers to the DSK Orientierungshilfe KI (6 May 2024).
- **Consent:**
  - Provide privacy notices, ideally pointed out at first contact.
  - Obtain consent where required, preferably in writing.
  - "Bei einer KI, die [Gesundheitsdaten] verarbeitet, ist immer eine Einwilligung einzuholen" (reconstructed; the bracketed words were lost in extraction).
  - Consent does not relieve the therapist of continuously checking the system's data-protection conformity.
- **Servers:** with an external or cloud provider, patient data must be anonymised or encrypted to protect against the provider. Processing only in the EU/EEA or adequacy countries (e.g. UK, Switzerland, Japan, New Zealand). US transfers only if the recipient is certified under the EU-U.S. Data Privacy Framework.
- **C5-Testat** (§393 SGB V) for cloud services, current version. The BSI notes C5 is not a sole guarantee.

**BPtK / DPT context**
- **48th DPT (8–9 May 2026, Travemünde):** the Praxis-Info gives "operativ greifbare Beratung zur möglichen Integration administrativer KI in die Praxisabläufe". The BPtK added an AI module to its Curriculum Digitalisierung and is preparing Handlungsempfehlungen on AI in healthcare. None of the nine DPT resolutions addresses AI directly. — [BPtK 48. DPT](https://www.bptk.de/psychotherapeutentag/48-deutscher-psychotherapeutentag/)
- **47th DPT (Nov 2025, Berlin):** AI was a focal topic. Benecke said AI cannot replace psychotherapists and warned of deskilling, lack of traceability and uncritical use. VP Sabine Maur said the profession must set guardrails, from data protection to quality standards. — [BPtK Newsletter 4/2025](https://www.bptk.de/newsletter/4-2025/47-deutscher-psychotherapeutentag-fortschritte-und-herausforderungen-psychische-gesundheit-in-umbruchphasen-sichern/), [Psychotherapeutenjournal 4/2025](https://www.psychotherapeutenjournal.de/2025/4/Laender_Bundespsychotherapeutenkammer)
- **BPtK Dokumentationsempfehlungen (DPT, 14 Nov 2020):** sections cover administrative data, anamnesis, initial diagnostics, information/consent, treatment plan, course documentation (including session-based Verlaufsdokumentation for professional and liability purposes) and therapy end. They contain no AI content. — [BPtK Empfehlungen](https://www.ptk-bayern.de/ptk/web.nsf/gfx/med_fdih-bypb6c_ad283/$file/Empfehlungen-der-BPtK-fuer-die-Dokumentation-psychotherapeutischer-Behandlungen-in-der-psychotherapeutischen-Versorgung.pdf)
- **PTK NRW:** held an event on 3 Dec 2025 (see section 3), with no formal guidance. — [PTK NRW](https://www.ptk-nrw.de/aktuelles/meldungen/detail/rueckblick-auf-den-grossen-ratschlag-kuenstliche-intelligenz-ki-und-psychotherapie-am-3-dezember-2025)

**Bundesärztekammer**
- Statement "Künstliche Intelligenz in der Medizin" by the Wissenschaftlicher Beirat, adopted by the Vorstand on 14 Jan 2025. It complements the ZEKO 2021 statement on AI decision support. — [BÄK KI in der Medizin](https://bundesaerztekammer.de/fileadmin/user_upload/wissenschaftlicher-beirat/Veroeffentlichungen/KI_in_der_Medizin_SN.pdf)
- Brochure "Von ärztlicher Kunst mit Künstlicher Intelligenz" (27 May 2025): AI can relieve physicians of repetitive tasks and free time for patient contact. — [BÄK brochure](https://www.bundesaerztekammer.de/fileadmin/user_upload/BAEK/Politik/Programme-Positionen/Von_aerztlicher_Kunst_mit_Kuenstlicher_Intelligenz_27.05.2025.pdf)
- The BÄK, like the Ethikrat, calls for AI outputs always to undergo a plausibility check (per search summary; I did not read the PDF in full). — [BÄK KI in der Medizin](https://bundesaerztekammer.de/fileadmin/user_upload/wissenschaftlicher-beirat/Veroeffentlichungen/KI_in_der_Medizin_SN.pdf)

**DSK (data protection conference)**
- Orientierungshilfe "Künstliche Intelligenz und Datenschutz" v1.0 (6 May 2024): a checklist for controllers selecting and using LLM applications. Controllers must check, among other things, whether the AI was trained lawfully. It is not legally binding.
- A June 2025 DSK guidance follows on the development and operation of AI systems, aimed at developers and manufacturers.
- Sources: [DSK press release](https://datenschutzkonferenz-online.de/media/pm/2024_05_06_DSK_PM_OH_KI_und_Datenschutz.pdf), [Noerr](https://www.noerr.com/de/insights/ki-und-datenschutz-orientierungshilfe-der-dsk-konferenz), [Lausen](https://lausen.com/datenschutz-und-ki-dsk-veroeffentlicht-orientierungshilfe/), [GvW July 2025](https://www.gvw.com/aktuelles/blog/detail/datenschutz-trifft-ki-neue-dsk-orientierungshilfe-konkretisiert-anforderungen)

### Inferences
- The BPtK Praxis-Info is the anchor document for German psychotherapists, and products are being judged against it. Its checklist maps almost one-to-one onto product requirements:
  - consent workflow, with written consent recommended
  - deletability of audio
  - AVV
  - support for a DSFA
  - EU hosting
  - C5-Testat
  - encryption against the cloud provider
  - human review and "persönliche Leistungserbringung" framing
- The BPtK frames KI documentation as *administrative KI*. That supports positioning a scribe as non-medical-device documentation support, as long as it stays out of diagnosis and treatment.

### Gaps
- No exact publication date for the Praxis-Info was found. It was presented as already published at the 48th DPT in May 2026, and since it still cites 2 Aug 2026 it likely predates the Omnibus.
- No KBV statement on AI scribes was found. The claim that "KBV says oral consent can suffice" appears only in a vendor blog (Noa) and is unverified.
- No DGPPN statement specific to documentation scribes was found.
- I did not search individual Landeskammer Praxisinfos beyond NRW (e.g. Bayern, Berlin, BW).
- No BfDI or Landesdatenschutz statement specific to ambient scribes was found.

## 5. GDPR/DSGVO, §203 StGB, data location, US providers, Gemini/Vertex AI

### Takeaway
Session audio and notes are Art. 9 health data and subject to professional secrecy (§203 StGB). In practice German guidance requires:
- **explicit, informed, prior consent** for the AI processing and recording (BPtK: always for KI processing health data, written recommended)
- an AVV
- a DSFA (large-scale or new-technology processing of health data)
- EU/EEA or adequacy-country processing, or DPF-certified US recipients
- a deletion concept for audio
- no training on customer data
- a C5 attestation for cloud components (§393 SGB V)

Google Vertex AI contractually does not train on customer data. Zero data retention requires specific configuration, including an abuse-monitoring exception, disabling caching, and avoiding Search grounding.

### Cited Findings
- **BPtK on consent, DPF, encryption and C5:** consent always for KI processing health data, written recommended; DPF for US transfers; encryption or anonymisation against the cloud provider; C5 attestation. — [BPtK Praxis-Info](https://api.bptk.de/uploads/bptk_praxisinfo_Administrative_KI_f7ee131776.pdf)
- **Tandem on legal basis:** legitimate interest is not available for special-category health data, so therapists should rely on explicit consent. Germany's §203 StGB adds secrecy obligations affecting how session data may be processed. — [Tandem Health](https://tandemhealth.ai/resources/knowledge/ai-documentation-therapy-european-practitioners)
- **Consent requirements as summarized by vendor and practitioner blogs (secondary sources):**
  - before the first recording, not afterwards
  - informed about purpose, place, type of processing and deletion period; a blanket clause in the treatment contract is usually insufficient
  - voluntary, with treatment not conditional on it, and revocable
  - Four conditions for lawful use: EU processing; an AVV binding the vendor and its model providers; no training; prior informed consent.
  - Sources: [wysor.io](https://wysor.io/de/blog/ki-psychotherapie-datenschutz), [Noa](https://noa.ai/de/praxiswissen/blog/ki-dokumentation-fuer-psychotherapeuten)
- **Google Vertex AI (Gemini):**
  - "Google won't use your data to train or fine-tune any AI/ML models without your prior permission or instruction."
  - Gemini caches data in memory for 24 hours by default. The cache is project-isolated and can be disabled.
  - Google "may log prompts to detect potential abuse". Customers can request an abuse-monitoring exception for zero data retention.
  - Request-response logging is off by default.
  - Grounding with Google Search keeps data for 3 days and cannot be disabled.
  - Caching "adheres to all Data Residency requirements for the selected location". Data residency and ML-processing location are documented on a separate page, which I did not fetch.
  - Source: [Vertex AI data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- **Vendor practice:** Clara and EPIKUR claim EU/C5 infrastructure. Noa, Psynex and Sesam claim German (Frankfurt) hosting. Tandem uses the Azure EU Data Boundary. — sources in section 1.

### Inferences
- If the product uses Gemini on Vertex AI, it should:
  - use an EU region (e.g. europe-west3 Frankfurt), not global endpoints
  - request the abuse-monitoring logging exception
  - disable in-memory caching or document it in the DSFA
  - avoid Google Search grounding
  - list Google as a subprocessor in the AVV
- Google Cloud participates in the EU-U.S. DPF and offers SCCs. Still, §203 StGB and the BPtK "encrypt against the provider" expectation push toward pseudonymising transcripts before LLM calls. This is my inference and should be verified against the Google Cloud DPA and the C5 attestation scope.
- Note the tension between the BPtK expectation that data with an external provider be "zwingend zu anonymisieren oder zu verschlüsseln" (protected against the provider) and any LLM processing, which needs plaintext at inference time. This should be addressed explicitly in the DSFA, for example through confidential computing, pseudonymisation, or the §203(3)/(4) StGB "mitwirkende Personen" route with contractual secrecy obligations. **Uncertain legal point; needs counsel.**

### Gaps
- I did not fetch Google's Vertex AI data-residency page for the exact EU ML-processing guarantees per Gemini model.
- I did not check whether Google Cloud holds a current C5 attestation covering Vertex AI generative services. Google publishes C5 reports, but the scope was not verified.
- I did not read the DSK Orientierungshilfe primary text on legal bases or §203. The content above comes from secondary summaries.
- The KBV position on oral vs. written consent is unverified.
