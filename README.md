# MeetFlow Pro — shared database web app

MeetFlow is a responsive meeting booking website and installable Progressive Web App. It uses Supabase PostgreSQL, so every visitor sees the same bookings on desktop and mobile.

## 1. Create the working database

1. Go to https://supabase.com and create a free project.
2. Open **SQL Editor → New query**.
3. Copy the full contents of `supabase-schema.sql`, paste it, and press **Run** once.
4. Open **Project Settings → API**.
5. Copy the **Project URL** and **Publishable key**. An older project may label the client key `anon`.
6. Open `supabase-config.js` and replace the two placeholder values:

```js
window.MEETFLOW_SUPABASE = {
  url: 'https://YOUR_PROJECT.supabase.co',
  key: 'YOUR_PUBLISHABLE_OR_ANON_KEY'
};
```

The publishable/anon key is intended for browser code. Never paste a `service_role` or secret key into this file.

The SQL creates:
- one shared `bookings` table;
- business-hour, duration and 15-minute interval checks;
- an exclusion constraint that atomically blocks overlaps and the 15-minute buffer;
- Row Level Security and least-privilege grants;
- `create_booking` and token-protected `cancel_booking` database functions.

Names and schedules are public to website visitors. A cancellation token stays only in the browser that created the booking, so another visitor can see that booking but cannot cancel it. Clearing browser data removes that cancellation ability.

## 2. Test locally

Extract the ZIP and open a terminal in the `meetflow-pro` folder:

```bash
python -m http.server 5500
```

Open http://localhost:5500. You can also use the VS Code **Live Server** extension. Make one booking, then open the same address in another browser/incognito window. The booking should appear there within 30 seconds or after refresh.

Run logic and schema checks:

```bash
npm test
```

## 3. Push to GitHub

Create a new empty GitHub repository, then run inside `meetflow-pro`:

```bash
git init
git add .
git commit -m "Build MeetFlow shared booking app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

GitHub may ask you to sign in. If the folder already has Git configured, commit and push without running `git init` or adding the remote again.

## 4. Deploy on Vercel

1. Go to https://vercel.com and sign in with GitHub.
2. Press **Add New → Project** and import the GitHub repository.
3. Set **Framework Preset** to **Other**.
4. Leave **Build Command** empty.
5. Leave **Output Directory** empty.
6. If this folder sits inside a larger repository, set **Root Directory** to `meetflow-pro`.
7. Press **Deploy**.

No Vercel environment variables are required because this plain static site reads the browser-safe values from `supabase-config.js`. Vercel automatically redeploys when you push later commits to the connected branch. See the official [Vercel Git deployment guide](https://vercel.com/docs/git).

After deployment, open the Vercel URL on mobile and desktop and create a booking on one device. Confirm it appears on the other. Then test an overlapping time, 11:00 AM after a 10:00–11:00 AM booking, cancellation, date switching, and app installation.

## App installation

Open the HTTPS Vercel URL and press **Install app**:
- Android Chrome: menu → Install app / Add to Home screen.
- iPhone/iPad Safari: Share → Add to Home Screen.
- Desktop Chrome/Edge: address-bar install icon or browser menu.

This creates an installed PWA. It is not an APK/IPA or store submission. The interface shell can open offline, but viewing or changing shared bookings needs internet.

## Security and limitations

Supabase recommends enabling RLS on exposed tables and granting client roles only the operations they need. This project does both, and the client cannot directly insert or delete table rows. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

This public assessment app has no accounts, rate limiting, email reminders or administrator panel. Anyone can create a valid booking and see names. For production, add authentication, CAPTCHA/rate limiting, an admin role, audit logging and a server-defined business timezone. Current past-time validation uses each visitor’s device clock; database conflict enforcement remains authoritative.

## Files

- `supabase-schema.sql` — database schema, constraints, security policies and RPC functions
- `supabase-config.js` — Project URL and browser-safe publishable key
- `index.html`, `styles.css`, `meetflow.js` — responsive application
- `manifest.webmanifest`, `sw.js`, icons — installable PWA
- `tests.js` — logic and schema assertions
- `browser-check.cjs` — optional Playwright acceptance test with a mocked Supabase API
