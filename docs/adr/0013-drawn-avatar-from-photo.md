# 0013 — Drawn avatar from the user's photo (parts + colours, animated by Rive)

Status: accepted for the prototype (2026-10-09). Extends ADR 0012; reverses the change
request's "never auto-detected from a photo" for this option.

## Context
Clients should be impressed by an animated avatar that looks like the therapist. Rive cannot
import or rig a new drawing at runtime, so "one SVG per user, animated by Rive" is not possible
literally. Rive can, however, swap parts and change colours at runtime (data binding).

## Decision
- The designer builds **one rigged character with interchangeable parts and bound colours**:
  view model `Avatar` with enums `hairStyle` (shaved, short, medium, long, curly_short,
  curly_long, tied_back, bun, headscarf), `glasses` (none, round, rectangular), `beard` (none,
  stubble, short, full) and colours `hairColor`, `skinColor`, `eyeColor`. All animation is built
  once and works for every combination.
- **From a photo:** the user crops a photo in the browser; `POST /auth/me/avatar/describe`
  sends it once to Gemini (vision, JSON schema) and returns a suggested description. The photo
  is not stored or logged. The user reviews and corrects every field, then saves.
- Stored as `users.avatar_appearance` (JSONB, validated) with `avatar_kind = 'drawn'`. The three
  ready-made characters (ADR 0012) are presets of the same description.
- Until the Rive file exists, an SVG stand-in (`DrawnFace`) draws any description with the same
  moods, eye tracking, nod and recording pose.

## Consequences
- **Prototype only, test photos only.** The photo goes to Google Gemini (in dev the Gemini API,
  ADR 0005) without the EU-only and zero-retention checks (rule 4). A colour estimated from a
  face can reveal ethnic origin, and a headscarf can reveal religion (GDPR Art. 9). Before real
  users: EU processing, zero retention, a DPIA note and explicit opt-in — or keep manual
  selection only.
- The prompt asks for drawing attributes only and forbids guessing age, gender, ethnicity, mood
  or health; the server accepts only the fixed schema.
- The designer's brief changes from three fixed characters to a part system with bound colours.
