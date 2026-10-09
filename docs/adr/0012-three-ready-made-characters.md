# 0012 — Three ready-made characters instead of an avatar builder

Status: accepted (2026-10-09).

## Context
The change request planned a later "build my avatar" step: users would pick hair, hair colour,
skin, glasses, beard and clothing one by one. The product owner wants a choice of avatar, but
without asking users a series of questions.

## Decision
- The Rive file holds **three complete characters** on one shared rig, selected by a Number
  input `character` (0, 1, 2). Every character supports all seven emotions, tracking, the
  recording pose and the `noted` glance.
- Settings shows the three as pictures under "Illustrated avatar"; one tap picks one. Stored on
  the account as `users.avatar_character` (0–2, default 0).
- Until the designer delivers the file, three placeholder images stand in
  (`public/avatar/placeholder-0.png` … `-2.png`).
- No per-feature builder and no AI-generated avatar from a photo. Initials and own photo remain.

## Consequences
- One additive column; the six part inputs (`hair`, `skin`, …) are dropped from the contract.
- The designer delivers three characters instead of a part system: less rigging work, and
  every combination users can see has been designed and checked.
