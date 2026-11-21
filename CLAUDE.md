# StuSPACE

Web platform ("Giving Big Opportunity to Shine"): schools/students register, receive a topic by email/SMS, record a short talk or debate video, admins review it first, then approved videos are published to YouTube and shown in the platform's Top 5; admins also award and release funding. Specs: `SystemUpdate.md`, `finalize.md` (latest), `project.md`, `design.md`, `AdminUpdate.md`.

## Run

- `npm start` (node server.js), default port 3000 (`PORT` env to change).
- No build step, no test suite. Node 18.7: use global `fetch`; no `fs.statfs`.
- The server does not hot reload. Restart after any change to `server.js`, `integrations.js` or `logger.js`. Web files (html/css/common.js) are read from disk per request, so they are served live.
- Default admin: Vivek Adhikari, 9841527953, thevivek2@gmail.com. OTP is the static code `2222` while `otp.static.enabled` is on.

## Layout

- `server.js` - Express API and all server logic (single file, sections marked `// ----------`).
- `integrations.js` - every third-party touch point (SMTP email via nodemailer, Sparrow SMS, OTP delivery). Swap providers here only. Source files sit in the project root (no `lib/`, `seed/` or `public/` folders).
- `logger.js` - console + `data/app.log` (rotated at 5 MB).
- Web pages (`*.html`), `common.js` (shared header, footer, helpers, icons), `app.css` (the only stylesheet) and `favicon.svg` sit in the project root next to the server code - no `public/` folder. The server serves them through an allowlist in `server.js` (`WEB_FILE`: `.html`, `.css`, `.svg`, `common.js`); never serve the root as a static folder, it holds `server.js`, `seed.json` and `data/`.
- `data/db.json` - the whole database (one JSON document). `videos/`, `photos/`, `outbox/` hold uploads and saved emails.
- `seed.json` - starting data (default admin, config values, plans, email templates, starter fund). Lives in the project root, outside `data/`, on purpose so "Delete all data" can rebuild from it.

## Conventions

- **Everything configurable lives in the DB** (Admin -> Configs): defaults are the `CONFIG_DEFAULTS` array in `server.js`; read with `cfg('key')`. Do not hardcode texts, limits, contact details or provider settings. Secrets use type `secret` (masked in API and audit).
- **Optimistic concurrency**: every editable entity has `version`; updates must send it and use `isStale()` / `bump()`, else 409. Keep this for any new editable entity.
- **Audit log**: admin mutations call `audit(req, entity, id, action, label, before, after)` (use `snap()` for before/after). Add the row icon `hist(entity, id)` in `admin.html` for new entities.
- **Auth**: OTP only, no passwords. Sessions in `db.sessions`, cookies `psid` (school, one insight then logged out) and `asid` (admin). Admin routes use `needAdmin`.
- **OTP**: `issueOtp` / `checkOtp` with scopes (`principal`, `admin`, `adminact`, `register`). Static OTP bypass when enabled.
- Schools can submit an insight only after an insights request email was sent (`openRequest`). Insight size limit is `video.maxMB` (read per request).
- **Roles**: admins have `role` = `super` (everything) or `admin` (register schools, edit registrations, request funding, publish / move works to review, YouTube retry; nothing else). Server: `needSuper` on every other `/api/admin/*` route, the console (`admin.html`) hides tabs/buttons by `ME.role` and loads only the data an admin may read. Admins that existed before roles are migrated to `super`; seeded admins are `super`; the last active super admin cannot be demoted or deactivated.
- **Maker-checker**: a row's creator (and an admin for their own record) cannot change its status (`LOCK` in `server.js`; rows carry `createdBy`). UI uses `locked()` / `lockField()` in `admin.html`.
- **Funding flow**: Works -> any admin uses "Request funding" (one funding per work; awards from the active fund, reward `Pending`) -> a super admin funds it manually in Admin -> Release funding (reference required, school emailed -> `Released`, shown as "Approved" on the work) and the release auto-publishes the work (YouTube + Watch). Publishing manually is rejected until funding is approved. Works already published before this rule stay published.
- **YouTube**: published works are uploaded by `integrations.js` (`youtube.*` configs, OAuth refresh token); status stored on the insight (`youtube`). The public Watch screen shows up to 5 videos: recently funded (released) ones first, then the newest published ones (`/api/insights/recent-funded`, video only, no details).
- **Theme**: StuSPACE platform theme - dark neutral surfaces, rounded cards, pill buttons, violet->pink gradient (variables `--ink`, `--gold`, `--grad` at the bottom of `app.css`; later blocks override earlier ones). Brand name/tagline come from configs `site.programName` / `site.tagline`; the logo is `LOGO_SVG` in `server.js`.
- Home page has no nav buttons: Register / Watch / Give Insights in the hero, Directory + Who we are (info icon) + Privacy (shield icon) + Admin in the footer, close (x) on flipped faces. The first panel flips (refresh icon) to show registrations, works and funding details; they are not shown anywhere else on public pages. The overview video autoplays muted and covers its panel. Privacy policy text is the `site.privacy` config.
- Main page artwork is inline SVG in `index.html`: slim side rails outside the two models - left rail has the animated AI buddy robot, right rail has a girl-with-paper logo (rails hide under 900px). Inside the right model a larger illustration of a woman working on paper sits behind the program video (the video autoplays over her once one is published). The hero button for recording is labelled "Let's do" (other pages still say "Give Insights").
- Registration auto-selects the first plan.
- Admin sidebar order is the workflow (`TAB_ORDER` in `admin.html`): Dashboard, Plans, Registrations, Manual send, Random send, Works, Funds, Release funding, Program videos, Outbox, Configs, Health monitor, then Admin users and Email templates. Manual/Random send have no topic field: each school gets a random topic from the pool (`insight.questions` config).
- Recording pages (`interview.html`, admin program-video recorder) get the camera through `getMediaStream()` in `common.js`: it falls back to video-only when no microphone exists and tries each camera the browser lists by id, and turns permission / no-device / busy-device errors into plain messages. `/camtest.html` shows what the browser can see. Never call `getUserMedia` directly.
- Admin calls insights "Works". Phone is optional for schools; OTPs go to email (SMS only when a phone exists and SMS is enabled). The seed has one Free plan ("charges may apply on renewal").
- Directory never exposes insights. No payments in registration. No upvotes or insight titles.
- Home page (`index.html`) is a single page: two equal centred panels, screen buttons, footer. Login dialogs open as blurred `<dialog>` overlays containing an iframe. Embedded pages detect `EMBED` in `common.js`.
- Don't use the HTML attribute `data-s` for anything but Register steps (it collided with header stats once; stats use `data-stat`).
- Put `<dialog>` elements directly under `<body>` (CSS blurs/blocks other body children while a dialog is open).

## Testing notes

- Don't run experiments against the live `data/` folder. Copy `*.js *.html *.css *.svg seed.json package.json` to a scratch dir, symlink `node_modules`, run on another port.
- The README-less verification pattern used so far: API scripts with `fetch`, and headless Chrome (`--dump-dom`, `--screenshot`) for UI.
- "Delete all data" (Admin sidebar, red link) is a temporary QC/UAT feature: wipes `data/`, uploads and outbox, then reseeds from `seed.json`.
