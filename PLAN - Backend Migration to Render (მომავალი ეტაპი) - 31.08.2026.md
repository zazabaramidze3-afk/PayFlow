# Backend Migration Plan — Render.com
**სტატუსი:** 📋 დაგეგმილი, **არ არის საჭირო დღეისთვის**
**თარიღი:** 31.08.2026
**კონტექსტი:** ROADMAP - Multi-Tenant SaaS - 28.08.2026.md-ის Priority 4-ის დაზუსტება

---

## რატომ ვწერთ ამას ახლა

დღეს production მუშაობს სრულად Vercel-ზე (frontend + backend serverless functions), Neon PostgreSQL-თან ერთად. ეს **საკმარისია** ამჟამინდელი დატვირთვისთვის. ეს დოკუმენტი მხოლოდ *მომავლის დაზღვევის* გეგმაა — არა დღევანდელი ამოცანა.

---

## პრობლემა: Vercel Free Tier ლიმიტი

Backend (Express) Vercel-ზე მუშაობს როგორც **serverless function** — იხსნება ყოველ request-ზე, პასუხობს, იხურება. Free tier-ს აქვს **დღიური ლიმიტი**:

- 100 MB-execution/day (AWS Lambda-ის ჯამური execution time)

**დღეს** ეს ლიმიტი შორსაა — მცირე ტესტები/ტრანზაქციები. **მომავალში** შეიძლება მიაღწიო ლიმიტს, თუ:
- მრავალი org/client დაემატება მასობრივად
- ტრანზაქციების რაოდენობა მნიშვნელოვნად გაიზრდება
- Aggregation queries (dashboard reports) ხშირად გამოიძახება

---

## გამოსავალი: Backend → Render.com

### არქიტექტურა (მომავალი state)

| კომპონენტი | სად | ცვლილება |
|---|---|---|
| Frontend (React/Vite) | Vercel | ❌ **უცვლელი რჩება** |
| Backend (Express/Node) | Render.com | ✅ გადადის (persistent server) |
| Database (PostgreSQL) | Neon | ❌ **უცვლელი რჩება** |

**რატომ Render:** persistent სერვერი, execution-time დღიური ლიმიტის გარეშე. Vercel კარგია static/SPA-სთვის (CDN, სისწრაფე) — ეს ნაწილი უცვლელად რჩება.

### ტექნიკური ცვლილებები (როცა დრო მოვა)

1. **`frontend`-ის `VITE_API_URL`** — გადამისამართება Render backend URL-ზე
2. **CORS კონფიგურაცია** (`backend/src/index.ts` ან სადაც `cors()` არის) — Vercel frontend origin-ის დამატება allowed origins-ში
3. **Render Web Service setup** — Dockerfile ან native Node build command
4. **Environment variables** გადატანა Render Dashboard-ზე: `DATABASE_URL`, `JWT_SECRET`, სხვა secrets — **არასდროს commit git-ში**
5. **Health check endpoint** (`GET /health`) — Render-ის მოთხოვნაა uptime-ის მონიტორინგისთვის

---

## დაკავშირებული საკითხი: Subdomain Routing (STEP 7)

Subdomain routing (`tenant.payflow.io`) **ასევე ველოდებით** — მოითხოვს:
- **Paid domain** wildcard DNS records-ით (`*.payflow.io`)
- `*.vercel.app`-ზე wildcard subdomains **არ მუშაობს** (Vercel Hobby plan ლიმიტაცია)

**დასკვნა:** Render migration + paid domain — ორივე ერთად უნდა დაიგეგმოს, რადგან ორივე production-ის "მომწიფების" ერთი და იგივე ეტაპია.

---

## Trigger პირობები — როდის დავიწყოთ

დაიწყე ეს გეგმა, როცა რომელიმე ამათგანი მოხდება:

- [ ] Vercel Dashboard-ის usage მეტრიკები ლიმიტთან უახლოვდება (შემოწმება: Vercel → Project → Usage)
- [ ] ახალი org-ების/client-ების მასობრივი დამატება იგეგმება
- [ ] კლიენტისგან მოთხოვნილია production SLA (99.9% uptime, backup/restore გარანტიები)
- [ ] Paid domain შეძენილია (`payflow.io` ან მსგავსი) და subdomain routing (STEP 7) გადაწყდა დაწყებულიყო

---

**წყარო საუბარი:** Claude Cowork session, 31.08.2026
