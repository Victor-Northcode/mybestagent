'use strict';
// Заявка о животном: единые параметры (вид, порода, окрас, особые приметы, одежда, место — парк города, транспорт, ориентир)
// и подсказка города, адреса и парка по точке на карте (геокодер подменён локальной заглушкой).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

let srv = null, geo = null, dataDir = '';
const geoHits = [];
before(async () => {
  // заглушка Nominatim: внутри Харитоновского сада в Екатеринбурге
  geo = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    geoHits.push({ ua: req.headers['user-agent'], lang: u.searchParams.get('accept-language'), lat: u.searchParams.get('lat') });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ category: 'leisure', type: 'park', name: 'Харитоновский сад', address: { leisure: 'Харитоновский сад', road: 'улица Карла Либкнехта', house_number: '44', city: 'Екатеринбург' } }));
  });
  await new Promise((r) => geo.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-animal-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', GEOCODER_URL: `http://127.0.0.1:${geo.address().port}/reverse` });
  delete env.GEOCODER;
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(base + '/api/config')).ok) { srv = { proc, base }; return; } } catch (e) { /* стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill(); throw new Error('server did not start\n' + log);
});
after(() => {
  if (srv) srv.proc.kill();
  if (geo) geo.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* файлы ещё заняты */ }
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
  return {
    get: (u) => req('GET', u), post: (u, b = {}) => req('POST', u, b), patch: (u, b = {}) => req('PATCH', u, b),
    async login(target) {
      const r = await req('POST', '/api/auth/request', { target });
      const extra = r.body.isNew ? { name: 'Тест', birthdate: '1990-01-01', consent_pd: true, consent_policy: true } : {};
      const v = await req('POST', '/api/auth/verify', { target, code: r.body.devCode, ...extra });
      assert.equal(v.status, 200, JSON.stringify(v.body));
    }
  };
}
// точка в Екатеринбурге — далеко от демо-заявок в Москве
const EKB = { lat: 56.8407, lng: 60.6151 };
const base = (o) => Object.assign({ kind: 'lost', category: 'animals', event_date: new Date().toISOString().slice(0, 10), contact: '+79990001122', address: 'ул. Карла Либкнехта, 44', city: 'Екатеринбург', photos: [] }, EKB, o);

describe('Заявка о животном', () => {
  let owner, finder;
  before(async () => { owner = browser(); finder = browser(); await owner.login('pet-owner@example.com'); await finder.login('pet-finder@example.com'); });

  it('сохраняет породу, окрас, одежду и парк; заголовок собирается сам', async () => {
    const r = await owner.post('/api/applications', base({
      title: '', species: 'Собака', features: 'Шрам на левом ухе', description: 'Боится громких звуков',
      details: { breed: 'Цвергшнауцер', color: 'Перец с солью', clothes: 'Красная шлейка', park: 'Харитоновский сад', landmark: 'у пруда', evil: '<script>' }
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = r.body.item;
    assert.equal(a.details.breed, 'Цвергшнауцер');
    assert.equal(a.details.color, 'Перец с солью');
    assert.equal(a.details.clothes, 'Красная шлейка');
    assert.equal(a.details.park, 'Харитоновский сад');
    assert.equal(a.details.landmark, 'у пруда');
    assert.equal(a.details.evil, undefined, 'лишние ключи отбрасываются');
    assert.equal(a.title, 'Пропажа: собака, цвергшнауцер, перец с солью');
    assert.equal(a.features, 'Шрам на левом ухе');
    assert.equal(a.description, 'Боится громких звуков');
  });

  it('транспорт: тип из списка (в том числе трамвай, маршрутка, такси) и маршрут; неизвестный тип отбрасывается', async () => {
    const r = await owner.post('/api/applications', base({
      title: 'Кошка Мурка', species: 'Кошка',
      details: { transport: 'tram', transport_route: '15, в сторону ВИЗа' }
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.item.details;
    assert.equal(d.transport, 'tram'); assert.equal(d.transport_route, '15, в сторону ВИЗа');
    const bad = await owner.post('/api/applications', base({ title: 'Кот', species: 'Кошка', details: { transport: 'rocket', transport_route: '1' } }));
    assert.equal(bad.status, 200);
    assert.equal(bad.body.item.details.transport, undefined);
    assert.equal(bad.body.item.details.transport_route, undefined);
  });

  it('редактирование меняет параметры', async () => {
    const r = await owner.post('/api/applications', base({ title: 'Попугай Кеша', species: 'Птица', details: { breed: 'Корелла', landmark: 'балкон 5 этажа' } }));
    assert.equal(r.body.item.details.landmark, 'балкон 5 этажа');
    const p = await owner.patch('/api/applications/' + r.body.item.id, Object.assign(base({ title: 'Попугай Кеша', species: 'Птица' }), { details: { breed: 'Корелла', color: 'Серый с жёлтой головой', transport: 'minibus' } }));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.item.details.color, 'Серый с жёлтой головой');
    assert.equal(p.body.item.details.landmark, undefined);
    assert.equal(p.body.item.details.transport, 'minibus');
  });

  it('порода и окрас участвуют в подборе совпадений и в поиске', async () => {
    await owner.post('/api/applications', base({ title: 'Пропала собака Дина', species: 'Собака', details: { breed: 'Бриар', color: 'Абрикосовый' } }));
    const f = await finder.post('/api/applications', base({ kind: 'found', title: 'Найдена собака', species: 'Собака', details: { breed: 'Бриар', color: 'Абрикосовый', clothes: 'без ошейника' } }));
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.ok(f.body.matches >= 1, 'находка совпала с пропажей по породе и окрасу');
    const s = await finder.get('/api/applications?q=' + encodeURIComponent('бриар'));
    assert.ok(s.body.items.length >= 2, JSON.stringify(s.body).slice(0, 200));
  });
});

describe('Подсказка места по точке на карте', () => {
  it('без входа недоступна, неверная точка — ошибка', async () => {
    assert.equal((await browser().get('/api/config')).body.map.geocoder, true, 'клиент узнаёт, что подсказка включена');
    assert.equal((await browser().get('/api/geo/reverse?lat=56.84&lng=60.61')).status, 401);
    const b = browser(); await b.login('geo-user@example.com');
    assert.equal((await b.get('/api/geo/reverse?lat=abc&lng=60')).status, 400);
    assert.equal((await b.get('/api/geo/reverse?lat=95&lng=60')).status, 400);
  });

  it('возвращает город, адрес и парк; повторный запрос берётся из кэша', async () => {
    const b = browser(); await b.login('geo-user2@example.com');
    const before = geoHits.length;
    const r = await b.get('/api/geo/reverse?lat=56.84071&lng=60.61512');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { city: 'Екатеринбург', address: 'улица Карла Либкнехта, 44', park: 'Харитоновский сад' });
    assert.equal(geoHits.length, before + 1);
    assert.match(geoHits.at(-1).ua, /^MyBestAgent\//, 'свой User-Agent по правилам Nominatim');
    assert.equal(geoHits.at(-1).lang, 'ru');
    await b.get('/api/geo/reverse?lat=56.84072&lng=60.61511');
    assert.equal(geoHits.length, before + 1, 'соседняя точка (до ~10 м) — из кэша');
  });
});
