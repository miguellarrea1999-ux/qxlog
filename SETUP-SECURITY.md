# QxLog — Security Setup Guide

A plain, click-by-click guide to finish securing QxLog. The code side is already
done; these are the steps that can only be done in the Supabase dashboard.

**Do the steps in order — don't skip ahead.**

---

## Before you start
Open your Supabase project: go to **https://supabase.com/dashboard**, log in, and
click your **QxLog** project (named `niascnzjlkrewtwwzivg`). Everything below happens
inside that project. The menu is the left sidebar.

---

## Step 1 — Create your login account
This is what you'll use to log into the app. Do it first so you don't lock yourself out.

1. In the left sidebar, click **Authentication**.
2. Click the **Users** tab at the top.
3. Click the green **Add user** button (top right) → choose **Create new user**.
4. Type an **email** and a **password** you'll remember. (The email doesn't need to be
   real, but use a real one if you want password resets to work.)
5. Make sure **Auto Confirm User** is turned **on** (so you don't have to click a
   confirmation email).
6. Click **Create user**.

✅ You now have a login. Remember the email + password.

---

## Step 2 — Turn on the lock (RLS)
This is the step that actually stops strangers from reaching your patient data.

1. In the left sidebar, click **SQL Editor**.
2. Click **+ New query**.
3. Open the file `supabase/enable-rls.sql` from this project, **copy everything in it**,
   and paste it into the box.
4. Click the green **Run** button (bottom right, or press Ctrl+Enter).
5. You should see **"Success. No rows returned."** at the bottom. That's correct — it
   means it worked.

✅ The database is now locked to logged-in users only.

---

## Step 3 — Replace the old key
The old key is public on GitHub. This step makes it useless.

1. In the left sidebar, click **Project Settings** (the gear icon at the bottom).
2. Click **API** (or **API Keys**).
3. Find the **anon / public** key. Next to it, click **Reset** / **Rotate** (there may
   be a small "⋯" menu). Confirm.
4. A **new** anon key appears. Click to **copy** it.

Now update your app's local file so it keeps working:

5. Open the file `qxlog/.env` on your computer in a text editor.
6. Replace the long value after `VITE_SUPABASE_ANON_KEY=` with the **new** key you just
   copied. Save the file.

✅ The leaked key is now dead; your app uses the new one.

---

## Step 4 — Test it
1. In a terminal, go into the `qxlog` folder and run:

   ```
   npm run dev
   ```

2. Open the address it prints (usually **http://localhost:5173**).
3. You should see the **login screen**. Enter the email + password from Step 1 → click
   **Entrar**.
4. Your surgery list should load normally.

✅ If you can log in and see your cases, everything is done and secure.

---

## If something goes wrong
- **Can't log in** → the email/password doesn't match Step 1, or "Auto Confirm" was off.
  Redo Step 1.
- **Login works but the list is empty / "Error de conexión"** → the key in `.env` doesn't
  match the new one from Step 3, or you need to fully restart `npm run dev` after editing
  `.env`.
- **App loads the list without asking you to log in** → your browser cached an old session;
  hard-refresh (Ctrl+Shift+R).

---

_Related files: `supabase/enable-rls.sql` (the lock script), `GAPS.md` #1/#2 (the full
security rationale), `CLAUDE.md` (auth model)._
