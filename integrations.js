// All third-party touch points live here so they can be swapped later:
//   email.send    - SMTP via nodemailer (free SMTP such as Gmail/Brevo/Mailtrap); without SMTP the mail is only written to ./outbox
//   youtube.upload- publishes approved videos to the YouTube channel (OAuth refresh token)
//   sms.send      - Sparrow SMS (Nepal). Real send needs sms.enabled + token; sms.sandbox keeps it from hitting the live endpoint
//   otp.deliver   - one-time codes are delivered by email and, when SMS is enabled, by SMS too
const nodemailer = require('nodemailer');
const log = require('./logger');

module.exports = function integrations(cfg) {
  let cached = { key: '', transport: null };
  const transport = () => {
    const o = { host: cfg('smtp.host'), port: Number(cfg('smtp.port')) || 587, secure: !!cfg('smtp.secure'), user: cfg('smtp.user'), pass: cfg('smtp.pass') };
    const key = JSON.stringify(o);
    if (cached.key !== key) cached = { key, transport: nodemailer.createTransport({ host: o.host, port: o.port, secure: o.secure, auth: o.user ? { user: o.user, pass: o.pass } : undefined }) };
    return cached.transport;
  };
  return {
    email: {
      // resolves { sent:boolean, via:'smtp'|'outbox', error? } - never throws
      async send({ to, subject, html }) {
        if (!cfg('smtp.enabled')) return { sent: false, via: 'outbox' };
        try {
          await transport().sendMail({ from: cfg('smtp.from') || cfg('smtp.user'), to, subject, html });
          log.info(`email sent via SMTP to=${to} subject="${subject}"`);
          return { sent: true, via: 'smtp' };
        } catch (e) {
          log.error(`SMTP send failed to=${to}`, e);
          return { sent: false, via: 'smtp', error: e.message };
        }
      },
    },
    youtube: {
      // Resumable upload to the channel owned by the configured OAuth refresh token. Never throws: resolves { videoId, url } or { error }.
      async upload({ file, title, description }) {
        try {
          if (!cfg('youtube.clientId') || !cfg('youtube.clientSecret') || !cfg('youtube.refreshToken')) return { error: 'YouTube credentials are not configured' };
          const tok = await fetch(cfg('youtube.tokenUrl'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: cfg('youtube.clientId'), client_secret: cfg('youtube.clientSecret'), refresh_token: cfg('youtube.refreshToken'), grant_type: 'refresh_token' }) });
          const tj = await tok.json().catch(() => ({}));
          if (!tok.ok || !tj.access_token) return { error: 'OAuth failed: ' + (tj.error_description || tj.error || tok.status) };
          const bytes = require('fs').readFileSync(file);
          const mime = /\.mp4$/i.test(file) ? 'video/mp4' : 'video/webm';
          const init = await fetch(cfg('youtube.uploadUrl') + '?uploadType=resumable&part=snippet,status', { method: 'POST',
            headers: { Authorization: 'Bearer ' + tj.access_token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.length) },
            body: JSON.stringify({ snippet: { title, description, categoryId: cfg('youtube.categoryId') }, status: { privacyStatus: cfg('youtube.privacy') || 'public', selfDeclaredMadeForKids: false } }) });
          const loc = init.headers.get('location');
          if (!init.ok || !loc) { const ij = await init.json().catch(() => ({})); return { error: 'Upload start failed: ' + ((ij.error && ij.error.message) || init.status) }; }
          const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(bytes.length) }, body: bytes });
          const uj = await up.json().catch(() => ({}));
          if (!up.ok || !uj.id) return { error: 'Upload failed: ' + ((uj.error && uj.error.message) || up.status) };
          return { videoId: uj.id, url: 'https://www.youtube.com/watch?v=' + uj.id };
        } catch (e) {
          log.error('YouTube upload error', e);
          return { error: e.message };
        }
      },
    },
    sms: {
      // Sparrow SMS: POST <baseUrl> with token, from (approved identity), to (comma separated), text. Never throws.
      async send({ to, text }) {
        const d = String(to || '').replace(/\D/g, '');
        const num = d.length === 13 && d.startsWith('977') ? d.slice(3) : d; // Sparrow expects Nepali numbers without 977
        if (!cfg('sms.enabled')) return { sent: false, via: 'disabled' };
        if (!/^\d{7,15}$/.test(num)) return { sent: false, via: 'invalid', error: 'invalid phone number' };
        const sandbox = cfg('sms.sandbox');
        const url = sandbox ? cfg('sms.sandboxUrl') : cfg('sms.baseUrl');
        if (!url) { log.info(`SMS (sandbox dry run, no sandbox URL set) to=${num}`); return { sent: false, via: 'sandbox', dryRun: true }; }
        if (!cfg('sms.token')) return { sent: false, via: 'sparrow', error: 'sms.token is not configured' };
        try {
          const body = new URLSearchParams({ token: cfg('sms.token'), from: cfg('sms.from'), to: num, text });
          const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          const j = await r.json().catch(() => ({}));
          const ok = r.ok && (j.response_code === undefined || Number(j.response_code) === 200);
          if (!ok) { log.error(`SMS failed to=${num} status=${r.status} response=${JSON.stringify(j)}`); return { sent: false, via: 'sparrow', error: j.response || j.message || ('HTTP ' + r.status) }; }
          log.info(`SMS sent via Sparrow${sandbox ? ' (sandbox)' : ''} to=${num}`);
          return { sent: true, via: 'sparrow', sandbox };
        } catch (e) {
          log.error(`SMS request failed to=${num}`, e);
          return { sent: false, via: 'sparrow', error: e.message };
        }
      },
    },
    otp: {
      async deliver({ to, phone, name, code, minutes, sendEmail, sendSms }) {
        if (phone && sendSms) sendSms(phone, `Your ${cfg('site.programName')} code is ${code}. It expires in ${minutes} minutes.`);
        return sendEmail(to, 'Your one-time code', `<p>Hi ${String(name || '').replace(/[<>&]/g, '')},</p><p>Your one-time code is <b style="font-size:22px;letter-spacing:4px">${code}</b>.</p><p>It expires in ${minutes} minutes.</p>`, 'otp');
      },
    },
  };
};
