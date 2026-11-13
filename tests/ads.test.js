'use strict';
// Рекламная строка на главной: объявления в /api/config, управление в админке, проверка ссылок и токена erid.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

let srv = null, dataDir = '';
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-ads-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test' });
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(base + '/api/config')).ok) { srv = { proc, base }; return; } } catch (e) { /* стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill(); throw new Error('server did not start\n' + log);
});
after(async () => {
  if (srv) { srv.proc.kill(); await new Promise((r) => srv.proc.once('exit', r)); }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function browser() {
  const cookies = new Map();
  const req = async (method, url, body) => {
    const headers = { 'X-Requested-With': 'mba' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { get: (u) => req('GET', u), post: (u, b = {}) => req('POST', u, b), del: (u) => req('DELETE', u) };
}
async function signIn(b, target) {
  const r = await b.post('/api/auth/request', { target });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await b.post('/api/auth/verify', { target, code: r.body.devCode });
  assert.equal(v.status, 200, JSON.stringify(v.body));
}

describe('Рекламная строка', () => {
  it('по умолчанию крутятся объявления kadryzdes.ru: текст RU/EN, домен, рекламодатель', async () => {
    const { ads } = (await browser().get('/api/config')).body;
    assert.equal(ads.length, 3);
    for (const a of ads) {
      assert.equal(a.host, 'kadryzdes.ru');
      assert.match(a.url, /^https:\/\/kadryzdes\.ru\/\?utm_source=my-bestagent\.ru/);
      assert.equal(a.advertiser, 'Кадры здесь');
      assert.ok(a.ru && a.en && a.ru.length <= 60, 'коротко: ' + a.ru);
    }
    assert.deepEqual(ads.map((a) => a.ru), ['Работа и вахта у проверенных работодателей по всей России', 'Ищете сотрудников? Подберём персонал для вашей компании', 'Помощь с документами, визой, квотой и переездом']);
  });

  it('управляет только администратор; гость и модератор — отказ', async () => {
    const anon = browser(), mod = browser();
    assert.ok([401, 403].includes((await anon.get('/api/admin/ads')).status));
    await signIn(mod, 'moderator@mba.local');
    assert.equal((await mod.get('/api/admin/ads')).status, 403);
    assert.equal((await mod.post('/api/admin/ads', { text_ru: 'x', url: 'https://example.com' })).status, 403);
  });

  it('админ: добавить, скрыть, токен erid в ссылке, удалить; опасные и пустые ссылки не принимаются', async () => {
    const adm = browser(); await signIn(adm, 'admin@mba.local');
    for (const url of ['javascript:alert(1)', 'data:text/html,1', 'ftp://example.com', 'example', '']) {
      const r = await adm.post('/api/admin/ads', { text_ru: 'Тест', url });
      assert.equal(r.status, 400, url); assert.equal(r.body.error, 'bad_url', url);
    }
    assert.equal((await adm.post('/api/admin/ads', { text_ru: '', url: 'https://example.com' })).status, 400, 'без текста');

    assert.equal((await adm.post('/api/admin/ads', { text_ru: 'Новая платформа', text_en: 'New platform', url: 'https://www.example.com/x', advertiser: 'ООО «Пример»', erid: 'Kra23<>abc', sort: 0 })).status, 200);
    let { items } = (await adm.get('/api/admin/ads')).body;
    const mine = items.find((a) => a.text_ru === 'Новая платформа');
    assert.equal(mine.erid, 'Kra23abc', 'в токене только буквы, цифры, _ и -');
    let ads = (await browser().get('/api/config')).body.ads;
    assert.equal(ads[0].ru, 'Новая платформа', 'порядок 0 — первым');
    assert.equal(ads[0].host, 'example.com');
    assert.equal(new URL(ads[0].url).searchParams.get('erid'), 'Kra23abc');

    assert.equal((await adm.post('/api/admin/ads', { id: mine.id, text_ru: 'Новая платформа', url: 'https://example.com/x', active: false })).status, 200);
    ads = (await browser().get('/api/config')).body.ads;
    assert.ok(!ads.some((a) => a.id === mine.id), 'скрытое объявление не показывается');
    assert.equal((await adm.post('/api/admin/ads', { id: 99999, text_ru: 'x', url: 'https://example.com' })).status, 404);

    ({ items } = (await adm.get('/api/admin/ads')).body);
    for (const a of items) assert.equal((await adm.del('/api/admin/ads/' + a.id)).status, 200);
    assert.deepEqual((await browser().get('/api/config')).body.ads, [], 'нет объявлений — строки нет');
  });
});
