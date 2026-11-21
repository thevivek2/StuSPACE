const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const log = require('./logger');
const makeIntegrations = require('./integrations');

const ROOT = __dirname;
const DIRS = { videos: path.join(ROOT, 'videos'), photos: path.join(ROOT, 'photos'), outbox: path.join(ROOT, 'outbox'), data: path.join(ROOT, 'data') };
Object.values(DIRS).forEach((d) => fs.mkdirSync(d, { recursive: true }));
log.init(DIRS.data);

const DB_FILE = path.join(DIRS.data, 'db.json');
const DAY = 24 * 3600 * 1000;
const COOKIE_TTL = 7 * DAY;
const PORT = process.env.PORT || 3000;

// ---------- DB (single JSON document; every entity carries `version`) ----------
const EMPTY = ['principals', 'emails', 'rewards', 'payments', 'admins', 'plans', 'configs', 'templates', 'programVideos', 'audit'];
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {};
function ensureShape() {
  EMPTY.forEach((k) => { db[k] = db[k] || []; });
  db.sessions = db.sessions || {};
  db.otps = db.otps || {};
  db.currentInsight = db.currentInsight || null;
}
ensureShape();
// Starting data lives outside the data folder (./seed.json) so "delete all data" can rebuild the system from it.
const SEED_FILE = path.join(ROOT, 'seed.json');
const loadSeed = () => { try { return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch (_) { return {}; } };
const save = () => { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_FILE); };
const id = () => crypto.randomBytes(6).toString('hex');
const id_ = id; // alias used where a local variable shadows id()
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');
const isoDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const longDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Optimistic concurrency: an update is accepted only for the latest version of the record
const LOCK = { error: 'You cannot change the status of a row you created (or your own admin record). Another admin must do it.' };
const STALE = { error: 'This record was changed by someone else. Reload to get the latest version, then try again.' };
const isStale = (entity, body) => Number((body || {}).version) !== (entity.version || 1);
const bump = (e) => { e.version = (e.version || 1) + 1; e.updatedAt = Date.now(); };

// ---------- audit log of admin changes (who, when, what changed: old -> new) ----------
const AUDIT_SKIP = new Set(['version', 'updatedAt', 'createdAt', 'id', 'interviews', 'paymentStatus', 'planPrice', 'lastInsightEmailAt']);
function flat(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    if (AUDIT_SKIP.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, prefix + k + '.', out); else out[prefix + k] = v;
  }
  return out;
}
const snap = (o) => flat(o);
function audit(req, entity, entityId, action, label, before, after) {
  const changes = [];
  if (before && after) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changes.push({ field: k, from: before[k] ?? null, to: after[k] ?? null });
    }
  } else if (after) {
    for (const [k, v] of Object.entries(after)) changes.push({ field: k, from: null, to: v });
  }
  db.audit.push({ id: id_(), at: Date.now(), adminId: req.admin.id, adminName: req.admin.name, entity, entityId, action, label, changes });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
  log.info(`audit ${entity}:${entityId} ${action} by ${req.admin.id}`);
  save();
}

// ---------- configuration stored in the DB (Admin > Configs) ----------
const PRIVACY_DEFAULT = [
  'Everything on StuSPACE is confidential and fair. What you share with us is kept private, every video is reviewed by our team before it is used, and every student is treated equally, whatever their school or background.',
  '# Information we collect',
  'We collect the details you give us when you register (name, school, address, email and, if you choose, a phone number) and the videos you record when you answer a topic.',
  '# How we use it',
  'We use your email to verify you with one-time codes and to send you topics and updates. Your videos are reviewed by our team. Only videos that pass review are published, on our YouTube channel and on this platform, and only with the consent of the student and their parent or guardian.',
  '# Fair and confidential review',
  'Reviewers use the same checklist for every video. Videos that are not published stay private and are visible only to the review team. Review decisions and changes to records are logged so they can be checked later.',
  '# Sharing',
  'We never sell your personal information. We share it only with service providers that help us run the platform (such as email, SMS and video hosting) and when the law requires it.',
  '# Security and retention',
  'Access is protected by one-time codes, and administrators can only see what they need. We keep records and videos only as long as needed for the program, then delete them. You can ask us to delete your data at any time.',
  '# Your rights',
  'You can ask to see, correct or delete your information, or withdraw consent for a published video, by contacting us using the details in "Who we are".',
  '# Changes',
  'We may update this policy from time to time. The latest version is always available from the footer of this site.',
].join('\n');
const DEFAULT_QUESTIONS = [
  'Talk: What does it mean to shine, and how will you do it?',
  'Debate: Should homework be replaced by projects?',
  'Talk: The best lesson you ever learned outside the classroom',
  'Debate: Is social media good for students?',
  'Talk: One idea that would make your school better',
].join('\n');
const CONFIG_DEFAULTS = [
  ['otp.static.enabled', true, 'boolean', 'OTP', 'Accept the static OTP below for every verification (turn off to send real one-time codes by email)'],
  ['otp.static.value', '2222', 'string', 'OTP', 'The static OTP that is always valid while the switch above is on'],
  ['otp.ttlMinutes', 10, 'number', 'OTP', 'Minutes a generated one-time code stays valid'],
  ['video.maxMB', 5, 'number', 'Videos', 'Maximum size of an insight video upload (MB)'],
  ['video.maxSeconds', 300, 'number', 'Videos', 'Maximum length of an insight video (seconds)'],
  ['video.program.maxMB', 100, 'number', 'Videos', 'Maximum size of a program video uploaded by an admin (MB)'],
  ['photo.maxMB', 5, 'number', 'Videos', 'Maximum size of a principal photo (MB)'],
  ['site.programName', 'StuSPACE', 'string', 'Site', 'Program name used in emails'],
  ['site.baseUrl', '', 'string', 'Site', 'Public URL of the site used in emails (blank = http://localhost:PORT)'],
  ['site.tagline', 'Giving Big Opportunity to Shine', 'string', 'Site', 'Tagline shown with the logo and in emails'],
  ['site.heroTitle', 'Giving Big Opportunity to Shine', 'string', 'Site', 'Home page heading'],
  ['site.heroText', 'Send us your talk or debate on the topic we ask. We review every student video first, then publish the best to the public on YouTube and here on the platform.', 'text', 'Site', 'Home page description'],
  ['site.playerTitle', 'StuSPACE', 'string', 'Site', 'Title above the program video on the home page'],
  ['letter.subject', 'Welcome to the {{program}}', 'string', 'Letter', 'Subject line of the welcome letter shown after registration'],
  ['letter.body', 'Thank you for registering {{school}} with {{program}}. We are delighted to welcome you and to give you a big opportunity to shine.\n\nYour registration is confirmed and your {{plan}} plan is active. Keep the registration number above for your records.\n\nWhat happens next: we will email {{email}} a topic for a short talk or debate. Verify with a one-time code, record your video, and our reviewers will check it first. Approved videos are published to the public on YouTube and on our platform.\n\nThank you for being part of {{program}}.', 'text', 'Letter', 'Body of the welcome letter. Placeholders: {{name}} {{school}} {{plan}} {{program}} {{date}} {{ref}} {{email}} {{phone}}'],
  ['letter.signoff', 'Warm regards,\nThe StuSPACE Team', 'text', 'Letter', 'Sign-off of the welcome letter'],
  ['site.whoWeAre', 'StuSPACE gives students a big opportunity to shine. Students send a talk or debate video on a topic we ask, our team reviews it first, and the best videos are published to the public through our YouTube channel and on the platform.', 'text', 'Site', '"Who we are" text shown in the footer'],
  ['site.privacy', PRIVACY_DEFAULT, 'text', 'Site', 'Privacy policy shown from the footer (lines starting with # are headings)'],
  ['contact.email', 'support@stuspace.example', 'string', 'Contact', 'Contact email shown in "Who we are"'],
  ['contact.phone', '+977-1-0000000', 'string', 'Contact', 'Contact phone shown in "Who we are"'],
  ['contact.address', 'Kathmandu, Nepal', 'string', 'Contact', 'Contact address shown in "Who we are"'],
  ['insight.repeatDays', 90, 'number', 'Insights', 'A school is not asked for random insights again within this many days'],
  ['insight.questions', DEFAULT_QUESTIONS, 'text', 'Insights', 'Topic pool for random talk/debate requests (one per line)'],
  ['fund.defaultReason', 'Support for school improvement', 'string', 'Funding', 'Initial reason for funds, used until the admin edits the fund'],
  ['sms.enabled', false, 'boolean', 'SMS', 'Send SMS through Sparrow SMS (one-time codes and invitations)'],
  ['sms.sandbox', true, 'boolean', 'SMS', 'Sandbox mode: use the sandbox URL below instead of the live endpoint. With no sandbox URL nothing is sent (dry run)'],
  ['sms.baseUrl', 'https://api.sparrowsms.com/v2/sms/', 'string', 'SMS', 'Sparrow SMS live endpoint'],
  ['sms.sandboxUrl', '', 'string', 'SMS', 'Sparrow SMS sandbox endpoint (paste the sandbox URL from your Sparrow account)'],
  ['sms.token', '', 'secret', 'SMS', 'Sparrow SMS API token'],
  ['sms.from', 'InfoSMS', 'string', 'SMS', 'Sparrow approved sender identity'],
  ['sms.notify', true, 'boolean', 'SMS', 'Also send an SMS when an insights request email is sent'],
  ['youtube.enabled', false, 'boolean', 'YouTube', 'Publish approved videos to the YouTube channel'],
  ['youtube.clientId', '', 'string', 'YouTube', 'Google OAuth client ID (YouTube Data API v3 enabled)'],
  ['youtube.clientSecret', '', 'secret', 'YouTube', 'Google OAuth client secret'],
  ['youtube.refreshToken', '', 'secret', 'YouTube', 'OAuth refresh token of the channel owner (scope youtube.upload)'],
  ['youtube.privacy', 'public', 'string', 'YouTube', 'public, unlisted or private'],
  ['youtube.categoryId', '27', 'string', 'YouTube', 'YouTube category id (27 = Education)'],
  ['youtube.titleTemplate', '{{school}} · {{program}}', 'string', 'YouTube', 'Video title. Placeholders: {{school}} {{name}} {{program}}'],
  ['youtube.tokenUrl', 'https://oauth2.googleapis.com/token', 'string', 'YouTube', 'OAuth token endpoint'],
  ['youtube.uploadUrl', 'https://www.googleapis.com/upload/youtube/v3/videos', 'string', 'YouTube', 'YouTube upload endpoint'],
  ['smtp.enabled', false, 'boolean', 'SMTP', 'Send real emails through the SMTP server below (off = emails are only saved in the outbox)'],
  ['smtp.host', 'smtp.gmail.com', 'string', 'SMTP', 'SMTP host (free options: Gmail, Brevo, Mailtrap)'],
  ['smtp.port', 587, 'number', 'SMTP', 'SMTP port'],
  ['smtp.secure', false, 'boolean', 'SMTP', 'Use TLS from the start (port 465). Leave off for STARTTLS on 587'],
  ['smtp.user', '', 'string', 'SMTP', 'SMTP user name'],
  ['smtp.pass', '', 'secret', 'SMTP', 'SMTP password or app password'],
  ['smtp.from', '', 'string', 'SMTP', 'From address, e.g. StuSPACE <no-reply@yourdomain>'],
  ['log.level', 'info', 'string', 'System', 'Log level: error, warn, info or debug (errors are always logged)'],
  ['admin.default.name', 'Vivek Adhikari', 'string', 'Admin', 'Default admin name (used to create the first admin and as the template for new admins)'],
  ['admin.default.phone', '9841527953', 'string', 'Admin', 'Default admin phone'],
  ['admin.default.email', 'thevivek2@gmail.com', 'string', 'Admin', 'Default admin email'],
];
function seedConfigs() {
  const seed = loadSeed().configs || {};
  for (const [key, value, type, group, description] of CONFIG_DEFAULTS) {
    const r = db.configs.find((c) => c.key === key);
    if (r) Object.assign(r, { type, group, description }); else db.configs.push({ key, value: key in seed ? seed[key] : value, type, group, description, version: 1, updatedAt: Date.now() });
  }
}
seedConfigs();
const cfgRec = (k) => db.configs.find((c) => c.key === k);
const cfg = (k) => {
  const r = cfgRec(k);
  if (!r) return undefined;
  return r.type === 'boolean' ? r.value === true || r.value === 'true' : r.type === 'number' ? Number(r.value) : String(r.value ?? '');
};
log.setLevel(cfg('log.level'));
const integ = makeIntegrations(cfg);

// ---------- seed + migrate ----------
const planByName = (n) => db.plans.find((p) => p.name === n);
const planById = (i) => db.plans.find((p) => p.id === i);
const TEMPLATE_DEFAULTS = [
  { key: 'insight_request', name: 'Talk / debate request email', subject: 'Your topic from {{program}}: time to shine',
    heading: 'Hi {{name}},',
    body: 'You have been selected by {{program}} to give a talk or debate on behalf of {{school}}. We choose members at random, and the best videos are published to the public on YouTube and on our platform.\n\nYour topic:\n\n{{question}}\n\nUse the button below, verify with a one-time code and record your video. Our reviewers watch every video before it is published.',
    buttonText: 'Verify and record your video', footer: '{{program}} · Giving Big Opportunity to Shine', showLogo: true, showDate: true, version: 1 },
  { key: 'welcome', name: 'Successful registration email', subject: 'Welcome to {{program}}',
    heading: 'Welcome, {{name}}!',
    body: 'Your {{plan}} registration for {{school}} is confirmed. You are now part of {{program}}, a platform that gives students a big opportunity to shine.\n\nWhat happens next:\n\n1. We email you a topic for a short talk or debate.\n2. Verify with a one-time code and record your video.\n3. We review it first, then publish the best to YouTube and on our platform.',
    buttonText: '', footer: '{{program}}', showLogo: true, showDate: true, version: 1 },
];
const DEFAULT_PLANS = [
  { id: 'plan_free', name: 'Free', price: 0, description: 'Free registration\nDirectory listing\nEligible for talk and debate topics\nCharges may apply on renewal', status: 'active' },
];
const DEFAULT_FUND = { name: 'Fund 1', perPeriod: 5, amount: 500, durationDays: 30, reason: 'Support for school improvement', status: 'active' };
// write the seed file once so it can be edited by hand
if (!fs.existsSync(SEED_FILE)) {
  fs.writeFileSync(SEED_FILE, JSON.stringify({
    _note: 'Starting data. Used on first start and after "Delete all data". Edit freely.',
    configs: Object.fromEntries(CONFIG_DEFAULTS.map((c) => [c[0], c[1]])),
    admins: [{ name: 'Vivek Adhikari', phone: '9841527953', email: 'thevivek2@gmail.com' }],
    plans: DEFAULT_PLANS, templates: TEMPLATE_DEFAULTS, funds: [DEFAULT_FUND],
  }, null, 2));
}
function seedEntities() {
  const seed = loadSeed();
  if (!db.plans.length) for (const p of (seed.plans || DEFAULT_PLANS)) db.plans.push({ version: 1, status: 'active', ...p, id: p.id || 'plan_' + id(), createdAt: Date.now() });
  if (!db.admins.length) {
    const list = seed.admins && seed.admins.length ? seed.admins : [{ name: cfg('admin.default.name'), phone: cfg('admin.default.phone'), email: cfg('admin.default.email') }];
    for (const a of list) db.admins.push({ id: id(), status: 'active', role: 'super', ...a, version: 1, createdAt: Date.now() });
  }
  for (const t of (seed.templates || TEMPLATE_DEFAULTS)) if (!db.templates.find((x) => x.key === t.key)) db.templates.push({ version: 1, ...t });
  for (const p of db.principals) {
    const pl = (p.planId && planById(p.planId)) || planByName(p.plan) || db.plans[0];
    p.planId = pl.id; p.plan = pl.name; if (p.planPrice === undefined) p.planPrice = pl.price;
    if (p.status === 'pending_payment') p.status = 'active';
    p.paymentStatus = 'n/a'; p.version = p.version || 1;
    for (const iv of p.interviews) { iv.status = iv.status || 'Published'; iv.version = iv.version || 1; }
  }
  // funds: several fund records (each a period, a number of funds and an amount); the active one in date range is used for rewards
  db.funds = db.funds || [];
  if (!db.funds.length) {
    const old = db.fund || null;
    if (old) {
      if (!old.end) old.end = old.start + (old.periodDays || 30) * DAY;
      delete old.periodDays;
      db.funds.push({ id: 'fund_' + id(), name: 'Fund 1', status: 'active', ...old, version: old.version || 1, createdAt: Date.now() });
      for (const r of db.rewards) if (!r.fundId) r.fundId = db.funds[0].id;
    } else {
      for (const f of (seed.funds || [DEFAULT_FUND])) {
        const start = Date.parse(isoDate(Date.now()) + 'T00:00:00'), end = f.endDate ? Date.parse(f.endDate + 'T23:59:59.999') : start + (f.durationDays || 30) * DAY - 1;
        db.funds.push({ id: 'fund_' + id(), status: 'active', name: f.name, perPeriod: f.perPeriod, amount: f.amount, reason: f.reason, ...f, start: f.startDate ? Date.parse(f.startDate + 'T00:00:00') : start, end, version: 1, createdAt: Date.now() });
      }
    }
  }
  delete db.fund;
}
seedEntities();
// one-time migration to the StuSPACE brand (keeps anything an admin has customised)
db.migrations = db.migrations || [];
if (!db.migrations.includes('stuspace-brand')) {
  const OLD_NAMES = [/Involved Principal CCC Program/g, /Involved Principal Program/g];
  const forced = { 'site.heroTitle': 'Funding the leaders who shape our schools', 'site.heroText': 'An education funding platform. Share contented video to platform that talks about CCC (communication, content and confidence).' };
  for (const c of db.configs) {
    if (typeof c.value !== 'string') continue;
    if (forced[c.key] === c.value || c.key === 'site.whoWeAre' || c.key === 'insight.questions' || c.key === 'letter.body' || c.key === 'letter.subject') { const d = CONFIG_DEFAULTS.find((x) => x[0] === c.key); if (d && (forced[c.key] === c.value || c.key === 'site.whoWeAre' || c.key === 'insight.questions' || c.key === 'letter.body' || c.key === 'letter.subject')) { c.value = d[1]; bump(c); continue; } }
    let v = c.value; for (const re of OLD_NAMES) v = v.replace(re, 'StuSPACE'); v = v.replace('support@involved.example', 'support@stuspace.example');
    if (v !== c.value) { c.value = v; bump(c); }
  }
  for (const t of db.templates) { const d = TEMPLATE_DEFAULTS.find((x) => x.key === t.key); if (d && (t.version || 1) === 1) Object.assign(t, d, { version: 2 }); }
  db.migrations.push('stuspace-brand');
}
if (!db.migrations.includes('stuspace-v2')) {
  for (const k of ['site.heroText', 'site.whoWeAre', 'letter.body']) { const c = cfgRec(k), d = CONFIG_DEFAULTS.find((x) => x[0] === k); if (c && d && /Top 5/.test(c.value)) { c.value = d[1]; bump(c); } }
  for (const t of db.templates) { const d = TEMPLATE_DEFAULTS.find((x) => x.key === t.key); if (d && /Top 5/.test(t.body) && (t.version || 1) <= 2) Object.assign(t, d, { version: (t.version || 1) + 1 }); }
  db.migrations.push('stuspace-v2');
}
for (const ad of db.admins) if (!ad.role) ad.role = 'super'; // admins that existed before roles keep full access
for (const r of db.rewards) if (!r.status) { r.status = 'Released'; r.releasedAt = r.at; r.releasedBy = 'before release tracking'; r.reference = r.reference || '—'; r.version = r.version || 1; }
for (const [sid, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[sid];

// ---------- logo (shared by web + email) ----------
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 64" width="330" height="64" role="img" aria-label="StuSPACE">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>
<g transform="translate(4,4)">
<rect width="56" height="56" rx="16" fill="url(#g)"/>
<path d="M28 10 L33.8 22.6 L47.5 24.2 L37.3 33.5 L40.2 47 L28 40 L15.8 47 L18.7 33.5 L8.5 24.2 L22.2 22.6 Z" fill="#fff"/>
</g>
<text x="70" y="34" font-family="Helvetica,Arial,sans-serif" font-size="30" font-weight="800" fill="#14121f">Stu<tspan fill="#d6338a">SPACE</tspan></text>
<text x="71" y="54" font-family="Helvetica,Arial,sans-serif" font-size="11.5" font-weight="700" letter-spacing="2.4" fill="#666">BIG OPPORTUNITY TO SHINE</text>
</svg>`;

// ---------- email (record in DB + ./outbox file; real delivery through the SMTP integration) ----------
const baseUrl = () => cfg('site.baseUrl') || process.env.BASE_URL || `http://localhost:${PORT}`;
const wrapEmail = (inner, logo) => `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#e5e5e5;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px">
${logo ? `<img src="${baseUrl()}/logo.svg" alt="${esc(cfg('site.programName'))}" width="300" style="display:block;margin-bottom:16px">` : ''}
${inner}
</div></body></html>`;
function sendEmail(to, subject, inner, kind, principalId, extra = {}) {
  const html = wrapEmail(inner, !extra.noLogo);
  const rec = { id: id(), to, subject, kind, principalId, sentAt: Date.now(), status: 'queued', ...(extra.meta || {}) };
  fs.writeFileSync(path.join(DIRS.outbox, `${rec.id}.html`), html);
  db.emails.push(rec);
  save();
  log.info(`email queued to=${to} kind=${kind} id=${rec.id}`);
  integ.email.send({ to, subject, html }).then((r) => { rec.status = r.sent ? 'sent' : r.error ? 'failed' : 'saved'; if (r.error) rec.error = r.error; save(); });
  return rec;
}
// SMS goes through the Sparrow integration; failures are logged, never thrown
function sendSms(to, text) { integ.sms.send({ to, text }).then((r) => { if (r.error) log.warn(`SMS not sent: ${r.error}`); }).catch((e) => log.error('sms error', e)); }
// Email templates are editable in Admin > Email templates. Placeholders: {{name}} {{school}} {{plan}} {{question}} {{date}} {{link}} {{program}}
function renderEmail(tpl, vars) {
  const sub = (s, raw) => String(s || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? (raw ? String(vars[k]) : esc(vars[k])) : m));
  const paras = sub(tpl.body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => x === esc(vars.question) && vars.question
    ? `<blockquote style="border-left:4px solid #000;margin:14px 0;padding-left:12px;font-size:17px">${x}</blockquote>`
    : `<p style="line-height:1.55">${x.replace(/\n/g, '<br>')}</p>`).join('');
  const button = tpl.buttonText && vars.link ? `<p><a href="${esc(vars.link)}" style="display:inline-block;background:#000;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(tpl.buttonText)}</a></p>` : '';
  const inner = `${tpl.showLogo ? `<img src="${baseUrl()}/logo.svg" alt="${esc(vars.program)}" width="300" style="display:block;margin-bottom:12px">` : ''}${tpl.showDate ? `<div style="color:#6b7280;font-size:12px;margin-bottom:12px">${esc(vars.date)}</div>` : ''}<h2 style="margin:0 0 12px">${sub(tpl.heading)}</h2>${paras}${button}<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><small style="color:#6b7280">${sub(tpl.footer)}</small>`;
  return { subject: sub(tpl.subject, true), inner };
}
const tplVars = (p, extra = {}) => ({ name: p.name, school: p.school.name, plan: p.plan, program: cfg('site.programName'), date: longDate(Date.now()), question: '', link: '', ...extra });
const getTpl = (key) => db.templates.find((t) => t.key === key);
const SAMPLE = { name: 'Sita Sharma', school: 'Everest Public School', plan: 'Free', program: '', date: '', question: '', link: '' };
const sampleVars = () => ({ ...SAMPLE, question: questions()[0] || '', program: cfg('site.programName'), date: longDate(Date.now()), link: `${baseUrl()}/login.html?next=/interview.html` });

// ---------- OTP (static code switchable from Admin, otherwise a generated code delivered by email) ----------
async function issueOtp(scope, key, to, name, phone) {
  if (cfg('otp.static.enabled')) return;
  const k = `${scope}:${key}`;
  const prev = db.otps[k];
  if (prev && Date.now() - prev.at < 10000) return; // throttle
  const code = String(crypto.randomInt(1000, 10000));
  const minutes = cfg('otp.ttlMinutes') || 10;
  db.otps[k] = { code, at: Date.now(), exp: Date.now() + minutes * 60000, tries: 0 };
  save();
  await integ.otp.deliver({ to, phone, name, code, minutes, sendEmail, sendSms });
}
function checkOtp(scope, key, code) {
  code = String(code || '').trim();
  if (cfg('otp.static.enabled') && code === cfg('otp.static.value')) return true;
  const k = `${scope}:${key}`, o = db.otps[k];
  if (!o || o.exp < Date.now()) return false;
  if (++o.tries > 5) { delete db.otps[k]; save(); return false; }
  if (o.code === code) { delete db.otps[k]; save(); return true; }
  return false;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const t0 = Date.now();
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => { if (req.path.startsWith('/api/')) log[res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug'](`${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`); });
  next();
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c[0]));
function startSession(res, cookie, data, ttl = COOKIE_TTL) {
  const sid = crypto.randomBytes(24).toString('hex');
  db.sessions[sid] = { ...data, exp: Date.now() + ttl };
  save();
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), `${cookie}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl / 1000}`]);
}
function getSession(req, cookie, role) {
  const sid = cookies(req)[cookie];
  const ses = sid && db.sessions[sid];
  if (!ses || ses.exp < Date.now() || ses.role !== role) return null;
  return ses;
}
function endSession(req, res, cookie) {
  const sid = cookies(req)[cookie];
  if (sid) { delete db.sessions[sid]; save(); }
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), `${cookie}=; Path=/; Max-Age=0`]);
}
const find = (pid) => db.principals.find((p) => p.id === pid);
const currentAdmin = (req) => { const s = getSession(req, 'asid', 'admin'); const a = s && db.admins.find((x) => x.id === s.adminId); return a && a.status === 'active' ? a : null; };
const needPrincipal = (req, res, next) => {
  const s = getSession(req, 'psid', 'principal');
  if (!s || !find(s.principalId)) return res.status(currentAdmin(req) ? 403 : 401).json({ error: currentAdmin(req) ? 'Only schools can provide insights. Admins review them.' : 'Please log in' });
  req.principal = find(s.principalId); next();
};
const isSuper = (a) => (a.role || 'super') === 'super';
const needSuper = (req, res, next) => needAdmin(req, res, () => (isSuper(req.admin) ? next() : res.status(403).json({ error: 'Super admin access required' })));
const needAdmin = (req, res, next) => { const a = currentAdmin(req); if (!a) return res.status(401).json({ error: 'Admin login required' }); req.admin = a; next(); };
app.get('/logo.svg', (_req, res) => res.type('image/svg+xml').send(LOGO_SVG));
app.get('/favicon.ico', (_req, res) => res.redirect(301, '/favicon.svg'));
app.use('/photos', express.static(DIRS.photos));
app.use('/videos', express.static(DIRS.videos));
app.get('/outbox/:f', needSuper, (req, res) => res.sendFile(path.join(DIRS.outbox, path.basename(req.params.f))));
// Web files live in the project root next to the server code, so only an explicit allowlist is served
// (never server.js, seed.json, package.json, data/ ...).
const WEB_FILE = /^\/([\w-]+\.(?:html|css|svg)|common\.js)$/;
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get(WEB_FILE, (req, res, next) => {
  const f = path.join(ROOT, req.params[0]);
  fs.existsSync(f) ? res.sendFile(f) : next();
});

const ext = (file, fallback) => (path.extname(file.originalname) || fallback).replace(/[^.\w]/g, '').slice(0, 8);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'video' ? DIRS.videos : DIRS.photos),
  filename: (req, file, cb) => cb(null, id() + ext(file, file.fieldname === 'video' ? '.webm' : '.jpg')),
});
// the size limit is read from the DB config on every request, so Admin changes apply immediately
const uploader = (field, limitKey) => (req, res, next) => multer({ storage, limits: { fileSize: Math.max(1, cfg(limitKey)) * 1024 * 1024 } }).single(field)(req, res, (err) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large. Maximum size is ${cfg(limitKey)} MB.` });
  err ? next(err) : next();
});

// ---------- views ----------
const publicView = (p) => { const { interviews, ...rest } = p; return rest; }; // directory never exposes insights
const insightLabel = (p, iv) => `${p.school.name} (${isoDate(iv.at)})`;
const insightView = (p, iv) => ({ id: iv.id, version: iv.version || 1, title: insightLabel(p, iv), question: iv.question, notes: iv.notes, video: iv.video, duration: iv.duration || null, at: iv.at, status: iv.status, funded: !!iv.funded, fundingStatus: (db.rewards.find((r) => r.insightId === iv.id) || {}).status || null, youtube: iv.youtube || null,
  principal: { id: p.id, name: p.name, address: p.address, photo: p.photo, linkedin: p.linkedin, school: p.school } });
const allInsights = () => db.principals.flatMap((p) => p.interviews.map((iv) => insightView(p, iv))).sort((a, b) => b.at - a.at);
const published = () => allInsights().filter((i) => i.status === 'Published');
const findInsight = (iid) => { for (const p of db.principals) { const iv = p.interviews.find((x) => x.id === iid); if (iv) return { p, iv }; } return null; };

// ---------- public config + stats ----------
app.get('/api/site', (_req, res) => res.json({ heroTitle: cfg('site.heroTitle'), heroText: cfg('site.heroText'), playerTitle: cfg('site.playerTitle'), whoWeAre: cfg('site.whoWeAre'), privacy: cfg('site.privacy'), tagline: cfg('site.tagline'),
  program: cfg('site.programName'), contact: { email: cfg('contact.email'), phone: cfg('contact.phone'), address: cfg('contact.address') }, maxVideoMB: cfg('video.maxMB'), maxVideoSeconds: cfg('video.maxSeconds') }));
const isoDay = () => Date.now();
const fundState = (f, now = isoDay()) => (now < f.start ? 'upcoming' : now > f.end ? 'ended' : 'active');
function activeFund() {
  const now = isoDay(), on = db.funds.filter((f) => f.status === 'active');
  return on.find((f) => fundState(f, now) === 'active') || on.filter((f) => f.start > now).sort((a, b) => a.start - b.start)[0] || on.sort((a, b) => b.end - a.end)[0] || null;
}
function fundStatus(f = activeFund()) {
  if (!f) return { id: null, name: '', status: 'inactive', version: 1, reason: '', perPeriod: 0, amount: 0, periodStart: 0, periodEnd: 0, startDate: '', endDate: '', state: 'none', used: 0, remaining: 0 };
  const now = isoDay();
  const used = db.rewards.filter((r) => r.fundId === f.id).length;
  const state = fundState(f, now);
  return { id: f.id, name: f.name, status: f.status, createdBy: f.createdBy || null, version: f.version, reason: f.reason, perPeriod: f.perPeriod, amount: f.amount, periodStart: f.start, periodEnd: f.end, startDate: isoDate(f.start), endDate: isoDate(f.end), state, used, remaining: state === 'active' && f.status === 'active' ? Math.max(0, f.perPeriod - used) : 0 };
}
app.get('/api/stats', (_req, res) => { const f = fundStatus(); res.json({ registrations: db.principals.length, insights: published().length, funding: db.rewards.reduce((a, r) => a + r.amount, 0), fundActive: f.remaining, fundTotal: f.perPeriod, fundState: f.state }); });
app.get('/api/plans', (_req, res) => res.json(db.plans.filter((p) => p.status === 'active').map(({ id: i, name, price, description }) => ({ id: i, name, price, description }))));
app.get('/api/program-video', (_req, res) => {
  const v = db.programVideos.filter((x) => x.status === 'Published' && x.active).sort((a, b) => (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt))[0];
  res.json(v ? { id: v.id, title: v.title, video: v.video } : null);
});

// ---------- OTP request for flows that are not tied to a login (registration, payment) ----------
app.post('/api/otp/request', async (req, res) => {
  const { scope, identifier } = req.body || {};
  try {
    if (scope === 'register') {
      if (!/^\S+@\S+\.\S+$/.test(String(identifier || ''))) return res.status(400).json({ error: 'Enter a valid email first' });
      await issueOtp('register', String(identifier).toLowerCase(), identifier, '', req.body.phone);
    } else if (scope === 'pay') {
      const p = find(identifier);
      if (!p) return res.status(404).json({ error: 'Not found' });
      await issueOtp('pay', p.id, p.email, p.name);
    } else return res.status(400).json({ error: 'Unknown scope' });
    res.json({ ok: true });
  } catch (e) { log.error('otp request failed', e); res.status(500).json({ error: 'Could not send the code' }); }
});

// ---------- school auth ----------
const findByIdentifier = (v) => {
  const idf = String(v || '').trim().toLowerCase();
  const d = digits(idf);
  return db.principals.find((x) => x.email.toLowerCase() === idf || (d.length >= 7 && digits(x.phone) === d));
};
const lastSubmit = (p) => p.interviews.reduce((m, iv) => Math.max(m, iv.at), 0);
// a school may submit only after an insights request email was sent to it (and not yet answered)
const openRequest = (p) => db.emails.filter((e) => e.kind === 'insight' && e.principalId === p.id && e.sentAt > lastSubmit(p)).sort((a, b) => b.sentAt - a.sentAt)[0] || null;
app.post('/api/auth/request', async (req, res) => {
  const p = findByIdentifier(req.body.identifier);
  if (!p) return res.status(404).json({ error: 'No school found with that email/phone. Please register first.' });
  if (p.status !== 'active') return res.status(403).json({ error: 'This registration is not active.' });
  await issueOtp('principal', p.id, p.email, p.name, p.phone);
  res.json({ ok: true });
});
app.post('/api/auth/login', (req, res) => {
  const p = findByIdentifier(req.body.identifier);
  if (!p || p.status !== 'active') return res.status(404).json({ error: 'No active school found with that email/phone. Please register first.' });
  if (!checkOtp('principal', p.id, req.body.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  startSession(res, 'psid', { role: 'principal', principalId: p.id }, 30 * 60 * 1000); // one OTP = one insight, 30 min to record it
  log.info(`school login ${p.id}`);
  res.json({ ok: true, name: p.name });
});
app.get('/api/auth/me', (req, res) => {
  const s = getSession(req, 'psid', 'principal');
  const p = s && find(s.principalId);
  if (!p) return res.json(null);
  const r = openRequest(p);
  res.json({ id: p.id, name: p.name, school: p.school.name, email: p.email, request: r ? { at: r.sentAt, question: r.question || '' } : null });
});
app.post('/api/auth/logout', (req, res) => { endSession(req, res, 'psid'); res.json({ ok: true }); });

// ---------- admin auth (phone or email + OTP) ----------
const findAdmin = (v) => {
  const idf = String(v || '').trim().toLowerCase(), d = digits(idf);
  return db.admins.find((a) => a.status === 'active' && (a.email.toLowerCase() === idf || (d.length >= 7 && digits(a.phone) === d)));
};
app.post('/api/admin/request', async (req, res) => {
  const a = findAdmin(req.body.identifier);
  if (!a) return res.status(404).json({ error: 'No active admin found with that phone or email.' });
  await issueOtp('admin', a.id, a.email, a.name, a.phone);
  res.json({ ok: true });
});
app.post('/api/admin/login', (req, res) => {
  const a = findAdmin(req.body.identifier);
  if (!a) return res.status(404).json({ error: 'No active admin found with that phone or email.' });
  if (!checkOtp('admin', a.id, req.body.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  startSession(res, 'asid', { role: 'admin', adminId: a.id });
  log.info(`admin login ${a.id}`);
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => { const a = currentAdmin(req); res.json({ admin: !!a, name: a ? a.name : null, id: a ? a.id : null, role: a ? (a.role || 'super') : null }); });
app.post('/api/admin/logout', (req, res) => { endSession(req, res, 'asid'); res.json({ ok: true }); });
app.post('/api/admin/otp', needAdmin, async (req, res) => { await issueOtp('adminact', req.admin.id, req.admin.email, req.admin.name, req.admin.phone); res.json({ ok: true, delivered: !cfg('otp.static.enabled') }); });

// ---------- registration ----------
const phoneTaken = (list, phone, except) => list.some((x) => x !== except && digits(x.phone) === digits(phone));
const activeSchool = (p) => p.status === 'active';
app.post('/api/principals', uploader('photo', 'photo.maxMB'), (req, res) => {
  const b = req.body;
  const required = ['name', 'address', 'schoolName', 'schoolAddress', 'email']; // linkedin and phone optional
  const missing = required.filter((k) => !String(b[k] || '').trim());
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  if (!/^\S+@\S+\.\S+$/.test(b.email)) return res.status(400).json({ error: 'Invalid email' });
  if (String(b.phone || '').trim() && digits(b.phone).length < 7) return res.status(400).json({ error: 'Invalid phone number' });
  const plan = planById(b.planId);
  if (!plan || plan.status !== 'active') return res.status(400).json({ error: 'Select a registration plan' });
  if (!checkOtp('register', b.email.trim().toLowerCase(), b.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  if (db.principals.some((p) => p.email.toLowerCase() === b.email.trim().toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
  if (String(b.phone || '').trim() && phoneTaken(db.principals.filter(activeSchool), b.phone)) return res.status(409).json({ error: 'A school is already registered with this phone number' });
  const p = {
    id: id(), version: 1, name: b.name.trim(), address: b.address.trim(),
    school: { name: b.schoolName.trim(), address: b.schoolAddress.trim(), board: (b.schoolBoard || '').trim(), students: Number(b.schoolStudents) || null },
    photo: req.file ? `/photos/${req.file.filename}` : null,
    phone: String(b.phone || '').trim(), email: b.email.trim(), linkedin: (b.linkedin || '').trim(),
    planId: plan.id, plan: plan.name, planPrice: plan.price, paymentStatus: 'n/a', status: 'active',
    createdAt: Date.now(), lastInsightEmailAt: null, interviews: [],
  };
  db.principals.push(p);
  save();
  log.info(`registration ${p.id} plan=${plan.name}`);
  sendWelcome(p);
  res.status(201).json({ principal: p, letter: letterFor(p) });
});
function sendWelcome(p) {
  const r = renderEmail(getTpl('welcome'), tplVars(p));
  sendEmail(p.email, r.subject, r.inner, 'welcome', p.id, { noLogo: true });
}
app.get('/api/principals', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json(db.principals
    .filter((p) => !q || [p.name, p.email, p.phone, p.address, p.school.name, p.school.address, p.plan].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt).map(publicView));
});
app.get('/api/principals/:id', (req, res) => { const p = find(req.params.id); p ? res.json(publicView(p)) : res.status(404).json({ error: 'Not found' }); });

// ---------- welcome letter (shown and downloadable after registration) ----------
function letterFor(p) {
  const v = { name: p.name, school: p.school.name, plan: p.plan, program: cfg('site.programName'), date: longDate(Date.now()), ref: 'REG-' + p.id.toUpperCase(), email: p.email, phone: p.phone };
  const body = cfg('letter.body').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));
  return { program: v.program, date: v.date, ref: v.ref, name: p.name, subject: cfg('letter.subject').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m)), body, signoff: cfg('letter.signoff'),
    contact: { email: cfg('contact.email'), phone: cfg('contact.phone'), address: cfg('contact.address') },
    details: [['Registration no.', v.ref], ['Principal', p.name], ['School', p.school.name], ['School address', p.school.address], ['Plan', p.plan], ['Email', p.email], ...(p.phone ? [['Phone', p.phone]] : []), ['Registered on', v.date]] };
}

// ---------- insight requests ----------
function sendInsightRequest(p, q) {
  const link = `${baseUrl()}/login.html?next=/interview.html`;
  const r = renderEmail(getTpl('insight_request'), tplVars(p, { question: q, link }));
  sendEmail(p.email, r.subject, r.inner, 'insight', p.id, { noLogo: true, meta: { question: q } });
  if (cfg('sms.notify')) sendSms(p.phone, `${cfg('site.programName')}: you have been invited to share a video insight. Check your email (${p.email}) and log in at ${baseUrl()}/login.html?next=/interview.html`);
  db.currentInsight = { question: q, sentAt: Date.now() };
}
const repeatMs = () => (cfg('insight.repeatDays') || 90) * DAY;
const questions = () => cfg('insight.questions').split('\n').map((x) => x.trim()).filter(Boolean);
function sendRandomInsight(topic) {
  const now = Date.now();
  const eligible = db.principals.filter((p) => p.status === 'active' && (!p.lastInsightEmailAt || now - p.lastInsightEmailAt >= repeatMs()));
  const qs = questions();
  if (!eligible.length || (!topic && !qs.length)) return null;
  const p = eligible[crypto.randomInt(eligible.length)];
  sendInsightRequest(p, topic || qs[crypto.randomInt(qs.length)]);
  p.lastInsightEmailAt = now;
  save();
  return p;
}
app.post('/api/admin/send-manual', needSuper, (req, res) => {
  const ids = Array.isArray(req.body.principalIds) ? req.body.principalIds : [];
  const qs = questions();
  if (!qs.length) return res.status(400).json({ error: 'No topics in the pool. Add some in Admin > Configs > insight.questions' });
  const targets = db.principals.filter((p) => ids.includes(p.id) && p.status === 'active');
  if (!targets.length) return res.status(400).json({ error: 'Select at least one active school' });
  targets.forEach((p) => sendInsightRequest(p, qs[crypto.randomInt(qs.length)])); // each school gets a topic from the pool
  save();
  res.json({ ok: true, sent: targets.length });
});
app.post('/api/admin/send-random', needSuper, (req, res) => {
  const topic = String((req.body || {}).question || '').trim().slice(0, 300);
  const p = sendRandomInsight(topic || undefined);
  p ? res.json({ ok: true, principal: p.name, topic: topic || null }) : res.status(409).json({ error: `No eligible schools (all emailed within the last ${cfg('insight.repeatDays')} days)` });
});
setInterval(() => { try { sendRandomInsight(); } catch (e) { log.error('scheduled random insight failed', e); } }, DAY).unref();

// ---------- insights ----------
app.get('/api/insights/current', (_req, res) => res.json(db.currentInsight || { question: questions()[0] || '', sentAt: null }));
app.get('/api/insights', (_req, res) => res.json(published()));
// Watch: up to 5 videos - recently funded (released) ones first, then the newest published ones. Only the video is exposed (no school or person details).
app.get('/api/insights/recent-funded', (_req, res) => {
  const out = [];
  const add = (hit) => { if (hit && hit.iv.status === 'Published' && out.length < 5 && !out.some((o) => o.id === hit.iv.id)) out.push({ id: hit.iv.id, video: hit.iv.video }); };
  for (const r of db.rewards.filter((x) => x.status === 'Released').sort((x, y) => (y.releasedAt || y.at) - (x.releasedAt || x.at))) add(r.insightId && findInsight(r.insightId));
  for (const i of published()) add(findInsight(i.id));
  res.json(out);
});
app.get('/api/insights/:id', (req, res) => {
  const i = allInsights().find((x) => x.id === req.params.id);
  const isOwner = !!(i && getSession(req, 'psid', 'principal') && i.principal.id === getSession(req, 'psid', 'principal').principalId);
  i && (i.status === 'Published' || currentAdmin(req) || isOwner) ? res.json(i) : res.status(404).json({ error: 'Insight not found' });
});
// Principal submits an insight video: needs an OTP session AND an insights request email. New insights go to OnReview.
app.post('/api/insights', needPrincipal, uploader('video', 'video.maxMB'), (req, res) => {
  const reject = (code, msg) => { if (req.file) fs.rmSync(req.file.path, { force: true }); return res.status(code).json({ error: msg }); };
  if (!openRequest(req.principal)) return reject(403, 'No insights request has been sent to your school yet. You can submit once you receive the request email.');
  if (!req.file) return res.status(400).json({ error: 'Video required' });
  const duration = Number(req.body.duration), maxSec = cfg('video.maxSeconds');
  if (duration > maxSec + 5) return reject(400, `Video is too long. Maximum length is ${Math.round(maxSec / 60)} minutes.`);
  const iv = { id: id(), version: 1, video: `/videos/${req.file.filename}`, question: String(req.body.question || (openRequest(req.principal) || {}).question || '').slice(0, 300),
    notes: String(req.body.notes || '').slice(0, 2000), at: Date.now(), status: 'OnReview', duration: duration > 0 ? Math.round(duration) : null };
  req.principal.interviews.push(iv);
  save();
  log.info(`insight submitted ${iv.id} school=${req.principal.id}`);
  endSession(req, res, 'psid'); // OTP used up: the next insight needs a new OTP
  res.status(201).json(insightView(req.principal, iv));
});

// ---------- admin: schools ----------
app.get('/api/admin/principals', needAdmin, (_req, res) => res.json(db.principals.map((p) => ({ id: p.id, version: p.version, name: p.name, email: p.email, phone: p.phone, plan: p.plan, planId: p.planId, status: p.status, school: p.school.name, address: p.address, linkedin: p.linkedin, schoolInfo: p.school, insights: p.interviews.length, lastInsightEmailAt: p.lastInsightEmailAt, createdAt: p.createdAt })).sort((a, b) => b.createdAt - a.createdAt)));
// An admin registers a school on its behalf (no OTP, active immediately; the welcome email is sent)
app.post('/api/admin/principals', needAdmin, (req, res) => {
  const b = req.body || {}, t = (k) => String(b[k] ?? '').trim();
  const missing = ['name', 'address', 'schoolName', 'schoolAddress', 'email'].filter((k) => !t(k));
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  if (!/^\S+@\S+\.\S+$/.test(t('email'))) return res.status(400).json({ error: 'Invalid email' });
  if (t('phone') && digits(t('phone')).length < 7) return res.status(400).json({ error: 'Invalid phone number' });
  const plan = planById(b.planId);
  if (!plan || plan.status !== 'active') return res.status(400).json({ error: 'Select an active registration plan' });
  if (db.principals.some((p) => p.email.toLowerCase() === t('email').toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
  if (t('phone') && phoneTaken(db.principals.filter(activeSchool), t('phone'))) return res.status(409).json({ error: 'A school is already registered with this phone number' });
  const p = { id: id(), version: 1, name: t('name'), address: t('address'), school: { name: t('schoolName'), address: t('schoolAddress'), board: t('schoolBoard'), students: Number(b.schoolStudents) || null },
    photo: null, phone: t('phone'), email: t('email'), linkedin: t('linkedin'), planId: plan.id, plan: plan.name, planPrice: plan.price, paymentStatus: 'n/a', status: 'active',
    createdAt: Date.now(), createdBy: req.admin.id, lastInsightEmailAt: null, interviews: [] };
  db.principals.push(p);
  audit(req, 'school', p.id, 'create', p.school.name, null, snap(p));
  sendWelcome(p);
  res.status(201).json({ ok: true, id: p.id });
});
app.put('/api/admin/principals/:id', needAdmin, (req, res) => {
  const p = find(req.params.id);
  if (!p) return res.status(404).json({ error: 'School not found' });
  if (isStale(p, req.body)) return res.status(409).json(STALE);
  const b = req.body || {};
  const t = (k) => String(b[k] ?? '').trim();
  for (const k of ['name', 'address', 'schoolName', 'schoolAddress', 'email']) if (!t(k)) return res.status(400).json({ error: `Missing: ${k}` });
  if (!/^\S+@\S+\.\S+$/.test(t('email'))) return res.status(400).json({ error: 'Invalid email' });
  if (db.principals.some((x) => x !== p && x.email.toLowerCase() === t('email').toLowerCase())) return res.status(409).json({ error: 'Email already used by another school' });
  const plan = planById(b.planId);
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  if (!['active', 'inactive'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.status !== 'inactive' && t('phone') && phoneTaken(db.principals.filter(activeSchool), t('phone'), p)) return res.status(409).json({ error: 'Another active school already uses this phone number' });
  const before = snap(p);
  Object.assign(p, { name: t('name'), address: t('address'), phone: t('phone'), email: t('email'), linkedin: t('linkedin'), planId: plan.id, plan: plan.name, planPrice: plan.price, status: b.status });
  p.school = { name: t('schoolName'), address: t('schoolAddress'), board: t('schoolBoard'), students: Number(b.schoolStudents) || null };
  bump(p); audit(req, 'school', p.id, 'update', p.school.name, before, snap(p));
  res.json({ ok: true });
});
app.delete('/api/admin/principals/:id', needSuper, (req, res) => {
  const p = find(req.params.id);
  if (!p) return res.status(404).json({ error: 'School not found' });
  for (const iv of p.interviews) fs.rmSync(path.join(DIRS.videos, path.basename(iv.video)), { force: true });
  if (p.photo) fs.rmSync(path.join(DIRS.photos, path.basename(p.photo)), { force: true });
  audit(req, 'school', p.id, 'delete', p.school.name, null, null);
  db.principals = db.principals.filter((x) => x !== p);
  for (const [sid, ses] of Object.entries(db.sessions)) if (ses.principalId === p.id) delete db.sessions[sid];
  save(); // reward/payment/email records are kept for audit
  log.info(`school deleted ${p.id} by admin ${req.admin.id}`);
  res.json({ ok: true });
});

// ---------- admin: insights, funding ----------
app.get('/api/admin/insights', needAdmin, (_req, res) => { const all = allInsights(); res.json({ last30: all.slice(0, 30), history: all }); });
app.get('/api/admin/summary', needAdmin, (_req, res) => {
  res.json({ registrations: db.principals.length, active: db.principals.filter((p) => p.status === 'active').length, byPlan: db.plans.map((pl) => ({ name: pl.name, count: db.principals.filter((p) => p.planId === pl.id).length })), repeatDays: cfg('insight.repeatDays') });
});
app.get('/api/admin/fund', needSuper, (_req, res) => res.json(fundStatus())); // the fund currently used for rewards
app.get('/api/admin/funds', needSuper, (_req, res) => { const cur = activeFund(); res.json(db.funds.map((f) => ({ ...fundStatus(f), current: !!cur && cur.id === f.id })).sort((a, b) => b.periodStart - a.periodStart)); });
function fundFields(b) {
  const name = String(b.name || '').trim().slice(0, 60), reason = String(b.reason || '').trim().slice(0, 500);
  const perPeriod = Number(b.perPeriod), amount = Number(b.amount);
  const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(Date.parse(v + 'T00:00:00'));
  if (!name) return { error: 'Fund name is required' };
  if (!reason) return { error: 'Reason is required' };
  if (!okDate(b.startDate) || !okDate(b.endDate)) return { error: 'Pick a valid start and end date' };
  const start = Date.parse(b.startDate + 'T00:00:00'), end = Date.parse(b.endDate + 'T23:59:59.999');
  if (end < start) return { error: 'End date must be on or after the start date' };
  if (!Number.isInteger(perPeriod) || perPeriod < 1 || perPeriod > 1000) return { error: 'Number of funds must be 1-1000' };
  if (!(amount > 0)) return { error: 'Amount must be greater than 0' };
  if (!['active', 'inactive'].includes(b.status)) return { error: 'Invalid status' };
  return { name, reason, start, end, perPeriod, amount, status: b.status };
}
app.post('/api/admin/funds', needSuper, (req, res) => {
  if (!checkOtp('adminact', req.admin.id, req.body.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  const f = fundFields(req.body);
  if (f.error) return res.status(400).json(f);
  const rec = { id: 'fund_' + id(), version: 1, ...f, createdAt: Date.now(), createdBy: req.admin.id };
  db.funds.push(rec); audit(req, 'fund', rec.id, 'create', rec.name, null, snap(rec));
  log.info(`fund created ${rec.id} by ${req.admin.id}`);
  res.status(201).json(fundStatus(rec));
});
app.put('/api/admin/funds/:id', needSuper, (req, res) => {
  const rec = db.funds.find((x) => x.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Fund not found' });
  if (isStale(rec, req.body)) return res.status(409).json(STALE);
  if (!checkOtp('adminact', req.admin.id, req.body.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  const f = fundFields(req.body);
  if (f.error) return res.status(400).json(f);
  if (rec.createdBy === req.admin.id && f.status !== rec.status) return res.status(403).json(LOCK);
  const used = db.rewards.filter((r) => r.fundId === rec.id).length;
  if (f.perPeriod < used) return res.status(400).json({ error: `${used} funds are already awarded, so the number of funds cannot be lower than that` });
  const before = snap(rec);
  Object.assign(rec, f); bump(rec); audit(req, 'fund', rec.id, 'update', rec.name, before, snap(rec));
  res.json(fundStatus(rec));
});
app.post('/api/admin/insights/:id/review', needAdmin, (req, res) => {
  const hit = findInsight(req.params.id);
  if (!hit) return res.status(404).json({ error: 'Insight not found' });
  const { p, iv } = hit;
  const before = { status: iv.status, funded: !!iv.funded };
  if (isStale(iv, req.body)) return res.status(409).json(STALE);
  const status = req.body.fund ? iv.status : req.body.status;
  if (!['Published', 'OnReview'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  let funded = false;
  if (req.body.fund && (iv.funded || db.rewards.some((r) => r.insightId === iv.id))) return res.status(409).json({ error: 'Funding was already requested for this work (one funding per work)' });
  if (req.body.fund) {
    const fs_ = fundStatus();
    if (fs_.state !== 'active') return res.status(409).json({ error: fs_.state === 'none' ? 'No active fund. Add one in Admin > Funds' : fs_.state === 'upcoming' ? 'The funding period has not started yet' : 'The funding period has ended' });
    if (!fs_.remaining) return res.status(409).json({ error: 'No funds left for this period' });
    db.rewards.push({ id: id(), principalId: p.id, principalName: p.name, insightId: iv.id, amount: fs_.amount, reason: fs_.reason, fundId: fs_.id, status: 'Pending', version: 1, at: Date.now() });
    iv.funded = true; funded = true;
  }
  if (status === 'Published' && iv.status !== 'Published' && !db.rewards.some((r) => r.insightId === iv.id && r.status === 'Released')) return res.status(409).json({ error: 'Publish only after funding is approved (request funding, then release it in Release funding)' });
  iv.status = status; bump(iv);
  if (status === 'Published' && !req.body.fund) publishToYoutube(p, iv);
  audit(req, 'insight', iv.id, req.body.fund ? 'request-funding' : req.body.approve ? 'publish' : 'review', p.school.name, before, { status: iv.status, funded: !!iv.funded });
  save();
  res.json({ ok: true, funded, fund: fundStatus() });
});
// ----- YouTube publishing (integration in integrations.js) -----
function publishToYoutube(p, iv, force = false) {
  if (!cfg('youtube.enabled')) return false;
  if (iv.youtube && (iv.youtube.status === 'published' || iv.youtube.status === 'uploading') && !force) return false;
  iv.youtube = { status: 'uploading', at: Date.now() };
  const v = { school: p.school.name, name: p.name, program: cfg('site.programName') };
  const title = cfg('youtube.titleTemplate').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m)).slice(0, 95);
  const description = [iv.question, '', `${v.program} · ${cfg('site.tagline')}`].filter((x) => x !== undefined).join('\n').slice(0, 4500);
  integ.youtube.upload({ file: path.join(DIRS.videos, path.basename(iv.video)), title, description }).then((r) => {
    iv.youtube = r.videoId ? { status: 'published', videoId: r.videoId, url: r.url, at: Date.now() } : { status: 'failed', error: r.error, at: Date.now() };
    if (!r.videoId) log.error(`YouTube publish failed insight=${iv.id}: ${r.error}`); else log.info(`YouTube published insight=${iv.id} video=${r.videoId}`);
    save();
  }).catch((e) => { iv.youtube = { status: 'failed', error: e.message, at: Date.now() }; log.error('youtube error', e); save(); });
  save();
  return true;
}
app.post('/api/admin/insights/:id/youtube', needAdmin, (req, res) => {
  const hit = findInsight(req.params.id);
  if (!hit) return res.status(404).json({ error: 'Insight not found' });
  if (hit.iv.status !== 'Published') return res.status(400).json({ error: 'Approve the insight before publishing it to YouTube' });
  if (!cfg('youtube.enabled')) return res.status(400).json({ error: 'YouTube publishing is turned off (Admin > Configs > youtube.enabled)' });
  publishToYoutube(hit.p, hit.iv, true);
  audit(req, 'insight', hit.iv.id, 'youtube-publish', hit.p.school.name, null, null);
  res.json({ ok: true });
});
// ----- Release funding: approved awards are Pending until an admin releases them -----
app.post('/api/admin/rewards/:id/release', needSuper, (req, res) => {
  const r = db.rewards.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Award not found' });
  if (isStale(r, req.body)) return res.status(409).json(STALE);
  if (r.status === 'Released') return res.status(409).json({ error: 'This funding is already released' });
  const reference = String(req.body.reference || '').trim().slice(0, 80);
  if (!reference) return res.status(400).json({ error: 'Enter a payment reference' });
  const before = { status: r.status, reference: r.reference || '' };
  Object.assign(r, { status: 'Released', releasedAt: Date.now(), releasedBy: req.admin.name, reference, note: String(req.body.note || '').trim().slice(0, 300) }); bump(r);
  const p = find(r.principalId);
  if (p) sendEmail(p.email, `Your NRS ${r.amount} funding has been released`, `<h2>Good news, ${esc(p.name)}!</h2><p>The NRS <b>${r.amount}</b> funding for <b>${esc(p.school.name)}</b> has been released.</p><p>Payment reference: <b>${esc(reference)}</b></p>`, 'reward-released', p.id);
  const hit = r.insightId && findInsight(r.insightId); // approving the funding publishes the work (sent to YouTube), so it shows on Watch
  if (hit && hit.iv.status !== 'Published') { const b = hit.iv.status; hit.iv.status = 'Published'; bump(hit.iv); publishToYoutube(hit.p, hit.iv); audit(req, 'insight', hit.iv.id, 'publish', hit.p.school.name, { status: b }, { status: 'Published' }); }
  audit(req, 'reward', r.id, 'release', r.principalName || (p && p.name) || r.id, before, { status: r.status, reference });
  res.json({ ok: true });
});
app.delete('/api/admin/insights/:id', needSuper, (req, res) => {
  const hit = findInsight(req.params.id);
  if (!hit) return res.status(404).json({ error: 'Insight not found' });
  audit(req, 'insight', hit.iv.id, 'delete', hit.p.school.name, null, null);
  hit.p.interviews = hit.p.interviews.filter((x) => x !== hit.iv);
  fs.rmSync(path.join(DIRS.videos, path.basename(hit.iv.video)), { force: true }); // funding records are kept for audit
  save();
  res.json({ ok: true });
});
app.get('/api/admin/rewards', needSuper, (_req, res) => res.json(db.rewards.map((r) => { const p = find(r.principalId); const hit = r.insightId && findInsight(r.insightId); return { ...r, principal: p?.name || r.principalName || '(deleted school)', school: p?.school.name || '—', insight: hit ? insightLabel(hit.p, hit.iv) : r.insightId ? '(deleted insight)' : '—' }; }).reverse()));
app.get('/api/admin/emails', needSuper, (_req, res) => res.json([...db.emails].reverse().slice(0, 100)));

// ---------- admin: program videos (the platform's own overview videos) ----------
const videoView = (v) => ({ ...v });
app.get('/api/admin/program-videos', needSuper, (_req, res) => res.json([...db.programVideos].sort((a, b) => b.createdAt - a.createdAt).map(videoView)));
app.post('/api/admin/program-videos', needSuper, uploader('video', 'video.program.maxMB'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video required' });
  const v = { id: id(), version: 1, title: String(req.body.title || '').trim().slice(0, 120) || 'Program video', video: `/videos/${req.file.filename}`, status: 'OnReview', active: true, createdAt: Date.now(), by: req.admin.name, createdBy: req.admin.id };
  db.programVideos.push(v); audit(req, 'video', v.id, 'create', v.title, null, { title: v.title, status: v.status, active: v.active });
  log.info(`program video uploaded ${v.id}`);
  res.status(201).json(videoView(v));
});
app.put('/api/admin/program-videos/:id', needSuper, (req, res) => {
  const v = db.programVideos.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found' });
  if (isStale(v, req.body)) return res.status(409).json(STALE);
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (v.createdBy === req.admin.id && (req.body.status !== v.status || !!req.body.active !== !!v.active)) return res.status(403).json(LOCK);
  if (!['Published', 'OnReview'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  if (req.body.status === 'Published' && v.status !== 'Published') v.publishedAt = Date.now();
  const before = { title: v.title, status: v.status, active: v.active };
  Object.assign(v, { title, status: req.body.status, active: !!req.body.active });
  bump(v); audit(req, 'video', v.id, 'update', v.title, before, { title: v.title, status: v.status, active: v.active });
  res.json({ ok: true });
});
app.delete('/api/admin/program-videos/:id', needSuper, (req, res) => {
  const v = db.programVideos.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found' });
  fs.rmSync(path.join(DIRS.videos, path.basename(v.video)), { force: true });
  audit(req, 'video', v.id, 'delete', v.title, null, null);
  db.programVideos = db.programVideos.filter((x) => x !== v); save();
  res.json({ ok: true });
});

// ---------- admin: admin users ----------
app.get('/api/admin/admins', needSuper, (_req, res) => res.json(db.admins));
function checkAdminFields(b, self) {
  const t = (k) => String(b[k] ?? '').trim();
  if (!t('name')) return 'Name is required';
  if (digits(t('phone')).length < 7) return 'Enter a valid phone number';
  if (!/^\S+@\S+\.\S+$/.test(t('email'))) return 'Enter a valid email';
  if (b.status && !['active', 'inactive'].includes(b.status)) return 'Invalid status';
  if (b.role && !['super', 'admin'].includes(b.role)) return 'Invalid role';
  const active = (b.status || 'active') === 'active';
  if (active && phoneTaken(db.admins.filter((a) => a.status === 'active'), t('phone'), self)) return 'Another active admin already uses this phone number';
  if (db.admins.some((a) => a !== self && a.email.toLowerCase() === t('email').toLowerCase())) return 'Another admin already uses this email';
  return null;
}
app.post('/api/admin/admins', needSuper, (req, res) => {
  const err = checkAdminFields(req.body, null);
  if (err) return res.status(400).json({ error: err });
  const a = { id: id(), version: 1, name: req.body.name.trim(), phone: req.body.phone.trim(), email: req.body.email.trim(), role: req.body.role === 'super' ? 'super' : 'admin', status: 'active', createdAt: Date.now(), createdBy: req.admin.id };
  db.admins.push(a); audit(req, 'admin', a.id, 'create', a.name, null, snap(a));
  log.info(`admin created ${a.id} by ${req.admin.id}`);
  res.status(201).json(a);
});
app.put('/api/admin/admins/:id', needSuper, (req, res) => {
  const a = db.admins.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Admin not found' });
  if (isStale(a, req.body)) return res.status(409).json(STALE);
  const err = checkAdminFields(req.body, a);
  if (err) return res.status(400).json({ error: err });
  if ((req.body.status || a.status) !== a.status && (a.createdBy === req.admin.id || a.id === req.admin.id)) return res.status(403).json(LOCK);
  if (req.body.status === 'inactive' && a.status === 'active' && db.admins.filter((x) => x.status === 'active').length < 2) return res.status(400).json({ error: 'At least one admin must stay active' });
  const newRole = req.body.role || a.role || 'super';
  if ((newRole !== (a.role || 'super') || (req.body.status || a.status) === 'inactive') && isSuper(a) && db.admins.filter((x) => x.status === 'active' && isSuper(x)).length < 2 && (newRole !== 'super' || req.body.status === 'inactive')) return res.status(400).json({ error: 'At least one super admin must stay active' });
  const before = snap(a);
  Object.assign(a, { name: req.body.name.trim(), phone: req.body.phone.trim(), email: req.body.email.trim(), role: newRole, status: req.body.status || a.status });
  bump(a); audit(req, 'admin', a.id, 'update', a.name, before, snap(a));
  if (a.status !== 'active') for (const [sid, s] of Object.entries(db.sessions)) if (s.adminId === a.id) delete db.sessions[sid];
  save();
  res.json({ ok: true, self: a.id === req.admin.id && a.status !== 'active' });
});

// ---------- admin: registration plans ----------
app.get('/api/admin/plans', needAdmin, (_req, res) => res.json(db.plans.map((p) => ({ ...p, schools: db.principals.filter((x) => x.planId === p.id).length }))));
function planFields(b) {
  const name = String(b.name || '').trim().slice(0, 40), price = Number(b.price);
  if (!name) return { error: 'Plan name is required' };
  if (!(price >= 0)) return { error: 'Price must be 0 or more' };
  if (!['active', 'inactive'].includes(b.status)) return { error: 'Invalid status' };
  return { name, price, description: String(b.description || '').slice(0, 400), status: b.status };
}
app.post('/api/admin/plans', needSuper, (req, res) => {
  const f = planFields(req.body);
  if (f.error) return res.status(400).json(f);
  if (db.plans.some((p) => p.name.toLowerCase() === f.name.toLowerCase())) return res.status(409).json({ error: 'A plan with this name already exists' });
  const p = { id: 'plan_' + id(), version: 1, ...f, createdAt: Date.now(), createdBy: req.admin.id };
  db.plans.push(p); audit(req, 'plan', p.id, 'create', p.name, null, snap(p));
  res.status(201).json(p);
});
app.put('/api/admin/plans/:id', needSuper, (req, res) => {
  const p = planById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  if (isStale(p, req.body)) return res.status(409).json(STALE);
  const f = planFields(req.body);
  if (f.error) return res.status(400).json(f);
  if (p.createdBy === req.admin.id && f.status !== p.status) return res.status(403).json(LOCK);
  if (db.plans.some((x) => x !== p && x.name.toLowerCase() === f.name.toLowerCase())) return res.status(409).json({ error: 'A plan with this name already exists' });
  const before = snap(p);
  Object.assign(p, f); bump(p); audit(req, 'plan', p.id, 'update', p.name, before, snap(p));
  for (const s of db.principals.filter((x) => x.planId === p.id)) s.plan = p.name; // existing schools keep the price they registered with
  save();
  res.json({ ok: true });
});
app.delete('/api/admin/plans/:id', needSuper, (req, res) => {
  const p = planById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plan not found' });
  if (db.principals.some((x) => x.planId === p.id)) return res.status(409).json({ error: 'Schools are registered on this plan. Set it to inactive instead.' });
  audit(req, 'plan', p.id, 'delete', p.name, null, null);
  db.plans = db.plans.filter((x) => x !== p); save();
  res.json({ ok: true });
});

// ---------- admin: email templates ----------
app.get('/api/admin/templates', needSuper, (_req, res) => res.json(db.templates));
const TPL_FIELDS = ['subject', 'heading', 'body', 'buttonText', 'footer'];
const tplFrom = (b, base) => ({ ...base, ...Object.fromEntries(TPL_FIELDS.map((k) => [k, String(b[k] ?? '').slice(0, 4000)])), showLogo: !!b.showLogo, showDate: !!b.showDate });
app.put('/api/admin/templates/:key', needSuper, (req, res) => {
  const t = getTpl(req.params.key);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  if (isStale(t, req.body)) return res.status(409).json(STALE);
  if (!String(req.body.subject || '').trim() || !String(req.body.body || '').trim()) return res.status(400).json({ error: 'Subject and body are required' });
  const before = snap(t);
  Object.assign(t, tplFrom(req.body, t)); bump(t); audit(req, 'template', t.key, 'update', t.name, before, snap(t));
  res.json({ ok: true });
});
app.post('/api/admin/templates/:key/preview', needSuper, (req, res) => {
  const t = getTpl(req.params.key);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  const r = renderEmail(tplFrom(req.body, t), sampleVars());
  res.json({ subject: r.subject, html: wrapEmail(r.inner, false) });
});
app.post('/api/admin/templates/:key/test', needSuper, (req, res) => {
  const t = getTpl(req.params.key);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  const r = renderEmail(tplFrom(req.body, t), sampleVars());
  sendEmail(req.admin.email, '[Test] ' + r.subject, r.inner, 'test', null, { noLogo: true });
  res.json({ ok: true, to: req.admin.email });
});

// ---------- admin: configs ----------
const maskCfg = (c) => (c.type === 'secret' ? { ...c, value: c.value ? '********' : '' } : c);
app.get('/api/admin/configs', needSuper, (_req, res) => res.json(db.configs.map(maskCfg)));
app.put('/api/admin/configs/:key', needSuper, (req, res) => {
  const c = cfgRec(req.params.key);
  if (!c) return res.status(404).json({ error: 'Config not found' });
  if (isStale(c, req.body)) return res.status(409).json(STALE);
  let v = req.body.value;
  if (c.type === 'boolean') v = v === true || v === 'true';
  else if (c.type === 'number') { v = Number(v); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'Enter a valid number' }); }
  else { v = String(v ?? ''); if (c.type === 'secret' && v === '********') return res.json({ ok: true }); }
  if (c.key === 'log.level' && !['error', 'warn', 'info', 'debug'].includes(v)) return res.status(400).json({ error: 'Level must be error, warn, info or debug' });
  if (c.key === 'otp.static.value' && !/^\d{4}$/.test(v)) return res.status(400).json({ error: 'The static OTP must be 4 digits' });
  if (['video.maxMB', 'video.program.maxMB', 'photo.maxMB', 'video.maxSeconds'].includes(c.key) && v < 1) return res.status(400).json({ error: 'Must be at least 1' });
  const mask = (x) => (c.type === 'secret' ? (x ? '********' : '') : x);
  const old = c.value;
  c.value = v; bump(c); audit(req, 'config', c.key, 'update', c.key, { value: mask(old) }, { value: mask(v) });
  if (c.key === 'log.level') log.setLevel(v);
  log.info(`config ${c.key} updated by ${req.admin.id}`);
  res.json({ ok: true });
});

// ---------- admin: delete all persisted data (temporary QC/UAT feature) ----------
// Wipes the database and every uploaded file/log, then rebuilds the starting data from ./seed.json.
app.post('/api/admin/purge', needSuper, (req, res) => {
  if (String(req.body.confirm || '') !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
  if (!checkOtp('adminact', req.admin.id, req.body.otp)) return res.status(400).json({ error: 'Invalid OTP' });
  const who = req.admin.id;
  for (const d of [DIRS.videos, DIRS.photos, DIRS.outbox, DIRS.data]) for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true, recursive: true });
  db = {};
  ensureShape(); seedConfigs(); seedEntities();
  log.setLevel(cfg('log.level'));
  save();
  res.setHeader('Set-Cookie', ['asid=; Path=/; Max-Age=0', 'psid=; Path=/; Max-Age=0']);
  log.warn(`ALL DATA DELETED by admin ${who}; rebuilt from seed`);
  res.json({ ok: true });
});

app.post('/api/admin/email/test', needSuper, async (req, res) => {
  const to = String(req.body.to || req.admin.email).trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address' });
  const rec = sendEmail(to, `[Test] ${cfg('site.programName')} email settings`, '<h2>Test email</h2><p>If you can read this, the email settings in the admin console work.</p>', 'test', null);
  for (let i = 0; i < 60 && rec.status === 'queued'; i++) await new Promise((r) => setTimeout(r, 250));
  res.json({ to, status: rec.status, smtp: cfg('smtp.enabled'), error: rec.error || null });
});
app.post('/api/admin/sms/test', needSuper, async (req, res) => {
  const r = await integ.sms.send({ to: req.body.to || req.admin.phone, text: `${cfg('site.programName')}: test message from the admin console` });
  res.json(r);
});

app.get('/api/admin/audit', needAdmin, (req, res) => {
  const { entity, entityId } = req.query;
  if (!isSuper(req.admin) && !['school', 'insight'].includes(entity)) return res.status(403).json({ error: 'Super admin access required' });
  res.json(db.audit.filter((a) => (!entity || a.entity === entity) && (!entityId || a.entityId === entityId)).sort((a, b) => b.at - a.at).slice(0, 200));
});

// ---------- admin: health ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirInfo = (dir) => { let size = 0, files = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { size += fs.statSync(f).size; files++; } catch (_) { /* ignore */ } } } }; try { walk(dir); } catch (_) { /* ignore */ } return { path: dir, size, files }; };
const diskInfo = () => new Promise((resolve) => execFile('df', ['-kP', DIRS.data], (err, out) => {
  if (err) return resolve(null);
  const p = out.trim().split('\n').pop().trim().split(/\s+/);
  const total = Number(p[1]) * 1024, used = Number(p[2]) * 1024, free = Number(p[3]) * 1024;
  resolve({ total, used, free, mount: p[5] });
}));
app.get('/api/admin/health', needSuper, async (_req, res) => {
  const a = os.cpus(); await sleep(250); const b = os.cpus();
  let idle = 0, total = 0;
  b.forEach((c, i) => { for (const k in c.times) total += c.times[k] - a[i].times[k]; idle += c.times.idle - a[i].times.idle; });
  const mem = process.memoryUsage();
  res.json({
    cpu: { cores: b.length, model: b[0] && b[0].model, usedPct: total ? Math.round((1 - idle / total) * 1000) / 10 : 0, load: os.loadavg() },
    memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), processRss: mem.rss, processHeap: mem.heapUsed },
    disk: await diskInfo(),
    storage: { database: { ...dirInfo(DIRS.data), file: DB_FILE, size: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0 }, videos: dirInfo(DIRS.videos), photos: dirInfo(DIRS.photos), outbox: dirInfo(DIRS.outbox) },
    runtime: { node: process.version, platform: `${os.platform()} ${os.release()}`, uptimeSec: Math.round(process.uptime()), host: os.hostname() },
  });
});

app.use((err, _req, res, _next) => {
  log.error('request failed', err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again.' });
});
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e instanceof Error ? e : new Error(String(e))));
process.on('uncaughtException', (e) => log.error('uncaughtException', e));
save(); // persists seeded defaults
app.listen(PORT, () => log.info(`StuSPACE running at http://localhost:${PORT}`));
