# QxLog — Gaps, Tech Debt & Risk Audit

Honest, unvarnished list of weaknesses. Ordered **most severe first**. Each item: what it is, where it lives, why it matters, and a small suggested fix.

> Context that raises the stakes: this app stores **identifiable patient health data** (clinical record number `nhc`, age, sex, diagnosis) for a hospital in Spain. GDPR/medical-confidentiality rules apply. Several items below are not "nice to have" — they are compliance-relevant.

---

## 🔴 CRITICAL

### 1. No authentication + world-open database; anon key shipped and committed
- **STATUS (2026-07-08): Code side DONE, dashboard side PENDING.** The app now has a Supabase-Auth login gate (`Login` component + `auth` helper in `App.jsx`); DB calls send the logged-in user's JWT via `sbFetch`. A ready-to-run RLS script exists at `supabase/enable-rls.sql` (see `SETUP-SECURITY.md` for the click-by-click guide). **Still required by the account owner (cannot be done from code):** (a) run `supabase/enable-rls.sql` in the SQL editor; (b) create your login user under Authentication → Users. Until RLS is enabled, the table is world-open regardless of the app's login screen — **RLS on the server is what actually protects the data; client-side login alone is not security.** Note the `anon` key does **not** need rotating: it is a public-by-design key (Supabase ships it in the browser), harmless once RLS denies the anon role. The dangerous `service_role` key bypasses RLS but was never in the code/repo — keep it that way.
- **What:** The app authenticates to Supabase with the **anon** key only (`App.jsx:5`, `.env`), sending it from the browser as both `apikey` and `Bearer` on every request. There is no login. For CRUD to work from the browser at all, the `cirugias` table's Row-Level Security must be either disabled or set to allow `anon`. That means **anyone who has the anon key (which is embedded in the shipped JS bundle and committed to git) can read, edit, and delete every patient record.**
- **Where:** `src/App.jsx:4–40`, `qxlog/.env` (both committed to the repo and, via `import.meta.env`, baked into the production build).
- **Why it matters:** Full disclosure/tampering/deletion of identifiable medical data by anyone with the URL+key. This is a data-breach-class issue and a GDPR violation risk.
- **Suggested fix (staged, each a single task):**
  1. Immediately: in the Supabase dashboard, enable RLS on `cirugias` and add policies so only an authenticated user (the owner) can access rows; rotate the anon key.
  2. Add Supabase Auth (email magic-link is enough for one user); gate the whole `<App/>` behind a session check; attach the user's JWT instead of the anon key on requests.
  3. Add a `user_id` column defaulted to `auth.uid()` and scope RLS to `user_id = auth.uid()`.
  4. Remove `.env` from git (`git rm --cached .env`) and add it to `.gitignore`; document required vars in `.env.example`.

### 2. `.env` with live credentials is tracked by git and not ignored
- **STATUS (2026-07-08): DONE and committed.** `.env` and `urls.env` were `git rm --cached`'d (untracked), `urls.env` deleted, `.gitignore` now ignores `.env`/`.env.*` (keeping `.env.example`), and a placeholder `.env.example` was added; committed and pushed. The `anon` key still sits in past commits, but that is not a real exposure once RLS is on (see #1) — the key is public by design. Do keep future real secrets (e.g. the `service_role` key) out of the repo entirely.
- **What:** `qxlog/.gitignore` ignores `*.local` but **not** `.env`. `.env` (and a duplicate `urls.env`) hold the real project URL and anon key, with the same key pasted twice.
- **Where:** `qxlog/.env`, `qxlog/urls.env`, `qxlog/.gitignore`.
- **Why it matters:** Secrets in history persist even after deletion; anyone with repo access gets the key. `urls.env` is dead duplication that will drift.
- **Suggested fix:** Add `.env` and `*.env` (except `.env.example`) to `.gitignore`; `git rm --cached .env urls.env`; delete `urls.env`; create `.env.example` with empty placeholders. (Pair with rotating the key in #1 — removing from git does not un-leak an already-pushed key.)

---

## 🟠 HIGH

### 3. Zero automated test coverage on all critical paths
- **What:** No test runner, no tests. The write paths (`handleSave`, `handleAddFollowUp`, `handleSaveNotes`, `handleDelete`), the `db` wrapper, the filter predicate, and the export mappers are all unverified.
- **Where:** whole repo; especially `src/App.jsx:229–278` (writes) and `:286–299` (filtering).
- **Why it matters:** A rename of one column key silently breaks saving or export with no signal. Refactors are high-risk.
- **Suggested fix:** Add Vitest + React Testing Library. Start with pure functions extracted from `App.jsx`: (a) the `filtered` predicate, (b) `exportCustom` row-mapping, (c) `generateMemoria` aggregation. Then a smoke test that mounts `<App/>` with `fetch` mocked and asserts a save posts the expected body.

### 4. No error surfacing beyond a generic toast; failures can corrupt in-memory state
- **What:** Every `db` method throws a generic Spanish `Error`; callers `catch` and show `"Error…"`. But optimistic updates assume the returned array is `[row]`. If Supabase returns `[]` (e.g. RLS blocks the row, or `return=representation` is stripped), `const [updated] = ...` yields `undefined` and `records` gets an `undefined` entry, crashing later renders.
- **Where:** `App.jsx:234, 238, 261, 272` (destructuring the response), `db.*` (`:7–40`).
- **Why it matters:** Silent data loss and hard-to-debug white-screen crashes.
- **Suggested fix:** In each handler, guard the response: `if (!updated) throw new Error(...)` before touching `records`; log `res.status` + body text in the `db` methods so failures are diagnosable.

### 5. Radiology images stored as base64 data URLs inside table rows
- **STATUS (2026-07-08): FIXED for new images (dashboard step required to enable).** Images now upload to a private Supabase Storage bucket `rx` via the `storage` helper in `App.jsx`; the row keeps only a short object path. Display goes through short-lived signed URLs (`RxImage` component), and uploads are downscaled client-side (`downscaleImage`, canvas → JPEG, max 1920px). **Legacy base64 rows still render** (backward-compatible via `isStoragePath`). **Owner must run `supabase/setup-storage.sql` once** to create the bucket + policy, or image upload will fail (the rest of the app is unaffected). *Not migrated:* existing base64 rows stay base64 (harmless, just heavy); a one-off backfill script could move them if desired. *Not handled:* replacing an image on edit orphans the old object (cheap; delete does clean up).
- **What (original):** `handleImageUpload` inlined the whole image as a data URL into `imagen_url`, persisted as a column and re-fetched with every `getAll()`.
- **Why it mattered:** A single X-ray is easily 1–5 MB → base64 adds ~33%. Every app load re-downloaded *all* images for *all* records, so load time and memory grew without bound.

### 6. No pagination — `getAll()` loads the entire table on every mount
- **STATUS (2026-07-08): Largely mitigated by #5; intentionally not adding hard pagination.** With images out of the rows, `getAll` now returns only light text + small follow-up JSON, so loading the full table is cheap at personal scale (hundreds–low thousands of rows). Real pagination is deliberately avoided because `stats`, the filter option lists, "similar cases", and "export all" all assume `records` is the complete set — a naive `limit` would silently hide medical records. If the dataset ever gets large, the right move is server-side stats + a paged list view, not a bare `limit`.
- **What (original):** `GET /rest/v1/cirugias?order=fecha.desc` with no `Range`/`limit`; all records + embedded images came down at once.
- **Why it mattered:** Combined with #5 (images in rows), this was the app's main scalability cliff — now removed.

---

## 🟡 MEDIUM

### 7. No input validation or sanitization; weak required-field check
- **What:** Only `fecha`, `nhc`, `diagnostico` are required (`App.jsx:230`); everything else is free text sent verbatim. `edad` is `type="number"` but stored as a string; dates aren't validated; no length limits.
- **Where:** `handleSave` (`:229`), the quick-mode/wizard inputs.
- **Why it matters:** Garbage-in data reduces the value of stats/exports; inconsistent `edad` typing makes numeric analysis unreliable.
- **Suggested fix:** Add a small validation pass in `handleSave` (numeric `edad` in a sane range, ISO date shape); trim strings; coerce `edad` to `Number` before insert.

### 8. Fragile "has complications" logic duplicated in three places
- **What:** The rule "a complication exists unless the text is empty/`ninguna`/`no`" is copy-pasted in `generateMemoria` (`:126`), `stats` (`:309`), and the `filtered` predicate (`:294`). Any change must be made in three spots; they can silently diverge.
- **Where:** `App.jsx:126, 294, 309`.
- **Why it matters:** Reintervention/complication *rates* are the headline clinical metrics; inconsistency here misreports outcomes.
- **Suggested fix:** Extract `const hasComplication = (r) => { const v=(r.complicaciones_intra||"").toLowerCase().trim(); return !!v && !["ninguna","no",""].includes(v); }` once and reuse.

### 9. Mislabeled "learning curve" statistic
- **What:** The "Curva de aprendizaje por tipo" chart (`App.jsx:316–324`, `:661`) sorts by date but then just counts totals per surgery type — it is not a curve over time or a complication trend.
- **Where:** `learningCurve` computation and its Bar in the stats view.
- **Why it matters:** Presents a misleading clinical metric; the label promises something the data doesn't show.
- **Suggested fix:** Either rename it to "Casos acumulados por tipo", or make it a real curve (e.g. cumulative count or complication rate over successive cases per type).

### 10. `edad` and `sexo` filter/analysis assume clean data that isn't enforced
- **What:** Stats bucket by exact string match (`r.tipo_cirugia===t`, `r.implante_tipo===i`). Free-text implant names ("LCP 3.5" vs "LCP 3.5 volar") fragment the histogram.
- **Where:** `App.jsx:282–314`.
- **Why it matters:** Top-N implant/type charts become noisy as data grows.
- **Suggested fix:** Longer term, back common fields with select options or a normalized lookup. Short term, document that implant type is free text and stats are approximate.

### 11. Delete uses browser `confirm()`; no undo, hard delete
- **What:** `handleDelete` (`App.jsx:248`) gates on `window.confirm` then permanently `DELETE`s the row. No soft-delete, no undo, no audit trail — for medical records.
- **Where:** `App.jsx:248–254`.
- **Why it matters:** One mis-click permanently loses a clinical record; medical data usually requires retention/audit.
- **Suggested fix:** Add a `deleted_at` soft-delete column and filter it out on read, instead of hard `DELETE`; keep the confirm.

---

## 🟢 LOW / cleanup

### 12. Dead template files
- **What:** `src/App.css` is imported nowhere. `src/index.css` is imported by `main.jsx` but visually overridden by the inline `<style>` in `App.jsx`. `src/assets/react.svg`, `vite.svg`, `hero.png` and the boilerplate `README.md` are unused template leftovers.
- **Where:** `src/App.css`, `src/index.css`, `src/assets/*`, `README.md`.
- **Why it matters:** Misleads new readers into editing files that do nothing.
- **Suggested fix:** Delete `App.css` and unused assets; trim `index.css` to the few rules actually needed (or fold into the inline style); replace `README.md` with a real project readme pointing to PROJECT.md.

### 13. Duplicated env file (`urls.env`) and duplicated key inside `.env`
- **What:** `urls.env` duplicates `.env`; `.env` itself lists `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` twice.
- **Where:** `qxlog/.env`, `qxlog/urls.env`.
- **Why it matters:** Guaranteed to drift; unclear which one is authoritative (Vite only reads `.env`).
- **Suggested fix:** Delete `urls.env`; de-duplicate `.env` to one pair of vars. (Do this together with #2.)

### 14. Massive single component, no memoization
- **What:** `App.jsx` is ~930 lines: data layer, all views, all styles, all helpers. All derived arrays (`filtered`, `stats`, `byType`, …) recompute every render.
- **Where:** `src/App.jsx`.
- **Why it matters:** Onboarding cost; and at larger record counts the per-render recompute over all rows (with embedded images) gets noticeable.
- **Suggested fix (incremental, low-risk):** Extract pure helpers (`db`, `exportCustom`, `generateMemoria`, predicates) into `src/lib/`; later split views into components. Wrap `filtered`/`stats` in `useMemo`. Do this *after* adding tests (#3), not before.

### 15. Hook order/readability nit: `notesEdit`/`editingNotes` state declared mid-component
- **What:** `useState` for `notesEdit`/`editingNotes` sits at `App.jsx:331–332`, far below the other hooks and after large derived-data blocks.
- **Where:** `App.jsx:331–332`.
- **Why it matters:** Easy to miss; inconsistent with the hook cluster at the top. (Not a bug — order is stable — just a readability inconsistency.)
- **Suggested fix:** Move these two `useState` calls up with the rest of the hook declarations (~`:199`).

### 16. `follow_ups` written only on insert, never initialized for edited/legacy rows
- **What:** Insert sends `follow_ups:[]` (`App.jsx:238`) but `handleAddFollowUp` relies on `record.follow_ups||[]` (`:258`) — fine — while `update` never touches it. Rows created outside the app (or before the field existed) may have `null`, handled defensively in reads but not consistently.
- **Where:** `App.jsx:238, 258, 792, 892`.
- **Why it matters:** Minor; the `|| []` guards cover it today, but it's an implicit contract worth making explicit.
- **Suggested fix:** Default `follow_ups` to `[]` at the DB level (column default `'[]'::jsonb`) so reads never see `null`.
