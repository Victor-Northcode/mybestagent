'use strict';
// Публичный тестовый стенд (PUBLIC_DEMO=1): посетитель входит только в свой тестовый профиль или в общие
// профили пользователя/волонтёра/партнёра. Модератор и администратор через стенд недоступны, сайт закрыт от поисковиков.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

let srv = null;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-demo-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', PUBLIC_DEMO: '1', DEV_OTP: '1', SEED_DEMO: '1', BASE_URL: 'https://demo.test' });
  for (const k of ['SMTP_URL', 'SMSRU_API_ID', 'YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY', 'ADMIN_EMAIL']) delete env[k];
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/config')).ok) { srv = { proc, base }; return; } } catch (e) { /* стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill(); throw new Error('server did not start\n' + log);
});
after(() => { if (srv) srv.proc.kill(); });

// «браузер» со своими cookie
function browser() {
  const cookies = new Map();
  const req = async (method, url, body) => {
    const headers = { 'X-Requested-With': 'mba' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { get: (u) => req('GET', u), post: (u, b = {}) => req('POST', u, b), del: (u) => req('DELETE', u) };
}
const NEW_USER = { name: 'Тест', birthdate: '1990-01-01', consent_pd: true, consent_policy: true };
async function signIn(b, target, extra = {}) {
  const r = await b.post('/api/auth/request', { target });
  if (r.status !== 200) return r;
  return b.post('/api/auth/verify', { target, code: r.body.devCode, ...(r.body.isNew ? NEW_USER : {}), ...extra });
}

describe('Публичный тестовый стенд', () => {
  it('каждый браузер получает свой тестовый профиль; общие профили перечислены', async () => {
    const a = browser(), b = browser();
    const ca = (await a.get('/api/config')).body, cb = (await b.get('/api/config')).body;
    assert.match(ca.demoEmail, /^guest-[a-f0-9]{40}@mybest\.invalid$/);
    assert.notEqual(ca.demoEmail, cb.demoEmail);
    assert.equal((await a.get('/api/config')).body.demoEmail, ca.demoEmail, 'профиль закреплён за браузером');
    assert.deepEqual(ca.demoLogins, ['anna@example.com', 'igor@example.com', 'lizaalert@example.com']);
  });

  it('свой профиль: регистрация по коду с экрана, роль — обычный пользователь', async () => {
    const a = browser();
    const { demoEmail } = (await a.get('/api/config')).body;
    const r = await signIn(a, demoEmail);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const me = (await a.get('/api/me')).body.user;
    assert.equal(me.email, demoEmail); assert.equal(me.role, 'user');
  });

  it('администратор, модератор, чужие адреса и телефоны через стенд недоступны', async () => {
    const a = browser(), b = browser();
    const other = (await b.get('/api/config')).body.demoEmail;
    for (const target of ['admin@mba.local', 'moderator@mba.local', 'someone@example.com', '+79001234567', other]) {
      const r = await a.post('/api/auth/request', { target });
      assert.equal(r.status, 403, target);
      assert.equal(r.body.error, 'demo_account', target);
    }
  });

  it('общий профиль: вход открыт, но удалить его и сменить контакты нельзя', async () => {
    const a = browser();
    assert.equal((await signIn(a, 'anna@example.com')).status, 200);
    assert.equal((await a.get('/api/me')).body.user.email, 'anna@example.com');
    const del = await a.del('/api/me');
    assert.equal(del.status, 403); assert.equal(del.body.error, 'demo_account');
    const contact = await a.post('/api/me/contact/request', { target: 'new@example.com' });
    assert.equal(contact.status, 403); assert.equal(contact.body.error, 'demo_contact');
    assert.equal((await a.get('/api/me')).body.user.email, 'anna@example.com', 'профиль на месте');
  });

  it('код, выданный одному браузеру, не подходит другому', async () => {
    const a = browser(), b = browser();
    const r = await a.post('/api/auth/request', { target: 'igor@example.com' });
    assert.equal(r.status, 200);
    const v = await b.post('/api/auth/verify', { target: 'igor@example.com', code: r.body.devCode });
    assert.equal(v.status, 400);
    assert.equal((await b.get('/api/me')).body.user, null);
  });

  it('стенд закрыт от поисковиков: meta robots и robots.txt', async () => {
    const a = browser();
    assert.match((await a.get('/')).body, /<meta name="robots" content="noindex, nofollow, noarchive">/);
    assert.match((await a.get('/robots.txt')).body, /Disallow: \//);
  });
});
