# SLIS-Jeddah Quran Class Management

A free, mobile-friendly system for running the Quran class: admissions, student and teacher
profiles, classes, QR-code attendance, WhatsApp notices and Excel/PDF reports.

Runs entirely on free tiers: **GitHub** (code) → **Netlify** (website) → **Supabase** (logins + database).
Built for under 200 students.

## What each person can do

| Role | Can do |
|---|---|
| **Student / parent** | Create an account, fill in the admission form, see admission status, get their attendance QR code, see their attendance history |
| **Teacher** | See their own classes and students, take attendance by scanning QR codes or tapping Present/Late/Absent/Excused, send absence notices on WhatsApp, download reports for their classes |
| **Admin** | Everything: approve or reject admissions (with a WhatsApp confirmation), add/edit students, create classes and assign teachers, give people teacher/admin access, take attendance for any class, download reports for all classes |

Everyone signs up the same way and starts as a **student**. The admin then promotes teachers under **Users**.

## One-time setup

### 1. Supabase (database and logins)
1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Go to **Project Settings → API** (or **Connect**) and copy the **Project URL** and the **anon / public** key.
4. Go to **Authentication → URL Configuration**. Set **Site URL** to your Netlify address
   (for example `https://qcslisj.netlify.app`) and add the same address under **Redirect URLs**.

### 2. Netlify (website)
1. In Netlify, open the site → **Site configuration → Environment variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon/public key
2. Make sure the site is linked to this GitHub repository (**Site configuration → Build & deploy**).
   Build settings come from `netlify.toml` automatically (build command `npm run build`, publish folder `dist`).
3. Go to **Deploys → Trigger deploy → Deploy site**.

### 3. Make yourself the admin
1. Open the website and **Create an account** with the admin email.
2. Confirm the email from the link Supabase sends you.
3. Back in Supabase **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role = 'admin' where email = 'quranclass.slisj@yahoo.com';
   ```
4. Sign out and sign in again. You will now see the admin menu.

### 4. Start using it
1. **Classes** → create your classes.
2. Ask each teacher to create an account, then **Users** → change their role to **Teacher**, and assign them a class.
3. Share the website link with parents. Their applications appear under **Admissions**. Approve each one,
   choose a class, then tap **Send WhatsApp confirmation**.

## How attendance works
- Each approved student gets a personal QR code (under **My Admission**, or the admin can print it from **Students → QR**).
- The teacher opens **Attendance**, chooses the class and date, taps **Scan QR codes** and points the phone camera at each code.
  Students are marked present instantly.
- Anyone without their code can be marked by tapping Present / Late / Absent / Excused, then **Save**.
- After saving, absent students show a **WhatsApp** button to notify the guardian.

## WhatsApp
Messages open in WhatsApp (app or web) with the text already written. You press send. This is free and needs no
WhatsApp Business API. Saudi numbers like `05xxxxxxxx` are converted to `9665xxxxxxxx` automatically.

## Reports
**Reports** → choose class and date range → **Download Excel** (three sheets: student summary, daily summary, all records)
or **Download PDF**. Students under 75% attendance are highlighted.

## Running it on your own computer (optional)
```bash
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

## Security notes
- All data is protected by Supabase row-level security: students see only their own record, teachers only their own classes.
  Nobody who is not signed in can read anything.
- Never put the Supabase `service_role` key in this code, in Netlify, or on GitHub. The app only needs the anon key.
- Never commit `.env.local`.
- Test with dummy data first, and get parent/guardian consent before storing children's details
  (the admission form includes a consent checkbox).

## Staying free and online every day

| Service | Free limit | What this project does about it |
|---|---|---|
| **Supabase** | Free projects **pause after ~7 days with no activity** (for example during school holidays). Data is kept, but the site stops working until someone clicks *Resume project*. | `.github/workflows/keep-alive.yml` pings the database every day so it never pauses. Add the two secrets below once. |
| **Netlify** | 300 credits a month. Each successful deploy costs about 15 credits, and visitors' traffic also uses credits. If they run out, the site shows "Site not available" until the next month. | The app is small, and a class of under 200 students uses very little traffic. **Each GitHub upload triggers a deploy**, so upload changes in one go rather than file by file. Check **Netlify → Usage** occasionally. |
| **GitHub** | Free for public repositories, including the daily job. GitHub switches off scheduled jobs in repos with no activity for 60 days. | The job re-enables itself each day. If GitHub ever emails that it was disabled, open **Actions → Keep Supabase awake → Enable workflow**. |

**Turn on the keep-alive (one time):** in GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**
and add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the same two values you gave Netlify). Then open
**Actions → Keep Supabase awake → Run workflow** to test it. It should finish with a green tick.
