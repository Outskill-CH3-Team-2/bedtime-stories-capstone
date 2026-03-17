# TODO - Dream Weaver

> Last updated: 2026-03-17 — branch `feature/final-polish` (commit 6f806e5)

## Status Summary

**App is functional end-to-end.** All core features working, 34/34 tests passing. Pending: team review, PR merge, deployment, presentation finalization.

| Feature | Status |
|---------|--------|
| LangGraph pipeline (text -> safety -> media -> assemble) | Done |
| Max 8 steps + ending instructions at step 6+ | Done |
| Safety classifier + retry loop (1 retry, fail-open) | Done |
| 5-layer input sanitization + injection detection | Done |
| Character reference images (visual consistency) | Done |
| Configuration page (name, age, companions, family, photo) | Done |
| Side characters with actual roles (Cat, Uncle, etc.) | Done |
| Config data reaching LLM prompt (structured CHILD PROFILE) | Done |
| TTS narration (expressive Director+Actor pipeline) | Done |
| TTS 402 short-circuit (no retry on insufficient balance) | Done |
| Story start debounce (no duplicate beginnings) | Done |
| Choices locked until narration audio finishes | Done |
| Moral message in every story (Heart-Gift framework) | Done |
| RAG integration (FAISS + OpenRouter embeddings) | Done |
| PDF booklet export (A5, cover + scene pages) | Done |
| Story memory (auto-save for cross-session universe) | Done |
| Mobile UI (responsive CSS + landscape hint) | Done |
| Deployment config (Dockerfile + render.yaml) | Done |
| Presentation draft (5 slides, evaluation format) | Done |

## Previous Bugs — All Fixed

### Bug #1: Characters not respected (CRITICAL) — FIXED
- Root cause: camelCase/snake_case mismatch + hardcoded "best friend" + no character guardrail in prompt
- Fix: PR #38 (data mapping) + companion roles with actual relation + prompt instruction to use ONLY listed characters

### Bug #2: Audio 402 insufficient balance (HIGH) — FIXED
- Root cause: OpenRouter balance below $0.50 + no short-circuit on 402
- Fix: Short-circuit retry on 402 + OpenRouter topped up

### Bug #3: Duplicate story beginnings (MEDIUM) — FIXED
- Root cause: No debounce on handleStart()
- Fix: `state.status !== 'idle'` guard

### Bug #4: Choices available during audio (from E2E test) — FIXED
- Root cause: choicesReady only checked prefired job cache, not audio state
- Fix: Added audioFinished state, choices require `choicesReady && audioFinished`

### Bug #5: Image misrepresentation (cat as dog, male as female) — IMPROVED
- Root cause: Image prompt lacked character descriptions
- Fix: Animal/gender hints in image prompt, companion registration includes pets

### Bug #6: Duplicate story_system_prompt in YAML — FIXED
- Root cause: Two keys with same name, second overwrote first silently
- Fix: Removed duplicate, merged moral lesson + character rules into single prompt

## Remaining Work

- [ ] Team feedback on `feature/final-polish` branch
- [ ] Create PR and merge to main
- [ ] Deploy online (Render/Railway)
- [ ] Finalize presentation in Google Slides
- [ ] Collect team photos for team slide
- [ ] Record demo video
- [ ] Submit deck to Outskill

## Nice-to-Have (post-deadline)

- [ ] Story library: browse and revisit past adventures (IndexedDB)
- [ ] Go-back: choose different path in story
- [ ] Multi-language narration
- [ ] Collaborative stories (siblings choose together)
