# VELA — Full Stack Content Monetization Platform

Dark luxury fitness content platform with free browsing, premium paywall, admin dashboard, and Telegram-delivered download links.

## Project structure

```
vela/
├── frontend/          → Deploy to Netlify
│   ├── index.html     → Public site
│   ├── admin.html     → Admin dashboard
│   ├── download.html  → One-time download redemption
│   └── netlify.toml   → Download route rewrite
└── backend/           → Deploy to Railway
    ├── server.js
    ├── routes/
    ├── services/
    └── db/schema.sql
```

## Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Supabase](https://supabase.com) project (free tier)
- [Railway](https://railway.app) account (backend)
- [Netlify](https://netlify.com) account (frontend)
- Telegram bot via [@BotFather](https://t.me/BotFather)
- Binance Pay merchant credentials (optional)
- PayPal REST API credentials (optional)

---

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the contents of `backend/db/schema.sql`
3. Go to **Storage** → create a bucket named `vela-content`
4. Set the bucket to **Private**
5. Copy your **Project URL** and **service_role key** (Settings → API)

---

## 2. Backend local setup

```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev
```

The API runs at `http://localhost:3000`. Health check: `GET /health`

### Required environment variables

See `backend/.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `ADMIN_SECRET` | Password for admin dashboard |
| `FRONTEND_URL` | Your Netlify URL (for CORS + download links) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (never expose to frontend) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username without @ |
| `TELEGRAM_PAYMENT_PROVIDER_TOKEN` | For Telegram Stars (BotFather → Payments) |

---

## 3. Frontend local setup

Update `API_BASE` in `frontend/index.html`, `frontend/admin.html`, and `frontend/download.html`:

- Local: auto-detects `localhost` → `http://localhost:3000`
- Production: set to your Railway URL, e.g. `https://vela-backend.railway.app`

Also replace `YOUR_BOT_USERNAME` in `index.html` with your Telegram bot username.

Serve the frontend with any static server:

```bash
cd frontend
npx serve .
```

Open `http://localhost:3000` (or whatever port serve uses) for the site, `/admin.html` for the dashboard.

---

## 4. Telegram bot setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy token to `.env`
2. Set bot username in `TELEGRAM_BOT_USERNAME`
3. For **Telegram Stars**: BotFather → `/mybots` → your bot → **Payments** → get provider token
4. Users pay via deep link: `https://t.me/YOUR_BOT?start=buy_CONTENT_ID`

The bot handles:
- `/buy` — list premium content and send Stars invoices
- `pre_checkout_query` — confirm payment
- `successful_payment` — auto-generate download link
- Post-verification link delivery for Binance/PayPal orders

---

## 5. Deploy backend → Railway

1. Push the `backend/` folder to GitHub
2. Create a new **Railway** project → **Deploy from GitHub**
3. Set root directory to `backend` (or deploy the backend folder as its own repo)
4. Add all environment variables from `.env.example` in the Railway dashboard
5. Railway provides a public URL like `https://vela-backend.railway.app`
6. Set `FRONTEND_URL` to your Netlify URL

---

## 6. Deploy frontend → Netlify

1. Push the `frontend/` folder to GitHub
2. Connect to **Netlify** → New site from Git
3. Base directory: `frontend` (if monorepo)
4. Build command: *(leave empty — static site)*
5. Publish directory: `.`
6. Update `API_BASE` in all three HTML files to your Railway URL
7. Update `YOUR_BOT_USERNAME` in `index.html`

Netlify serves:
- `/` → index.html
- `/admin.html` → admin dashboard
- `/download/:token` → download.html (via netlify.toml rewrite)

---

## API overview

### Public

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/content` | Active content (free items include file URLs) |
| GET | `/api/content/:id` | Single content item |
| POST | `/api/orders` | Submit payment (rate limited: 5/hr per IP) |
| GET | `/api/links/:token` | Redeem one-time download link |

### Admin (header: `X-Admin-Key: YOUR_ADMIN_SECRET`)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/admin/login` | Login with password |
| GET/POST | `/api/admin/content` | List / upload content |
| PATCH/DELETE | `/api/admin/content/:id` | Update / soft-delete |
| GET | `/api/admin/orders` | List all orders |
| POST | `/api/admin/orders/:id/verify` | Verify + send Telegram link |
| POST | `/api/admin/orders/:id/reject` | Reject order |

---

## Payment flows

### Binance Pay
1. Buyer sends USDT via Binance Pay
2. Submits TX ID on the site
3. Backend queries Binance Pay API for auto-verification
4. On success: download link sent via Telegram

### PayPal
1. Buyer sends payment via PayPal
2. Submits transaction/capture ID
3. Backend verifies via PayPal REST API
4. On success: link sent via Telegram

### Telegram Stars
1. Buyer opens bot via deep link from payment modal
2. Bot sends Stars invoice (~100 Stars ≈ $1 USD)
3. On payment: link delivered instantly in Telegram

---

## Security

- Admin routes require `X-Admin-Key` on every request
- Download tokens are UUID-based, single-use, 48-hour expiry
- Supabase storage is private — files only via server-signed URLs (60 min)
- Service key never exposed to frontend
- Order submissions rate-limited (5 per IP per hour)
- Text inputs sanitized before database insert
- CORS restricted to `FRONTEND_URL`

---

## Admin dashboard

Open `/admin.html` on your Netlify site:

1. **Content tab** — upload videos/photos/PDFs, set prices, toggle active status
2. **Orders tab** — view pending orders, verify/reject, auto-refresh every 30s

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS errors | Ensure `FRONTEND_URL` in Railway matches your exact Netlify URL |
| Content not loading | Check Supabase credentials and that schema.sql was run |
| Telegram link not sent | User must have started the bot first; verify handle includes @ |
| Upload fails | Confirm storage bucket `vela-content` exists and is private |
| Binance auto-verify fails | Orders stay pending — verify manually in admin dashboard |

---

## License

Private project — all rights reserved.
