'use strict';
// Рабочий режим (NODE_ENV=production): никаких демо-данных и тестовых обходов;
// коды входа уходят через SMS-провайдера, оплата — через ЮKassa. Внешние сервисы заменены локальной заглушкой
// с тем же API (SMS.ru и ЮKassa v3), поэтому тест не ходит в интернет и не тратит деньги.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };

/* ---------- заглушка внешних сервисов ---------- */
const sms = [];            // отправленные SMS
const yk = new Map();      // платежи «ЮKassa»
const ykRequests = [];     // запросы к «ЮKassa» (проверяем авторизацию, идемпотентность, чек)
let mock = null, MOCK = '';
function startMock() {
  return new Promise((resolve) => {
    mock = http.createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/sms/send') {
          const f = new URLSearchParams(raw);
          if (f.get('to').endsWith('0000')) return json(200, { status: 'OK', sms: { [f.get('to')]: { status: 'ERROR', status_text: 'Неверный номер' } } });
          sms.push({ to: f.get('to'), msg: f.get('msg'), api_id: f.get('api_id') });
          return json(200, { status: 'OK', sms: { [f.get('to')]: { status: 'OK', sms_id: 'x' } } });
        }
        if (req.method === 'POST' && req.url === '/v3/payments') {
          const body = JSON.parse(raw);
          ykRequests.push({ headers: req.headers, body });
          const id = crypto.randomUUID();
          const p = { id, status: body.payment_method_id ? 'succeeded' : 'pending', amount: body.amount, metadata: body.metadata,
            payment_method: { type: 'bank_card', id: body.payment_method_id || 'pm_' + id, saved: !!body.save_payment_method || !!body.payment_method_id, card: { last4: '4444' } } };
          if (!body.payment_method_id) p.confirmation = { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' + id };
          yk.set(id, p);
          return json(200, p);
        }
        const m = req.url.match(/^\/v3\/payments\/([\w-]+)$/);
        if (req.method === 'GET' && m) return yk.has(m[1]) ? json(200, yk.get(m[1])) : json(404, { type: 'error', code: 'not_found' });
        json(404, {});
      });
    }).listen(0, '127.0.0.1', () => { MOCK = `http://127.0.0.1:${mock.address().port}`; resolve(); });
  });
}

/* ---------- сервер в рабочем режиме ---------- */
async function startServer(extraEnv) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-prod-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'production', BASE_URL: 'https://mybestagent.test' }, extraEnv);
  for (const k of ['SMTP_URL', 'SMSRU_API_ID', 'YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY', 'DEV_OTP', 'SEED_DEMO']) if (!(k in extraEnv)) delete env[k];
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/config')).ok) return { proc, base, dataDir, log: () => log }; } catch (e) { /* стартует */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start\n' + log);
}
function client(base) {
  const cookies = new Map();
  const req = async (method, url, body) => {
    const headers = { 'X-Requested-With': 'mba' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { get: (u) => req('GET', u), post: (u, b = {}) => req('POST', u, b) };
}

let S1 = null, S2 = null;
before(async () => {
  await startMock();
  S1 = await startServer({ ADMIN_EMAIL: 'boss@company.test', SMSRU_API_ID: 'test-api-id', SMSRU_API_URL: MOCK + '/sms/send', YOOKASSA_SHOP_ID: '123456', YOOKASSA_SECRET_KEY: 'live_secret', YOOKASSA_API_URL: MOCK + '/v3' });
  S2 = await startServer({}); // рабочий режим без подключённых провайдеров
});
after(() => { for (const s of [S1, S2]) if (s) s.proc.kill(); if (mock) mock.close(); });

describe('Рабочий режим: чистая база и честные ответы', () => {
  it('нет демо-пользователей и демо-заявок; тарифы и справочники на месте; администратор из ADMIN_EMAIL', async () => {
    const c = client(S1.base);
    assert.equal((await c.get('/api/applications?status=all')).body.items.length, 0, 'на рабочем сайте нет демо-заявок');
    assert.equal((await c.get('/api/tariffs')).body.items.length, 3);
    const cfg = (await c.get('/api/config')).body;
    assert.equal(cfg.dev, false);
    assert.equal(cfg.payments, 'yookassa');
    assert.ok(cfg.dicts.species.length > 0);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(S1.dataDir, 'app.db'), { readOnly: true });
    const users = db.prepare('SELECT email, role FROM users').all();
    db.close();
    assert.deepEqual(users.map((u) => [u.email, u.role]), [['boss@company.test', 'admin']]);
  });
  it('главная: абсолютные ссылки для превью; robots.txt открывает сайт поисковикам', async () => {
    const html = await (await fetch(S1.base + '/')).text();
    assert.match(html, /og:image" content="https:\/\/mybestagent\.test\/assets\/og-image\.jpg"/);
    assert.match(html, /rel="canonical" href="https:\/\/mybestagent\.test\/"/);
    const robots = await (await fetch(S1.base + '/robots.txt')).text();
    assert.match(robots, /Allow: \//); assert.match(robots, /Disallow: \/api\//);
  });
  it('без провайдеров вход и оплата честно недоступны (без тестовых обходов)', async () => {
    const c = client(S2.base);
    assert.equal((await c.get('/api/config')).body.payments, 'none');
    const e = await c.post('/api/auth/request', { target: 'user@mail.test' });
    assert.equal(e.status, 503); assert.equal(e.body.error, 'channel_unavailable'); assert.equal(e.body.devCode, undefined);
    assert.equal((await c.post('/api/auth/request', { target: '+7 999 111-22-33' })).status, 503);
    assert.equal((await c.post('/api/payments/webhook', { object: { id: 'x' } })).status, 503);
  });
});

describe('Рабочий режим: вход по SMS через SMS.ru', () => {
  let user = null;
  it('код уходит в SMS, на экране не показывается; регистрация проходит', async () => {
    const c = client(S1.base);
    const r = await c.post('/api/auth/request', { target: '+7 999 123-45-67' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.devCode, undefined, 'в рабочем режиме код не возвращается');
    const msg = sms.find((s) => s.to === '79991234567');
    assert.ok(msg && msg.api_id === 'test-api-id', 'SMS отправлено провайдеру');
    const code = msg.msg.match(/\d{6}/)[0];
    const v = await c.post('/api/auth/verify', { target: '+7 999 123-45-67', code, name: 'Ирина', birthdate: yearsAgo(35), consent_pd: true, consent_policy: true });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    user = c;
    // в журнале «Исходящие» код скрыт, статус — «отправлено»
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(S1.dataDir, 'app.db'), { readOnly: true });
    const o = db.prepare("SELECT * FROM outbox WHERE channel = 'sms' ORDER BY id DESC LIMIT 1").get();
    db.close();
    assert.equal(o.status, 'sent'); assert.ok(!o.body.includes(code), 'код в журнале замаскирован');
  });
  it('если провайдер не принял SMS — понятная ошибка, код аннулирован', async () => {
    const r = await client(S1.base).post('/api/auth/request', { target: '+7 999 000-00-00' });
    assert.equal(r.status, 502); assert.equal(r.body.error, 'send_failed');
  });
  it('e-mail не подключён — вход по e-mail честно недоступен', async () => {
    const r = await client(S1.base).post('/api/auth/request', { target: 'someone@mail.test' });
    assert.equal(r.status, 503); assert.equal(r.body.error, 'channel_unavailable');
  });

  describe('оплата через ЮKassa', () => {
    let tariff, payId, ykId;
    it('платёж создаётся в ЮKassa с чеком 54-ФЗ, пользователь уходит на страницу оплаты', async () => {
      tariff = (await user.get('/api/tariffs')).body.items.find((t) => t.code === 'registry_plus');
      const r = await user.post('/api/payments', { tariff_id: tariff.id, method: 'card', save_card: true });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.status, 'pending');
      assert.match(r.body.confirmation_url, /^https:\/\/yoomoney\.ru\//);
      payId = r.body.id;
      const q = ykRequests.at(-1);
      assert.equal(q.headers.authorization, 'Basic ' + Buffer.from('123456:live_secret').toString('base64'));
      assert.ok(q.headers['idempotence-key']);
      assert.deepEqual(q.body.amount, { value: tariff.final_price.toFixed(2), currency: 'RUB' });
      assert.equal(q.body.capture, true);
      assert.equal(q.body.save_payment_method, true);
      assert.deepEqual(q.body.payment_method_data, { type: 'bank_card' });
      assert.equal(q.body.confirmation.return_url, `https://mybestagent.test/#/pay/${payId}`);
      assert.deepEqual(q.body.receipt.customer, { phone: '79991234567' });
      assert.equal(q.body.receipt.items[0].vat_code, 1);
      assert.equal(q.body.metadata.payment_id, String(payId));
      ykId = [...yk.keys()].at(-1);
    });
    it('уведомлению без подтверждения ЮKassa не верим; тестовое подтверждение запрещено', async () => {
      const fake = await fetch(S1.base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { id: ykId, status: 'succeeded' } }) });
      assert.equal(fake.status, 200);
      assert.equal((await user.get('/api/payments/' + payId)).body.item.status, 'pending', 'в ЮKassa платёж ещё не оплачен');
      assert.equal((await user.post(`/api/payments/${payId}/confirm`, { success: true, card: '4111111111111111' })).status, 403);
    });
    it('после оплаты в ЮKassa тариф подключается, карта сохраняется для автопродления', async () => {
      yk.get(ykId).status = 'succeeded';
      const w = await fetch(S1.base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { id: ykId } }) });
      assert.equal((await w.json()).status, 'succeeded');
      const me = (await user.get('/api/me')).body.user;
      assert.equal(me.card, '•••• 4444');
      assert.ok(me.subscriptions.some((s) => s.code === 'registry_plus'));
    });
    it('оплата сохранённой картой проходит сразу; подмена суммы не засчитывается', async () => {
      const r = await user.post('/api/payments', { tariff_id: tariff.id, method: 'saved_card' });
      assert.equal(r.body.status, 'succeeded');
      assert.match(ykRequests.at(-1).body.payment_method_id, /^pm_/);
      const sbp = await user.post('/api/payments', { tariff_id: tariff.id, method: 'sbp' });
      assert.deepEqual(ykRequests.at(-1).body.payment_method_data, { type: 'sbp' });
      const id = [...yk.keys()].at(-1);
      Object.assign(yk.get(id), { status: 'succeeded', amount: { value: '1.00', currency: 'RUB' } });
      assert.equal((await user.get('/api/payments/' + sbp.body.id)).body.item.status, 'pending', 'сумма не совпала — тариф не подключён');
    });
  });
});
