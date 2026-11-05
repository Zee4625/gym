# Security checklist (status in this project)

Legend: **Done** = implemented and covered by `npm test` or checked by hand. **You** = needs an action only you can do. **Limit** = honest limitation.

| # | Item | Status | Where / how |
|---|---|---|---|
| 1 | Hide API keys | **Done** | The browser has no secrets: `config.js` holds only `server: true/false` and the *public* Turnstile site key. SMTP password, keys, owner-code hash live in `server/.env` (git-ignored). **You:** fill `.env`, never paste keys into HTML/JS. |
| 2 | Purge Git secrets | **You** | `.gitignore` blocks `.env` and data. `node scripts/scan-secrets.js --history` scans files and all history; CI runs it on every push. If it finds a real secret: rotate it first, then `git filter-repo --replace-text` / BFG, force-push. I cannot touch your repository. |
| 3 | Use public DB key | **Done** | Server mode: the browser never gets a DB key (SQLite sits behind the API). Firebase mode: the only key in the browser is the public web `apiKey` (`config.js`); no admin / service key is ever shipped. Supabase alternative: only the `anon` key (see `supabase/leaderboard.sql`). |
| 4 | Enable RLS | **Done / You** | Firebase: `firebase/firestore.rules` (each browser can only write its own entry, only allowed fields and ranges, default deny): **You** must publish them in the console. Server mode: every query is scoped to the session user in code. `supabase/leaderboard.sql` is the Supabase version (tested only against a simulated Supabase, not a real project). |
| 5 | Encrypt sensitive data | **Done** | E-mails and training data: AES-256-GCM at rest (`DATA_KEY`). E-mail lookup uses an HMAC index. Passwords: scrypt. In transit: HTTPS. Name, bio, links, avatar and score are stored plain because they are public by design. |
| 6 | Enforce server-side auth | **Done** | Every private endpoint checks a session row in the database; admin endpoints check `role` on the server. Hiding the Special page in the browser is only cosmetic. **Limit:** the G program text is inside `app.js`, so anyone can read it. Move it to the server if it must stay secret. |
| 7 | Lock record access | **Done** | Users only read/write their own row. Public ids are HMAC pseudonyms (no sequential ids); the leaderboard never exposes e-mail or role. |
| 8 | Block field tampering | **Done** | Every body is rebuilt field by field (whitelist, ranges, lengths). The client never sends a score: the server recomputes it from the saved program (`rank.js`). `role` changes only through the owner API. Tested. |
| 9 | Secure session cookies | **Done** | `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Strict`, 256-bit random token, only its SHA-256 is stored, 30-day expiry, revoked on logout/delete. |
| 10 | Hash passwords | **Done** | scrypt (N=16384, r=8, p=1), random salt, timing-safe compare, dummy hash for unknown accounts (no timing leak). |
| 11 | Rate limit login | **Done** | 3 wrong attempts -> 30 s pause per account (unknown e-mails behave the same), per-IP windows on login/signup/verify/owner, global limiter. **Limit:** counters are in memory (reset on restart, per instance). |
| 12 | Add bot protection | **Done / You** | Cloudflare Turnstile verified on the server when you set the keys; otherwise a signed one-time math challenge (weaker). Honeypot + minimum-time check in the form. |
| 13 | Parameterize queries | **Done** | Only prepared statements (`db.prepare(...).run(?)`); no SQL is built from strings. |
| 14 | Validate all input | **Done** | Strict validators for e-mail, name, password, program, profile, JSON size caps, content-type check. |
| 15 | Escape user content | **Done** | API returns JSON only. The browser escapes every user string before inserting it in HTML; links are built only as `http(s)`; avatars must be `data:image/jpeg|png`. |
| 16 | Restrict file uploads | **Done** | Only avatars: browser accepts jpeg/png/webp up to 4 MB and re-encodes to a 160 px JPEG (metadata stripped); server accepts only jpeg/png data URLs up to 60 KB with magic-byte check. No files are written to disk. |
| 17 | Trim API responses | **Done** | Leaderboard returns only `id,name,avatar,bio,soc,score,scores,online,seen`. `/me` returns the caller's own data only. No hashes, indexes or other users' e-mails. |
| 18 | Add security headers | **Done** | On GitHub Pages (cannot send headers) every page carries a CSP `<meta>`; the server sends the real headers. CSP (self + fonts + Turnstile + Supabase/Firebase), HSTS (production), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP, `no-store` on the API. |
| 19 | Force HTTPS | **Done / You** | In production HTTP is redirected (308) and HSTS is sent. **You:** run behind an HTTPS host/proxy that sets `x-forwarded-proto`. |
| 20 | Scan dependencies | **Done** | The server has **zero npm dependencies** (Node built-ins only), so there is nothing to poison. `npm audit`, Dependabot and a CI workflow are included in case you add some. The browser loads only Google Fonts and (optionally) the Turnstile script. |

## Not covered yet (be aware)
* Firebase-only mode trusts the browser for the score (rules only bound it to 0-7). Use server mode for a tamper-proof board.
* **No password reset** flow (only "resend code"). Add one before real users depend on it.
* No 2-factor login. The Owner "Panel" code is a shared secret: use a long random code, keep it only as a hash, rotate it if leaked.
* `node:sqlite` is marked experimental by Node. Fine for a small site; for large traffic move to Postgres.
* E-mail sending was verified against a local fake SMTP server (protocol, content, recipient) but **not** against real Gmail, and Turnstile was not tested live: do one real signup after deploying.
