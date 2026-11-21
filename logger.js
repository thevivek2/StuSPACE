// Tiny logger: console + data/app.log (rotated at 5 MB). Errors are always on; the level is configurable (Admin > Configs).
const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let level = 'info';
let file = null;
const MAX_BYTES = 5 * 1024 * 1024;

function init(dir) {
  file = path.join(dir, 'app.log');
}
function setLevel(l) {
  if (l in LEVELS) level = l;
}
function write(lvl, msg, meta) {
  if (lvl !== 'error' && LEVELS[lvl] > LEVELS[level]) return;
  const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${msg}${meta ? ' ' + (meta instanceof Error ? meta.stack || meta.message : JSON.stringify(meta)) : ''}`;
  (lvl === 'error' ? console.error : console.log)(line);
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, line + '\n');
  } catch (_) { /* never let logging crash the app */ }
}
module.exports = {
  init, setLevel,
  error: (m, x) => write('error', m, x),
  warn: (m, x) => write('warn', m, x),
  info: (m, x) => write('info', m, x),
  debug: (m, x) => write('debug', m, x),
};
