# Story Weaver — Pitch Deck Content

> 5 slides, 5 minutes. "The demo should do the talking."

---

## SLIDE 0 — Title (5 sec)

**Dream Weaver**
AI-Powered Personalized Bedtime Stories

Team 2 — GEF C3
Tamas | Alessandro | Om | Kumaraguru | Ravi

---

## SLIDE 1 — The Problem (~45 sec)

### "Every parent knows this moment."

**It's 8 PM. Your child wants a bedtime story.**

- Generic storybooks don't feature *their* name, *their* pet, *their* favorite things
- Reading the same 5 books gets repetitive — kids lose interest
- Creating original stories on the spot is exhausting for tired parents
- Existing AI tools generate walls of text — no illustrations, no narration, no interactivity

**The gap:** There is no tool that creates a *personalized, illustrated, narrated, interactive* bedtime story tailored to a specific child — in real time.

> Speaker notes: "Every parent has been here. It's bedtime, your kid wants something new, something with THEIR cat Mimo in it, something where THEY are the hero. And you're exhausted. That's the problem we solve."

---

## SLIDE 2 — The Solution (~1 min)

### Dream Weaver — Your Child is the Hero

A web app that generates **personalized bedtime stories** where the child is the main character, surrounded by their real family, pets, and friends.

**How it works (show diagram):**

```
Parent fills config → Child picks story idea → AI generates scene
    ↓                                              ↓
  Name, age, pet,                          Text + Illustration +
  family, favorites                        Narration + 2 Choices
    ↓                                              ↓
  Characters stay                          Child picks a choice →
  consistent across                        next scene generates →
  all scenes                               8 scenes → happy ending
                                           with moral lesson
```

**Key differentiators:**
- Child is the HERO — their name, their pet, their uncle, all woven in naturally
- AI-generated illustrations + expressive voice narration for each scene
- Interactive: child chooses what happens next (2 choices per scene)
- Every story ends with a moral lesson (kindness, sharing, empathy)
- Stories exportable as PDF booklets
- RAG-powered story memory: past stories expand the child's universe

---

## SLIDE 3 — Live Demo (~2 min)

### Demo Script

1. **Config screen** (15s) — Show: child name "Flavio", age 6, cat "Mimo", brother "Giulio", favorite food pasta, color blue
2. **Story idea** (10s) — Type: "a brave knight who befriends a dragon"
3. **Intro video** (15s) — Show the animated intro while story generates
4. **First scene** (20s) — Point out: personalized text (Flavio is the hero, Mimo the cat appears), illustration, audio narration playing
5. **Make a choice** (10s) — Click one of the two options, show instant page flip transition
6. **Second scene** (15s) — Show continuity: story continues from the choice, characters consistent
7. **Skip to ending** (15s) — Show the moral lesson and "The End"
8. **Export PDF** (10s) — Click "Save as PDF", show the downloaded booklet
9. **RAG demo** (10s) — Show the story memory was auto-saved, mention re-upload capability

> Speaker notes: Keep energy up. Let the product speak. Don't explain what's happening — just do it and react naturally.

---

## SLIDE 4 — Under the Hood (~45 sec)

### Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  React/Vite │     │           FastAPI Backend                 │
│  Frontend   │────→│                                          │
│             │     │  ┌──────────────────────────────────┐    │
│  PageFlip   │     │  │     LangGraph Pipeline            │    │
│  IndexedDB  │     │  │                                    │    │
│  IDB Cache  │     │  │  generate_text ──→ safety_check   │    │
│             │     │  │       ↓                ↓           │    │
│             │     │  │  [retry if unsafe] ──→ media_gen  │    │
│             │     │  │                        ↓           │    │
│             │     │  │                    assemble        │    │
│             │     │  └──────────────────────────────────┘    │
│             │     │                                          │
│             │     │  ┌─────────┐  ┌──────┐  ┌───────────┐  │
│             │     │  │ RAG/FAISS│  │ TTS  │  │ Image Gen │  │
│             │     │  │ (story   │  │(GPT- │  │(Gemini    │  │
│             │     │  │ memory)  │  │4o)   │  │Flash)     │  │
│             │     │  └─────────┘  └──────┘  └───────────┘  │
└─────────────┘     └──────────────────────────────────────────┘
                              All AI via OpenRouter
```

**Key concepts applied:**
- **LangGraph** — Stateful pipeline with conditional routing (safety retry loop)
- **RAG** — FAISS vector store + OpenRouter embeddings for story memory across sessions
- **Prompt engineering** — Structured CHILD PROFILE injection, character consistency rules, moral lesson framework
- **Safety** — 5-layer input sanitization + LLM content classifier (fail-open with retry)
- **Pre-generation** — Both choices pre-generated in parallel → instant page transitions

---

## SLIDE 5 — Impact & What's Next (~30 sec)

### Who Benefits

- **Parents** — No more exhausted improvisation. A personalized story in 20 seconds.
- **Children** — They are the hero. Their pet is in the story. Their choices matter.
- **Educators** — Moral lessons (kindness, sharing, empathy) embedded in every story.

### By the Numbers

- 8-scene stories with illustrations, narration, and choices in ~20s per scene
- 5 AI models orchestrated via single OpenRouter gateway
- Character consistency across all scenes via reference image system
- Story universe that grows: RAG memory connects stories across sessions

### What's Next

- **Story library** — Browse and revisit past adventures
- **Multi-language** — Italian, Spanish, German narration
- **Collaborative stories** — Siblings choose together
- **Mobile app** — Native iOS/Android with offline mode

> End with: "Dream Weaver turns bedtime into the best part of the day. Thank you."

---

## TEAM SLIDE (from template — Slide 2)

| Name | Role | Background |
|------|------|------------|
| Tamas | Lead Developer, Backend Architect | Backend Developer — DERTOUR |
| Alessandro | Bug Fixes, RAG, PDF Export, Deployment, Presentation | AI Engineer — Rebis Labs |
| Om | Configuration Page, Frontend | (add) |
| Kumaraguru | Prompt Engineering, Moral Lessons | (add) |
| Ravi | RAG Research (FAISS), Backend | (add) |

> Ask each teammate for their photo + one-line title/company.

---

## MoSCoW (from template — for Solution slide)

### Must Have (Done)
- Personalized story with child as hero
- AI-generated illustrations per scene
- Expressive voice narration
- Interactive choices (2 per scene)
- Safety content filter
- Moral lesson in every story

### Should Have (Done)
- Side character support (family, pets, friends)
- Character visual consistency (reference images)
- PDF booklet export
- RAG story memory (cross-session universe)

### Could Have (Stretch)
- Story library with revisit
- Multi-language narration
- Go-back and choose different path
- Online deployment with live URL
