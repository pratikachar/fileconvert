/**
 * Node checks for Phase 9 pure logic (sharedInbox routing + timeAgo).
 * IDB itself needs a browser - the E2E covers storage round-trips.
 * Run: node scripts/test-p9.mjs
 */

import { routeShared } from '../src/utils/sharedInbox.js';
import { timeAgo, RECENT_MAX, RECENT_MAX_BYTES } from '../src/utils/recentFiles.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

function hooks(log) {
  return {
    toEditor: (f) => log.push(['editor', f.name]),
    toAudio: (fs) => log.push(['audio', fs.map((f) => f.name).join(',')]),
    toPdf: (fs) => log.push(['pdf', fs.map((f) => f.name).join(',')]),
    toConverter: (f) => log.push(['converter', f.name]),
    toast: (m) => log.push(['toast', m]),
    gotoTab: (t) => log.push(['tab', t]),
  };
}

const row = (name, type) => ({ name, type, blob: { type } });

{
  // images route to the editor, first wins
  const log = [];
  const counts = routeShared([row('a.png', 'image/png'), row('b.jpg', 'image/jpeg')], hooks(log));
  check('share: images go to editor', log.some(([k, v]) => k === 'editor' && v === 'a.png'), JSON.stringify(log));
  check('share: tab jumps to editor', log.some(([k, v]) => k === 'tab' && v === 'editor'));
  check('share: counts mention editor', counts.join(' ').includes('editor'));
}

{
  // mixed batch splits by kind
  const log = [];
  routeShared([
    row('s.mp3', 'audio/mpeg'), row('v.mp4', 'video/mp4'),
    row('d.pdf', 'application/pdf'), row('notes.txt', 'text/plain'),
  ], hooks(log));
  check('share: audio+video to toolbox', log.some(([k, v]) => k === 'audio' && v === 's.mp3,v.mp4'), JSON.stringify(log));
  check('share: pdf to pdf tools', log.some(([k, v]) => k === 'pdf' && v === 'd.pdf'));
  check('share: unknown falls to converter', log.some(([k, v]) => k === 'converter' && v === 'notes.txt'));
  check('share: tab prefers audio over pdf', log.find(([k]) => k === 'tab')[1] === 'audio');
}

{
  // missing hooks never throw
  let threw = false;
  try { routeShared([row('a.png', 'image/png')], {}); } catch { threw = true; }
  check('share: survives missing hooks', !threw);
  const log = [];
  const counts = routeShared([], hooks(log));
  check('share: empty batch is quiet', counts.length === 0 && log.length === 0);
}

{
  // relative time
  const now = Date.now();
  check('time: just now', timeAgo(now - 1000) === 'just now');
  check('time: minutes', timeAgo(now - 5 * 60 * 1000) === '5m ago');
  check('time: hours', timeAgo(now - 3 * 3600 * 1000) === '3h ago');
  check('time: days', timeAgo(now - 2 * 86400 * 1000) === '2d ago');
  check('time: future clamps', timeAgo(now + 99999) === 'just now');
  check('caps: 8 recents, 10 MB blobs', RECENT_MAX === 8 && RECENT_MAX_BYTES === 10 * 1024 * 1024);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
