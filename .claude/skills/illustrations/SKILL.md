---
name: illustrations
description: Use when adding a spot illustration to a screen — empty states, first-run/onboarding, login, offline/error, 404, success/confirmation, upload/sync, report and consent steps, keys, settings. Maps each app moment to a matching SVG from the illustration library (../light, unDraw-based), and explains how to copy, recolour to the olive tokens and render it.
---

# Illustrations

The library lives **outside the repo** at `../light/` (next to `via-health/`): 386 unDraw SVGs,
already recoloured to a teal/cream palette. Never import from there directly — copy only the
files a screen uses into `apps/web/src/design/illustrations/` with the script below, which also
maps the colours to our olive tokens. Decision record: ADR 0015.

Licence: unDraw licence — free for commercial use, no attribution, may be modified; we may not
redistribute the set as an illustration pack. Only ship the files we use.

## Rules

1. **One illustration per view, never two.** It supports the one sentence + one action of the
   state; it is not decoration.
2. **Where they go:** full-page empty states (`.empty`), first-run/onboarding steps, login,
   full-page errors (offline, 404, no permission), and confirmation pages (report signed,
   consent saved, export ready).
3. **Where they never go:**
   - The **recording screen** — nothing that moves attention or CPU away from recording.
   - The **Today screen** — the avatar is its focal element; illustrations would compete. Empty
     cards on Today (`card-empty`) keep the lucide icon. One exception: the first-run setup card
     (`features/today/SetupCard.tsx`: `invite-only` for keys, `nice-to-meet-you` for the first
     client) — one step at a time, gone once setup is done.
   - Inside tables, list rows, cards smaller than ~320 px, dialogs, toasts, the sidebar.
4. **State, not content.** An illustration is chosen by app state only (empty, offline,
   signed…) — never by what was said in a session or about a client, same as the avatar
   (CLAUDE.md rules 11–12). No illustration may suggest a mood, diagnosis or assessment.
5. **AI pictures stay modest** (ADR 0008): the AI documents, it never advises. Use
   `ai-generated-document` / `thinking-mode` for drafting; never `ai-answers`, `genius`,
   `virtual-assistant`, `ask-me-anything`, `ai-slop` or anything showing the AI "answering".
6. **Decorative by default:** `alt=""` + `aria-hidden="true"`. The heading and sentence next to
   it carry the meaning, in German and English via i18n (memory: bilingual UI). If an
   illustration ever carries meaning on its own, give it a translated `alt`.
7. **Colour:** only via the script's palette map. Don't hand-edit hex. Olive is brand, not
   "success" — success is said in text, the picture just accompanies it.
8. **Size:** 160–220 px wide in `.empty`, max 280 px on onboarding/login/full-page errors.
   Hide under 480 px height or in very small containers rather than shrinking below 120 px.
9. **Weight:** most files are 5–25 kB. Avoid the heavy scenes (`team-collaboration` 54 kB,
   `holding-flowers`, `working-late`, `trip`, `bibliophile` ~35–40 kB) — they are also off-topic.

## Adding one

```sh
# from the repo root; names as listed below (suffixes like _teip (1) are stripped)
node .claude/skills/illustrations/scripts/add-illustration.mjs empty-mailbox connection-lost
# → apps/web/src/design/illustrations/empty-mailbox.svg, connection-lost.svg
# other library location: ILLUSTRATION_SRC=/path/to/light node …
```

The script cleans the name, strips `artist`/`source` attributes and recolours:

| Library | Token |
|---|---|
| `#0C4A4E` teal | olive-700 |
| `#062F32` dark teal | olive-800 |
| `#C9E0E1` teal tint | olive-100 |
| `#6E8462` green | olive-500 |
| `#E2D9C8` cream | sand |
| `#DAD2C3` cream dark | border |
| `#F7F4EE` paper | bg |
| `#0E1418` ink | charcoal |
| `#45474A` grey | text-muted |
| `#A8654A` rust | clay |

Skin tones, hair and greys (`#ffb6b6`, `#a0616a`, `#B9B0A0`, `#fff` …) are left as they are.
If a new library colour shows up, add it to `PALETTE` in the script — don't patch single files.

Render as a Vite asset with `<img>` (cached, no inline SVG in the bundle, CSP-safe):

```tsx
import emptyMailbox from '../../design/illustrations/empty-mailbox.svg'

<div className="empty">
  <img className="empty-illustration" src={emptyMailbox} alt="" aria-hidden="true" />
  <p>{t('notifications.empty')}</p>
  <button className="primary">…</button>
</div>
```

`.empty-illustration` (add to `design/base.css` with the first use) replaces `.empty-icon`:
`width: clamp(120px, 40%, 200px); height: auto;` and nothing else — no shadow, no frame.
When dark mode lands, swap the file per theme or move to inline SVG with `var(--…)` fills;
keep the palette map as the single source.

## Moment → illustration

First choice in **bold**; alternatives after it. Check a candidate visually before using it
(`qlmanage -t -s 400 -o /tmp/x ../light/<file>.svg` on macOS, or open it in the browser).

### Account and access
| Moment | Use |
|---|---|
| Login (email + code) | **authentication**, fingerprint, security-on |
| "Code sent, check your email" | **message-sent**, mailbox, letter, open-letter |
| First-run welcome | **hello**, nice-to-meet-you, starting-work |
| Onboarding: setting up | **setup**, adjust-settings, my-workspace |
| Onboarding done | **moving-forward**, finish-line, all-checked |
| Signed out | **goodbye** |
| No access / locked | **security-on**, invite-only |
| Session expired, sign in again | **authentication** |

### Clients and consent
| Moment | Use |
|---|---|
| No clients yet | **people**, join, add-files |
| Client search, no results | **people-search**, file-search |
| Client profile / personal data | **personal-information**, personal-info |
| Consent form | **contract**, forms, agreement |
| Consent signed / saved | **signed-document**, approve, confirm |
| Consent missing — recording blocked | **warnings**, upload-warning |
| Consent by email | **email-consent** |
| Consent withdrawn, audio deleted | **throw-away**, clean-up |

### Sessions and recording (never on the recording screen itself)
| Moment | Use |
|---|---|
| No sessions yet | **schedule**, booking, time-management |
| No sessions in the selected range | **out-of-office**, a-moment-to-relax |
| Before first recording: mic test intro | **voice-notes**, voice-interface, podcast |
| Microphone permission denied | **adjust-settings**, settings |
| Audio files / upload list empty | **audio-files** |
| Uploading after a session | **files-uploading**, uploading, upload |
| Offline — saved on this device | **connection-lost**, local-server |
| Upload complete | **uploading** (in use), action-successful, all-checked |
| Upload failed / storage full | **upload-warning**, warnings |
| Transcript processing | **thinking-mode**, file-analysis, process |
| Transcript ready | **reading-notes**, noted |

### Reports
| Moment | Use |
|---|---|
| No reports yet | **note-list**, my-files, articles |
| Report drafting (AI) | **ai-generated-document**, writing-down-ideas, taking-notes |
| Ready for review | **report**, annotations, body-text |
| Report signed | **signed-document**, approve, all-checked |
| All reports signed, nothing to review | **all-checked**, completed-tasks |
| Choose a template | **forms**, select-option, choose, fill-the-blanks |
| Export / download records | **export-files**, file-bundle |

### Keys, security, settings
| Moment | Use |
|---|---|
| Keys page / keys set up | **security-on**, fingerprint, certification |
| Recovery key check | **verify-data**, verified |
| Keys not set up (card on Today) | **invite-only** |
| No clients yet (setup card on Today) | **nice-to-meet-you** |
| Keys locked | **invite-only**, security-on |
| Settings overview | **settings**, adjust-settings, preferences-popup |
| Profile picture picker | **select-character**, character-drawing, polaroid, images |
| Account deletion / crypto-shred done | **throw-away**, schedule-cleanup |

### System
| Moment | Use |
|---|---|
| No notifications | **empty-mailbox**, notify, reminders |
| Unread notifications intro | **unread-messages** |
| Generic empty | **empty** |
| 404 / page not found | **lost**, finding-the-way, road-sign, directions |
| Something went wrong | **maintenance**, problem-solving |
| Coming soon / placeholder page | **work-in-progress**, build-mode |
| App update available (PWA) | **updated**, upgrade, progressive-web-app |
| Help / FAQ | **questions**, helpful-sign, question-answered |
| Feedback form | **user-feedback**, anonymous-feedback |
| Data loading (full page, rare — prefer skeletons) | **loading**, progress-indicator |

## Full index

Names as passed to the script. Use the groups to find alternatives.

**Documents & files** — add-file, add-files, ai-data-extraction, ai-generated-document,
annotations, articles, attached-file, body-text, contract, export-files, file-analysis,
file-bundle, file-manager, file-search, file-searching, files-missing, files-uploading, forms,
google-docs, markdown-file, my-files, note-list, noted, open-notes, report, saving-notes,
signed-document, spreadsheets, taking-notes, term-sheet, upload, uploading, verify-data,
throw-away, clean-up

**Writing & thinking** — diary, idea, ideation, ideas-flow, in-thought, key-insights,
key-points, lightbulb-moment, new-ideas, sorting-thoughts, thinking-mode, thought-process,
thoughts, writing-down-ideas, wandering-mind, got-an-idea, bright-ideas, deep-thinker-avatar,
plan-mode, master-plan, five-year-plan

**Tasks & progress** — accept-task, action-successful, all-checked, completed-tasks,
completing, confirm, approve, finish-line, goals, moving-forward, progress-indicator,
progress-overview, project-completed, puzzle-solved, result, successful, to-do-list,
work-in-progress, build-mode, scrum-board, organizing-projects, process, level-up, upgrade,
updated, verified, certification, home-run

**Time & schedule** — alarm-clock, booking, late-at-night, morning-plans, out-of-office,
reminders, schedule, schedule-cleanup, screen-time, time-management, work-time, waiting-for-you,
on-the-way

**Messages & communication** — casual-chat, comment-sent, conversation, email-consent,
empty-mailbox, letter, love-note, mailbox, message-sent, messaging-fun, newsletter-subscriber,
notify, open-letter, phone-call, quick-chat, respond, unread-messages, work-chat, just-saying,
my-answer, opinion, online-discussion, post-online

**Audio & voice** — audio-files, podcast, voice-interface, voice-notes

**Security & account** — authentication, fingerprint, invite, invite-only, personal-info,
personal-information, security-on, enter-payment-info, wallet, subscriptions, subscriber

**Settings & UI** — adjust-settings, control-panel, preferences-popup, select-option, choose,
decide, next-option, drag-to-add, fill-the-blanks, elements, information-tab, settings, setup,
select-character, character-drawing, professional-woman-avatar, images, polaroid,
image-comparison, add-color, designing-components, design-data, pen-tool

**System states** — connection-lost, empty, loading, local-server, lost, maintenance,
problem-solving, upload-warning, warnings, progressive-web-app, connected, online-everywhere,
code-deployed

**Navigation & search** — directions, finding-the-way, location-search, people-search,
road-sign, route-planning, destinations, right-places, discoverable, browsing

**People & greeting** — hello, goodbye, nice-to-meet-you, people, join, followers,
confident, positive-attitude, feeling-happy, happy, starting-work, helpful-sign, questions,
question-answered, user-feedback, anonymous-feedback, experts, legal-counsel, agreement,
business-deal

**Work settings** — deep-work, in-the-office, my-workspace, workspace, shared-workspace,
remote-worker, working-at-home, working-from-anywhere, work-from-anywhere, working-late,
multitasking, distractions, absorbed

**Calm & wellbeing** (use sparingly, never as a reaction to a session) — a-moment-to-relax,
meditation, mindfulness, relaxing-at-home, relaxed-reading, hot-cocoa, watering-plants,
blooming, gardening, tree-swing, walking, quiet-street, clouds

**Data & charts** (counts of work only, never scores about clients — rule 11) — analytics,
analyze, data-at-work, data-input, data-reports, pie-chart, statistic-chart, statistics,
visual-data, trends, segment-analysis, cohort-analysis, revenue-analysis, fitness-stats,
calculator

**Learning & reading** — book-lover, book-reading, books, bibliophile, continuous-learning,
education, exam-prep, grades, grading-papers, homework-research, learning, lecture, open-book,
reading, reading-book, reading-notes, reading-time, road-to-knowledge, sharing-knowledge,
teacher, newspaper, morning-news, online-media

**Teams & meetings** — collaborating, collaboration, conference-call, conference-speaker,
connecting-teams, content-team, design-team, founding-team, good-team, group-project,
meet-the-team, online-community, online-meeting, online-meetings, remote-meeting,
selecting-team, team-assignment, team-collaboration, team-spirit, teamwork,
working-together, video-call, public-speaking, business-call, business-decisions,
target-audience, share-results, sharing-ideas

## Do not use

Off-topic for a clinical documentation tool, or conflicting with the product rules:

- **AI that answers/advises or mocks AI:** ai-answers, ai-response, ai-slop, ask-me-anything,
  genius, virtual-assistant, mobile-assistant, coding-assistant, ai-code-generation
- **Security-scary:** data-thief, hacker-mindset
- **Money / sales:** make-it-rain, treasure, popular, stand-out, exciting-news, overly-proud,
  powerful, gravitas, job-hunt
- **Leisure, sport, seasons, holidays:** air-support, autumn, barbecue, barista, beach-day,
  biking, departing, eating-together, everyday-life, fall, farming, getting-coffee, golf,
  group-hangout, hiking, holding-flowers, hot-air-balloon, in-the-pool, indoor-bike,
  light-the-fire, outdoors, pancakes, petting, playful-cat, playing-golf, pumpkin,
  remote-cabin, scooter, skateboard, skateboarding, surfer, trip, walk-in-the-city,
  walking-the-dog, heavy-lifting, unexpected-friends, friends-online
- **Romance / affection:** love-messages, spread-love, with-love, celebration
- **Tech/dev/creative off-topic:** artist-at-work, animating, code-contribution, coding,
  composition, creative-designer, creative-flow, design-inspiration, game-world, making-art,
  modern-art, photographer, physics, reviewing-design, science, scientist, starlink,
  virtual-reality, vr-chat, solution-mindset, counting-stars, stars, dreamer, day-dreaming,
  collecting, pin-to-board, peekaboo, convert, election-day
