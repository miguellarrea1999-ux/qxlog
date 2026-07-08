# CLAUDE.md — QxLog

Operational guide for working in this repo. Read **PROJECT.md** for architecture/context and **GAPS.md** for known issues before making non-trivial changes.

- **PROJECT.md** — what QxLog is, the stack, the data flow, critical paths, and gotchas.
- **GAPS.md** — prioritized list of tech debt, missing tests, fragile edges, and (importantly) security issues.

## What this is (one line)
A single-user, Spanish-language **surgical logbook** for an orthopedic-surgery resident: a React 19 + Vite SPA that reads/writes patient case records directly to a Supabase (Postgres/PostgREST) table `cirugias`. **Real, identifiable patient health data** — treat the DB and any exported `.xlsx` accordingly.

## ⚠️ First things first — location
The real project is **`C:\Users\migue\qxlog`** (its own git repo, GitHub remote `miguellarrea1999-ux/qxlog`, branch `main`). The parent `C:\Users\migue` is *also* a git repo (the user's home dir, no commits) — **do not commit there**. Always `cd` into `qxlog/` and confirm `git remote -v` shows `qxlog.git` before any git action.

## Commands
Run from `qxlog/`:
- `npm install` — install deps.
- `npm run dev` — Vite dev server (default http://localhost:5173).
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the built `dist/`.
- `npm run lint` — ESLint (the **only** automated check; there are no tests).
- Deploy: no deploy config in-repo. It's a static SPA — build and host `dist/` anywhere; env vars are baked in at build time.

## Environment
- Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (read via `import.meta.env` in `App.jsx:4–5`).
- `.env` is now **git-ignored** (see `.gitignore`); a placeholder `.env.example` is checked in. Copy it to `.env` and fill real values locally. Never re-commit real keys.
- Missing vars → the login screen shows a config warning; the app loads nothing.

## Auth model (added 2026-07-08)
- The app is gated behind **Supabase Auth** (email + password) — see the `Login` component and the `auth` helper in `App.jsx`. No account = no access.
- Identity flows through `sbFetch` (`App.jsx`): every DB call sends the anon key as `apikey` and the **logged-in user's JWT** as `Authorization: Bearer`. On a 401 it refreshes the token once, else it bounces to login. The session is cached in `localStorage` under `qxlog_session`.
- **Server-side is what actually secures data:** RLS must be enabled on `cirugias` (script: `supabase/enable-rls.sql`; user-facing guide: `SETUP-SECURITY.md`). Owner-only manual steps that code cannot do: run that SQL, and create the login user in the Supabase dashboard. The client login screen alone is *not* protection if RLS is off. The `anon` key is public by design and does **not** need rotating once RLS is on; never put the `service_role` key in the app/repo (it bypasses RLS).
- If you run the app and can't get past the login screen, the Supabase Auth user hasn't been created yet — create it in Authentication → Users.

## Where things live
- **Everything** is in `src/App.jsx` (~930 lines): the `db` REST wrapper, all React state and views, all helper functions, all UI subcomponents, and the entire stylesheet as an inline `<style>` block.
- `src/main.jsx` — trivial React entry.
- `src/index.css` — imported but visually **overridden** by the inline `<style>`. `src/App.css` — **dead, imported nowhere**. Don't edit these expecting visual changes; edit the `<style>` block in `App.jsx` (starts ~`App.jsx:336`).

## Conventions this codebase actually follows
- **Language:** all UI text, options, toasts, and errors are **Spanish**. Keep new strings Spanish.
- **Terse naming, by design:** CSS classes are 2–4 letters (`.rc`, `.ib`, `.fg`, `.sc`); reusable field components are `SF` (select), `TF` (text), `TAF` (textarea), `CF` (checkbox), `Bar` (chart). Match this style; don't rename for "clarity" without reason.
- **State:** plain `useState` only; no Redux/context/router. "Pages" are the `view` string (`home`/`new`/`list`/`detail`/`stats`) plus overlay booleans (`presentMode`, `showExportModal`).
- **Data access:** only through the `db` object (`App.jsx:7–40`) — hand-written `fetch` to PostgREST with `apikey` + `Bearer` headers and `Prefer: return=representation` on writes. Row filters use `?id=eq.${id}`. Do not add `@supabase/supabase-js`; stay consistent with the raw-fetch pattern unless deliberately migrating.
- **Writes are optimistic:** handlers splice the returned row into `records` after a successful call.
- **Styling:** dark GitHub-like theme; CSS variables in `:root` inside the inline `<style>`; DM Serif Display + DM Mono via a Google Fonts `@import`.

## Data model (must stay in sync)
- Table `cirugias`. Its columns are the keys of the `EMPTY` object (`App.jsx:42–53`) **plus** `id` and `follow_ups` (JSON array).
- **Field keys must exactly match DB column names.** A typo means silently dropped data on write and blank cells on export.
- If you add a field: update `EMPTY`, add it to the relevant wizard step JSX, add it to `ALL_COLUMNS` (`App.jsx:58`) if it should be exportable, **and** add the column in Supabase. All four or it breaks.
- `follow_ups` = array of `{fecha_revision, consolidacion, resultado_escala, resultado_funcional, complicacion_tardia, reintervencion, reintervencion_motivo, date}`, appended by `handleAddFollowUp`.
- Images: `imagen_url` holds a base64 **data URL** (no object storage). See GAPS.md #5 before touching image handling.

## Gotchas (look-like-they-work-but-don't)
- Editing `App.css`/`index.css` does nothing visible — the inline `<style>` wins. (`App.css` isn't even imported.)
- No router → browser refresh always returns to `home`; there are no shareable URLs or back-button navigation.
- `db.getAll()` fetches **all** rows (with embedded images) on every mount — no pagination. Don't assume it scales.
- Write handlers destructure `const [row] = await db.x()`. If Supabase returns `[]` (e.g. RLS blocks it), `row` is `undefined` and gets pushed into `records`, crashing later renders. Guard responses when editing these (GAPS.md #4).
- The "complication exists" rule is duplicated in 3 places (`App.jsx:126, 294, 309`) — change all three or extract a helper (GAPS.md #8).
- The "Curva de aprendizaje" chart is just per-type totals, not a real curve (GAPS.md #9).

## Rules / do-with-care
- **Never** loosen Supabase access further or hardcode new keys. If you touch auth/RLS, read GAPS.md #1 first — the table is currently effectively public, which is the top open risk.
- Treat `cirugias` data and exported spreadsheets as confidential medical data (GDPR). Don't paste record contents into logs, commits, or external services.
- Don't commit in the parent home-dir repo; commit only inside `qxlog/`. End commit messages with the required Co-Authored-By line if you commit on the user's behalf.
- Generated/untracked: `node_modules/`, `dist/`, `.env` (now git-ignored — keep it that way; use `.env.example` for placeholders).
- Prefer small, surgical edits to `App.jsx`. If refactoring for size (GAPS.md #14), add tests first (GAPS.md #3) — there are currently none.
