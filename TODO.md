# TODO - Dream Weaver

> Last updated: 2026-03-18 — branch `feature/final-polish` (PR #40 open)

## Status Summary

**App is functional end-to-end.** All core features working, 34/34 tests passing. E2E verified via API (2-scene story with text + audio + image + choices). PR #40 open, presentation deck filled from course template.

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
| Image max_tokens capped at 4096 (prevents 402 credit errors) | Done |
| Story start debounce (ref-based, survives React batching) | Done |
| Scene 0 history committed before prefiring scene 1 | Done |
| Choices unlock when jobs fired (not when results cached) | Done |
| Moral message in every story (Heart-Gift framework) | Done |
| RAG integration (FAISS + OpenRouter embeddings) | Done |
| PDF booklet export (A5, cover + scene pages) | Done |
| Story memory (auto-save for cross-session universe) | Done |
| Mobile UI (responsive CSS + landscape hint) | Done |
| Deployment config (Dockerfile + render.yaml) | Done |
| Presentation deck (course template filled, team photos) | Done |

## Previous Bugs — All Fixed

### Bug #1: Characters not respected (CRITICAL) — FIXED
- Root cause: camelCase/snake_case mismatch + hardcoded "best friend" + no character guardrail in prompt
- Fix: PR #38 (data mapping) + companion roles with actual relation + prompt instruction to use ONLY listed characters

### Bug #2: Audio 402 insufficient balance (HIGH) — FIXED
- Root cause: OpenRouter balance below $0.50 + no short-circuit on 402
- Fix: Short-circuit retry on 402 + OpenRouter topped up

### Bug #3: Duplicate story beginnings (MEDIUM) — FIXED
- Root cause: React state batching let two rapid clicks both pass idle check
- Fix: `startingRef` (useRef) as synchronous debounce guard + state check backup

### Bug #4: Choices available during audio (from E2E test) — FIXED
- Root cause: choicesReady only checked prefired job cache, not audio state
- Fix: Added audioFinished state, choices require `(jobsFired || choicesReady) && audioFinished`

### Bug #5: Image misrepresentation (cat as dog, male as female) — IMPROVED
- Root cause: Image prompt lacked character descriptions
- Fix: Animal/gender hints in image prompt, companion registration includes pets

### Bug #6: Duplicate story_system_prompt in YAML — FIXED
- Root cause: Two keys with same name, second overwrote first silently
- Fix: Removed duplicate, merged moral lesson + character rules into single prompt

### Bug #7: Image/TTS/text 402 credit errors — FIXED
- Root cause: Image gen defaulted to 32768 max_tokens; safety used 5000 for tiny JSON
- Fix: Image max_tokens=4096, safety max_tokens=500

### Bug #8: LLM restarting story on scene 1 ("two beginnings") — FIXED
- Root cause: Scene 0's response never committed to live session before prefiring scene 1
- Fix: Set scene 0's job as selectedJobRef in handleContinue so prev_job_id is passed to backend

### Bug #9: Dead time between audio end and choices appearing — FIXED
- Root cause: Choices required all prefire results to be fully cached (too slow)
- Fix: Added jobsFired state; buttons enable when jobs are dispatched, fallback polling handles uncached results

## Remaining Work

- [ ] Merge PR #40 to main
- [ ] Deploy online (Render/Railway)
- [ ] Finalize presentation in Google Slides (team fixing colors/alignment)
- [ ] Record demo video
- [ ] Submit deck to Outskill

## Nice-to-Have (post-deadline)

- [ ] Story library: browse and revisit past adventures (IndexedDB)
- [ ] Go-back: choose different path in story
- [ ] Multi-language narration
- [ ] Collaborative stories (siblings choose together)
