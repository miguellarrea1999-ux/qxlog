# QxLog — Security Setup Guide

A plain, click-by-click guide to finish securing QxLog. The code side is already
done; there are just **two actions** in the Supabase dashboard, then a test.

**Do the steps in order — don't skip ahead.**

## The one thing to understand
Your app's `anon` / `public` key is meant to be public — it ships inside the browser.
On its own it isn't a secret. What actually protects your patient data is a database
feature called **Row-Level Security (RLS)**. Turning RLS on (Step 2) is the real fix.
Supabase confirms this on the API keys screen: *"This key is safe to use in a browser
if you have enabled Row Level Security."* So you do **not** need to rotate or change any
keys — just enable RLS.

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

## Step 2 — Turn on the lock (RLS) — this is the fix
This is the step that actually stops strangers from reaching your patient data.

1. In the left sidebar, click **SQL Editor**.
2. Click **+ New query**.
3. Open the file `supabase/enable-rls.sql` from this project, **copy everything in it**,
   and paste it into the box.
4. Click the green **Run** button (bottom right, or press Ctrl+Enter).
5. You should see **"Success. No rows returned."** at the bottom. That's correct — it
   means it worked.

✅ The database is now locked to logged-in users only. **Your data is secure.**

---

## Step 2b — Enable image storage (needed to attach X-rays)
X-ray images now live in a private storage area instead of bloating the database.
This one-time step creates that storage. If you skip it, everything else works but
attaching an image will fail.

1. In the left sidebar, click **SQL Editor** → **+ New query**.
2. Open the file `supabase/setup-storage.sql` from this project, copy everything, paste
   it in, and click **Run**.
3. You should see **"Success. No rows returned."**

✅ You can now attach radiology images, and they stay private (only you can view them).

---

## Step 3 — Test that it all works
Run the app on your own computer to confirm you can still log in and see your surgeries.

1. Open a terminal: press **Start**, type **PowerShell**, open it.
2. Go into your project folder — type this and press **Enter**:

   ```
   cd C:\Users\migue\qxlog
   ```

3. Start the app — type this and press **Enter**:

   ```
   npm run dev
   ```

4. It prints a few lines, including one like `Local:  http://localhost:5173/`.
   Hold **Ctrl** and click that link (or paste it into your browser).
5. You should see a **login screen** with **Correo** and **Contraseña** boxes.
6. Enter the email + password from **Step 1**, click **Entrar**.
7. Your list of surgeries should load, just like before.

✅ If you can log in and see your cases, **everything is done and your data is secure.**

To stop the app when you're finished: go back to PowerShell and press **Ctrl + C**.

---

## Two things NOT to touch on the API keys screen
- ❌ **Don't click "Disable legacy API keys" / "Disable JWT-based API keys."** The app
  uses the legacy `anon` key — disabling it would break the app.
- 🔒 The **`service_role` `secret`** key (hidden behind "Reveal") is the dangerous one —
  it bypasses RLS. It was never in your code, and it must never go into the app or `.env`.
  Leave it hidden.

You do **not** need to rotate or change the `anon` key. Leave your `.env` as it is.

---

## If something goes wrong
- **Can't log in ("Credenciales incorrectas")** → the email/password doesn't match Step 1.
  Recheck it in Supabase → Authentication → Users.
- **Login works but the list is empty / "Error de conexión"** → RLS may not have run
  correctly; re-run Step 2. (You did not change any key, so the key isn't the issue.)
- **App shows your surgeries without asking you to log in** → your browser remembered an
  old session; hard-refresh with **Ctrl + Shift + R**.

---

_Related files: `supabase/enable-rls.sql` (the lock script), `GAPS.md` #1/#2 (the full
security rationale), `CLAUDE.md` (auth model)._
