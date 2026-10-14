# Canar - SPA Profile Builder

React + Express + PostgreSQL (Drizzle ORM, Neon).

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` (Neon connection string) and `SESSION_SECRET`.
3. `npm run db:push` (creates the tables)
4. `npm run dev` -> http://localhost:5000

## Flow
Sign up -> choose a plan (Basic Rs 1,999 / 500 credits, Premium Rs 2,999 / 1,000 credits) -> build profile.
Every saved edit costs 5 credits. Top-up: Rs 500 = 100 credits. Public link: `/profile/share/<slug>`.
See `CHANGELOG.md` for everything that was fixed.
