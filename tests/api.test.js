'use strict';
// API-тесты платформы «Мой лучший агент».
// Запуск: node --test tests/api.test.js  (поднимает отдельный сервер на свободном порту с временной базой)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let BASE = '';
let DATA_DIR = '';
let server = null;
let serverLog = '';

/* ---------- инфраструктура ---------- */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

class Client {
  constructor(label) { this.label = label; this.cookies = new Map(); this.user = null; }
  async req(method, url, body, { csrf = true } = {}) {
    const headers = {};
    if (csrf && method !== 'GET') headers['X-Requested-With'] = 'mba';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const pair = c.split(';')[0]; const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (!v || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: data, setCookies };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}, o) { return this.req('POST', u, b, o); }
  patch(u, b = {}, o) { return this.req('PATCH', u, b, o); }
  del(u, o) { return this.req('DELETE', u, undefined, o); }
  async login(target, extra = {}) {
    const r = await this.post('/api/auth/request', { target });
    assert.equal(r.status, 200, `${this.label}: auth/request ${JSON.stringify(r.body)}`);
    const v = await this.post('/api/auth/verify', Object.assign({ target, code: r.body.devCode }, extra));
    assert.equal(v.status, 200, `${this.label}: auth/verify ${JSON.stringify(v.body)}`);
    this.user = v.body.user;
    return this.user;
  }
}
const anon = () => new Client('anon');

// Дата N лет назад (для проверки возраста)
const yearsAgo = (n, extraDays = 0) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() + extraDays); return d.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
function distKm(aLat, aLng, bLat, bLng) {
  const R = 6371, r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Базовые поля заявки (Москва, центр — отдельные тесты сдвигают координаты)
const appBody = (o = {}) => Object.assign({
  kind: 'lost', category: 'things', title: 'Тестовая заявка', description: '', features: '',
  event_date: today(), lat: 55.70, lng: 37.50, address: 'Тестовый адрес', city: 'Москва', contact: '+7 900 000-00-00'
}, o);
const peopleBody = (o = {}) => appBody(Object.assign({
  category: 'people', title: 'Пропал человек', person_name: 'Иван Тестов', person_age: 40, last_seen: 'У метро',
  relation: 'relative', confirm_rights: true
}, o));

// Пользователи (кука-хранилище на каждого)
const admin = new Client('admin'), mod = new Client('moderator'), anna = new Client('anna'), igor = new Client('igor'), max = new Client('max');
const st = {}; // общие данные между тестами

before(async () => {
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-api-test-'));
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR, NODE_ENV: 'test' });
  server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  let exited = false; server.on('exit', () => { exited = true; });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (exited) throw new Error('Сервер завершился при старте:\n' + serverLog);
    try { const r = await fetch(BASE + '/api/config'); if (r.status === 200) break; } catch (e) { /* ещё не слушает */ }
    if (Date.now() > deadline) throw new Error('Сервер не поднялся за 20 с:\n' + serverLog);
    await new Promise((r) => setTimeout(r, 150));
  }
  await admin.login('admin@mba.local');
  await mod.login('moderator@mba.local');
  await anna.login('anna@example.com');
  await igor.login('igor@example.com');
  await max.login('max@example.com');
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  if (DATA_DIR) fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (process.env.MBA_TEST_LOG) console.log(serverLog);
});

/* ======================================================================= */
describe('Публичные эндпоинты', () => {
  it('GET /api/config: тестовый режим, справочники, уровни', async () => {
    const r = await anon().get('/api/config');
    assert.equal(r.status, 200);
    assert.equal(r.body.dev, true);
    assert.equal(typeof r.body.vapidPublic, 'string');
    assert.ok(r.body.vapidPublic.length > 20);
    assert.deepEqual(r.body.levels.map((l) => l.code), ['novice', 'helper', 'agent', 'best']);
    assert.ok(r.body.dicts.species.some((d) => d.ru === 'Собака' && d.en === 'Dog'));
    assert.ok(Array.isArray(r.body.dicts.complaint_reason) && r.body.dicts.complaint_reason.length > 0);
    assert.equal(r.body.map.provider, 'osm');
    assert.ok(Array.isArray(r.body.map.center) && r.body.map.center.length === 2);
  });

  it('GET /api/stats/public согласуется со списком заявок', async () => {
    const c = anon();
    const s = await c.get('/api/stats/public');
    assert.equal(s.status, 200);
    for (const k of ['active', 'found', 'volunteers', 'matches', 'emergencies']) assert.equal(typeof s.body[k], 'number', k);
    assert.deepEqual(Object.keys(s.body.byCategory).sort(), ['animals', 'people', 'things']);
    const active = await c.get('/api/applications?status=active');
    assert.equal(s.body.active, active.body.total);
    assert.ok(s.body.found >= 1, 'в демо-данных есть найденная заявка');
    assert.ok(s.body.volunteers >= 4, 'волонтёры и партнёр из демо-данных');
    assert.ok(s.body.emergencies >= 1);
  });

  it('GET /api/applications: только опубликованные/найденные, экстренные первыми, без контактов и PD', async () => {
    const r = await anon().get('/api/applications');
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 12);
    assert.ok(r.body.items.every((a) => ['published', 'found'].includes(a.status)));
    assert.ok(!r.body.items.some((a) => a.status === 'pending'), 'заявка на проверке не должна попадать в список');
    assert.ok(r.body.items[0].emergency != null, 'активное экстренное оповещение — первым');
    for (const a of r.body.items) { assert.equal(a.contact, undefined); assert.equal(a.relation, undefined); assert.equal(a.is_owner, false); }
  });

  it('фильтры category / kind', async () => {
    const c = anon();
    const an = await c.get('/api/applications?category=animals');
    assert.ok(an.body.items.length > 0 && an.body.items.every((a) => a.category === 'animals'));
    const lost = await c.get('/api/applications?category=animals&kind=lost');
    assert.ok(lost.body.items.length > 0 && lost.body.items.every((a) => a.category === 'animals' && a.kind === 'lost'));
    assert.ok(lost.body.items.length < an.body.items.length);
    const fnd = await c.get('/api/applications?status=found');
    assert.ok(fnd.body.items.length > 0 && fnd.body.items.every((a) => a.status === 'found'));
    const bogus = await c.get('/api/applications?category=bogus');
    assert.equal(bogus.body.total, (await c.get('/api/applications')).body.total, 'неизвестная категория игнорируется');
  });

  it('поиск q (в том числе кириллица в другом регистре)', async () => {
    const c = anon();
    const lab = await c.get('/api/applications?q=' + encodeURIComponent('лабрадор'));
    assert.ok(lab.body.items.some((a) => a.title.includes('лабрадор')));
    assert.ok(lab.body.items.every((a) => /лабрадор/i.test([a.title, a.description, a.features, a.address, a.species].join(' '))));
    // «Барсик» в заголовке с заглавной: поиск должен быть регистронезависимым
    const cat = await c.get('/api/applications?q=' + encodeURIComponent('барсик'));
    assert.ok(cat.body.items.some((a) => a.title.includes('Барсик')), 'поиск «барсик» должен находить «Барсик»');
    const cat2 = await c.get('/api/applications?q=' + encodeURIComponent('БАРСИК'));
    assert.ok(cat2.body.items.some((a) => a.title.includes('Барсик')));
    const none = await c.get('/api/applications?q=zzqqxxnonexistent');
    assert.equal(none.body.total, 0);
  });

  it('фильтр по радиусу и сортировка по расстоянию', async () => {
    const c = anon();
    const [lat, lng] = [55.7890, 37.6795]; // Сокольники — рядом заявка о коте
    const r = await c.get(`/api/applications?lat=${lat}&lng=${lng}&radius=1&sort=near`);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length >= 1);
    assert.ok(r.body.items.every((a) => a.distance <= 1));
    assert.ok(r.body.items.some((a) => a.title.includes('Барсик')));
    const wide = await c.get(`/api/applications?lat=${lat}&lng=${lng}&radius=50&sort=near`);
    assert.ok(wide.body.items.length > r.body.items.length);
    const d = wide.body.items.map((a) => a.distance);
    assert.deepEqual(d, [...d].sort((x, y) => x - y), 'отсортировано по расстоянию');
  });

  it('GET /api/applications/:id: карточка, 404 для отсутствующей и для заявки на проверке', async () => {
    const c = anon();
    const list = await c.get('/api/applications');
    const one = list.body.items.find((a) => a.title.includes('лабрадор'));
    const r = await c.get('/api/applications/' + one.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.item.id, one.id);
    assert.equal(r.body.item.contact, undefined, 'контакт автора не раскрывается');
    assert.equal(r.body.item.matches, undefined);
    assert.equal(r.body.item.chats, undefined);
    assert.equal((await c.get('/api/applications/999999')).status, 404);
    // демо-заявка о человеке со статусом pending
    const adm = await admin.get('/api/admin/applications?status=pending');
    assert.ok(adm.body.items.length >= 1);
    const p = await c.get('/api/applications/' + adm.body.items[0].id);
    assert.equal(p.status, 404);
    assert.equal(p.body.error, 'not_found');
  });

  it('GET /api/stories и /api/tariffs', async () => {
    const c = anon();
    const s = await c.get('/api/stories');
    assert.equal(s.status, 200);
    assert.ok(s.body.items.length >= 3);
    assert.ok(s.body.items.every((x) => x.title_ru && x.text_ru && x.published === 1));
    const t = await c.get('/api/tariffs');
    assert.equal(t.status, 200);
    assert.equal(t.body.discount, 0);
    assert.deepEqual(t.body.items.map((x) => x.code).sort(), ['partner', 'promote', 'registry_plus']);
    assert.ok(t.body.items.every((x) => x.final_price === x.price));
  });

  it('неизвестный API-путь → 404 JSON', async () => {
    const r = await anon().get('/api/definitely-missing');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not_found');
  });
});

/* ======================================================================= */
describe('Безопасность', () => {
  it('изменяющий запрос без X-Requested-With отклоняется (CSRF)', async () => {
    const r = await anon().post('/api/auth/request', { target: 'csrf@example.com' }, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'csrf');
    const r2 = await anna.req('PATCH', '/api/me', { name: 'Взлом' }, { csrf: false });
    assert.equal(r2.status, 403);
    assert.equal((await anna.get('/api/me')).body.user.name, 'Анна Смирнова', 'данные не изменились');
    const r3 = await anna.req('DELETE', '/api/applications/1', undefined, { csrf: false });
    assert.equal(r3.status, 403);
  });

  it('без входа: закрытые эндпоинты → 401', async () => {
    const c = anon();
    for (const [m, u] of [['GET', '/api/notifications'], ['GET', '/api/chats'], ['GET', '/api/my/applications'], ['GET', '/api/valuables'],
      ['POST', '/api/applications'], ['POST', '/api/payments'], ['POST', '/api/tickets'], ['PATCH', '/api/me'], ['GET', '/api/family']]) {
      const r = await c.req(m, u, m === 'GET' ? undefined : {});
      assert.equal(r.status, 401, `${m} ${u}`);
      assert.equal(r.body.error, 'auth_required');
    }
    assert.equal((await c.get('/api/me')).body.user, null);
  });

  it('обычный пользователь не имеет доступа к /api/admin/* (403), модератор — к админ-only разделам', async () => {
    for (const u of ['/api/admin/stats', '/api/admin/users', '/api/admin/applications', '/api/admin/export.xlsx', '/api/admin/audit']) {
      const r = await anna.get(u);
      assert.equal(r.status, 403, u);
    }
    assert.equal((await anna.post('/api/admin/backup')).status, 403);
    assert.equal((await anon().get('/api/admin/stats')).status, 403);
    // модератор — только модерация, без тарифов/переводов/бэкапов
    assert.equal((await mod.get('/api/admin/stats')).status, 200);
    assert.equal((await mod.get('/api/admin/translations')).status, 403);
    assert.equal((await mod.post('/api/admin/backup')).status, 403);
    assert.equal((await mod.post('/api/admin/tariffs', { feature: 'promote', name_ru: 'x', price: 1 })).status, 403);
  });

  it('заголовки безопасности (CSP, nosniff, frame options) на API и статике', async () => {
    for (const u of ['/api/config', '/']) {
      const r = await fetch(BASE + u);
      const csp = r.headers.get('content-security-policy') || '';
      assert.match(csp, /default-src 'self'/, u);
      assert.match(csp, /frame-ancestors 'self'/, u);
      assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'inline-скрипты запрещены');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(r.headers.get('x-powered-by'), null);
      await r.arrayBuffer();
    }
  });
});

/* ======================================================================= */
describe('Авторизация', () => {
  const lisa = new Client('lisa');
  const newbie = new Client('newbie');
  st.newbie = newbie;

  it('запрос кода для существующего пользователя, повтор раньше минуты → 429', async () => {
    const r = await lisa.post('/api/auth/request', { target: 'Lisa@Example.com' });
    assert.equal(r.status, 200);
    assert.equal(r.body.type, 'email');
    assert.equal(r.body.target, 'lisa@example.com');
    assert.equal(r.body.isNew, false);
    assert.match(r.body.devCode, /^\d{6}$/);
    st.lisaCode = r.body.devCode;
    const again = await lisa.post('/api/auth/request', { target: 'lisa@example.com' });
    assert.equal(again.status, 429);
    assert.equal(again.body.error, 'otp_wait');
    const bad = await lisa.post('/api/auth/request', { target: 'not-an-email' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad_target');
  });

  it('неверный код отклоняется, верный — создаёт httpOnly-сессию', async () => {
    const wrong = await lisa.post('/api/auth/verify', { target: 'lisa@example.com', code: st.lisaCode === '111111' ? '222222' : '111111' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'otp_wrong');
    assert.equal(lisa.cookies.size, 0);
    const ok = await lisa.post('/api/auth/verify', { target: 'lisa@example.com', code: st.lisaCode });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'lisa@example.com');
    assert.equal(ok.body.user.role, 'volunteer');
    const sc = ok.setCookies.find((c) => c.startsWith('mba_sid='));
    assert.ok(sc, 'кука сессии выставлена');
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Lax/i);
    const me = await lisa.get('/api/me');
    assert.equal(me.body.user.email, 'lisa@example.com');
    // код одноразовый
    const reuse = await anon().post('/api/auth/verify', { target: 'lisa@example.com', code: st.lisaCode });
    assert.equal(reuse.status, 400);
  });

  it('выход: сессия удаляется на сервере', async () => {
    const token = lisa.cookies.get('mba_sid');
    const r = await lisa.post('/api/auth/logout');
    assert.equal(r.status, 200);
    assert.equal(lisa.cookies.has('mba_sid'), false);
    assert.equal((await lisa.get('/api/me')).body.user, null);
    const stolen = new Client('stolen'); stolen.cookies.set('mba_sid', token);
    assert.equal((await stolen.get('/api/me')).body.user, null, 'старый токен больше не действует');
  });

  it('регистрация: младше 18 лет и без согласий — отказ; с согласиями — успех', async () => {
    const target = 'newbie.api@example.com';
    const r = await newbie.post('/api/auth/request', { target });
    assert.equal(r.status, 200);
    assert.equal(r.body.isNew, true);
    const code = r.body.devCode;
    const base = { target, code, name: 'Новый Пользователь', consent_pd: true, consent_policy: true };
    const noName = await newbie.post('/api/auth/verify', Object.assign({}, base, { name: '' , birthdate: yearsAgo(30) }));
    assert.equal(noName.status, 400); assert.equal(noName.body.error, 'name_required');
    const young = await newbie.post('/api/auth/verify', Object.assign({}, base, { birthdate: yearsAgo(18, 2) })); // 18 исполнится через 2 дня
    assert.equal(young.status, 400); assert.equal(young.body.error, 'age_18');
    const noBirth = await newbie.post('/api/auth/verify', Object.assign({}, base, { birthdate: '' }));
    assert.equal(noBirth.status, 400); assert.equal(noBirth.body.error, 'age_18');
    const noPd = await newbie.post('/api/auth/verify', Object.assign({}, base, { birthdate: yearsAgo(30), consent_pd: false }));
    assert.equal(noPd.status, 400); assert.equal(noPd.body.error, 'consent_required');
    const noPolicy = await newbie.post('/api/auth/verify', Object.assign({}, base, { birthdate: yearsAgo(30), consent_policy: false }));
    assert.equal(noPolicy.status, 400); assert.equal(noPolicy.body.error, 'consent_required');
    assert.equal(newbie.cookies.size, 0, 'сессии нет после отказов');
    const ok = await newbie.post('/api/auth/verify', Object.assign({}, base, { birthdate: yearsAgo(18, -2), city: 'Тверь' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.role, 'user');
    assert.equal(ok.body.user.name, 'Новый Пользователь');
    assert.equal(ok.body.user.city, 'Тверь');
    assert.equal(ok.body.user.points, 0);
    newbie.user = ok.body.user;
    assert.equal((await newbie.get('/api/me')).body.user.email, target);
  });
});

/* ======================================================================= */
describe('Профиль и контакты для входа', () => {
  const pf = new Client('profile');
  before(async () => {
    await pf.login('profile.api@example.com', { name: 'Пётр Профилев', birthdate: yearsAgo(30), consent_pd: true, consent_policy: true });
  });

  it('GET /api/me отдаёт дату регистрации и статистику; имя/город/фото меняются, пустое имя — отказ', async () => {
    const me = (await pf.get('/api/me')).body.user;
    assert.ok(me.created_at, 'created_at');
    assert.deepEqual(Object.keys(me.stats).sort(), ['apps', 'found', 'helped']);
    assert.equal(me.stats.apps, 0);
    const up = await pf.post('/api/upload', { data: PNG });
    const r = await pf.patch('/api/me', { name: 'Пётр Новиков', city: 'Тверь', avatar: up.body.url });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const me2 = (await pf.get('/api/me')).body.user;
    assert.equal(me2.name, 'Пётр Новиков'); assert.equal(me2.city, 'Тверь'); assert.equal(me2.avatar, up.body.url);
    assert.equal((await pf.patch('/api/me', { avatar: '' })).status, 200);
    assert.equal((await pf.get('/api/me')).body.user.avatar, '');
    const bad = await pf.patch('/api/me', { name: '  ' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'name_required');
  });

  it('e-mail/телефон нельзя сменить без кода; тот же контакт в PATCH игнорируется', async () => {
    const r = await pf.patch('/api/me', { email: 'hijack@example.com' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'verify_contact');
    const p = await pf.patch('/api/me', { phone: '+79990001122' });
    assert.equal(p.status, 400); assert.equal(p.body.error, 'verify_contact');
    const same = await pf.patch('/api/me', { email: 'profile.api@example.com', name: 'Пётр Новиков' });
    assert.equal(same.status, 200);
    assert.equal((await pf.get('/api/me')).body.user.email, 'profile.api@example.com');
  });

  it('чужой или текущий контакт — отказ; неверный код не меняет контакт', async () => {
    const taken = await pf.post('/api/me/contact/request', { target: 'anna@example.com' });
    assert.equal(taken.status, 400); assert.equal(taken.body.error, 'email_taken');
    const same = await pf.post('/api/me/contact/request', { target: 'profile.api@example.com' });
    assert.equal(same.status, 400); assert.equal(same.body.error, 'same_contact');
    const anonReq = await anon().post('/api/me/contact/request', { target: 'x@example.com' });
    assert.equal(anonReq.status, 401);
    const rq = await pf.post('/api/me/contact/request', { target: '8 (999) 000-77-66' });
    assert.equal(rq.status, 200); assert.equal(rq.body.type, 'phone'); assert.equal(rq.body.target, '+79990007766');
    const again = await pf.post('/api/me/contact/request', { target: '+79990007766' });
    assert.equal(again.status, 429); assert.equal(again.body.error, 'otp_wait');
    const wrong = await pf.post('/api/me/contact/verify', { target: '+79990007766', code: rq.body.devCode === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400); assert.equal(wrong.body.error, 'otp_wrong');
    assert.equal((await pf.get('/api/me')).body.user.phone, null);
    const ok = await pf.post('/api/me/contact/verify', { target: '+79990007766', code: rq.body.devCode });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.phone, '+79990007766');
  });

  it('смена e-mail по коду: старый адрес больше не входит в этот аккаунт, новый — входит', async () => {
    const rq = await pf.post('/api/me/contact/request', { target: 'Profile.New@Example.com' });
    assert.equal(rq.status, 200); assert.equal(rq.body.target, 'profile.new@example.com');
    const ok = await pf.post('/api/me/contact/verify', { target: 'profile.new@example.com', code: rq.body.devCode });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'profile.new@example.com');
    const other = new Client('profile-new');
    const u = await other.login('profile.new@example.com');
    assert.equal(u.id, pf.user.id);
    const old = await anon().post('/api/auth/request', { target: 'profile.api@example.com' });
    assert.equal(old.body.isNew, true, 'старый e-mail свободен');
  });

  it('отвязка контакта: можно, пока остаётся второй; последний — нельзя', async () => {
    const rm = await pf.del('/api/me/contact/phone');
    assert.equal(rm.status, 200); assert.equal(rm.body.user.phone, null);
    const last = await pf.del('/api/me/contact/email');
    assert.equal(last.status, 400); assert.equal(last.body.error, 'need_contact');
    assert.equal((await pf.del('/api/me/contact/name')).status, 400);
  });

  it('выгрузка своих данных — JSON-файл без чужих данных', async () => {
    const r = await pf.get('/api/me/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="my-data-/);
    const d = r.body;
    assert.equal(d.profile.email, 'profile.new@example.com');
    assert.ok(Array.isArray(d.applications) && Array.isArray(d.payments) && Array.isArray(d.valuables));
    assert.equal((await anon().get('/api/me/export')).status, 401);
  });
});

/* ======================================================================= */
describe('Заявки', () => {
  it('создание (животные, вещи) — публикуется сразу; валидация обязательных полей', async () => {
    const a = await anna.post('/api/applications', appBody({ kind: 'lost', category: 'animals', title: 'Пропала морская свинка Пуша', species: 'грызун', features: 'трёхцветная, длинношёрстная', reward: 1500 }));
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.item.status, 'published');
    assert.equal(a.body.item.is_owner, true);
    assert.equal(a.body.item.reward, 1500);
    assert.equal(typeof a.body.matches, 'number');
    st.annaAnimal = a.body.item;
    const t = await igor.post('/api/applications', appBody({ kind: 'found', category: 'things', title: 'Найден зелёный шарф', lat: 55.71, lng: 37.51 }));
    assert.equal(t.status, 200);
    assert.equal(t.body.item.status, 'published');
    st.igorThing = t.body.item;
    const pub = await anon().get('/api/applications/' + st.annaAnimal.id);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.item.title, 'Пропала морская свинка Пуша');

    const cases = [
      [{ title: '' }, 'title_required'], [{ kind: 'x' }, 'bad_kind'], [{ category: 'cars' }, 'bad_category'],
      [{ lat: null }, 'place_required'], [{ lat: 95 }, 'place_required'], [{ contact: '' }, 'contact_required'],
      [{ event_date: '2999-01-01' }, 'future_date'], [{ event_date: 'вчера' }, 'bad_date']
    ];
    for (const [patch, code] of cases) {
      const r = await anna.post('/api/applications', appBody(patch));
      assert.equal(r.status, 400, code); assert.equal(r.body.error, code);
    }
  });

  it('заявка о человеке: нужна relation; о несовершеннолетнем — только законный представитель; уходит на проверку', async () => {
    const noRel = await max.post('/api/applications', peopleBody({ relation: '' }));
    assert.equal(noRel.status, 400); assert.equal(noRel.body.error, 'relation_required');
    const minorRel = await max.post('/api/applications', peopleBody({ person_age: 15, relation: 'relative' }));
    assert.equal(minorRel.status, 400); assert.equal(minorRel.body.error, 'minor_legal_rep');
    const noConfirm = await max.post('/api/applications', peopleBody({ confirm_rights: false }));
    assert.equal(noConfirm.status, 400); assert.equal(noConfirm.body.error, 'confirm_rights');
    const noFio = await max.post('/api/applications', peopleBody({ person_name: '' }));
    assert.equal(noFio.status, 400); assert.equal(noFio.body.error, 'fio_required');

    const minor = await max.post('/api/applications', peopleBody({ title: 'Пропала дочь, 15 лет', person_name: 'Ольга О.', person_age: 15, relation: 'legal_rep' }));
    assert.equal(minor.status, 200, JSON.stringify(minor.body));
    assert.equal(minor.body.item.status, 'pending');
    assert.equal(minor.body.item.is_minor, true);
    assert.equal(minor.body.item.relation, 'legal_rep');
    st.minorApp = minor.body.item;
    assert.equal((await anon().get('/api/applications/' + st.minorApp.id)).status, 404, 'до проверки не видна');
    assert.equal((await igor.get('/api/applications/' + st.minorApp.id)).status, 404);
    const own = await max.get('/api/applications/' + st.minorApp.id);
    assert.equal(own.status, 200);
    assert.equal(own.body.item.status, 'pending');
    const list = await anon().get('/api/applications?category=people');
    assert.ok(!list.body.items.some((a) => a.id === st.minorApp.id));
    // модераторы получили уведомление о новой заявке на проверке
    const n = await mod.get('/api/notifications');
    assert.ok(n.body.items.some((x) => x.type === 'moderation' && x.body.includes('Пропала дочь')));
  });

  it('загрузка фото и фильтрация URL: чужие ссылки отбрасываются, больше 5 — отказ', async () => {
    const up = await anna.post('/api/upload', { data: PNG });
    assert.equal(up.status, 200);
    assert.match(up.body.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
    const img = await fetch(BASE + up.body.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    await img.arrayBuffer();
    const fake = await anna.post('/api/upload', { data: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') });
    assert.equal(fake.status, 400); assert.equal(fake.body.error, 'bad_image');
    const gif = await anna.post('/api/upload', { data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
    assert.equal(gif.status, 400);

    const r = await anna.post('/api/applications', appBody({ title: 'Потеряна сумка с фото', photos: ['https://evil.example/x.jpg', '/uploads/../../secret.jpg', 'javascript:alert(1)', 42, up.body.url] }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.item.photos, [up.body.url]);
    st.annaThing = r.body.item;
    const six = Array.from({ length: 6 }, (_, i) => `/uploads/${String(i).repeat(32)}.jpg`);
    const tooMany = await anna.post('/api/applications', appBody({ photos: six }));
    assert.equal(tooMany.status, 400); assert.equal(tooMany.body.error, 'photos_max');
  });

  it('редактирование: автор — может, чужой — 404, аноним — 401', async () => {
    const body = appBody({ title: 'Потеряна сумка с фото (обновлено)', description: 'Новое описание', photos: st.annaThing.photos });
    const r = await anna.patch('/api/applications/' + st.annaThing.id, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.item.title, 'Потеряна сумка с фото (обновлено)');
    assert.equal(r.body.item.description, 'Новое описание');
    assert.equal(r.body.item.kind, 'lost', 'тип не меняется при правке');
    const other = await igor.patch('/api/applications/' + st.annaThing.id, Object.assign({}, body, { title: 'Взлом' }));
    assert.equal(other.status, 404);
    assert.equal((await anon().patch('/api/applications/' + st.annaThing.id, body)).status, 401);
    assert.equal((await igor.post(`/api/applications/${st.annaThing.id}/status`, { status: 'closed' })).status, 404);
    assert.equal((await igor.del('/api/applications/' + st.annaThing.id)).status, 404);
    const check = await anon().get('/api/applications/' + st.annaThing.id);
    assert.equal(check.body.item.title, 'Потеряна сумка с фото (обновлено)');
  });

  it('«найдено» для заявки о человеке скрывает персональные данные в публичной карточке', async () => {
    const up = await max.post('/api/upload', { data: PNG });
    const c = await max.post('/api/applications', peopleBody({ title: 'Пропал отец', person_name: 'Сергей Петрович Орлов', person_age: 70, last_seen: 'Парк Сокольники', description: 'Плохо ориентируется', features: 'синяя куртка', photos: [up.body.url] }));
    assert.equal(c.status, 200);
    st.peopleFound = c.body.item;
    assert.equal((await mod.post(`/api/admin/applications/${c.body.item.id}/moderate`, { action: 'approve' })).status, 200);
    const before = await anon().get('/api/applications/' + c.body.item.id);
    assert.equal(before.body.item.person_name, 'Сергей Петрович Орлов');
    assert.equal(before.body.item.hidden_pd, false);

    const bad = await max.post(`/api/applications/${c.body.item.id}/status`, { status: 'published' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_status');
    const f = await max.post(`/api/applications/${c.body.item.id}/status`, { status: 'found' });
    assert.equal(f.status, 200);
    assert.equal(f.body.item.status, 'found');
    assert.ok(f.body.item.found_at);

    const pub = await anon().get('/api/applications/' + c.body.item.id);
    assert.equal(pub.status, 200);
    const it2 = pub.body.item;
    assert.equal(it2.hidden_pd, true);
    assert.equal(it2.person_name, '');
    assert.equal(it2.person_age, null);
    assert.equal(it2.description, '');
    assert.equal(it2.features, '');
    assert.equal(it2.last_seen, '');
    assert.deepEqual(it2.photos, []);
    assert.equal(it2.address, 'Москва', 'вместо адреса — только город');
    const inList = (await anon().get('/api/applications?status=found&category=people')).body.items.find((a) => a.id === c.body.item.id);
    assert.ok(inList && inList.hidden_pd === true && inList.person_name === '');
    // модератор видит данные полностью
    const m = await mod.get('/api/applications/' + c.body.item.id);
    assert.equal(m.body.item.person_name, 'Сергей Петрович Орлов');
    // автор получил баллы за «найдено»
    const pts = await max.get('/api/my/points');
    assert.ok(pts.body.items.some((p) => p.delta === 10));
  });

  it('запрос на удаление от человека из заявки (без входа) → модератор удаляет заявку', async () => {
    const id = st.peopleFound.id;
    const bad = await anon().post(`/api/applications/${id}/deletion-request`, { name: '', contact: '' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'required');
    assert.equal((await anon().post('/api/applications/999999/deletion-request', { name: 'X', contact: 'Y' })).status, 404);
    const r = await anon().post(`/api/applications/${id}/deletion-request`, { name: 'Сергей Орлов', contact: '+7 900 111-22-33', reason: 'Я нашёлся, удалите' });
    assert.equal(r.status, 200);
    const list = await mod.get('/api/admin/deletion');
    const d = list.body.items.find((x) => x.application_id === id && x.status === 'open');
    assert.ok(d, 'запрос виден модератору');
    assert.equal(d.reason, 'Я нашёлся, удалите');
    assert.equal((await anna.post(`/api/admin/deletion/${d.id}`, { action: 'delete' })).status, 403);
    assert.equal((await mod.post(`/api/admin/deletion/${d.id}`, { action: 'delete' })).status, 200);
    assert.equal((await anon().get('/api/applications/' + id)).status, 404);
    assert.equal((await mod.get('/api/admin/deletion')).body.items.find((x) => x.id === d.id).status, 'done');
  });

  it('автор удаляет свою заявку', async () => {
    const c = await anna.post('/api/applications', appBody({ title: 'Временная заявка на удаление' }));
    const r = await anna.del('/api/applications/' + c.body.item.id);
    assert.equal(r.status, 200);
    assert.equal((await anna.get('/api/applications/' + c.body.item.id)).status, 404);
    assert.ok(!(await anna.get('/api/my/applications')).body.items.some((a) => a.id === c.body.item.id));
  });
});

/* ======================================================================= */
describe('Модерация', () => {
  it('модератор видит заявку в очереди и одобряет — она публикуется, автор получает уведомление', async () => {
    const q = await mod.get('/api/admin/applications?status=pending');
    const item = q.body.items.find((a) => a.id === st.minorApp.id);
    assert.ok(item, 'в очереди модерации');
    assert.equal(item.contact, '+7 900 000-00-00', 'модератор видит контакт');
    assert.equal(item.relation, 'legal_rep');
    assert.equal((await anna.post(`/api/admin/applications/${st.minorApp.id}/moderate`, { action: 'approve' })).status, 403);
    const bad = await mod.post(`/api/admin/applications/${st.minorApp.id}/moderate`, { action: 'explode' });
    assert.equal(bad.status, 400);
    const r = await mod.post(`/api/admin/applications/${st.minorApp.id}/moderate`, { action: 'approve' });
    assert.equal(r.status, 200);
    const pub = await anon().get('/api/applications/' + st.minorApp.id);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.item.status, 'published');
    assert.equal(pub.body.item.is_minor, true);
    const n = await max.get('/api/notifications');
    assert.ok(n.body.items.some((x) => x.type === 'moderation' && x.title === 'Заявка опубликована' && x.link === `#/a/${st.minorApp.id}`));
  });

  it('правка опубликованной заявки о человеке автором возвращает её на проверку', async () => {
    const r = await max.patch('/api/applications/' + st.minorApp.id, peopleBody({ title: 'Пропала дочь, 15 лет (уточнение)', person_name: 'Ольга О.', person_age: 15, relation: 'legal_rep' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.item.status, 'pending');
    assert.equal((await anon().get('/api/applications/' + st.minorApp.id)).status, 404);
    assert.equal((await mod.post(`/api/admin/applications/${st.minorApp.id}/moderate`, { action: 'approve' })).status, 200);
  });

  it('отклонение с причиной: заявка скрыта, автор видит причину', async () => {
    const c = await max.post('/api/applications', peopleBody({ title: 'Сомнительная заявка', person_name: 'Неизвестный' }));
    assert.equal(c.body.item.status, 'pending');
    const r = await mod.post(`/api/admin/applications/${c.body.item.id}/moderate`, { action: 'reject', reason: 'Недостаточно данных для публикации' });
    assert.equal(r.status, 200);
    assert.equal((await anon().get('/api/applications/' + c.body.item.id)).status, 404);
    const own = await max.get('/api/applications/' + c.body.item.id);
    assert.equal(own.body.item.status, 'rejected');
    assert.equal(own.body.item.reject_reason, 'Недостаточно данных для публикации');
    const n = await max.get('/api/notifications');
    assert.ok(n.body.items.some((x) => x.title === 'Заявка отклонена' && x.body.includes('Недостаточно данных')));
    const audit = await admin.get('/api/admin/audit');
    assert.ok(audit.body.items.some((x) => x.action === 'moderation.reject' && x.target === 'application:' + c.body.item.id));
  });
});

/* ======================================================================= */
describe('Подбор совпадений', () => {
  // Отдельный район (Казань), чтобы демо-заявки Москвы не влияли на результат
  const K = { lat: 55.7963, lng: 49.1088, city: 'Казань' };

  it('находка, явно похожая на пропажу, создаёт совпадение и уведомление владельцу пропажи', async () => {
    const lost = await anna.post('/api/applications', appBody(Object.assign({ kind: 'lost', category: 'things', title: 'Потерян синий зонт', features: 'синий зонт, деревянная ручка, брелок-сова' }, K)));
    assert.equal(lost.status, 200);
    assert.equal(lost.body.matches, 0);
    const found = await igor.post('/api/applications', appBody(Object.assign({ kind: 'found', category: 'things', title: 'Найден синий зонт', features: 'деревянная ручка, брелок-сова', lat: K.lat + 0.002 }, K, { lat: K.lat + 0.002 })));
    assert.equal(found.status, 200);
    assert.equal(found.body.matches, 1);
    const detail = await anna.get('/api/applications/' + lost.body.item.id);
    const m = detail.body.item.matches.find((x) => x.id === found.body.item.id);
    assert.ok(m, 'совпадение видно владельцу пропажи');
    assert.ok(m.score >= 50 && m.score <= 100, 'score ' + m.score);
    const n = await anna.get('/api/notifications');
    const note = n.body.items.find((x) => x.type === 'match' && x.link === `#/a/${found.body.item.id}`);
    assert.ok(note, 'уведомление о совпадении');
    assert.match(note.title, /Возможное совпадение \d+%/);
    const ni = await igor.get('/api/notifications');
    assert.ok(ni.body.items.some((x) => x.type === 'match' && x.link === `#/a/${lost.body.item.id}`), 'нашедший тоже уведомлён');
    const my = await anna.get('/api/my/applications');
    assert.equal(my.body.items.find((a) => a.id === lost.body.item.id).match_count, 1);
  });

  it('собака и кошка с одинаковыми приметами не совпадают; собака с собакой — совпадает', async () => {
    const N2 = { lat: 55.0302, lng: 82.9204, city: 'Новосибирск' };
    const lost = await max.post('/api/applications', appBody(Object.assign({ kind: 'lost', category: 'animals', title: 'Пропала собака Рыжик', species: 'собака', features: 'пятнистая шерсть, синий ошейник с колокольчиком, купированный хвост' }, N2)));
    assert.equal(lost.status, 200);
    const cat = await igor.post('/api/applications', appBody(Object.assign({ kind: 'found', category: 'animals', title: 'Найден кот', species: 'кот', features: 'пятнистая шерсть, синий ошейник с колокольчиком, купированный хвост' }, N2)));
    assert.equal(cat.status, 200);
    assert.equal(cat.body.matches, 0, 'кот не совпадает с собакой');
    let d = await max.get('/api/applications/' + lost.body.item.id);
    assert.equal(d.body.item.matches.length, 0);
    const dog = await igor.post('/api/applications', appBody(Object.assign({ kind: 'found', category: 'animals', title: 'Найдена собака', species: 'собака', features: 'пятнистая шерсть, синий ошейник с колокольчиком, купированный хвост' }, N2)));
    assert.equal(dog.body.matches, 1, 'контроль: та же пара с собакой совпадает');
    d = await max.get('/api/applications/' + lost.body.item.id);
    assert.deepEqual(d.body.item.matches.map((x) => x.id), [dog.body.item.id]);
    const n = await max.get('/api/notifications');
    assert.ok(!n.body.items.some((x) => x.type === 'match' && x.link === `#/a/${cat.body.item.id}`));
  });

  it('совпадения не создаются между заявками одного автора и без общих примет', async () => {
    const P = { lat: 56.3269, lng: 44.0059, city: 'Нижний Новгород' };
    const a = await anna.post('/api/applications', appBody(Object.assign({ kind: 'lost', title: 'Потеряна флешка', features: 'металлическая, гравировка «Нижний»' }, P)));
    const b = await anna.post('/api/applications', appBody(Object.assign({ kind: 'found', title: 'Найдена флешка', features: 'металлическая, гравировка «Нижний»' }, P)));
    assert.equal(b.body.matches, 0, 'своя же заявка не совпадение');
    const c = await igor.post('/api/applications', appBody(Object.assign({ kind: 'found', title: 'Найдена перчатка', features: 'кожаная, чёрная' }, P)));
    assert.equal(c.body.matches, 0, 'одного места и даты недостаточно');
    assert.ok(a.status === 200 && b.status === 200);
  });
});

/* ======================================================================= */
describe('Анонимный чат', () => {
  it('посетитель открывает чат по чужой заявке; свою и неопубликованную — нельзя', async () => {
    const r = await igor.post(`/api/applications/${st.annaAnimal.id}/chat`);
    assert.equal(r.status, 200);
    assert.ok(r.body.id);
    st.chatId = r.body.id;
    const again = await igor.post(`/api/applications/${st.annaAnimal.id}/chat`);
    assert.equal(again.body.id, st.chatId, 'повторное открытие — тот же чат');
    const own = await anna.post(`/api/applications/${st.annaAnimal.id}/chat`);
    assert.equal(own.status, 400); assert.equal(own.body.error, 'own');
    const pend = await igor.post(`/api/applications/${st.minorApp.id + 100000}/chat`);
    assert.equal(pend.status, 400); assert.equal(pend.body.error, 'not_available');
    const n = await anna.get('/api/notifications');
    assert.ok(n.body.items.some((x) => x.type === 'chat' && x.link === `#/chat/${st.chatId}`));
    const det = await igor.get('/api/applications/' + st.annaAnimal.id);
    assert.equal(det.body.item.chat_id, st.chatId);
  });

  it('текст и геоточка; владелец видит сообщения и счётчик непрочитанных', async () => {
    const meBefore = (await anna.get('/api/me')).body.user.unreadChats;
    const t = await igor.post(`/api/chats/${st.chatId}/messages`, { text: 'Видел похожую свинку у подъезда' });
    assert.equal(t.status, 200);
    assert.equal(t.body.message.mine, true);
    assert.equal(t.body.message.from, 'other');
    const loc = await igor.post(`/api/chats/${st.chatId}/messages`, { lat: 55.701, lng: 37.502 });
    assert.equal(loc.status, 200);
    assert.equal(loc.body.message.lat, 55.701);
    const empty = await igor.post(`/api/chats/${st.chatId}/messages`, { text: '   ' });
    assert.equal(empty.status, 400); assert.equal(empty.body.error, 'empty');

    assert.equal((await anna.get('/api/me')).body.user.unreadChats, meBefore + 2);
    const list = await anna.get('/api/chats');
    const ch = list.body.items.find((c) => c.id === st.chatId);
    assert.equal(ch.unread, 2);
    assert.equal(ch.side, 'owner');
    assert.equal(ch.last.location, true);
    assert.equal(ch.alias, 'Откликнувшийся');
    const open = await anna.get(`/api/chats/${st.chatId}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.messages.length, 2);
    assert.deepEqual(open.body.messages.map((m) => m.from), ['other', 'other']);
    assert.equal(open.body.messages[0].text, 'Видел похожую свинку у подъезда');
    assert.equal(open.body.messages[1].lat, 55.701);
    assert.equal(open.body.messages[0].mine, false);
    assert.ok(!('sender_id' in open.body.messages[0]), 'идентификаторы собеседников не раскрываются');
    assert.equal((await anna.get('/api/chats')).body.items.find((c) => c.id === st.chatId).unread, 0, 'прочитано');
    assert.equal((await anna.get('/api/me')).body.user.unreadChats, meBefore);

    await anna.post(`/api/chats/${st.chatId}/messages`, { text: 'Спасибо! Иду туда' });
    const il = await igor.get('/api/chats');
    assert.equal(il.body.items.find((c) => c.id === st.chatId).unread, 1);
  });

  it('посторонний не видит чат; модератор читает, но не пишет', async () => {
    assert.equal((await max.get(`/api/chats/${st.chatId}`)).status, 404);
    assert.equal((await max.post(`/api/chats/${st.chatId}/messages`, { text: 'hi' })).status, 404);
    const m = await mod.get(`/api/chats/${st.chatId}`);
    assert.equal(m.status, 200);
    assert.equal(m.body.chat.side, 'moderator');
    const w = await mod.post(`/api/chats/${st.chatId}/messages`, { text: 'Модератор' });
    assert.equal(w.status, 403);
  });

  it('блокировка: собеседник не может писать; разблокирует только заблокировавший', async () => {
    assert.equal((await anna.post(`/api/chats/${st.chatId}/block`, { block: true })).status, 200);
    const s = await igor.post(`/api/chats/${st.chatId}/messages`, { text: 'Ещё сообщение' });
    assert.equal(s.status, 403); assert.equal(s.body.error, 'blocked');
    const s2 = await anna.post(`/api/chats/${st.chatId}/messages`, { text: 'И я не могу' });
    assert.equal(s2.status, 403);
    const chat = (await igor.get(`/api/chats/${st.chatId}`)).body.chat;
    assert.equal(chat.blocked, true); assert.equal(chat.blocked_by_me, false);
    const un = await igor.post(`/api/chats/${st.chatId}/block`, { block: false });
    assert.equal(un.status, 403);
    assert.equal((await anna.post(`/api/chats/${st.chatId}/block`, { block: false })).status, 200);
    assert.equal((await igor.post(`/api/chats/${st.chatId}/messages`, { text: 'Снова можно' })).status, 200);
  });
});

/* ======================================================================= */
describe('Жалобы, избранное, уведомления', () => {
  it('жалоба: валидация, видна модератору, разбор', async () => {
    const bad = await igor.post('/api/complaints', { target_type: 'planet', target_id: 1, reason: 'x' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_target');
    const noReason = await igor.post('/api/complaints', { target_type: 'application', target_id: st.annaThing.id, reason: '' });
    assert.equal(noReason.status, 400); assert.equal(noReason.body.error, 'required');
    const foreignChat = await max.post('/api/complaints', { target_type: 'chat', target_id: st.chatId, reason: 'Спам' });
    assert.equal(foreignChat.status, 404, 'жаловаться на чужой чат нельзя');
    const ok = await igor.post('/api/complaints', { target_type: 'application', target_id: st.annaThing.id, reason: 'Подозрение на мошенничество' });
    assert.equal(ok.status, 200);
    const chatC = await igor.post('/api/complaints', { target_type: 'chat', target_id: st.chatId, reason: 'Грубость в чате' });
    assert.equal(chatC.status, 200);
    const list = await mod.get('/api/admin/complaints');
    const c = list.body.items.find((x) => x.reason === 'Подозрение на мошенничество');
    assert.ok(c);
    assert.equal(c.status, 'open');
    assert.equal(c.target.link, `#/a/${st.annaThing.id}`);
    const adm = await mod.get('/api/admin/applications?status=published');
    assert.equal(adm.body.items.find((a) => a.id === st.annaThing.id).complaints, 1);
    assert.equal((await mod.post(`/api/admin/complaints/${c.id}`, { action: 'dismiss' })).status, 200);
    assert.equal((await mod.get('/api/admin/complaints')).body.items.find((x) => x.id === c.id).status, 'dismissed');
  });

  it('избранное: добавить, увидеть, убрать', async () => {
    const id = st.annaAnimal.id;
    const s = await igor.post(`/api/applications/${id}/save`);
    assert.equal(s.status, 200); assert.equal(s.body.saved, true);
    assert.ok((await igor.get('/api/my/saved')).body.items.some((a) => a.id === id));
    assert.equal((await igor.get('/api/applications/' + id)).body.item.saved, true);
    const u = await igor.post(`/api/applications/${id}/save`);
    assert.equal(u.body.saved, false);
    assert.ok(!(await igor.get('/api/my/saved')).body.items.some((a) => a.id === id));
    assert.equal((await igor.post('/api/applications/999999/save')).status, 404);
  });

  it('уведомления: список и «прочитать все»', async () => {
    const n = await anna.get('/api/notifications');
    assert.equal(n.status, 200);
    assert.ok(n.body.items.some((x) => x.read === 0));
    assert.ok(n.body.items.every((x) => x.user_id === anna.user.id), 'только свои уведомления');
    assert.ok((await anna.get('/api/me')).body.user.unread > 0);
    assert.equal((await anna.post('/api/notifications/read')).status, 200);
    assert.ok((await anna.get('/api/notifications')).body.items.every((x) => x.read === 1));
    assert.equal((await anna.get('/api/me')).body.user.unread, 0);
  });
});

/* ======================================================================= */
describe('Экстренное оповещение', () => {
  // Зоны оповещений демо-пользователей (seed.js): [lat, lng, radius]
  const ZONES = { igor: [55.7558, 37.6173, 5], lisa: [55.7887, 37.6790, 4], liza: [55.7520, 37.5960, 5], max: [55.7310, 37.6030, 3], anna: [55.7601, 37.6186, 3] };
  const P = { lat: 55.7700, lng: 37.6500 };
  const expected = (radius, owner) => Object.entries(ZONES).filter(([k, z]) => k !== owner && distKm(z[0], z[1], P.lat, P.lng) <= radius + z[2]).length;

  it('запрос оповещения с заявкой; до публикации запустить нельзя', async () => {
    const c = await anna.post('/api/applications', peopleBody(Object.assign({ title: 'Пропал муж, 45 лет', person_name: 'Андрей Смирнов', person_age: 45, emergency_radius: 2 }, P)));
    assert.equal(c.status, 200);
    assert.equal(c.body.item.emergency_status, 'pending');
    assert.equal(c.body.item.emergency_radius, 2);
    st.emApp = c.body.item;
    const q = await mod.get('/api/admin/emergencies');
    assert.ok(q.body.items.some((a) => a.id === st.emApp.id && a.emergency_status === 'pending'));
    const early = await mod.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'approve', radius: 2 });
    assert.equal(early.status, 400); assert.equal(early.body.error, 'not_published');
    assert.equal((await mod.post(`/api/admin/applications/${st.emApp.id}/moderate`, { action: 'approve' })).status, 200);
  });

  it('обычный пользователь не может запускать оповещение; радиус вне 1–5 км отклоняется', async () => {
    assert.equal((await anna.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'approve', radius: 2 })).status, 403);
    for (const radius of [0.5, 6, 50, -1]) {
      const r = await mod.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'approve', radius });
      assert.equal(r.status, 400, 'radius ' + radius);
      assert.equal(r.body.error, 'bad_radius');
    }
    const own = await anna.get('/api/applications/' + st.emApp.id);
    assert.equal(own.body.item.emergency_status, 'pending', 'неверный радиус не запускает рассылку');
  });

  it('модератор запускает рассылку (радиус 1–5 км) — возвращается число получателей', async () => {
    const r = await mod.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'approve', radius: 2 });
    assert.equal(r.status, 200);
    const exp = expected(2, 'anna');
    assert.ok(exp >= 1);
    assert.equal(r.body.sent, exp);
    const pub = await anon().get('/api/applications/' + st.emApp.id);
    assert.equal(pub.body.item.emergency, 2);
    assert.ok((await anon().get('/api/applications?emergency=1')).body.items.some((a) => a.id === st.emApp.id));
    const ni = await igor.get('/api/notifications');
    const note = ni.body.items.find((x) => x.type === 'emergency' && x.link === `#/a/${st.emApp.id}`);
    assert.ok(note, 'волонтёр в зоне получил оповещение');
    assert.equal(note.title, 'Экстренный поиск человека рядом');
    const na = await anna.get('/api/notifications');
    assert.ok(na.body.items.some((x) => x.type === 'emergency' && x.title === 'Экстренное оповещение запущено' && x.body.includes(String(exp))));
    assert.ok(!na.body.items.some((x) => x.title === 'Экстренный поиск человека рядом' && x.link === `#/a/${st.emApp.id}`), 'автор не получает собственную рассылку');
  });

  it('повтор рассылки админом, остановка; повтор неактивной — 400', async () => {
    const r = await admin.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'resend' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, expected(2, 'anna'));
    const big = await admin.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'approve', radius: 5 });
    assert.equal(big.status, 200);
    assert.equal(big.body.sent, expected(5, 'anna'));
    assert.equal((await anon().get('/api/applications/' + st.emApp.id)).body.item.emergency, 5);
    assert.equal((await admin.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'stop' })).status, 200);
    assert.equal((await anon().get('/api/applications/' + st.emApp.id)).body.item.emergency, null);
    const again = await admin.post(`/api/admin/emergencies/${st.emApp.id}`, { action: 'resend' });
    assert.equal(again.status, 400); assert.equal(again.body.error, 'not_active');
    const audit = (await admin.get('/api/admin/audit')).body.items;
    assert.ok(audit.some((x) => x.action === 'emergency.approve' && x.target === 'application:' + st.emApp.id));
    assert.ok(audit.some((x) => x.action === 'emergency.resend'));
  });

  it('автор запрашивает оповещение для вещи — нельзя; радиус вне диапазона — 400', async () => {
    const thing = await anna.post(`/api/applications/${st.annaThing.id}/emergency`, { radius: 3 });
    assert.equal(thing.status, 400); assert.equal(thing.body.error, 'not_allowed');
    const bad = await anna.post(`/api/applications/${st.annaAnimal.id}/emergency`, { radius: 10 });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_radius');
    const ok = await anna.post(`/api/applications/${st.annaAnimal.id}/emergency`, { radius: 4 });
    assert.equal(ok.status, 200);
    const own = await anna.get('/api/applications/' + st.annaAnimal.id);
    assert.equal(own.body.item.emergency_status, 'pending');
    assert.equal(own.body.item.emergency_radius, 4);
    const dup = await anna.post(`/api/applications/${st.annaAnimal.id}/emergency`, { radius: 4 });
    assert.equal(dup.status, 400); assert.equal(dup.body.error, 'exists');
  });
});

/* ======================================================================= */
describe('Реестр ценностей', () => {
  it('создание, отметка «украдено», публичная проверка по серийному номеру', async () => {
    const c = await igor.post('/api/valuables', { title: 'Электросамокат', serials: 'XM-2024-556677', marks: 'наклейка с совой на деке' });
    assert.equal(c.status, 200);
    assert.equal(c.body.item.status, 'ok');
    st.val = c.body.item;
    assert.equal((await igor.post('/api/valuables', { title: '' })).status, 400);
    const pre = await anon().get('/api/registry/check?q=' + encodeURIComponent('XM-2024-556677'));
    assert.equal(pre.status, 200);
    assert.equal(pre.body.items.length, 0, 'пока не отмечен украденным — не находится');

    assert.equal((await igor.patch(`/api/valuables/${st.val.id}`, { status: 'burned' })).status, 400);
    assert.equal((await anna.patch(`/api/valuables/${st.val.id}`, { status: 'stolen' })).status, 404, 'чужой предмет');
    const s = await igor.patch(`/api/valuables/${st.val.id}`, { status: 'stolen' });
    assert.equal(s.status, 200);
    assert.equal(s.body.item.status, 'stolen');
    assert.ok(s.body.item.status_at);

    const r = await anon().get('/api/registry/check?q=' + encodeURIComponent('xm 2024 556677'));
    assert.equal(r.status, 200);
    const hit = r.body.items.find((x) => x.id === st.val.id);
    assert.ok(hit, 'найден по серийному номеру без учёта пробелов и дефисов');
    assert.equal(hit.serial_match, true);
    assert.equal(hit.status, 'stolen');
    assert.equal(hit.user_id, undefined, 'данные владельца не раскрываются');
    assert.equal(hit.serials, undefined);
    const byMark = await anon().get('/api/registry/check?q=' + encodeURIComponent('совой'));
    assert.ok(byMark.body.items.some((x) => x.id === st.val.id && x.serial_match === false));
    const short = await anon().get('/api/registry/check?q=ab');
    assert.equal(short.status, 400); assert.equal(short.body.error, 'short');
  });

  it('сообщение владельцу о замеченном предмете', async () => {
    const empty = await anon().post(`/api/registry/${st.val.id}/report`, { message: '' });
    assert.equal(empty.status, 400);
    const r = await anon().post(`/api/registry/${st.val.id}/report`, { message: 'Видел у метро Динамо' });
    assert.equal(r.status, 200);
    const n = await igor.get('/api/notifications');
    assert.ok(n.body.items.some((x) => x.type === 'registry' && x.body.includes('Видел у метро Динамо')));
    // предмет в статусе «ok» сообщать нельзя
    const okItem = await igor.post('/api/valuables', { title: 'Часы', serials: 'W-1' });
    assert.equal((await anon().post(`/api/registry/${okItem.body.item.id}/report`, { message: 'тут' })).status, 404);
  });

  it('бесплатный лимит реестра — 3 предмета', async () => {
    const list = await igor.get('/api/valuables');
    assert.equal(list.body.limit, 3);
    assert.equal(list.body.items.length, 3); // демо-рюкзак + самокат + часы
    const over = await igor.post('/api/valuables', { title: 'Четвёртый' });
    assert.equal(over.status, 402); assert.equal(over.body.error, 'limit');
  });
});

/* ======================================================================= */
describe('Оплата', () => {
  let tariffs;
  before(async () => { tariffs = Object.fromEntries((await anna.get('/api/tariffs')).body.items.map((t) => [t.code, t])); });

  it('валидация создания платежа', async () => {
    assert.equal((await anna.post('/api/payments', { tariff_id: 99999, method: 'card' })).status, 404);
    const m = await anna.post('/api/payments', { tariff_id: tariffs.registry_plus.id, method: 'bitcoin' });
    assert.equal(m.status, 400); assert.equal(m.body.error, 'bad_method');
    const sc = await anna.post('/api/payments', { tariff_id: tariffs.registry_plus.id, method: 'saved_card' });
    assert.equal(sc.status, 400); assert.equal(sc.body.error, 'no_card');
    const p = await anna.post('/api/payments', { tariff_id: tariffs.partner.id, method: 'card' });
    assert.equal(p.status, 403); assert.equal(p.body.error, 'partners_only');
    const pr = await anna.post('/api/payments', { tariff_id: tariffs.promote.id, method: 'card' });
    assert.equal(pr.status, 400); assert.equal(pr.body.error, 'app_required');
    const foreign = await anna.post('/api/payments', { tariff_id: tariffs.promote.id, method: 'card', application_id: st.igorThing.id });
    assert.equal(foreign.status, 400, 'нельзя продвигать чужую заявку');
  });

  it('карта: неверный номер отклоняется; успешная оплата — чек, подписка, увеличенный лимит реестра', async () => {
    // у Анны 2 демо-предмета: третий можно, четвёртый — нет
    assert.equal((await anna.post('/api/valuables', { title: 'Фотоаппарат' })).status, 200);
    assert.equal((await anna.post('/api/valuables', { title: 'Гитара' })).status, 402);

    const c = await anna.post('/api/payments', { tariff_id: tariffs.registry_plus.id, method: 'card', save_card: true });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, 'pending');
    assert.equal(c.body.confirmation_url, `#/pay/${c.body.id}`);
    assert.equal((await igor.get('/api/payments/' + c.body.id)).status, 404, 'чужой платёж не виден');
    assert.equal((await igor.post(`/api/payments/${c.body.id}/confirm`, { success: true, card: '4111111111111111' })).status, 404);

    const bad = await anna.post(`/api/payments/${c.body.id}/confirm`, { success: true, card: '4111 1111' });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_card');
    assert.equal((await anna.get('/api/payments/' + c.body.id)).body.item.status, 'pending');

    const luhnBad = await anna.post(`/api/payments/${c.body.id}/confirm`, { success: true, card: '4111 1111 1111 1234' });
    assert.equal(luhnBad.status, 400, 'номер с неверной контрольной суммой (Луна) отклоняется'); assert.equal(luhnBad.body.error, 'bad_card');
    const ok = await anna.post(`/api/payments/${c.body.id}/confirm`, { success: true, card: '4111 1111 1111 1111' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.item.status, 'succeeded');
    assert.equal(ok.body.item.amount, tariffs.registry_plus.final_price);
    assert.ok(ok.body.item.paid_at);
    const receipt = JSON.parse(ok.body.item.receipt);
    assert.equal(receipt.total, tariffs.registry_plus.final_price);
    assert.equal(receipt.customer, 'anna@example.com');
    assert.equal(receipt.items[0].name, 'Реестр ценностей+');

    const me = (await anna.get('/api/me')).body.user;
    assert.ok(me.subscriptions.some((s) => s.code === 'registry_plus' && s.until > new Date().toISOString().replace('T', ' ').slice(0, 19)));
    assert.equal(me.card, '•••• 1111');
    assert.equal((await anna.get('/api/valuables')).body.limit, 100);
    assert.equal((await anna.post('/api/valuables', { title: 'Гитара' })).status, 200);
    assert.ok((await anna.get('/api/my/payments')).body.items.some((p) => p.id === c.body.id && p.status === 'succeeded'));
    assert.ok((await anna.get('/api/notifications')).body.items.some((n) => n.type === 'payment'));
    // повторное подтверждение не меняет оплаченный платёж
    const again = await anna.post(`/api/payments/${c.body.id}/confirm`, { success: false });
    assert.equal(again.body.item.status, 'succeeded');
  });

  it('продвижение заявки привязанной картой и отмена платежа', async () => {
    const before = await anon().get('/api/applications/' + st.annaThing.id);
    assert.equal(before.body.item.promoted, false);
    const p = await anna.post('/api/payments', { tariff_id: tariffs.promote.id, method: 'saved_card', application_id: st.annaThing.id });
    assert.equal(p.status, 200);
    assert.equal(p.body.status, 'succeeded');
    assert.equal((await anon().get('/api/applications/' + st.annaThing.id)).body.item.promoted, true);

    const c = await anna.post('/api/payments', { tariff_id: tariffs.promote.id, method: 'sbp', application_id: st.annaThing.id });
    const cancel = await anna.post(`/api/payments/${c.body.id}/confirm`, { success: false });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.item.status, 'canceled');
    const adm = await admin.get('/api/admin/payments');
    assert.ok(adm.body.items.some((x) => x.id === p.body.id && x.status === 'succeeded'));
  });
});

/* ======================================================================= */
describe('Семейный аккаунт', () => {
  it('создание семьи и приглашение', async () => {
    assert.equal((await igor.post('/api/family/invite', { target: 'anna@example.com' })).status, 403, 'без семьи приглашать нельзя');
    const c = await max.post('/api/family', { name: 'Орловы' });
    assert.equal(c.status, 200);
    const dup = await max.post('/api/family', { name: 'Ещё одна' });
    assert.equal(dup.status, 400); assert.equal(dup.body.error, 'exists');
    const f = await max.get('/api/family');
    assert.equal(f.body.family.name, 'Орловы');
    assert.equal(f.body.family.is_owner, true);
    assert.equal(f.body.family.members.length, 1);
    const inv = await max.post('/api/family/invite', { target: 'igor@example.com' });
    assert.equal(inv.status, 200);
    assert.equal((await max.get('/api/family')).body.family.pending.length, 1);
  });

  it('второй пользователь принимает приглашение', async () => {
    const g = await igor.get('/api/family');
    assert.equal(g.body.family, null);
    const invite = g.body.invites.find((i) => i.name === 'Орловы');
    assert.ok(invite);
    assert.equal(invite.owner, 'Максим Орлов');
    assert.ok((await igor.get('/api/notifications')).body.items.some((n) => n.type === 'family'));
    assert.equal((await anna.post(`/api/family/invites/${invite.id}/accept`)).status, 404, 'чужое приглашение');
    const a = await igor.post(`/api/family/invites/${invite.id}/accept`);
    assert.equal(a.status, 200);
    const f = await igor.get('/api/family');
    assert.equal(f.body.family.is_owner, false);
    assert.deepEqual(f.body.family.members.map((m) => m.name).sort(), ['Игорь Волков', 'Максим Орлов']);
    assert.equal((await igor.post('/api/family/invite', { target: 'anna@example.com' })).status, 403, 'приглашает только владелец');
  });

  it('общая заявка семьи видна и редактируется участником, но не посторонним', async () => {
    const c = await max.post('/api/applications', appBody({ kind: 'lost', category: 'animals', title: 'Пропал семейный хомяк', species: 'грызун', family: true, lat: 59.93, lng: 30.31 }));
    assert.equal(c.status, 200);
    assert.equal(c.body.item.family_shared, true);
    const mine = await igor.get('/api/my/applications');
    const shared = mine.body.items.find((a) => a.id === c.body.item.id);
    assert.ok(shared, 'участник семьи видит заявку в кабинете');
    assert.equal(shared.is_owner, true);
    assert.equal(shared.is_author, false);
    const e = await igor.patch('/api/applications/' + c.body.item.id, appBody({ kind: 'lost', category: 'animals', title: 'Пропал семейный хомяк Пончик', lat: 59.93, lng: 30.31 }));
    assert.equal(e.status, 200);
    assert.equal(e.body.item.title, 'Пропал семейный хомяк Пончик');
    assert.equal((await anna.patch('/api/applications/' + c.body.item.id, appBody({ title: 'x' }))).status, 404);
    const pub = await anon().get('/api/applications/' + c.body.item.id);
    assert.equal(pub.body.item.contact, undefined);
    // личная заявка без флага family не становится общей
    const own = await max.post('/api/applications', appBody({ title: 'Личная заявка Макса', lat: 59.94, lng: 30.32 }));
    assert.ok(!(await igor.get('/api/my/applications')).body.items.some((a) => a.id === own.body.item.id));
  });
});

/* ======================================================================= */
describe('Поддержка', () => {
  it('обращение пользователя и ответ сотрудника', async () => {
    const bad = await anna.post('/api/tickets', { subject: 'Без текста', text: '' });
    assert.equal(bad.status, 400);
    const t = await anna.post('/api/tickets', { subject: 'Не приходит push', text: 'Включила уведомления, но ничего не приходит' });
    assert.equal(t.status, 200);
    const id = t.body.id;
    const q = await mod.get('/api/admin/tickets');
    const row = q.body.items.find((x) => x.id === id);
    assert.ok(row); assert.equal(row.status, 'open'); assert.equal(row.name, 'Анна Смирнова');
    assert.equal((await igor.get('/api/tickets/' + id)).status, 404, 'чужое обращение');
    const view = await mod.get('/api/tickets/' + id);
    assert.equal(view.body.user.email, 'anna@example.com', 'сотрудник видит контакты');
    const rep = await mod.post(`/api/tickets/${id}/messages`, { text: 'Проверьте разрешения браузера' });
    assert.equal(rep.status, 200);
    const mine = await anna.get('/api/tickets/' + id);
    assert.equal(mine.body.ticket.status, 'answered');
    assert.equal(mine.body.user, undefined);
    assert.deepEqual(mine.body.messages.map((m) => m.staff), [0, 1]);
    assert.equal(mine.body.messages[1].text, 'Проверьте разрешения браузера');
    assert.ok((await anna.get('/api/notifications')).body.items.some((n) => n.type === 'support' && n.link === `#/support/${id}`));
    assert.equal((await anna.post(`/api/tickets/${id}/messages`, { text: 'Спасибо, помогло' })).status, 200);
    assert.equal((await anna.get('/api/tickets/' + id)).body.ticket.status, 'open');
    assert.equal((await anna.post(`/api/tickets/${id}/close`)).status, 200);
    assert.equal((await anna.get('/api/tickets')).body.items.find((x) => x.id === id).status, 'closed');
  });
});

/* ======================================================================= */
describe('Панель администратора', () => {
  it('статистика и список пользователей', async () => {
    const s = await admin.get('/api/admin/stats');
    assert.equal(s.status, 200);
    const T = s.body.totals;
    for (const k of ['applications', 'pending', 'published', 'found', 'matches', 'users', 'volunteers', 'partners', 'revenue']) assert.equal(typeof T[k], 'number', k);
    assert.ok(T.matches >= 2);
    assert.ok(T.revenue >= 199);
    assert.ok(Array.isArray(s.body.byCat) && s.body.byCat.length > 0);
    assert.ok(s.body.days.some((d) => d.c > 0));
    const users = await admin.get('/api/admin/users');
    assert.equal(users.body.items.length, T.users);
    const q = await admin.get('/api/admin/users?q=anna');
    assert.ok(q.body.items.some((u) => u.email === 'anna@example.com'));
    const vol = await admin.get('/api/admin/users?role=volunteer');
    assert.ok(vol.body.items.length >= 3 && vol.body.items.every((u) => u.role === 'volunteer'));
  });

  it('права при изменении пользователей', async () => {
    const users = (await admin.get('/api/admin/users')).body.items;
    const id = (e) => users.find((u) => u.email === e).id;
    assert.equal((await mod.patch('/api/admin/users/' + id('anna@example.com'), { role: 'admin' })).status, 403, 'роли меняет только админ');
    assert.equal((await mod.patch('/api/admin/users/' + id('admin@mba.local'), { blocked: true })).status, 403, 'админа не заблокировать');
    const self = await admin.patch('/api/admin/users/' + id('admin@mba.local'), { role: 'user' });
    assert.equal(self.status, 400); assert.equal(self.body.error, 'self');
    assert.equal((await admin.patch('/api/admin/users/' + id('anna@example.com'), { role: 'superuser' })).status, 400);
    assert.equal((await admin.patch('/api/admin/users/999999', { blocked: true })).status, 404);
  });

  it('блокировка: сессии сбрасываются, войти нельзя; разблокировка', async () => {
    const users = (await admin.get('/api/admin/users')).body.items;
    const newbie = st.newbie;
    const nid = users.find((u) => u.email === 'newbie.api@example.com').id;
    const lid = users.find((u) => u.email === 'lisa@example.com').id;
    assert.ok((await newbie.get('/api/me')).body.user, 'до блокировки сессия активна');
    assert.equal((await mod.patch('/api/admin/users/' + nid, { blocked: true })).status, 200);
    assert.equal((await newbie.get('/api/me')).body.user, null);
    assert.equal((await newbie.get('/api/notifications')).status, 401);

    assert.equal((await admin.patch('/api/admin/users/' + lid, { blocked: true })).status, 200);
    const lisa = new Client('lisa-blocked');
    const r = await lisa.post('/api/auth/request', { target: '8 (999) 000-00-03' }); // телефон Лизы в другом формате
    assert.equal(r.status, 200);
    assert.equal(r.body.type, 'phone');
    assert.equal(r.body.target, '+79990000003');
    const v = await lisa.post('/api/auth/verify', { target: '+7 999 000 00 03', code: r.body.devCode });
    assert.equal(v.status, 403);
    assert.equal(v.body.error, 'blocked');
    assert.equal(lisa.cookies.size, 0);
    assert.ok((await admin.get('/api/admin/users?q=lisa')).body.items.every((u) => u.blocked === 1));
    assert.equal((await admin.patch('/api/admin/users/' + lid, { blocked: false })).status, 200);
    assert.equal((await admin.get('/api/admin/users?q=lisa')).body.items[0].blocked, 0);
  });

  it('выгрузка статистики в Excel', async () => {
    const r = await admin.get('/api/admin/export.xlsx');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="mba-stats-\d{4}-\d{2}-\d{2}\.xlsx"/);
    assert.ok(Buffer.isBuffer(r.body) && r.body.length > 1000);
    assert.equal(r.body.subarray(0, 2).toString(), 'PK', 'zip-контейнер xlsx');
    assert.equal((await mod.get('/api/admin/export.xlsx')).status, 200, 'модератору выгрузка доступна');
  });

  it('резервная копия базы', async () => {
    const r = await admin.post('/api/admin/backup');
    assert.equal(r.status, 200);
    assert.match(r.body.file, /^app-.*\.db$/);
    const f = path.join(DATA_DIR, 'backups', r.body.file);
    assert.ok(fs.existsSync(f), 'файл копии создан');
    assert.ok(fs.statSync(f).size > 10000);
  });

  it('журнал аудита содержит действия', async () => {
    const r = await admin.get('/api/admin/audit');
    assert.equal(r.status, 200);
    const actions = new Set(r.body.items.map((x) => x.action));
    for (const a of ['system.seed', 'user.login', 'user.register', 'application.create', 'application.update', 'application.status', 'moderation.approve',
      'payment.create', 'payment.succeeded', 'complaint.create', 'chat.block', 'family.create', 'user.admin_update', 'system.backup', 'stats.export', 'deletion.delete']) {
      assert.ok(actions.has(a), 'нет записи ' + a);
    }
    const login = r.body.items.find((x) => x.action === 'user.login' && x.name === 'Анна Смирнова');
    assert.ok(login && login.ip, 'IP фиксируется');
  });

  it('переводы и справочники: изменения админа видны клиенту', async () => {
    const t = await admin.post('/api/admin/translations', { key: 'hero.title', lang: 'ru', value: 'Найдём вместе — тест' });
    assert.equal(t.status, 200);
    assert.equal((await anon().get('/api/i18n/ru')).body['hero.title'], 'Найдём вместе — тест');
    assert.equal((await anon().get('/api/i18n/en')).body['hero.title'], undefined);
    assert.equal((await mod.post('/api/admin/translations', { key: 'hero.title', lang: 'ru', value: 'x' })).status, 403);
    await admin.post('/api/admin/translations', { key: 'hero.title', lang: 'ru', value: '' });
    assert.equal((await anon().get('/api/i18n/ru')).body['hero.title'], undefined, 'пустое значение удаляет перевод');

    const d = await admin.post('/api/admin/dicts', { type: 'species', value_ru: 'Ящерица', value_en: 'Lizard' });
    assert.equal(d.status, 200);
    const cfg = await anon().get('/api/config');
    assert.ok(cfg.body.dicts.species.some((x) => x.ru === 'Ящерица' && x.en === 'Lizard'));
  });

  it('исходящие письма: только администратору и без кодов входа', async () => {
    const r = await admin.get('/api/admin/outbox');
    assert.equal(r.status, 200);
    const mail = r.body.items.find((m) => m.channel === 'email' && m.target === 'newbie.api@example.com');
    assert.ok(mail && mail.body.includes('••••••') && !/\d{6}/.test(mail.body), 'код замаскирован');
    assert.ok(r.body.items.some((m) => m.channel === 'sms' && m.target === '+79990000003'));
    assert.equal((await mod.get('/api/admin/outbox')).status, 403, 'модератор не видит исходящие');
  });
});

describe('Правовые документы', () => {
  it('все четыре документа отдаются на русском и английском, с нумерацией и реквизитами', async () => {
    for (const doc of ['terms', 'privacy', 'consent', 'publication']) {
      for (const lang of ['ru', 'en']) {
        const r = await anon().get(`/api/legal/${doc}?lang=${lang}`);
        assert.equal(r.status, 200, `${doc}/${lang}`);
        assert.equal(r.body.id, doc); assert.equal(r.body.lang, lang);
        assert.ok(r.body.title && r.body.lead && /^\d{4}-\d{2}-\d{2}$/.test(r.body.edition));
        assert.ok(r.body.sections.length >= 4, `${doc}/${lang}: разделы`);
        assert.equal(r.body.sections[0].n, '1'); assert.equal(r.body.sections[0].items[0].n, '1.1');
        const text = JSON.stringify(r.body.sections);
        assert.ok(!/\{(op|email|site)\}/.test(text), 'плейсхолдеры подставлены');
        assert.ok(r.body.requisites.some(([, v]) => v.includes('@')), 'e-mail оператора');
        assert.equal(r.body.docs.length, 4);
      }
    }
    const ru = (await anon().get('/api/legal/privacy')).body;
    assert.match(JSON.stringify(ru), /152-ФЗ/); assert.match(JSON.stringify(ru), /территории Российской Федерации/);
    assert.equal((await anon().get('/api/legal/nope')).status, 404);
    assert.equal((await anon().get('/api/legal/terms.docx')).status, 404);
  });
  it('PDF скачивается с корректным именем файла', async () => {
    const r = await anon().get('/api/legal/consent.pdf?lang=ru');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const cd = r.headers.get('content-disposition');
    assert.match(cd, /^attachment; filename="soglasie-na-obrabotku-pd\.pdf"; filename\*=UTF-8''/);
    assert.ok(decodeURIComponent(cd.split("''")[1]).startsWith('Согласие на обработку персональных данных'));
    assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(r.body.length > 20000, 'встроен шрифт с кириллицей');
    const en = await anon().get('/api/legal/terms.pdf?lang=en&inline=1');
    assert.match(en.headers.get('content-disposition'), /^inline; filename="terms-of-use\.pdf"/);
  });
  it('администратор задаёт реквизиты оператора — они попадают во все документы', async () => {
    await admin.post('/api/admin/translations', { key: 'legal.op.name', lang: 'ru', value: 'ООО «Лучший агент»' });
    await admin.post('/api/admin/translations', { key: 'legal.op.inn', lang: 'ru', value: '7700000000' });
    try {
      const d = (await anon().get('/api/legal/consent')).body;
      assert.match(d.sections[0].items[0].text, /оператору платформы — ООО «Лучший агент» \(далее — «Оператор»\)/);
      assert.ok(d.requisites.some(([k, v]) => k === 'ИНН' && v === '7700000000'));
      const en = (await anon().get('/api/legal/consent?lang=en')).body;
      assert.ok(en.requisites.some(([k, v]) => /TIN/.test(k) && v === '7700000000'), 'ИНН не зависит от языка');
      assert.equal((await anon().get('/api/legal/consent.pdf')).status, 200);
    } finally {
      await admin.post('/api/admin/translations', { key: 'legal.op.name', lang: 'ru', value: '' });
      await admin.post('/api/admin/translations', { key: 'legal.op.inn', lang: 'ru', value: '' });
    }
    const d = (await anon().get('/api/legal/consent')).body;
    assert.match(d.sections[0].items[0].text, /оператору платформы \(далее — «Оператор»\)/);
  });
});

describe('Хранение данных', () => {
  it('база — файл app.db в папке данных, с WAL, внешними ключами и затиранием удалённого', () => {
    const { DatabaseSync } = require('node:sqlite');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'app.db')));
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'secret.key')), 'ключ хранится отдельно от БД');
    const d = new DatabaseSync(path.join(DATA_DIR, 'app.db'), { readOnly: true });
    try {
      assert.equal(d.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      assert.equal(d.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.ok(d.prepare('PRAGMA user_version').get().user_version >= 1);
    } finally { d.close(); }
  });
  it('в БД нет токенов сессий и кодов входа в открытом виде', async () => {
    const { DatabaseSync } = require('node:sqlite');
    const c = new Client('db');
    await c.login('max@example.com');
    const pending = await anon().post('/api/auth/request', { target: 'dbcheck@example.com' });
    assert.equal(pending.status, 200);
    const token = c.cookies.get('mba_sid');
    const d = new DatabaseSync(path.join(DATA_DIR, 'app.db'), { readOnly: true });
    try {
      assert.equal(d.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(token).n, 0, 'сырой токен не хранится');
      const hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
      assert.equal(d.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(hash).n, 1, 'хранится хэш');
      const o = d.prepare('SELECT code FROM otp WHERE target = ?').get('dbcheck@example.com');
      assert.ok(o && /^[a-f0-9]{64}$/.test(o.code) && o.code !== pending.body.devCode, 'код входа — HMAC, не цифры');
    } finally { d.close(); }
    assert.equal((await c.get('/api/me')).status, 200, 'вход по cookie работает');
    const ok = await anon().post('/api/auth/verify', { target: 'dbcheck@example.com', code: pending.body.devCode, name: 'Тест', birthdate: yearsAgo(30), consent_pd: true, consent_policy: true });
    assert.equal(ok.status, 200, 'код из письма принимается');
  });
  it('файлы данных не отдаются по HTTP', async () => {
    for (const u of ['/data/app.db', '/app.db', '/data/secret.key', '/uploads/../data/app.db', '/uploads/%2e%2e/app.db', '/uploads/..%2fsecret.key']) {
      const r = await anon().get(u);
      assert.ok(!Buffer.isBuffer(r.body) || !r.body.subarray(0, 15).toString().startsWith('SQLite format'), u);
      assert.ok(!(r.headers.get('content-type') || '').includes('octet-stream'), u);
    }
  });
});

describe('Защита от злоупотреблений', () => {
  it('заблокированный собеседник не может снять блокировку сам', async () => {
    const a = (await anna.post('/api/applications', appBody({ title: 'Потерян зонт в клетку' }))).body.item;
    const chat = (await igor.post(`/api/applications/${a.id}/chat`)).body.id;
    assert.equal((await anna.post(`/api/chats/${chat}/block`, { block: true })).status, 200);
    assert.equal((await igor.post(`/api/chats/${chat}/block`, { block: true })).status, 403);
    assert.equal((await igor.post(`/api/chats/${chat}/block`, { block: false })).status, 403);
    assert.equal((await igor.post(`/api/chats/${chat}/messages`, { text: 'привет' })).status, 403);
    assert.equal((await anna.post(`/api/chats/${chat}/block`, { block: false })).status, 200);
    assert.equal((await igor.post(`/api/chats/${chat}/messages`, { text: 'привет' })).status, 200);
    st.abuseApp = a; st.abuseChat = chat;
  });
  it('баллы помощнику — только при переписке с обеих сторон', async () => {
    const before = (await igor.get('/api/me')).body.user.points;
    const a = (await anna.post('/api/applications', appBody({ title: 'Потеряны перчатки' }))).body.item;
    await igor.post(`/api/applications/${a.id}/chat`);
    await anna.post(`/api/applications/${a.id}/status`, { status: 'found', helper_id: igor.user.id });
    assert.equal((await igor.get('/api/me')).body.user.points, before, 'чат без сообщений — без баллов');
    await anna.post(`/api/chats/${st.abuseChat}/messages`, { text: 'Спасибо, это мой зонт' });
    await anna.post(`/api/applications/${st.abuseApp.id}/status`, { status: 'found', helper_id: igor.user.id });
    assert.equal((await igor.get('/api/me')).body.user.points, before + 50, 'реальная помощь — +50');
  });
  it('скрытая модератором заявка недоступна по прямой ссылке', async () => {
    const a = (await anna.post('/api/applications', appBody({ title: 'Найден кошелёк коричневый', kind: 'found' }))).body.item;
    assert.equal((await anon().get(`/api/applications/${a.id}`)).status, 200);
    const c = await max.post('/api/complaints', { target_type: 'application', target_id: a.id, reason: 'спам' });
    assert.equal(c.status, 200);
    const list = (await mod.get('/api/admin/complaints')).body.items;
    const cm = list.find((x) => x.target_type === 'application' && x.target_id === a.id);
    assert.equal((await mod.post(`/api/admin/complaints/${cm.id}`, { action: 'resolve', hide: true })).status, 200);
    assert.equal((await anon().get(`/api/applications/${a.id}`)).status, 404);
    assert.equal((await anna.get(`/api/applications/${a.id}`)).status, 200, 'автор видит свою заявку');
  });
  it('модератор не начисляет баллы себе и не блокирует модераторов через жалобу', async () => {
    assert.equal((await mod.patch(`/api/admin/users/${mod.user.id}`, { points: 100 })).status, 400);
    assert.equal((await mod.patch(`/api/admin/users/${igor.user.id}`, { points: 100000 })).status, 400);
    const c = await max.post('/api/complaints', { target_type: 'user', target_id: admin.user.id, reason: 'тест' });
    assert.equal(c.status, 200);
    const cm = (await mod.get('/api/admin/complaints')).body.items.find((x) => x.target_type === 'user' && x.target_id === admin.user.id);
    assert.equal((await mod.post(`/api/admin/complaints/${cm.id}`, { action: 'resolve', block_user: mod.user.id })).status, 403);
  });
  it('аватар — только загруженное на платформу изображение', async () => {
    await max.patch('/api/me', { avatar: 'javascript:alert(1)' });
    assert.equal((await max.get('/api/me')).body.user.avatar, '');
  });
  it('большие тела запросов отклоняются везде, кроме загрузки фото', async () => {
    const r = await anon().post('/api/leads', { kind: 'partner', name: 'x', contact: 'x@x.ru', message: 'x'.repeat(300000) });
    assert.equal(r.status, 413);
  });
  it('push-подписка хранит только адрес и ключи', async () => {
    assert.equal((await max.post('/api/push/subscribe', { subscription: { endpoint: 'https://push.example.com/abc' } })).status, 400);
    assert.equal((await max.post('/api/push/subscribe', { subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'k', auth: 'a' }, junk: 'x'.repeat(1000) } })).status, 200);
  });
});

describe('Оплата в тестовом режиме и уведомления на английском', () => {
  it('тестовый режим: тестовая страница оплаты вместо ЮKassa, вебхук ЮKassa не принимается', async () => {
    assert.equal((await anon().get('/api/config')).body.payments, 'test');
    const tariff = (await anna.get('/api/tariffs')).body.items.find((t) => t.feature === 'registry');
    const pay = await anna.post('/api/payments', { tariff_id: tariff.id, method: 'sbp' });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.confirmation_url, `#/pay/${pay.body.id}`);
    const wh = await fetch(BASE + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ object: { id: 'x', status: 'succeeded' } }) });
    assert.equal(wh.status, 503, 'без ключей ЮKassa уведомления не принимаются');
    assert.equal((await anna.post(`/api/payments/${pay.body.id}/confirm`, { success: true })).status, 200);
    const it = (await anna.get(`/api/payments/${pay.body.id}`)).body.item;
    assert.equal(it.status, 'succeeded'); assert.equal(it.provider, 'test');
  });
  it('системные уведомления и баллы приходят на языке интерфейса', async () => {
    const cookie = [...anna.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const get = (u, lang) => fetch(BASE + u, { headers: { Cookie: cookie, 'X-Lang': lang } }).then((r) => r.json());
    const en = await get('/api/notifications', 'en'), ru = await get('/api/notifications', 'ru');
    assert.ok(ru.items.some((n) => /[а-я]/i.test(n.title)));
    assert.ok(en.items.length && en.items.every((n) => !/[а-яё]/i.test(n.title)), 'заголовки переведены: ' + en.items.map((n) => n.title).filter((x) => /[а-я]/i.test(x)).join(' | '));
    const pts = await get('/api/my/points', 'en');
    assert.ok(pts.items.some((p) => p.reason === 'Signed up' || /^Confirmed help|Report marked/.test(p.reason)));
  });
  it('лимит хранилища фото учитывает загрузки пользователя', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const r = await max.post('/api/upload', { data: PNG });
    assert.equal(r.status, 200);
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path.join(DATA_DIR, 'app.db'), { readOnly: true });
    try { assert.ok(d.prepare('SELECT size FROM uploads WHERE name = ?').get(r.body.url.split('/').pop()).size > 0); } finally { d.close(); }
  });
});
