# Clasament cu Supabase pe GitHub Pages: ce faci tu, pas cu pas

## De ce nu Flask pe GitHub?
GitHub Pages servește **doar fișiere statice** (HTML, CSS, JS, poze). Nu poate rula Python/Flask și nici serverul Node. Soluția: paginile vorbesc **direct cu Supabase din browser**. Cheia `sb_publishable_...` este **publică prin design**; datele sunt protejate de **Row Level Security (RLS)**, scris în `supabase/leaderboard.sql`. Deci pentru siteul de pe GitHub **nu ai nevoie de Flask**.

## Pașii (în ordine)

### 1. Supabase: creezi tabelul (o singură dată)
1. Intră în dashboard-ul proiectului tău Supabase.
2. Meniu stânga → **SQL Editor** → **New query**.
3. Deschide fișierul `supabase/leaderboard.sql`, copiază TOT conținutul, lipește-l în editor → **Run**.
4. Verifică: **Table Editor** → apare tabelul `leaderboard`, cu eticheta „RLS enabled”.

### 2. Supabase: permiți utilizatori anonimi (altfel nu se poate publica)
**Authentication** → **Sign In / Providers** → activează **Allow anonymous sign-ins** → Save.
(Recomandat: tot la Authentication, la rate limits / attack protection, lasă limitele implicite.)

### 3. Cheile: ce pui și ce NU pui pe GitHub
- Pe GitHub pui **doar** URL-ul proiectului și cheia **Publishable** (`sb_publishable_...`). Sunt deja în `config.js`.
- **Nu pune niciodată** `sb_secret_...` sau `service_role` în repo. Dacă ai greșit: Project Settings → API Keys → revocă și creează alta.
- `.env` din fragmentul Flask nu are rost pe GitHub Pages (e ignorat de `.gitignore`).

### 4. Ce urci în repository-ul GitHub
La **rădăcina** repo-ului pui fișierele siteului:
`index.html, my-workout.html, rang.html, clasament.html, special.html, exemplu.html, style.css, app.js, config.js, .nojekyll` + cele 7 poze de rang (`novice.jpeg, striker.jpeg, beast.jpeg, vanguard.jpeg, elite.jpeg, mythic.jpeg, overlord.jpeg`).
Folderele `server/`, `python-flask/`, `firebase/`, `supabase/` nu sunt necesare pentru GitHub Pages (poți să le ții în repo ca documentație; nu se execută).

### 5. Unde modifici ceva
Doar în `config.js` (pe GitHub: deschizi fișierul → creionul ✏️ → editezi → **Commit changes**):
```js
window.FORMA_CFG={
  server:false,
  turnstile:"",
  supabase:{url:"https://PROIECTUL-TAU.supabase.co",key:"sb_publishable_..."},
  firebase:{apiKey:"",projectId:""}
};
```
Dacă proiectul e cel din mesajul tău, e deja completat.

### 6. Pornești GitHub Pages
Repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → Save. După ~1 minut siteul e la `https://UTILIZATOR.github.io/NUME-REPO/`.

### 7. Testezi
1. Deschide siteul, creează un cont, mergi la **My workout**, adaugă „Împins la bancă” cu kg (sau apasă **+**).
2. **Clasament** → bifează **Publică-mă în clasamentul online**.
3. În Supabase → **Table Editor** → `leaderboard`: trebuie să apară rândul tău.
4. Clasamentul se actualizează **singur o dată pe zi**; butonul „Actualizează acum” îl actualizează oricând (pauză de 30 s).

## Dacă nu merge: ce scrie pe pagina Clasament
| Mesaj | Cauză | Ce faci |
|---|---|---|
| `sb-404` | tabelul nu există | rulezi `supabase/leaderboard.sql` |
| `sb-401` | cheie sau URL greșit | verifici `config.js` |
| `sb-auth-422` / `sb-auth-4xx` | anonymous sign-ins oprit | pasul 2 |
| `Nu am putut publica (sb-403)` | lipsesc politicile RLS | rulezi din nou SQL-ul |
| `Nu am putut publica (sb-400)` | valoare în afara limitelor | actualizezi siteul la ultima versiune |
| „Serverul nu e disponibil aici” | `config.js` fără `supabase` | pasul 5 |

## Flask (opțional)
Folderul `python-flask/` e fragmentul tău adaptat la tabelul `leaderboard`. Îl folosești doar **local** (previzualizare la http://127.0.0.1:5000) sau dacă ții un API Flask pe alt serviciu (Render, PythonAnywhere). Pași: `cd python-flask` → `pip install -r requirements.txt` → copiezi `.env.example` în `.env` → `python app.py`. Nu se urcă pe GitHub Pages.

## Limite, ca să știi
- Scorul îl calculează browserul, deci cineva hotărât poate publica un scor fals între 0 și 7 (regulile îl opresc să iasă din limite). Pentru un clasament fără trișat, calculul trebuie făcut pe un server (Supabase Edge Function sau Flask cu cheia secretă păstrată doar pe server, niciodată pe GitHub Pages).
- Identitatea este „anonimă”, legată de browser: dacă ștergi datele siteului, apare o intrare nouă (cea veche o ștergi din Table Editor).
