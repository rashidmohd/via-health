# Best Practices and Evidence for AI-Drafted Psychotherapy Session Notes from Transcripts

Scope: design guidance for a feature that drafts a psychotherapy session note (German output) from a diarized transcript plus the therapist's own notes, which the therapist edits and signs. Researched 2026-10-08. Many sources were only reachable as search snippets or secondary summaries (several primary pages, including apa.org and england.nhs.uk, returned empty on fetch). Where that applies, it is flagged.

## 1. Evidence on quality of ambient AI scribes (2023-2026), and mental health specifically

### Takeaway
Across general medicine, well-engineered LLM scribes show low but non-zero error rates. The best primary data is roughly 1.5% hallucinated sentences and 3.5% omitted transcript facts, and a large share of hallucinations are clinically "major" and cluster in the Assessment/Plan sections. Omissions are more frequent than hallucinations. Psychotherapy-specific evidence is very thin: no peer-reviewed study was found that measures AI psychotherapy progress-note accuracy against session transcripts. Psychiatry evidence consists of simulation pilots, one primary-care cohort, and a registered trial with no results yet.

### Cited Findings
**General ambient-scribe quality**
- Asgari et al., npj Digital Medicine 2025 (8:274), studied GPT-4 on 450 notes and 12,999 clinician-annotated sentences. The hallucination rate was 1.47% (191 sentences), and 44% of those were "major" (could change diagnosis or management). The omission rate was 3.45% of transcript sentences (1,712/49,590), and 16.7% of those were major. — [Asgari et al., PMC12075489](https://pmc.ncbi.nlm.nih.gov/articles/PMC12075489/)
- Asgari taxonomy of hallucination subtypes: fabrication 43%, negation (contradicts what was said) 30%, contextual (mixes in unrelated topics) 17%, causality (unsupported speculation on cause) 10%. Major hallucinations were most common in Plan (21%), Assessment (10.5%) and Symptoms (5.2%). Negation errors in the plan were judged most concerning. — [Asgari et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12075489/)
- In Asgari, structured prompting plus an explicit "unknown" status for missing information cut major hallucinations from 4 to 1 and major omissions from 24 to 10 (Exp. 3 to 8). JSON/function-call structured output with iterative refinement cut major omissions from 61 to 0 (Exp. 6 to 11). Chain-of-thought "atomisation" (fact extraction first) increased errors: major hallucinations rose from 4 to 25 and major omissions from 24 to 47. The authors say the work was developed with the scribe vendor TORTUS. — [Asgari et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12075489/); [search summary noting TORTUS link](https://event.x-on.co.uk/hubfs/AVT/A%20framework%20to%20assess%20clinical%20safty%20and%20hallucination%20rates%20of%20LLMs%20for%20medical%20text%20summarisation_digital.pdf?hsLang=en)
- Kaiser Permanente (Tierney et al., NEJM Catalyst 2024;5(3), DOI 10.1056/cat.23.0404) covered 3,442 physicians and 303,266 encounters in 10 weeks. It reported "high-quality clinical documentation for physicians' editing" but documented hallucinations. In one, a prostate exam that had only been *discussed for scheduling* was recorded as performed. In another, a discussion of "hands, feet and mouth" was turned into a diagnosis of hand-foot-and-mouth disease. The authors stress ongoing attention to accuracy. — [KP Division of Research](https://divisionofresearch.kaiserpermanente.org/publications/ambient-artificial-intelligence-scribes-to-alleviate-the-burden-of-clinical-documentation/); [AMA summary](https://www.ama-assn.org/practice-management/digital/ai-scribe-saves-doctors-hour-keyboard-every-day)
- KP follow-up: "Ambient AI Scribes: Learnings after 1 Year and over 2.5 Million Uses," NEJM Catalyst, 31 Mar 2025 (DOI 10.1056/CAT.25.0040). Only seen cited secondarily, so its content is unverified. — [KP Division of Research](https://divisionofresearch.kaiserpermanente.org/blog/publications/ambient-artificial-intelligence-scribes-to-alleviate-the-burden-of-clinical-documentation/)
- PDQI-9 comparison, 97 outpatient encounters across 5 specialties. Physician-written ("gold") notes scored slightly higher overall (4.25 vs 4.20/5, p=0.04) and higher on accuracy (p=0.05), succinctness (p<0.001) and internal consistency (p=0.004). AI notes scored higher on thoroughness (p<0.001). — [Frontiers in AI 2025](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1691499/full); [PMC12586549](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12586549/)
- A simulated-encounter evaluation of five ambulatory scribe platforms (14 scripted encounters) classified errors as omission, commission or partially correct. Rates were not visible in the snippet. — [ScienceDirect 2025](https://www.sciencedirect.com/science/article/pii/S2949761225000999)
- Interpreter errors propagated into notes in 55% (vendor A) and 60% (vendor B) of 20 seeded errors, and omissions propagated most (67%, 78%). The scribe faithfully reproduces upstream ASR/diarization or interpretation errors. — [PMC13412140](https://pmc.ncbi.nlm.nih.gov/articles/PMC13412140/)
- Narrative review of 18 studies (2025): current systems "still generate high omission rates and intermittent factual inaccuracies," and the evidence is limited by small cohorts and heterogeneous methods. — [PubMed 41815573](https://pubmed.ncbi.nlm.nih.gov/41815573/)
- Preprint (Research Square) comparing an AI scribe with handwritten notes: hallucination frequency was similar, but the AI's were mostly minor while the handwritten notes' were more often clinically meaningful. Omissions dominated the handwritten notes. Not peer reviewed. — [Research Square rs-9139641](https://www.researchsquare.com/article/rs-9139641/v1)
- 2026 arXiv preprint "LLM Judges Verify Presence, Not Absence: Omission Blindness in AI Clinical Notes." Its title claim is that LLM-as-judge evaluators miss omissions. Content not fetched. — [arXiv 2608.31016](https://arxiv.org/pdf/2608.31016)

**Mental health / psychiatry**
- No peer-reviewed study was found that directly measures LLM-generated psychotherapy progress-note accuracy against session transcripts (consistent with search results across multiple queries). — [search results incl. Sci Rep 2025](https://www.nature.com/articles/s41598-025-14923-y)
- Psychiatric consultation simulation pilot (medRxiv 2025): crossover design with 8 clinicians, measuring NASA-TLX workload, letter quality (Sheffield instrument) and screen time. Pilot only. — [medRxiv 2025.09.21.25336260](https://www.medrxiv.org/content/10.1101/2025.09.21.25336260v1.full)
- Frontiers in Psychiatry 2026 qualitative follow-up: the structured AI output captured management plans and formulation that clinicians often leave out. It cites roughly 1-3% error rates, with fabrications, omissions and contextual misreadings as failure modes. — [Frontiers in Psychiatry 2026](https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2026.1821065/full)
- Primary-care matched cohort: AI-scribed notes recorded more neuropsychiatric symptoms but were less likely to document a depression intervention. A JAMA Psychiatry letter frames this as "measurement bias," meaning the scribe changes *what* gets documented. — [PMC12824846](https://pmc.ncbi.nlm.nih.gov/articles/PMC12824846/); [JAMA Psychiatry](https://jamanetwork.com/journals/jamapsychiatry/article-abstract/2848624)
- Registered trial NCT07777224 ("AI Ambient Scribe in Psychiatry") uses blinded PDQI-9 raters and records whether raters can guess AI use. No results yet. — [ClinicalTrials.gov](https://clinicaltrials.gov/study/NCT07777224)
- LLM rewriting of psychiatrists' notes into patient-centered language (pre-post qualitative study): "critical errors remain prevalent" and affect understanding of patient circumstances, medication clarity and interpretation of clinical observations. — [PubMed 42054574](https://pubmed.ncbi.nlm.nih.gov/42054574/)
- Practitioner commentary (KevinMD 2026): AI therapy notes are often "technically accurate yet narratively hollow." This is opinion, not data. — [KevinMD](https://kevinmd.com/2026/03/the-hidden-risks-of-ai-generated-progress-notes-in-psychotherapy.html)

### Inferences
- The pattern most relevant to psychotherapy is that errors concentrate in interpretive sections (Assessment/Plan). The model invents clinical judgments or contradicts what was said. Psychotherapy notes are mostly interpretive (process, formulation, interventions), so risk is likely *higher* than in the medical scribe numbers. Design should push the model toward descriptive content and leave interpretation to the therapist.
- PDQI-9 (9 items: up-to-date, accurate, thorough, useful, organized, comprehensible, succinct, synthesized, internally consistent) is the de facto quality metric. A psychotherapy-adapted version plus Asgari-style sentence-level hallucination/omission labeling is a reasonable evaluation plan.
- Omissions are hard for both humans and LLM judges to see. Evaluation should include transcript-to-note coverage checks, not only note-to-transcript verification.

### Gaps
- No German-language or psychotherapy-specific note-accuracy study was found.
- Primary full texts were not fetched for KP 2025, the omission-blindness preprint, or the 5-platform simulation (so the rates are missing).

## 2. Known failure modes and mitigations

### Takeaway
The documented failure modes are fabrication, negation, causality speculation, contextual mixing, omissions, propagation of transcription/diarization errors, mis-attribution in multi-person sessions, stigmatizing language, and documentation bias. The mitigations with evidence are structured per-section output with an explicit "unknown / not discussed" state, iterative prompt evaluation against a labeled set, and mandatory clinician review. Mitigations without direct trial evidence, but widely used, are grounding to transcript spans, an "unverified" UI, and edit tracking.

### Cited Findings
- Hallucination subtypes and severity (fabrication, negation, causality, contextual), and that an "unknown" status reduces errors. — [Asgari et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12075489/)
- Example of tense/status error (discussed treated as done) and term-to-diagnosis leap (KP). — [AMA](https://www.ama-assn.org/practice-management/digital/ai-scribe-saves-doctors-hour-keyboard-every-day)
- Upstream errors propagate: 55-60% of interpreter errors carried into notes. — [PMC13412140](https://pmc.ncbi.nlm.nih.gov/articles/PMC13412140/)
- Vendor-reported failure modes in therapy notes: content "that wasn't mentioned," and in couples or family sessions "AI may confuse who said what." Vendor source. — [Supanote blog](https://www.supanote.ai/blog/accuracy-of-ai-generated-therapy-notes)
- Stigmatizing language: across 66,297 paired note sections, 21.4% of AI draft sections had at least one stigmatizing-language mention, versus 24.0% after clinician finalization. Clinicians *added* more than they removed. This is a preprint using a lexicon-based method. — [arXiv 2606.00019](https://arxiv.org/pdf/2606.00019)
- A single stigmatizing sentence in a note skewed decisions by all 9 frontier LLMs tested, with a dose-response effect. Relevant if notes are later fed to AI (e.g., next-session context). Preprint. — [arXiv 2605.17228](https://arxiv.org/pdf/2605.17228)
- LLMs can *detect* stigmatizing language, and giving examples improves accuracy, but performance depends heavily on settings and prompts. — [GMU news 2026](https://publichealth.gmu.edu/news/2026-07/can-ai-help-make-medical-records-less-biased-new-study-suggests-yes-caveats)
- Scribes shift *what* is documented (more symptoms, fewer interventions). — [PMC12824846](https://pmc.ncbi.nlm.nih.gov/articles/PMC12824846/)
- US clinic policy template: AI scribes are allowed with consent and clinician review. AI must never be the sole basis for diagnosis or suicide/violence risk assessment. — [NovoPsych policy template](https://novopsych.com/novonote-security/ai-policy-for-clinics-usa/)

### Inferences
Recommended mitigations for this feature, mapped to the failure modes:
- **Fabrication / negation:** Every generated statement carries source references (transcript segment IDs/timestamps, or "therapist note"). Statements without a source are flagged in the UI. Post-generation, a verification pass (second LLM call or NLI check) labels each sentence supported/unsupported. Treat the absence of evidence as "nicht besprochen," never as a negative finding (e.g., do not write "keine Suizidalität" unless it was explicitly assessed).
- **Status/tense errors:** Prompt the model to distinguish *discussed / planned / done*, and *client-reported* vs *therapist-observed*.
- **Speaker attribution:** Feed diarized labels (Therapeut/Klient, plus additional persons). Attribute statements explicitly ("Klientin berichtet ..."). Show low diarization confidence. Never attribute a therapist's hypothesis or reflection to the client as a fact.
- **Overstated interpretation:** By default, do not generate diagnoses, ICD codes, risk ratings or psychodynamic formulations unless the therapist stated them or wrote them in their notes. Reserve "Einschätzung/Beurteilung" for therapist input, and if it is drafted, mark it "Vorschlag."
- **Omissions:** Use per-section extraction with a checklist (e.g., risk topics, homework, medication, appointments). Show a "possibly relevant, not included" sidebar. Evaluate coverage explicitly.
- **Stigmatizing language:** Instruct neutral, behavior-descriptive, person-first language. Run a lexicon or LLM check that highlights terms (e.g., "verweigert," "nicht compliant," "manipulativ," "behauptet"). Apply the check to the *clinician's edits too*, since the evidence shows clinicians add such terms.
- **Third-party information:** Minimize names and details of third parties (partners, family, colleagues). Use roles ("Partner," "Mutter") rather than names unless clinically necessary. This also supports §630g BGB's "Rechte Dritter" limitation (see section 6).
- **Mandatory review:** The note cannot be signed until reviewed. Retain AI draft vs final diff (edit tracking), which also yields evaluation data.

### Gaps
- No controlled evidence was found that click-to-source or confidence highlighting reduces errors that slip through review. It is plausible but unproven.
- No evidence on automation-bias rates in therapist review of AI notes.

## 3. Professional guidance (APA, NHS England, AMA, German chambers) and consent

### Takeaway
All bodies converge on the same principles. The clinician remains fully responsible for the note. Clients must be informed (and in practice consent) before AI and recording are used. Opt-out without disadvantage is expected. Organizations must do DPIAs, safety cases and monitoring. In Germany, the BPtK classes AI documentation as "administrative KI," and the Berlin chamber considers it professionally unproblematic as a support tool, but a formal BPtK Handreichung was still being drafted as of late 2025. Recording requires prior consent.

### Cited Findings
**APA (USA)**
- APA published "Ethical Guidance for AI in the Professional Practice of Health Service Psychology" in June 2025. Its themes are transparency/informed consent with clients, bias mitigation, data privacy, validation of tools, human oversight, and liability awareness. Only secondary summaries were accessible. — [Videra Health summary](https://viderahealth.com/2025/07/03/apa-ai-ethical-guidance-clinician-perspective/); [Infocop (COP Spain)](https://www.infocop.es/el-uso-etico-de-la-ia-en-la-psicologia-directrices-de-la-apa/)
- A secondary summary says disclosure should cover the type of AI tools, their effect on treatment, data flows, third-party vendors and cost implications. Consent belongs at the start of the relationship, not buried in a policy. Unverified against the APA text. — [rawveg blog](https://tiny.write.as/rawveg/the-machine-is-listening-disclosure-and-consent-in-modern-therapy)

**NHS England / MHRA (UK)**
- NHS England, "Guidance on the use of AI-enabled ambient scribing products in health and care settings" (April 2025), covers business case, risk assessment, governance, the clinical safety officer, DCB0160 safety case, DPIA, and evaluation/monitoring. It warns that LLM products may add functions unintentionally. — [NHS England publication page](https://www.england.nhs.uk/publication/guidance-on-the-use-of-ai-enabled-ambient-scribing-products/); [HTN](https://htn.co.uk/2025/04/28/ambient-voice-technology-guidance-launched-by-nhse-to-support-adoption/)
- The original 2025 guidance said transcription-only tools are likely not medical devices, while generative summarisation likely is (MHRA Class I). A June 2025 NHSE priority notification (secondary report) said not to use non-compliant AVT, and that liability sits with the deploying organisation or clinician. — [MedCity News](https://medcitynews.com/2025/09/rush-to-regulation-what-new-nhs-compliance-requirements-for-ambient-voice-technology-mean-for-us-providers/); [Heidi Health blog](https://www.heidihealth.com/uk/blog/nhs-guidance-on-ai-scribes)
- MHRA, 29 July 2026: AVT intended solely for transcription, summarisation, drafting letters or suggesting codes *for clinician review* is not regulated as a medical device. Products that support diagnosis/treatment, or act automatically without clinician review, are regulated. — [GOV.UK MHRA press release](https://www.gov.uk/government/news/mhra-clarifies-regulatory-status-of-ambient-voice-technologies-used-in-the-nhs)
- A version 2 of the NHSE guidance (April 2026) and an IG guidance with template DPIA (March 2026) were reported by a blog but not verified. — [iatroX blog](https://www.iatrox.com/blog/ambient-voice-technology-nhs-safety-consent-governance)

**AMA (USA)**
- AMA coverage of the KP rollout presents AI scribes as saving about an hour of keyboard time per day while requiring physician review. AMA's formal AI principles (2023, "augmented intelligence," transparency, physician liability) were not fetched in this session. — [AMA](https://www.ama-assn.org/practice-management/digital/ai-scribe-saves-doctors-hour-keyboard-every-day)

**Germany**
- BPtK Praxisinformation "Administrative KI" classes AI-assisted documentation and report writing as administrative use. Secondary source (vendor blog). — [VIA Health blog on BPtK](https://www.via-health.de/ki-in-der-psychotherapiepraxis-was-die-bptk-sagt)
- The Psychotherapeutenkammer Berlin classes session transcripts as administrative tasks and considers them professionally unproblematic as long as they accompany therapy and do not replace it. Secondary report. The primary PDF could not be text-extracted. — [PTK Berlin "Einsatz von KI in der ambulanten Psychotherapie"](https://www.psychotherapeutenkammer-berlin.de/media/2889)
- 47th Deutscher Psychotherapeutentag (Nov 2025) named unclear data flows, possible breaches of Schweigepflicht and insufficiently tested algorithms as real risks. The BPtK is drafting a Handreichung on AI in psychotherapy, and no final version was found. — [Psychotherapeutenjournal 4/2025, BPtK-Mitteilungen](https://www.psychotherapeutenjournal.de/2025/4/Laender_Bundespsychotherapeutenkammer)
- The Musterberufsordnung requires documentation in temporal connection with treatment, recording essential measures and results. It is tool-agnostic. Participants must be informed and consent before recording. — [Doculina FAQ](https://www.doculina.de/faq); [DPtV "Wie dokumentiere ich richtig?" 2022](https://www.dptv.de/fileadmin/Redaktion/Bilder_und_Dokumente/Wissensdatenbank_oeffentlich/Psychotherapie_Aktuell/2022/Dokumentation_aus_Psychotherapie_Aktuell_2.2022.pdf)
- Austrian/DACH vendor perspective on what is allowed in 2026 (secondary). — [Curala](https://www.curala.at/blog/ki-in-der-psychotherapie-erlaubt)

### Inferences
- For Germany, the legal anchors are (from statute knowledge, not fetched here; verify):
  - §201 StGB: recording the non-public spoken word without consent is a criminal offence, so explicit prior consent from every speaker is required.
  - §203 StGB: Schweigepflicht. Vendors must be bound as "mitwirkende Personen."
  - Art. 9 DSGVO: health data needs explicit consent or another Art. 9(2) basis.
  - Art. 28 DSGVO: AV-Vertrag with vendor and subprocessors.
  - Art. 35 DSGVO: DPIA, practically mandatory for audio of therapy sessions.
  - §630f BGB: corrections must keep the original content recognizable, which supports versioned edits after signing.
- Consent UX should be per-client, recorded, revocable, with a no-AI path that does not disadvantage the client (mirrors APA/NHS expectations). Consent should cover every person in the room (couples, family, group).
- A vendor (VIA) claims an exemption under Art. 50(4) EU AI Act when therapists review AI content. Art. 50(4) concerns disclosure of AI-generated text published to inform the public, so its relevance to clinical notes is doubtful. Have counsel review. Also note that the MHRA position (no device when clinician-reviewed and no diagnostic suggestion) parallels the likely MDR line in the EU. A draft that proposes diagnoses or risk levels moves toward device territory.

### Gaps
- The APA primary text and the NHSE page body could not be fetched, so exact wording is unverified.
- Final BPtK Handreichung status in 2026 is unknown. Check bptk.de.
- AMA 2023/2024 AI principles were not directly retrieved.

## 4. Prompting / LLM design patterns

### Takeaway
The strongest evidence (Asgari) favors structured, per-section output (JSON/function calling) with an explicit "unknown / not mentioned" value, measured iteratively against a clinician-labeled baseline. Naive chain-of-thought fact extraction made things worse in that study. Other patterns (neutral language, clinician voice, length control, German output) are best practice without direct trial evidence.

### Cited Findings
- Structured JSON output and an "unknown" status reduced major hallucinations and omissions, while CoT atomisation increased them. Iterate changes against a baseline and quantify clinical impact per error type. — [Asgari et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12075489/)
- AI notes are more thorough but less succinct than physician notes (PDQI-9), so length control matters. — [Frontiers in AI 2025](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1691499/full)
- Few-shot examples of stigmatizing language improve LLM detection. — [GMU 2026](https://publichealth.gmu.edu/news/2026-07/can-ai-help-make-medical-records-less-biased-new-study-suggests-yes-caveats)
- Berlin chamber: keyword-style (stichwortartig) documentation suffices if it is understandable to professionals. This supports concise output. — [Ärztekammer/PTK Berlin material via search](https://www.psychotherapeutenkammer-berlin.de/media/1098)

### Inferences
- **Schema:** configurable template per therapy type (VT, TP, AP, systemic), with sections such as Anlass/Themen, Berichtete Inhalte, Beobachtungen (psychopathologischer Befund only if observed/stated), Interventionen, Hausaufgaben/Vereinbarungen, Risikoeinschätzung (only if explicitly addressed), Plan nächste Sitzung. Each field is a list of statements `{text, source_refs[], speaker, kind: reported|observed|intervention|plan, confidence}` or `status: "nicht besprochen"`.
- **Inputs precedence:** therapist notes are higher authority than the transcript. When the two conflict, surface the conflict and do not resolve it silently.
- **Minimum necessary:** instruct "dokumentiere nur, was für Behandlung, Nachvollziehbarkeit und Abrechnung erforderlich ist." Do not include verbatim intimate details, third-party names, or details of crimes by or against others unless clinically required. Prefer paraphrase over long quotes, and allow short quotes with timestamps.
- **Language:** generate directly in German, with professional neutral register (Indikativ for observations, Konjunktiv/"berichtet" for client reports). Avoid diagnosing adjectives. Keep German clinical terminology (e.g., ICD-10-GM labels only when given by the therapist).
- **Clinician voice:** offer per-therapist style settings (length, bullet vs prose, first person "ich" vs passive). Few-shot with the therapist's own past signed notes is possible only with consent and data-protection review.
- **Length control:** target word budgets per section, and default to concise.
- **Evaluation:** build a German gold set (synthetic/role-play sessions to avoid real patient data). Label sentence-level hallucination (Asgari subtypes) and omissions with severity. Score PDQI-9 adapted for psychotherapy. Track edit distance and the categories of edits in production. Do not rely solely on an LLM judge for omissions (omission blindness).

### Gaps
- No published evidence on prompt patterns specifically for German-language psychotherapy notes.
- No comparison of extractive vs abstractive note generation in therapy was found.

## 5. UX patterns from leading products

### Takeaway
Leading products (Abridge "Linked Evidence," DAX, Nabla, therapy scribes) converge on a draft labeled as AI, linked back to source evidence in the transcript, reviewed and signed by the clinician inside the record. Audio is often discarded after note generation. Public, verifiable product documentation is sparse, and most claims are vendor marketing.

### Cited Findings
- Abridge provides "Linked Evidence" and provenance tracking so clinicians can verify where AI-generated output came from, with clinician-in-the-loop review inside Epic. Third-party directory, vendor claims. — [BERI Abridge profile](https://www.beri.net/tools/abridge); [agentsindex](https://agentsindex.ai/abridge)
- Common therapy workflow: record, AI drafts a SOAP/progress note, clinician reviews and signs. — [NovoPsych](https://novopsych.com/novonote-security/ai-policy-for-clinics-usa/)
- An advisory view (not a chamber requirement): audio is most sensitive and should be processed in real time and discarded immediately to avoid creating a stored record. — [secondary, via search summary; Curala](https://www.curala.at/blog/ki-in-der-psychotherapie-erlaubt)
- German vendors (VIA, Doculina, Psynex) market AI protocols from session recordings with therapist review. — [VIA Dokumentation](https://www.via-health.de/dokumentation); [Doculina](https://www.doculina.de/faq); [Psynex](https://psynex.de/de/dokumentationssoftware-psychotherapie)

### Inferences
Recommended UX:
- Persistent "KI-Entwurf – nicht geprüft" label until signature. The signed note records "erstellt mit KI-Unterstützung, geprüft von …" in metadata.
- Side-by-side view of draft and transcript. Clicking a sentence highlights its source segments, and clicking a transcript segment shows where it was used.
- Highlight unsupported, low-confidence or inferred statements, plus stigmatizing-language flags. Optionally require each flagged item to be accepted, edited or deleted before signing (friction against automation bias).
- "Nicht besprochen" placeholders that are visibly distinct, plus an "evtl. relevant, nicht übernommen" panel for omission review.
- Sign-off is the explicit legal act. After signing, edits create versions (§630f). Store the AI draft vs final diff for QA.
- Retention: delete audio after the transcript is verified (or immediately after drafting). Delete the transcript after signing, or at a configurable short retention. The signed note is the only Akte content. Show the retention status to the therapist.
- Per-session consent status visible before recording starts, with a one-click "ohne Aufnahme" fallback.

### Gaps
- No primary engineering blog content from Abridge/Nuance/Nabla was retrieved in this session.
- No usability study comparing click-to-source vs no-source review was found.

## 6. Privacy: minimizing content and client access rights

### Takeaway
In Germany, clients have a broad right to inspect their complete record, including the therapist's subjective impressions (§630g BGB and Art. 15 DSGVO). Refusal is allowed only for specific, serious therapeutic risks or significant third-party rights. AI-drafted notes should therefore be written as if the client will read them: minimal, neutral, descriptive, and sparing with third-party information.

### Cited Findings
- §630g BGB: access to the *complete* record on request, without delay, unless serious therapeutic reasons or significant rights of third parties stand against it. This includes subjective impressions and explicitly applies to psychiatric/psychotherapeutic records. — [Ärztekammer Berlin Merkblatt Einsichtsrechte](https://www.aekb.de/fileadmin/migration/pdf/25_Merkblatt_Einsichtsrechte_in_Patientenunterlagen.pdf)
- A serious therapeutic reason requires a *specific* risk (e.g., suicidality). A general worry that the client may misunderstand is insufficient. No justification is required from the client, copies are available, and about two weeks counts as "unverzüglich" per PTK Berlin. — [PTK Berlin](https://www.psychotherapeutenkammer-berlin.de/media/333); [transparent-beraten](https://www.transparent-beraten.de/ratgeber/patientenakte-recht-auf-einsicht/)
- A planned Berlin Berufsordnung revision would make personal notes (subjective impressions) generally disclosable. Status unconfirmed. — [PTK Berlin](https://www.psychotherapeutenkammer-berlin.de/media/727)
- Subjective impressions need not always be documented, but must be when the therapy is based on them. — [Ärztekammer Nordrhein, Rheinisches Ärzteblatt 2016](https://www.aekno.de/fileadmin/user_upload/RheinischesAerzteblatt/Ausgaben/2016/2016.03.020.pdf)
- Data-flow and confidentiality risks were named at the 47th DPT 2025. — [Psychotherapeutenjournal 4/2025](https://www.psychotherapeutenjournal.de/2025/4/Laender_Bundespsychotherapeutenkammer)

### Inferences
- Because the client can read the note and a transcript might count as part of the Akte if retained, keep raw transcripts out of the permanent record and delete them after signing. Otherwise they become inspectable and must be retained for 10 years (§630f(3) BGB). This is a strong argument for short transcript retention.
- Third parties: "erhebliche Rechte Dritter" can justify redaction, but it is better not to record identifiable third-party details at all. Default to roles, not names.
- Write neutral, respectful, non-pejorative German. It reduces harm when the client reads the note and aligns with the stigmatizing-language evidence.
- Note that a separate "persönliche Aufzeichnungen" area is not a safe harbor in Germany (subjective impressions are also disclosable). Do not design a "private AI notes" feature on the assumption it is exempt, unlike US HIPAA "psychotherapy notes."
- If the system offers suggested hypotheses or diagnoses, these become Akte content once signed. Keep suggestions out of the note unless the therapist actively adopts them.

### Gaps
- No German case law on transcripts or audio as part of the Patientenakte was retrieved.
- Art. 15 DSGVO vs §630g interplay and the current BGH/EuGH copy-right rulings were not fetched here (EuGH C-307/22, 2023, on free first copy, from background knowledge, unverified in this session).
