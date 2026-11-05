# FORMA (workout site, ranks, leaderboard)

A multi-page site. Every page is a real file:

| File | What it shows |
|---|---|
| `index.html` | Home: greeting, today's workout, your rank, body map, quick links |
| `my-workout.html` | **My workout**: your own program (exercise list, kg/reps, log) and the rank it gives you |
| `rang.html` | Rank details, LVL / EXP, reference lifts, profile (weight, age, sex) |
| `clasament.html` | Leaderboard (online + offline players) |
| `special.html` | Special area: only for Admin / Owner accounts (hidden for everyone else) |
| `exemplu.html` | An example program (kept as a sample, not shown first) |

Shared files: `style.css`, `app.js`, `config.js`. Put your 7 rank pictures next to them: `novice.jpeg striker.jpeg beast.jpeg vanguard.jpeg elite.jpeg mythic.jpeg overlord.jpeg`.

## Two modes

**1. Local mode** (just open `index.html`): accounts live only in this browser. There is no e-mail (a static page cannot send mail), so e-mail verification is NOT available. You still get the 3-attempts / 30 s pause and the "not a robot" check, but these are only friction, not security.

**2. Server mode** (recommended): `server/server.js` serves these pages **and** the API. Accounts need a real e-mail (a 6-digit code is mailed and must be entered), passwords are hashed, sessions are secure cookies, the leaderboard is shared by everyone and computed on the server.

## Run the server (Node 22.13 or newer, no `npm install` needed)

```bash
cd server
cp .env.example .env            # then edit .env
npm run keys                    # prints DATA_KEY and SESSION_SECRET -> paste into .env
npm run owner-hash -- "ZEE4625COOL"   # prints OWNER_CODE_HASH -> paste into .env (code for the Panel button)
npm run dev                     # http://localhost:3000   (development: codes are printed in the console if SMTP is not set)
npm test                        # 36 end-to-end checks (real server + fake mail server)
```

### Real e-mails from Gmail
1. Google account -> Security -> turn on **2-Step Verification**.
2. Security -> **App passwords** -> create one for "Mail" (16 characters).
3. In `.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `SMTP_FROM=you@gmail.com`.
Any address (Gmail, Outlook, company mail...) can sign up; Gmail is only the mailbox that SENDS the code.

### "I am not a robot"
Create a free Cloudflare Turnstile widget, put the **site key** in `TURNSTILE_SITEKEY` and the **secret key** in `TURNSTILE_SECRET`. Without them the server uses its own signed math question (weaker).

### Deploy
Run it behind HTTPS (Render, Fly.io, Railway, a VPS with Caddy or nginx...). Set `NODE_ENV=production`, `APP_URL=https://your-domain`, `TRUST_PROXY=1`. In production the server redirects HTTP to HTTPS, sends HSTS and uses `__Host-` secure cookies. Keep `server/data/` on a persistent disk and back it up.

## Leaderboard on GitHub Pages (Supabase): see `GHID-SUPABASE-RO.md`
GitHub Pages is static, so the browser talks to Supabase directly (publishable key + Row Level Security from `supabase/leaderboard.sql`, anonymous sign-in for the people who opt in). Same rules as below: it refreshes itself once a day, plus a "Refresh now" button; offline players are listed from the saved copy.

## Leaderboard with Firebase instead (no server needed)
The Clasament can be shared by everybody with a free Firebase project. The site talks to Firebase with plain `fetch` (no SDK, no extra script).
1. https://console.firebase.google.com -> create a project.
2. Build -> **Authentication** -> Sign-in method -> turn on **Anonymous**.
3. Build -> **Firestore Database** -> create it -> **Rules** -> paste `firebase/firestore.rules` -> Publish.
4. Project settings -> Your apps -> Web app -> copy `apiKey` and `projectId` into `config.js` (`firebase:{apiKey:"...",projectId:"..."}`). The key is public by design; the rules are the protection.
5. Recommended: in Google Cloud -> APIs & Services -> Credentials, restrict that key to your site's domain and to the Identity Toolkit, Token Service and Cloud Firestore APIs (a referrer restriction does not work for `file://`, so host the site).
Players opt in with "Publish me on the online leaderboard". **The list refreshes itself once a day** (when the last refresh is older than 24 h: at login, on the Clasament page, and hourly while the page stays open), plus a "Refresh now" button (30 s cooldown). If Firebase cannot be reached, the last saved list is shown with everyone marked offline.
Limit: in Firebase mode the score is computed in the browser, so a determined user can post a fake score inside the rules' range. For a leaderboard that cannot be cheated use the server mode above (the server recomputes every score).

## Direct progress on My workout
Every exercise has `-` / `+` buttons for kg and reps (step 1, 2.5 or 5 kg). A click saves the program, so your rank updates immediately; the new weight is written to the log once you stop clicking. Rank pictures are shown inside a hexagon frame in the rank colour. The Special page and its tab exist only for Admin / Owner accounts (other accounts are redirected to the home page).

## Login rules
* 3 wrong attempts -> 30 second pause (per account; the Owner code is limited per IP too).
* Panel button on the login screen: type the owner code -> Owner account.
* Special page, owner panel (accounts) and moderation need the Admin / Owner role on the server.

See `SECURITY.md` for the 20-point checklist, what is done and what you still have to do.
