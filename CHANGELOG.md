# Change log (50 fixes / improvements)

## Security & authentication (server/auth.ts, server/routes.ts)
1. **Auth bypass removed** - every route used a hardcoded user id, so all visitors shared one account and one credit balance.
2. **`requireAuth` on every private route** - unauthenticated calls now get 401.
3. **Password hash no longer returned** by /api/user, /api/login, /api/register.
4. **Session cookie hardened** - `httpOnly`, `secure` in production, `sameSite=lax`, `saveUninitialized:false`, `SESSION_SECRET` required in production.
5. **Readable login errors** - "Invalid email or password" instead of a bare 401.
6. **Registration validation (zod)** - valid email, password >= 8 chars, duplicate email -> 409.
7. **Ownership checks (IDOR)** - update/delete only affect rows owned by the signed-in user (storage.ts).
8. **Profile PUT whitelist** - only name/email/bio are accepted; users can't write `userId` or arbitrary photo/CV URLs.
9. **Error handler no longer re-throws** after responding (it could crash the Node process).
10. **API logs no longer print response bodies** (they contained personal data).

## Credits, payments & subscriptions
11. **Atomic credit deduction** - single `UPDATE ... WHERE credits_remaining >= 5` (was read-then-write, race condition).
12. **Automatic refund** if the save fails after credits were charged; no charge when the item isn't found.
13. **Top-up price/credits decided on the server** (client could previously send any amount).
14. **Duplicate subscriptions blocked; Basic -> Premium upgrade supported** (keeps unused credits) - brief: "or upgrade your plan".
15. **Top-up modal was fake** (setTimeout + toast, no API call) - now calls `POST /api/subscription/credits/topup`.
16. **Top-up pricing matches the brief** (Rs 500 = 100 credits; modal showed made-up prices).
17. **Subscription page** shows the current plan, disables invalid choices, shows upgrade label.
18. **Profile builder is gated by subscription** - users without a plan are sent to /subscription.
19. **Low-credit warning (< 50)** and an editing lock with "Insufficient credits. Please top-up or subscribe." when < 5.
20. **"Saved ✓ (Credits left: X)" shows the fresh balance** (it used a stale value before).

## Profile data & uploads
21. **Photo / CV were `URL.createObjectURL` blob URLs** (broke after reload and were saved in the DB) - real upload endpoints `PATCH /api/profile/photo|cv` with type, size and file-signature validation, old file removed.
22. **Share slug is generated automatically**; public endpoint hides internal ids.
23. **New public read-only page `/profile/share/:slug`** (the share link pointed to a page that didn't exist).
24. **GET /api/profile always returns the full shape** so a new user can't crash the UI.
25. **Autosave debounce bug** - it was re-created whenever credits changed, cancelling pending saves; now stable (refs + useMemo) and flushed on unmount.
26. **Per-keystroke saves in Education/Projects/Skills/Experience** (each keystroke = one request = 5 credits) - now one debounced save per item.
27. **Half-typed email no longer autosaved** (caused 400 errors and wasted credits).

## Frontend structure, UX & quality
28. **`ProtectedRoute` actually protects** (it always rendered the page) - redirects to /auth, shows a loader while checking.
29. **Debug pages/routes removed** (debug-auth, simple-form-test, old auth pages and their routes in App.tsx).
30. **New auth page** with proper components and validation (the old one printed typed email/username/password length on screen).
31. **Post-login redirect** - subscribers go to /profile, others to /subscription.
32. **Readable API error messages** (was `401: {"message":...}`).
33. **Global mutation error toast** - failed saves are never silent.
34. **Cached data leaked between accounts** (staleTime = Infinity) - cache cleared on login/logout.
35. **Logout button** added.
36. **SPA navigation** with `setLocation` instead of full page reloads.
37. **Copy fixes** ("/month" -> "/ 30 days", "per autosave" -> "per saved edit").

## Code quality & tooling
38. **routes.ts refactor** - ~550 lines of copy-pasted handlers replaced by one generic CRUD helper + zod validation (555 -> ~400 lines).
39. **Windows: `npm run dev` failed** (`NODE_ENV=...` syntax) - `cross-env`.
40. **Windows: `reusePort` caused ENOTSUP** on listen - removed.
41. **`.env` loaded automatically** (`dotenv`), `.env.example` added.
42. **Junk removed**: cookies.txt, login_cookies.txt (session data), debug/emergency scripts, `.local` Replit state.
43. **`.gitignore` fixed** (.env, uploads/, etc.).

## Landing page & PDF (round 2)
44. **Landing page buttons fixed** - "View Demo" sent logged-out visitors to a protected page (dead end) and the CTAs ignored login state. Now: Sign In / Get Started / Continue Building depend on the session, and "See Features" scrolls to the features section.
45. **PDF export page-break bug** - content only checked for a new page at the start of some sections, so long profiles ran off the page. Every line now checks the space left; added section dividers, page numbers and a safe filename.
46. **"Saved ✓ (Credits left: X)" toast was invisible** - it used `bg-accent text-white`, but `accent` is a near-white gray in this theme (white text on white). Also fixed the same invisible colors on the Buy Credits button, the coin icon (`text-warning` doesn't exist) and the plan feature check marks.
47. **Autosave charged for unchanged text and fired on short pauses** - unchanged values are skipped (no request, no charge) and the debounce is 1.5 s.

## Round 3 (uploads & export)
48. **Photo picker allowed file types the server rejects** (`image/*` included GIF/SVG) - now JPG, PNG, WebP only.
49. **CV upload failed when the browser sent an empty file type** (common for .docx) - MIME type is derived from the file extension as a fallback.
50. **Export PDF on an empty profile** - the "no data" check could never trigger because the API now always returns an object; now it checks that something is actually filled in.

> Honest notes for the video: payment is mocked (Stripe/Razorpay not integrated); sessions (passport) are used instead of JWT; the project uses PostgreSQL only (no MongoDB exists in it).

## Verification status (update this after your own testing)
- **Confirmed by running the app:** database tables created, sign-up writes a user (password stored hashed), subscription creates 500 credits, autosave deducts 5 credits per saved edit, landing page renders.
- **Implemented but not yet confirmed by running:** section add/edit/remove, photo/CV upload, share page, PDF export, Buy Credits, Basic -> Premium upgrade, low-credit warning and lock, logout / second-user isolation, redirect when logged out.
- **Not implemented:** JWT, real payment gateway, automated tests.
