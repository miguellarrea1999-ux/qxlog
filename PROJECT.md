# QxLog — Project Overview

> Knowledge-transfer document for engineers/agents new to this codebase.
> Companion files: **CLAUDE.md** (operational rules, read first every session) and **GAPS.md** (known weaknesses & security issues).

---

## 1. What this is, and who it's for

**QxLog** is a personal **surgical logbook** for a single user: an orthopedic-and-trauma surgery resident (the UI says *"R3 COT · Hospital de Manises"* — 3rd-year resident in *Cirugía Ortopédica y Traumatología* at Hospital de Manises, Valencia, Spain). It is a private clinical case register the surgeon fills in after each operation.

For every surgery it records: patient identifiers (NHC = *número de historia clínica* / clinical record number, age, sex, operated side), pre-op risk (ASA grade, anticoagulation, osteoporosis, comorbidities), diagnosis and fracture classification (AO/OTA plus systems like Garden, Neer, Schatzker…), operative detail (approach, technique, implant brand/type, graft, tourniquet, assistant), an attached radiology image, post-op notes, personal learning notes, and an open-ended list of follow-up visits (consolidation, functional scores, reintervention).

On top of the raw log it provides: full-text + faceted **filtering**, **statistics** (counts by type/implant/month, complication & reintervention rates, a rough "learning curve"), a distraction-free **presentation mode** for showing a single case (e.g. in a clinical session), and **Excel export** (custom column picker + a pre-built multi-sheet "memoria"/annual report). Everything is in **Spanish**.

The whole product is one user's tool. There is no multi-user concept, no accounts, no roles.

---

## 2. Tech stack (and why)

| Piece | Version | Why it's here |
|---|---|---|
| **React** | 19.x | UI. Chosen for familiarity; this started from the standard `create-vite` React template (see the untouched `README.md`, `App.css`, `index.css`). |
| **Vite** | 8.x | Dev server + bundler. Comes with the template. `@vitejs/plugin-react` (Oxc-based). |
| **xlsx (SheetJS)** | 0.18.5 | Client-side Excel generation for exports and the annual "memoria". No server needed to produce `.xlsx`. |
| **Supabase** | (hosted) | Backend-as-a-service. Used **purely as a REST datastore** via PostgREST — there is **no** `@supabase/supabase-js` dependency. The app hand-writes `fetch()` calls to `/rest/v1/cirugias`. This keeps the bundle tiny and the code dependency-light, at the cost of doing auth/RLS/error-handling by hand (it mostly doesn't — see GAPS.md). |
| **ESLint 10** (flat config) | dev | Lint. Standard template config + react-hooks + react-refresh. |

Notable **non**-choices: no TypeScript, no router (react-router), no state library (Redux/Zustand), no component framework (MUI/Tailwind), no test runner, no CSS files in use. All state is React `useState`; all styling is a single inline `<style>` block; all "routing" is a `view` string in state.

---

## 3. Architecture

This is a **single-file front-end app** talking directly to a hosted Postgres over REST. There is no backend code in this repo.

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (the only runtime)                                   │
│                                                              │
│  index.html → src/main.jsx → <App/>  (src/App.jsx, ~930 LOC) │
│                                                              │
│   App.jsx contains EVERYTHING:                               │
│   ┌──────────────┬───────────────┬────────────────────────┐ │
│   │ db { }       │ React <App/>  │ helpers                │ │
│   │ CRUD wrapper │ all state +   │ exportCustom/exportAll │ │
│   │ (fetch)      │ all views +   │ generateMemoria        │ │
│   │              │ inline <style>│ SF/TF/TAF/CF/Bar (UI)  │ │
│   └──────┬───────┴───────────────┴────────────────────────┘ │
│          │ fetch() with apikey + Bearer = VITE_SUPABASE_...  │
└──────────┼──────────────────────────────────────────────────┘
           │  HTTPS
           ▼
   Supabase PostgREST  →  Postgres table `cirugias`
```

### Data flow
- **On mount** (`useEffect`, `App.jsx:204`): `db.getAll()` → `GET /rest/v1/cirugias?order=fecha.desc` → fills `records` state. If env vars are missing or the request fails, `dbError` is set and a red banner shows.
- **Create/Edit**: the 6-step wizard (or "quick mode") mutates `form` state → `handleSave` (`App.jsx:229`) calls `db.insert` or `db.update` → the returned row is spliced into `records` optimistically.
- **Follow-ups & notes** are stored *inside the row*: `follow_ups` is a JSON array column, `notas_clinicas` is a text column. `handleAddFollowUp`/`handleSaveNotes` PATCH the whole field.
- **Images**: `handleImageUpload` (`App.jsx:212`) reads the file with `FileReader.readAsDataURL` and stores the **base64 data URL directly** in `form.imagen_url` → persisted as a column value. There is **no** file/object storage.
- **Derived data** (filters, stats, charts, similar cases) is all computed in-render from `records` — no memoization.

### The `cirugias` table (inferred from `EMPTY` at `App.jsx:42` + writes)
Columns are the keys of `EMPTY` (fecha, nhc, edad, sexo, lado, asa, anticoagulacion, …, imagen_url, notas_clinicas) **plus**: `id` (PK, used in `?id=eq.${id}` filters), and `follow_ups` (JSON array; written with `follow_ups:[]` on insert). Booleans in DB: `diabetes, irc, hta, epoc`. Everything else is stored as text/date. There is no schema/migration file in the repo — the table lives only in the Supabase project (`niascnzjlkrewtwwzivg`).

### The "view" state machine (`view` in state, `App.jsx:175`)
`home` → `new` (wizard) → `list` → `detail`, plus `stats`. Two overlays sit above any view: `presentMode` (full-screen single case) and `showExportModal`. Navigation is buttons setting `view`; there is no URL, so refresh always returns to `home` and there is no deep-linking or back button.

---

## 4. Key design decisions (inferred)

- **One file, terse code.** `App.jsx` is deliberately dense — 2–4-letter class names (`.rc`, `.ib`, `.fg`), 2-letter component names (`SF`=SelectField, `TF`=TextField, `TAF`=TextArea, `CF`=Checkbox, `Bar`). This is a solo project optimized for the author's speed of iteration, not for onboarding. Accept it; don't "refactor for clarity" without a reason.
- **Supabase via raw REST, anon key in the client.** The author wanted a permanent cloud DB with near-zero backend work. PostgREST + the anon key gives instant CRUD from the browser. The trade-off (no real auth, open table) is the single biggest issue in the project — see GAPS.md #1.
- **Inline everything (styles + components).** The `<style>` block (`App.jsx:336`) is the real stylesheet; `src/App.css` and most of `src/index.css` are leftover template files that are effectively dead (App.css is imported nowhere).
- **Data-URL images instead of object storage.** Simplest possible "attach an X-ray" — no upload pipeline — at the cost of fat rows and fat payloads (GAPS.md).
- **Follow-ups as an embedded JSON array.** Avoids a second table/join; fine for a personal-scale dataset.
- **Spanish, GitHub-dark aesthetic, DM Serif/DM Mono fonts loaded from Google Fonts** via `@import` inside the inline style.

---

## 5. Critical paths — what's load-bearing vs. safe to touch

**Load-bearing (change carefully, test the round-trip):**
- `db` object (`App.jsx:7–40`) — the *only* persistence layer. Every column name, the `?id=eq.` filter syntax, and the `Prefer: return=representation` header matter. Breaking any header breaks all saving.
- `EMPTY` (`App.jsx:42`) and `ALL_COLUMNS` (`App.jsx:58`) — these define the data model and the export shape. Field keys **must** match real DB column names exactly, or saves silently drop data / exports show blanks.
- `handleSave` / `handleAddFollowUp` / `handleSaveNotes` — the write paths. They optimistically update `records`; a shape mismatch corrupts the in-memory list.
- The env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`.env`) — without them the app is read-nothing.

**Safe to change casually:**
- Any JSX inside a `view===` block (labels, layout, adding a display field).
- The inline `<style>` block — pure presentation.
- Option lists (`CLASIFICACIONES`, ASA options, implant placeholders) — additive changes are harmless.
- Stats/chart computations — they're derived and read-only.

---

## 6. Surprises / things that will trip you up

1. **Two git repos are nested.** `C:\Users\migue` is *also* a git repo (the user's home dir, no commits). **The real project is `C:\Users\migue\qxlog`** — its own repo with a GitHub remote and 3 commits (v1/v2/v3). Always work inside `qxlog/`.
2. **`.env` is committed** and contains a live Supabase URL + anon key. It is not in `.gitignore`. (See GAPS.md — this is a security issue, not a convenience.)
3. **`src/App.css` is dead code** — imported nowhere. `src/index.css` is imported by `main.jsx` but its look is overridden by the inline `<style>` in `App.jsx`. Don't waste time editing these expecting visual changes.
4. **No router.** "Pages" are a `view` string. Refresh loses your place; there are no shareable URLs.
5. **No tests, no CI.** `npm run lint` is the only automated check.
6. **`db.getAll` fetches *all* rows, ordered, every mount** — no pagination. Fine at personal scale, quietly O(n) forever.
7. **`generateMemoria`'s "learning curve"** (`App.jsx:316`) is mislabeled — it's just a per-type total count, not a curve over time.
8. **This is real patient data.** NHC + age + sex + diagnosis is identifiable health information under GDPR. Treat the DB and the exported `.xlsx` files accordingly.
9. **Everything is in Spanish**, including toast messages and error strings — keep new UI text Spanish for consistency.
