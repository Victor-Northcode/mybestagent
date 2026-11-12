'use strict';
// Заявки о вещах: тип (одежда, аксессуары, украшения, авто, другое) и уточнения к нему в applications.details.
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-things-'));
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
  const b = { get: (u) => req('GET', u), post: (u, x = {}) => req('POST', u, x), patch: (u, x = {}) => req('PATCH', u, x) };
  b.login = async (target) => {
    const r = await b.post('/api/auth/request', { target });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = await b.post('/api/auth/verify', { target, code: r.body.devCode });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    return b;
  };
  return b;
}
// Екатеринбург — подальше от демо-заявок Москвы
const EKB = { lat: 56.8389, lng: 60.6057, city: 'Екатеринбург' };
const body = (o = {}) => Object.assign({ kind: 'lost', category: 'things', title: 'Вещь', description: '', features: '', event_date: new Date().toISOString().slice(0, 10), address: 'ул. Ленина', contact: '+7 900 000-00-00' }, EKB, o);

describe('Вещи: тип и уточнения', () => {
  let anna, igor;
  before(async () => { anna = await browser().login('anna@example.com'); igor = await browser().login('igor@example.com'); });

  it('авто: сохраняются марка, модель, цвет и госномер; чужие для типа поля отбрасываются', async () => {
    const r = await anna.post('/api/applications', body({
      title: 'Серебристый седан', features: 'Царапина на заднем бампере', description: 'Эвакуировали со двора ночью',
      details: { thing_type: 'auto', brand: ' Kia ', model: 'Rio', color: 'серебристый', plate: 'а123вс  77', size: 'XL', stones: 'бриллиант', hack: '<b>x</b>' }
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = r.body.item;
    assert.deepEqual(a.details, { thing_type: 'auto', brand: 'Kia', model: 'Rio', color: 'серебристый', plate: 'А123ВС 77' });
    assert.equal(a.species, 'Авто', 'название типа — в species для поиска и списков');
    const pub = await browser().get('/api/applications/' + a.id);
    assert.deepEqual(pub.body.item.details, a.details, 'уточнения видны всем');
    assert.equal(pub.body.item.features, 'Царапина на заднем бампере');
    assert.equal(pub.body.item.description, 'Эвакуировали со двора ночью');
  });

  it('поиск находит вещь по уточнениям (госномер, бренд)', async () => {
    const r = await anna.post('/api/applications', body({ title: 'Белый хэтчбек', details: { thing_type: 'auto', brand: 'Škoda', plate: 'О777ОО 196' } }));
    assert.equal(r.status, 200);
    const s = await browser().get('/api/applications?q=' + encodeURIComponent('о777оо'));
    assert.ok(s.body.items.some((x) => x.id === r.body.item.id), 'по госномеру');
    const s2 = await browser().get('/api/applications?q=' + encodeURIComponent('škoda'));
    assert.ok(s2.body.items.some((x) => x.id === r.body.item.id), 'по марке');
  });

  it('неизвестный тип не сохраняется; без типа заявка принимается как раньше', async () => {
    const bad = await anna.post('/api/applications', body({ title: 'Ключи', species: 'Ключи', details: { thing_type: 'spaceship', brand: 'x' } }));
    assert.equal(bad.status, 200);
    assert.deepEqual(bad.body.item.details, {});
    assert.equal(bad.body.item.species, 'Ключи');
    const none = await anna.post('/api/applications', body({ title: 'Зонт' }));
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.item.details, {});
    const arr = await anna.post('/api/applications', body({ title: 'Зонт', details: ['clothes'] }));
    assert.deepEqual(arr.body.item.details, {});
  });

  it('другие категории уточнения вещей не принимают', async () => {
    const r = await anna.post('/api/applications', body({ category: 'animals', title: 'Кот Барсик', species: 'Кошка', details: { thing_type: 'auto', plate: 'А123ВС 77' } }));
    assert.equal(r.status, 200);
    assert.equal(r.body.item.details.thing_type, undefined);
    assert.equal(r.body.item.details.plate, undefined);
    assert.equal(r.body.item.species, 'Кошка');
  });

  it('смена типа при правке убирает уточнения прежнего типа', async () => {
    const r = await anna.post('/api/applications', body({ title: 'Кольцо', details: { thing_type: 'jewelry', metal: 'золото 585', stones: 'фианит', engraving: 'Навсегда' } }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.item.details, { thing_type: 'jewelry', metal: 'золото 585', stones: 'фианит', engraving: 'Навсегда' });
    const p = await anna.patch('/api/applications/' + r.body.item.id, body({ title: 'Перчатки', details: { thing_type: 'clothes', size: 'M', color: 'чёрные', metal: 'золото' } }));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual(p.body.item.details, { thing_type: 'clothes', size: 'M', color: 'чёрные' });
    assert.equal(p.body.item.species, 'Одежда');
  });

  it('совпадения: одежда не совпадает с авто, одежда с одеждой — совпадает по уточнениям', async () => {
    const P = { lat: 56.85, lng: 60.62 };
    const lost = await anna.post('/api/applications', body(Object.assign({ title: 'Потеряна куртка', features: 'капюшон с мехом, сломанная молния', details: { thing_type: 'clothes', size: '48', color: 'бордовая', brand: 'Columbia' } }, P)));
    assert.equal(lost.status, 200);
    const car = await igor.post('/api/applications', body(Object.assign({ kind: 'found', title: 'Найдено авто', features: 'капюшон с мехом, сломанная молния', details: { thing_type: 'auto', brand: 'Columbia', color: 'бордовая' } }, P)));
    assert.equal(car.status, 200);
    assert.equal(car.body.matches, 0, 'разные типы вещей не совпадают');
    const jacket = await igor.post('/api/applications', body(Object.assign({ kind: 'found', title: 'Найдена куртка', features: 'на скамейке в парке', details: { thing_type: 'clothes', color: 'бордовая', brand: 'Columbia' } }, P)));
    assert.equal(jacket.status, 200);
    assert.equal(jacket.body.matches, 1, 'совпадение по цвету и бренду');
  });

  it('выгрузка своих данных содержит уточнения вещи', async () => {
    const r = await anna.get('/api/me/export');
    assert.equal(r.status, 200);
    const data = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
    assert.ok(data.applications.some((a) => a.details && a.details.thing_type === 'auto' && a.details.plate === 'А123ВС 77'));
  });
});
