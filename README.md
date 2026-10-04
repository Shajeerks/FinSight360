# FinSight360

Personal finance management: bank accounts, credit cards, loans and EMIs, income, expenses, investments, statement imports and insights, all in one place.

- Runs at **http://localhost:3010**. Port 3000 is never used, so your other app is safe.
- Stack: Next.js 16 (App Router) + TypeScript, Tailwind CSS 4 with shadcn-style components, PostgreSQL + Prisma 6, Auth.js v5, Zod, React Hook Form, Recharts and Vitest.
- Money is stored as `DECIMAL(18,2)` and calculated with decimal arithmetic, never JavaScript floats.

> FinSight360 provides personal financial analysis, **not** financial advice.

---

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Project setup, authentication, database, layout, navigation, theme, dashboard shell | ✅ Done |
| 2 | Bank accounts, credit cards, income, expenses, transactions, categories, rules | ✅ Done |
| 3 | Loan/EMI engine UI, amortization, interest analysis | ✅ Done |
| 4 | Statement import (CSV/XLSX/PDF), duplicate detection, review workflow | ✅ Done |
| 5 | Gmail and Outlook integration, email transaction parser | ✅ Done |
| 6 | Investment portfolio, Groww provider | ✅ Done |
| 7 | Analytics, spending intelligence, recurring expenses, net worth, budgets, reports | ✅ Done |
| 8 | Notifications, reminders, PWA, mobile optimization | ✅ Done |
| 9 | Testing, security, performance and production readiness | ✅ Done |

All nine phases are complete.

---

## 1. One-time setup (macOS)

You need **Node.js 20.9 or newer** and **PostgreSQL**. Check Node with:

```bash
node -v      # must print v20.9.0 or higher (v22 recommended)
```

If Node is missing, install it from https://nodejs.org (LTS) or run `brew install node@22`.

### Step 1: Open Terminal and go to the project

```bash
cd ~/finsight360
```

### Step 2: Install packages

```bash
npm install
```

This downloads everything, including Prisma's macOS database engine, and generates the database client. It takes 1–3 minutes.

### Step 3: Configure `.env`

One command creates `.env` with fresh random secrets:

```bash
npm run setup:env
```

This assumes PostgreSQL on port **5433** (Docker or Homebrew, see Step 4). If yours uses another port, run this instead:

```bash
npm run setup:env -- --port 5432
```

> Tip: paste commands one per line. macOS zsh treats `# comments` typed after a command as extra arguments.

`.env` is in `.gitignore`. Never commit it.

### Step 4: Start PostgreSQL

Choose **one** option.

**Option A: Docker (easiest).** Install Docker Desktop, start it, then run:

```bash
npm run db:up
```

This starts PostgreSQL 16 on port **5433**, so it won't clash with any other PostgreSQL on 5432. It also creates the `finsight360` database and a separate `finsight360_test` database for tests. The default `.env` already points at it.

**Option B: Homebrew PostgreSQL (no Docker).** This runs on port 5433, so it never clashes with another PostgreSQL (for example pgAdmin's) on 5432. Paste one line at a time:

```bash
brew install postgresql@16
sed -i '' 's/^#\{0,1\}port = [0-9]*/port = 5433/' /opt/homebrew/var/postgresql@16/postgresql.conf
brew services start postgresql@16
pg_isready -h localhost -p 5433
/opt/homebrew/opt/postgresql@16/bin/psql -p 5433 postgres
```

At the `postgres=#` prompt, run:

```sql
CREATE USER finsight WITH PASSWORD 'finsight_dev' CREATEDB;
CREATE DATABASE finsight360 OWNER finsight;
CREATE DATABASE finsight360_test OWNER finsight;
\q
```

**Option C: an existing PostgreSQL on another port.** Create the same user and databases with an admin login, then run `npm run setup:env -- --force --port <port>`.

### Step 5: Create the tables (Prisma migration)

```bash
npm run db:deploy
```

This applies `prisma/migrations/20261004000000_init`. Later, when the schema changes during development, use `npm run db:migrate`.

### Step 6: Load seed data

```bash
npm run db:seed
```

- This always loads the built-in categories (Food → Food Delivery, and so on) and system settings.
- In development it also creates a **demo user** with realistic sample data:
  - **Email:** `demo@finsight360.local`
  - **Password:** `Demo@123456`
- The demo data includes 2 bank accounts, 3 credit cards, 2 loans with full EMI schedules, about 160 transactions over 6 months, recurring payments, investments and reminders.
- Running the seed again resets the demo user. It never touches other accounts.
- Demo data is refused when `NODE_ENV=production` or `SEED_DEMO_DATA=false`.

### Step 7: Start the app

```bash
npm run dev
```

Open **http://localhost:3010**. Sign in with the demo account, or click **Create an account** to make your own.

### Stopping the app

- Press **Ctrl + C** in the Terminal window running `npm run dev`.
- To stop the Docker database as well, run `npm run db:down`. Your data is kept in a Docker volume.

### Every day after the first setup

```bash
cd ~/finsight360
npm run db:up        # only if you use Docker and it isn't running
npm run dev
```

---

## 2. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on http://localhost:3010 |
| `npm run build` | Production build |
| `npm run start` | Run the production build on port 3010 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit tests (no database needed) |
| `npm run test:integration` | Integration tests (uses `DATABASE_URL_TEST`, which is wiped on every run) |
| `npm run test:all` | All tests |
| `npm run check` | Lint + type check + all tests |
| `npm run db:up` / `db:down` | Start/stop the Docker PostgreSQL |
| `npm run db:deploy` | Apply migrations |
| `npm run db:migrate` | Create and apply a new migration after editing `schema.prisma` |
| `npm run db:seed` | Load reference data and demo data |
| `npm run db:reset` | ⚠️ Delete all data, re-apply migrations and re-seed |
| `npm run db:studio` | Browse the database at http://localhost:5556 |
| `npm run jobs:daily` | Run the daily jobs now (net-worth snapshot, recurring detection, due notifications) |
| `npm run sync:email` | Sync connected mailboxes once |

### Production build

```bash
npm run build
npm run start
```

See **§11 Production deployment** before putting FinSight360 on a server.

---

## 3. Sign-in

### Email and password (works out of the box)

- Passwords are hashed with bcrypt (cost 12) and never stored in plain text.
- Passwords need at least 10 characters, with uppercase and lowercase letters and a number.
- After 5 wrong passwords the account is locked for 15 minutes. Attempts are also rate-limited per email and IP.
- Sessions use secure HTTP-only cookies and expire after `SESSION_MAX_AGE_HOURS` (7 days by default).
- **Settings → Security → Sign out everywhere** instantly ends every session. Changing or resetting your password does the same.
- **Forgot password** emails a single-use link that is valid for 30 minutes. Only a SHA-256 hash of the token is stored.
- In development, emails are printed in the Terminal running `npm run dev` (`EMAIL_TRANSPORT="console"`). Real SMTP delivery arrives with notifications in Phase 8.
- Email verification links are sent on sign-up. Set `REQUIRE_EMAIL_VERIFICATION="true"` to block sign-in until the email is verified.
- After creating your own account you can set `ALLOW_REGISTRATION="false"` to stop new sign-ups.

### Google sign-in (optional)

1. Go to https://console.cloud.google.com, create a project, then open **APIs & Services → OAuth consent screen**. Choose **External** and add yourself as a test user.
2. Open **Credentials → Create credentials → OAuth client ID** and choose **Web application**.
   - **Authorized JavaScript origin:** `http://localhost:3010`
   - **Authorized redirect URI:** `http://localhost:3010/api/auth/callback/google`
3. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart `npm run dev`.
4. The **Continue with Google** button appears automatically.

Signing in with Google only requests your name and email. Gmail access is a separate, explicit consent step (see “Email sync” below). Microsoft sign-in can be added later; the place for it is marked in `auth.ts`.

### Email sync — Gmail / Outlook (optional, Phase 5)

FinSight360 reads **bank and card alert emails** (read-only) to add transactions automatically. You never type your email password into FinSight360; access tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY`, and email bodies are read in memory only (a fingerprint is kept, not the text).

**Gmail**
1. In https://console.cloud.google.com (same project as Google sign-in is fine) open **APIs & Services → Library**, search **Gmail API** and press **Enable**.
2. **OAuth consent screen → Data access / Scopes:** add `.../auth/gmail.readonly`. While the app is in *Testing*, add your Gmail address under **Test users**.
3. **Credentials → your Web OAuth client** (or a new one) → add the redirect URI `http://localhost:3010/api/email/callback/gmail`.
4. Put the client ID/secret into `.env` as `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`, restart, then open **Email Sync → Connect Gmail**.

**Outlook / Microsoft 365**
1. https://entra.microsoft.com → **App registrations → New registration**. Supported accounts: *personal and work accounts*. Redirect URI (Web): `http://localhost:3010/api/email/callback/outlook`.
2. **API permissions → Microsoft Graph → Delegated:** `Mail.Read`, `offline_access`, `User.Read`.
3. **Certificates & secrets → New client secret.** Put the Application (client) ID and the secret value into `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (leave `MICROSOFT_TENANT_ID="common"`), restart, then **Connect Outlook**.

Without these settings the Email Sync page still works for testing: paste an alert into **Try the alert reader** to see what would be imported. `npm run sync:email` syncs every connected mailbox once (useful with cron if the app isn't kept running).

---

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection |
| `DATABASE_URL_TEST` | for tests | Separate test database (wiped by tests) |
| `AUTH_SECRET` | ✅ | Signs session tokens (`openssl rand -base64 32`) |
| `AUTH_URL`, `APP_URL` | ✅ | `http://localhost:3010` |
| `TOKEN_ENCRYPTION_KEY` | Phase 5+ | AES-256-GCM key for stored OAuth tokens |
| `SESSION_MAX_AGE_HOURS` | – | Session lifetime (default 168) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | Google sign-in |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Phase 5 | Gmail import |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | Phase 5 | Outlook import |
| `EMAIL_TRANSPORT`, `EMAIL_FROM` | – | Email delivery: `console` (prints to the terminal) or `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | with `smtp` | SMTP server for password-reset and notification emails (Gmail app password, Zoho, SES, Brevo…) |
| `REQUIRE_EMAIL_VERIFICATION` | – | Block sign-in until the email is verified |
| `ALLOW_REGISTRATION` | – | Allow new sign-ups |
| `STORAGE_DIR` | – | Where uploaded statements are kept (default `./storage`, private and gitignored) |
| `EMAIL_SYNC_INTERVAL_MINUTES` | – | Background mailbox sync while the app runs (default 60; `0` = off) |
| `AMFI_NAV_URL` | – | Mutual-fund NAV source (default AMFI's public `NAVAll.txt`) |
| `TRUST_PROXY` | – | `true` only behind a reverse proxy you control (then X-Real-IP is trusted for rate limits) |
| `SEED_DEMO_DATA` | – | Set to `false` to skip demo data when seeding |
| `PRISMA_JS_ENGINE` | – | Set to `1` only if Prisma can't download its engines (restricted networks) |

---

## 5. Updating after a new phase

When a new phase is delivered into your folder, run these one at a time:

```bash
cd ~/finsight360
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

- `db:deploy` applies only the new database changes; your own data is kept.
- `db:seed` is optional. It resets only the **demo** user (`demo@finsight360.local`), never your own account.

## 6. Using the app

| Page | What you can do |
|---|---|
| **Bank Accounts** | Add savings, salary or current accounts and cash wallets. Balances update automatically from transactions. Editing an account lets you enter the balance your bank shows today, and FinSight360 reconciles to it. Removing an account hides it but keeps its history. |
| **Credit Cards** | See total limit, outstanding, available limit, overall and per-card utilization, upcoming dues and overdue cards. **Record payment** creates a card-bill payment from a bank account: it lowers the card's outstanding and the bank balance, and is never counted as an expense. Payments made this billing cycle reduce the amount still due. |
| **Transactions** | One ledger for everything. Search and filter by date range, account or card, category, sub-category, merchant, amount range, type, money in/out, source, duplicate status, imported/manual and review status. Filters are kept in the URL. You can add, edit and delete from here. |
| **Income** | Monthly income by type (Salary, Freelance, Rental…) and by source/payer. Use **Add Income** to record new income. |
| **Expenses** | Monthly spending by category and sub-category, split into fixed and discretionary, plus payment methods. Refunds are netted off. EMIs, investments and card-bill payments are excluded. |
| **Settings → Categories** | Built-in categories plus your own. You can add sub-categories under any category. |
| **Settings → Transaction Rules** | Merchant, keyword and amount rules, e.g. SWIGGY → Food → Food Delivery. **Apply to uncategorized** re-runs the rules on existing transactions and never overrides a category you chose. |

**Transaction types:** Expense, Income, Transfer between my accounts (stored as two linked entries), Credit-card bill payment, Loan EMI, Investment/SIP, Refund, Interest, Fee, ATM withdrawal, Reversal and Other.

**Automatic categorization:** if you leave the category on *Auto*, FinSight360 first uses what it learned for that merchant, then your rules. When you pick a category yourself, tick **"Apply this category to future transactions from this merchant"** to make FinSight360 remember it.

**API** (signed-in session required; JSON in and out):

| Endpoint | Methods |
|---|---|
| `/api/accounts`, `/api/accounts/:id` | GET, POST / GET, PATCH, DELETE |
| `/api/cash-accounts`, `/api/cash-accounts/:id` | GET, POST / GET, PATCH, DELETE |
| `/api/credit-cards`, `/api/credit-cards/:id` | GET, POST / GET, PATCH, DELETE |
| `/api/transactions?q=&from=&to=&account=&category=&…`, `/api/transactions/:id` | GET, POST / GET, PATCH, DELETE |
| `/api/income?month=YYYY-MM`, `/api/expenses?month=YYYY-MM` | GET, POST |
| `/api/categories`, `/api/categories/:id` | GET, POST / PATCH, DELETE |
| `/api/rules`, `/api/rules/:id` | GET, POST / PATCH, DELETE |
| `/api/loans`, `/api/loans/preview`, `/api/loans/:id`, `/api/loans/:id/amortization` | GET, POST / POST / GET, PATCH, DELETE / GET |
| `/api/loans/:id/payments`, `/api/loans/:id/payments/:paymentId`, `/api/loans/:id/rate` | POST / DELETE / POST |
| `/api/imports` (multipart upload), `/api/imports/:id` | GET, POST / GET, DELETE (cancel) |
| `/api/imports/:id/mapping`, `/commit`, `/undo`, `/rows/:rowId` | POST / POST / POST / PATCH |
| `/api/duplicates`, `/api/duplicates/:id`, `/api/duplicates/scan` | GET / POST `{action}` / POST |
| `/api/review` | GET, POST `{action: APPROVE\|REJECT, ids}` |
| `/api/email/connect/:provider`, `/api/email/callback/:provider` | GET (OAuth redirect / callback) |
| `/api/email/connections`, `/api/email/connections/:id`, `/:id/sync` | GET / DELETE `?deleteData=1` / POST `{days}` |
| `/api/email/candidates`, `/api/email/candidates/:id`, `/api/email/parse` | GET / POST `{action, account}` / POST `{from, subject, text}` |
| `/api/investments` | GET (portfolio) |
| `/api/investments/accounts`, `/accounts/:id`, `/accounts/:id/import` | POST / PATCH, DELETE / POST multipart (`commit=1` to apply) |
| `/api/investments/holdings`, `/holdings/:id`, `/holdings/:id/price` | POST / GET, PATCH, DELETE / POST `{currentPrice}` |
| `/api/investments/transactions`, `/transactions/:id`, `/api/investments/nav-refresh` | POST / DELETE / POST |

### Loans & EMI (Phase 3)

| Page | What you can do |
|---|---|
| **Loans & EMI** | Add home, car, personal or education loans. The EMI is calculated exactly (reducing balance) with a live preview, or you can enter the lender's EMI. You see outstanding principal, monthly EMI commitment, interest paid this month/year, estimated future interest and a principal-vs-interest chart. |
| **Loan detail** | Full amortization schedule (scheduled vs actually paid, overdue marked), charts of principal/interest and outstanding balance. **Record EMI payment**, **Prepay** (reduce tenure or reduce EMI), **Foreclose**, record charges, revise the interest rate (keep EMI or keep tenure) and undo a payment. Payments can be added to your transactions automatically, so bank balances stay right. |

### Statement import & duplicates (Phase 4)

| Page | What you can do |
|---|---|
| **Upload Statement** | Choose the bank account or card, then upload a CSV, XLSX or text PDF (up to 10 MB). Password-protected PDFs work: the password is used once in memory and never saved or logged. Scanned (image-only) PDFs and old `.xls` files aren't supported. |
| **Column mapping** (CSV/XLSX) | The header row, columns, date format and amount layout are detected automatically, with a live preview. Save the mapping as a template and it's applied automatically next time. |
| **Review before import** | Every row shows whether it is **New**, **Already in ledger** (it will be linked, not added twice), a **Possible duplicate**, or skipped. You can untick rows and change the type or category. Nothing touches your balances until you press **Import**. |
| **Duplicates** | Score ≥ 95 → linked automatically to the existing transaction (one transaction, several sources, counted once). Score 70–94 → imported as *pending* and shown in **Review Duplicates** side by side with **Merge**, **Is duplicate**, **Keep both** or **Ignore**. **Scan for duplicates** checks recent transactions (e.g. manual + email). Re-uploading the same statement never imports a row twice. |
| **Review Queue** | Low-confidence rows (e.g. a PDF row whose money in/out couldn't be verified) wait here and don't count until you approve or reject them. |
| **Undo** | Any completed import can be undone from its page or the history list: what it added is removed, links it made are detached, balances are recalculated. |

### Email Sync (Phase 5)

| What | How it works |
|---|---|
| **Connect** | Connect Gmail / Connect Outlook (OAuth, read-only). Several mailboxes can be connected. **Disconnect** revokes access and deletes the tokens (optionally the list of processed alerts too); transactions already added stay. |
| **Sync** | **Sync now** (first sync looks back 30–180 days) and automatically every hour while the app runs. Only mail from known bank/card senders (HDFC, ICICI, SBI, Axis, Kotak, Yes, IDFC FIRST, IndusInd, AU, Federal, RBL, PNB, BoB, Canara, Union, SC, HSBC, Citi, Amex, OneCard) is read. OTPs, offers, statements, reminders and declined payments are skipped. |
| **Placement** | The alert's last digits are matched to your bank accounts / credit cards (add the last 4 digits to each account). Unmatched alerts wait under **Alerts that need an account**. |
| **Counting once** | Each alert goes through the same pipeline as statements: if the transaction is already in your ledger (manual entry or statement row) it is linked as an extra source — never added twice. Clear alerts from a known bank (confidence ≥ 85%) are added straight away; everything else waits in the **Review Queue**. Two identical alerts (two coffees) are kept as two, with the second flagged for review. |

### Investments (Phase 6)

| What | How it works |
|---|---|
| **Accounts** | Add a Groww (or other) demat / mutual-fund account. No broker password or OTP is ever asked for. |
| **Holdings** | Add what you hold today (units + average price or invested amount), or let transactions build it. Value = units × latest price; gain and gain % per holding, per account and overall. |
| **Transactions** | Buy, SIP, sell, redemption, dividend, bonus/split units, switch in/out. Units, average cost (weighted average) and realised gains are recalculated from them; selling more units than you hold is refused. XIRR is shown for holdings with a transaction history. |
| **Groww import** | **Import from Groww** on an account: upload the XLSX/CSV from Groww → Reports — the *Holdings statement* (stocks or mutual funds) or *Transactions / Order history*. You see a preview first. Re-importing never duplicates (order ids are remembered); a holdings statement also removes positions you have sold (optional). |
| **Prices** | **Refresh NAVs** fetches mutual-fund NAVs from AMFI's public daily file (needs the fund's ISIN). Stock prices come from your latest holdings statement or **Update price**. |
| **Portfolio** | Allocation by asset type, value-vs-invested history, best/worst performers. Investments count in the dashboard's net worth. |

### Analytics, budgets & reports (Phase 7)

| What | How it works |
|---|---|
| **Monthly Analysis** | Income, expenses, savings and EMI burden vs last month; 12-month trend; category trends (up/down vs the 3-month average); spending by weekday; unusually large spends; savings, EMI and fixed-cost ratios with tips. |
| **Budgets** | Monthly or yearly, overall or per category. Refunds reduce spend. Turns amber at your alert level and red when exceeded (and notifies you). |
| **Recurring payments** | **Detect recurring** finds subscriptions, rent, SIPs and salary from at least 3 regular payments. Confirm or ignore each; confirmed ones show their next date and appear in Reminders. |
| **Net worth** | Bank + cash + investments − card dues − loan outstanding. A snapshot is saved daily; the chart shows the last snapshot of each month. |
| **Reports** | Expenses, income, transactions, cards, loans, interest, investments and net worth for any period (this month, last month, Indian financial year…). View on screen, download CSV or Excel, or **Print / Save as PDF**. CSV cells are protected against spreadsheet formula injection. |

### Reminders, notifications & the app on your phone (Phase 8)

| What | How it works |
|---|---|
| **Reminders** | One list of everything due: card bills and loan EMIs (automatic, they clear when you record the payment), confirmed recurring payments, and your own reminders (insurance, bills, SIPs, subscriptions) that can repeat weekly to yearly. **Done** rolls a repeating reminder to its next date. |
| **Notifications** | The bell and the Notifications page show due/overdue items, high card utilization, budget alerts, import results and security events (password changed, signed out everywhere). Each alert is sent once. |
| **Settings** | Per type: in-app, browser and email; and how many days before a card bill or EMI to be told. Email is **off** until you turn it on (and needs SMTP settings). |
| **Browser notifications** | **Allow on this device** on the Notifications page. They appear while FinSight360 is open (or installed and running). |
| **Install as an app** | iPhone: Safari → Share → **Add to Home Screen**. Android/desktop Chrome: **Install app**. It opens full-screen with its own icon and shortcuts. |
| **Offline** | Your financial data is never stored on the device. With no connection the app shows a "You're offline" page instead of stale numbers. |

Groww API: Groww's statements are the supported route. A direct API connection would only be added through an official, documented API you authorize yourself; it isn't enabled in this version.

## 7. Project structure

```text
app/                  Next.js routes
  (auth)/             login, register, forgot/reset password
  (public)/           verify-email
  (app)/              signed-in area: dashboard, settings, module pages
  api/                auth, health, profile (more per phase)
auth.ts, auth.config.ts, proxy.ts   Auth.js setup and route protection
components/           ui/ (design-system primitives), layout/ (sidebar, bottom nav, top bar)
features/             UI and server actions per feature (auth, dashboard, settings)
services/             business logic (auth, profile, dashboard, user setup)
repositories/         database queries (user, ledger)
lib/                  money, dates, finance maths, security, errors, logging, mail, db
validators/           Zod schemas shared by client and server
providers/            ingestion and investment provider interfaces (email/CSV/PDF/SMS/Groww)
imports/, workers/    statement parsers and background jobs (later phases)
prisma/               schema.prisma, migrations/, seed.ts
tests/unit            calculation and security tests
tests/integration     database-backed tests
```

Rules followed throughout:

- React components never touch the database. Pages call **services**, and services call **repositories** and Prisma.
- Every query is filtered by `userId`.
- Every input is validated with Zod on the server.
- Errors reach users as friendly messages. Stack traces and secrets never leave the server.

## 8. Database design (highlights)

- **46 tables, normalized.** They include users and auth, accounts, cards, loans with amortization schedules and payments, the central transaction ledger and its sources, imports and import rows, duplicate candidates, merchants, categories and sub-categories, rules, budgets, recurring payments, reminders, notifications, investments (accounts, holdings, transactions, prices, snapshots), Groww and email connections, sync jobs, statements, attachments, the audit log and system settings.
- **Central ledger.** Every source (manual, CSV, XLSX, PDF, Gmail, Outlook, future Android SMS) becomes exactly one `transactions` row. Each source is recorded in `transaction_sources`, so merging duplicates keeps the full history.
- **What counts toward totals.** A transaction counts only when it is `CONFIRMED`, not deleted and not a duplicate (`duplicateOfId IS NULL`). Paying a credit-card bill is tracked separately (`CARD_PAYMENT`) and is never counted as a second expense.
- **Never stored:** CVV, PIN, OTP, full card or account numbers, or bank/Groww/email passwords. Only the last 4 digits are kept.
- **Balances are never "typed in" twice.** A bank or cash balance = opening balance + credits − debits. A card's outstanding = opening outstanding + purchases − refunds − bill payments. Both are recomputed from the ledger inside the same database transaction whenever an entry changes, so they can't drift.
- **Transfers** between your own accounts are two linked ledger entries (`transferGroupId`) and are excluded from income and expenses.
- Calendar dates use PostgreSQL `DATE`. The user's timezone (default Asia/Kolkata) decides which day and month a transaction falls in.

## 9. Platform notes (honest limitations)

- **iPhone SMS:** iOS doesn't let apps or web apps read the SMS inbox, so FinSight360 doesn't claim to. Automatic imports will come from Gmail, Outlook and statement uploads. `FUTURE_ANDROID_SMS` is reserved for a possible Android companion app.
- **Groww:** FinSight360 never asks for your Groww password or OTP and doesn't use unofficial APIs. It imports the reports you download from Groww.
- **Email:** only alerts your bank emails you can be read; banks that send alerts only by SMS can't be imported on iPhone. Alert wording changes from time to time — use **Try the alert reader** to check one.
- **Restricted networks:** if `npm install` can't download Prisma engines (a company firewall blocking `binaries.prisma.sh`), run commands with `PRISMA_JS_ENGINE=1`.

## 10. Tests

```bash
npm run check
```

That one command runs lint, the type check and all unit and integration tests.

```bash
npm test                  # unit tests, no database needed
npm run test:integration  # needs DATABASE_URL_TEST
```

The unit tests include the spec's acceptance checks:

- **Credit card:** a ₹2,00,000 limit with ₹50,000 used gives 25% utilization and ₹1,50,000 available.
- **Loan:** ₹10,00,000 at 9.5% for 60 months gives a valid 60-row schedule. Each row satisfies opening − principal = closing and principal + interest = EMI, and the loan ends at exactly ₹0.
- **Dashboard:** income 85,000, expenses 42,350, EMI 18,500 and investments 10,000 give a net cash flow of 14,150.

They also cover transaction normalization (UPI/reference noise removal, merchant extraction), the categorization rules engine (SWIGGY/ZOMATO → Food Delivery, UBER → Taxi, NETFLIX → Subscription, AMAZON → Shopping), balance and outstanding calculations, the transaction/card validators, money and date helpers, net worth, password hashing, tokens, encryption, the rate limiter, log redaction and open-redirect protection.

The integration tests cover registration, sign-in, lockout, email verification, password reset, change password and sign-out-everywhere. They also check dashboard totals: pending, rejected, deleted and duplicate transactions must be excluded.

The Phase 2 ledger tests cover:
- creating expenses and income, with balance updates, auto-categorization, merchant learning and audit entries;
- card purchases and bill payments, including the §48 acceptance check through the real service;
- transfers, with both entries edited and deleted together;
- reconciling a balance to what the bank shows;
- ownership checks, so one user can't touch another user's accounts, categories or transactions;
- per-user sub-categories;
- applying rules to uncategorized transactions;
- every transaction filter.

The Phase 3 loan tests cover the §49 schedule through the service, EMI payments (bank balance + interest/principal split), prepayment (reduce tenure / reduce EMI), foreclosure with charges, rate revision, undoing payments and loan-payment locking in Transactions.

The Phase 5 tests cover 12 real-world alert formats (HDFC, ICICI, SBI, Axis, Kotak — UPI, card spends, salary credits, refunds, ATM, card bill payments) and rejection of OTPs, offers, statements, reminders and declined payments; mailbox sync with a fake provider (token refresh, encrypted tokens, nothing imported twice, unplaced alerts, revoked access), §47 in both directions (email then statement, statement then email), OAuth state binding and disconnect.

The Phase 6 tests cover weighted-average cost, realised gains with charges, bonus units, dividends, oversell protection, XIRR, the AMFI NAV file, Groww holdings / mutual-fund / order-history files, re-import without duplicates, removal of sold positions, incomplete-history protection and net worth.

The review regression tests cover: confirming/merging a card-payment duplicate keeps the bank debit and is undone correctly, undoing both imports of a linked pair, promoting a hidden duplicate when its original is removed, loan EMIs after a loan is removed, undoing an earlier EMI, and object-ids sent to server actions.

The Phase 7 tests cover recurring detection (monthly/weekly, salary, irregular spends ignored), category trends, unusual spends, ratios, budgets net of refunds, net-worth snapshots and history, and every report type in CSV (formula-safe) and Excel.

The Phase 8 tests cover reminders (statuses, repeating roll-forward, ownership, automatic types refused), derived card-bill and EMI items, notifications sent only once, lead-day preferences, opt-in email, disabled types, per-user dedupe and security notices. The production check tests cover weak/placeholder `AUTH_SECRET` and the readiness warnings.

The Phase 4 import tests cover CSV header detection and mapping templates, PDF parsing with the running-balance check, password-protected PDFs (password never stored), XLSX signed amounts, re-upload protection, the **§47 acceptance check** (an email-sourced transaction plus the same statement row = one transaction with two sources, counted once), possible duplicates and every resolution action, the review queue, undo, ownership checks and two simultaneous imports of the same file.

## 11. Production deployment

FinSight360 holds sensitive financial data. Before running it anywhere other than your own Mac:

1. **HTTPS only.** Put it behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) with TLS. Set `APP_URL` and `AUTH_URL` to the `https://` address and `TRUST_PROXY="true"` (only when the proxy is yours, so rate limits see real client IPs).
2. **Secrets.** `npm run setup:env` generates a strong `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY`. In production the server **refuses to start** with a short or placeholder `AUTH_SECRET`, and logs a warning for anything else missing. Never commit `.env`.
3. **Database.** Use a dedicated PostgreSQL database and user for FinSight360 (never a shared or production database of another system). Run `npm run db:deploy` on each release.
4. **Email.** Set `EMAIL_TRANSPORT="smtp"` and the `SMTP_*` values so password resets and opted-in notifications are delivered.
5. **Registration.** After creating your account, set `ALLOW_REGISTRATION="false"` if the instance is just for you.
6. **Background jobs.** While `npm run start` is running, a built-in scheduler runs the daily jobs and the mailbox sync. If you run several app instances, or the app sleeps, use your system scheduler instead, e.g. cron:
   - `15 6 * * * cd /srv/finsight360 && npm run jobs:daily`
   - `0 * * * * cd /srv/finsight360 && npm run sync:email`
7. **Backups.** Back up the database daily (e.g. `pg_dump -Fc finsight360 > finsight360-$(date +%F).dump`) and the `STORAGE_DIR` folder; keep copies encrypted and off the server. Test a restore with `pg_restore` now and then.
8. **Health check.** `GET /api/health` returns `200` when the app and database are up (no user data).

Security built in: bcrypt passwords, account lockout and rate limits, sessions that can be revoked everywhere, encrypted OAuth tokens, per-user ownership checks on every query, audit log, CSV-injection-safe exports, a strict Content-Security-Policy (no third-party scripts), `X-Frame-Options: DENY`, HSTS in production, `Cache-Control: no-store` on every API response, and a service worker that never caches pages or API data. No CVV, PIN, OTP, full card or account numbers or bank passwords are ever stored — only the last 4 digits.
