'use strict';
// Ошибки API на английском: у каждого русского текста ошибки есть перевод, и английский интерфейс (X-Lang: en) его получает.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { toEn } = require('../server/errors-en');

const ROOT = path.join(__dirname, '..');
const CYR = /[А-Яа-яЁё]/;

describe('Ошибки API на английском', () => {
  it('у каждого текста ошибки в коде сервера есть английский перевод', () => {
    const missing = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'server')).filter((x) => x.endsWith('.js') && x !== 'errors-en.js')) {
      for (const line of fs.readFileSync(path.join(ROOT, 'server', f), 'utf8').split('\n')) {
        if (!/fail\(|message: '|int\('|new Error\('Платёж/.test(line)) continue;
        for (const m of line.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)) {
          if (/^(SELECT|UPDATE|INSERT|DELETE)\b/.test(m[1])) continue;
          if (CYR.test(toEn(m[1]))) missing.push(`${f}: ${m[1]}`);
        }
      }
    }
    assert.deepEqual(missing, []);
    assert.equal(toEn('Лимит бесплатного реестра — 3 предмета. Подключите тариф «Реестр ценностей+».'), 'The free registry is limited to 3 items. Upgrade to the “Registry+” plan.');
    assert.equal(toEn('Already English'), 'Already English');
  });

  let srv = null;
  before(async () => {
    const port = await new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); }); });
    const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mba-err-')), NODE_ENV: 'test' });
    const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 240; i++) {
      try { if ((await fetch(base + '/api/config')).ok) { srv = { proc, base }; return; } } catch (e) { /* стартует */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    proc.kill(); throw new Error('server did not start');
  });
  after(() => { if (srv) srv.proc.kill(); });

  it('английский интерфейс получает текст ошибки по-английски, русский — по-русски', async () => {
    const get = (lang) => fetch(srv.base + '/api/applications/999999', { headers: { 'X-Requested-With': 'mba', 'X-Lang': lang } }).then(async (r) => [r.status, await r.json()]);
    const [s1, en] = await get('en');
    assert.equal(s1, 404); assert.equal(en.error, 'not_found');
    assert.equal(en.message, 'Report not found');
    const [, ru] = await get('ru');
    assert.equal(ru.message, 'Заявка не найдена');
    const bad = await fetch(srv.base + '/api/auth/request', { method: 'POST', headers: { 'X-Requested-With': 'mba', 'X-Lang': 'en', 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'not a contact' }) }).then((r) => r.json());
    assert.ok(bad.message && !CYR.test(bad.message), bad.message);
  });
});
