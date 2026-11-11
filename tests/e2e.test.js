'use strict';
// Сквозные (E2E) тесты интерфейса в настоящем браузере Chromium: мобильная вёрстка, язык, вход, мастер заявки,
// личный кабинет, чат, админка. Запуск: npm run test:e2e
// Поднимает отдельный сервер на свободном порту с временной базой — рабочие данные в platform/data не трогаются.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 3000 + 900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const MOBILE = { width: 360, height: 780 };
let srv, dataDir, browser;

// Ошибки сторонних тайлов карты не относятся к платформе
const IGNORE = /tile\.openstreetmap\.org|favicon|ERR_ABORTED|beforeinstallprompt|Banner not shown/;

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/api/config'); if (r.ok) return; } catch (e) { /* ещё стартует */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || MOBILE, locale: opts.locale || 'ru-RU', deviceScaleFactor: 1, hasTouch: !!opts.touch, bypassCSP: !!opts.bypassCSP });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text() + ' ' + (m.location().url || ''))) page.errors.push('console: ' + m.text() + ' @ ' + m.location().url); });
  return page;
}

// Вход через API в контексте браузера (cookie сохраняются в контексте)
async function login(page, target) {
  await page.goto(BASE + '/#/');
  const name = await page.evaluate(async (target) => {
    const H = { 'X-Requested-With': 'mba', 'Content-Type': 'application/json' };
    const r = await (await fetch('/api/auth/request', { method: 'POST', headers: H, body: JSON.stringify({ target }) })).json();
    const v = await (await fetch('/api/auth/verify', { method: 'POST', headers: H, body: JSON.stringify({ target, code: r.devCode }) })).json();
    return v.user && v.user.name;
  }, target);
  assert.ok(name, 'login failed for ' + target);
  return name;
}

async function open(page, hash) {
  await page.goto('about:blank');
  await page.goto(BASE + '/' + hash);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function noOverflow(page, label) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    // элемент «торчит», только если его не обрезает ни один родитель (overflow: hidden/clip/auto)
    wide: [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width || r.right <= innerWidth + 1 || getComputedStyle(e).position === 'fixed') return false;
      if (e.closest('.stories,.subnav,.chips,.admin-nav,.table-wrap,.leaflet-container,.track,.map-filters,.seg')) return false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible' && p.getBoundingClientRect().right <= innerWidth + 1) return false; }
      return true;
    })
      .slice(0, 3).map((e) => e.tagName + '.' + [...e.classList].join('.') + ' ' + Math.round(e.getBoundingClientRect().right)) }));
  assert.ok(m.sw <= m.cw + 1, `${label}: horizontal scroll ${m.sw} > ${m.cw}`);
  assert.equal(m.wide.length, 0, `${label}: elements wider than the screen: ${m.wide.join('; ')}`);
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-e2e-'));
  srv = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dataDir, NODE_ENV: 'test' }), stdio: 'ignore' });
  await waitUp();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (srv) srv.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* файл БД может быть ещё занят */ }
});

describe('Язык интерфейса', () => {
  it('определяется автоматически: русский браузер → RU', async () => {
    const page = await newPage({ locale: 'ru-RU' });
    await open(page, '#/');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
    assert.match(await page.locator('.brand').first().innerText(), /Мой лучший агент/);
    await page.context().close();
  });
  it('определяется автоматически: английский браузер → EN, без экрана выбора языка', async () => {
    const page = await newPage({ locale: 'en-US' });
    await open(page, '#/');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.match(await page.locator('.brand').first().innerText(), /My Best Agent/);
    assert.equal(await page.locator('.langpick').count(), 0);
    await page.context().close();
  });
  it('переключается кнопкой в шапке и запоминается', async () => {
    const page = await newPage({ locale: 'ru-RU' });
    await open(page, '#/');
    await page.locator('#langBtn').click();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    await open(page, '#/');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'choice persisted after reload');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('Мобильная вёрстка (360 px) — публичные страницы', () => {
  for (const [hash, label] of [['#/', 'главная'], ['#/map', 'карта'], ['#/a/3', 'заявка с фото'], ['#/a/1', 'заявка о человеке'], ['#/registry', 'реестр'],
    ['#/tariffs', 'тарифы'], ['#/community', 'волонтёры'], ['#/login', 'вход'], ['#/legal/terms', 'соглашение'], ['#/legal/privacy', 'политика'], ['#/legal', 'документы'], ['#/nope', '404']]) {
    it(`${label} (${hash}) — без ошибок и горизонтальной прокрутки`, async () => {
      const page = await newPage();
      await open(page, hash);
      assert.ok((await page.locator('#view').innerText()).trim().length > 20, 'page has content');
      await noOverflow(page, hash);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    });
  }
  it('карта показывает метки заявок', async () => {
    const page = await newPage();
    await open(page, '#/map');
    await page.waitForSelector('.pin, .mcl', { timeout: 8000 });
    await page.waitForTimeout(600);
    // метки могут быть объединены в кластеры — считаем одиночные метки + числа в кластерах
    const total = await page.evaluate(() => document.querySelectorAll('.pin').length
      + [...document.querySelectorAll('.mcl b')].reduce((s, b) => s + (+b.textContent || 0), 0));
    assert.ok(total >= 5, 'markers on map: ' + total);
    // тап по метке открывает карточку заявки (нажимаем в точку метки на карте — как пользователь)
    const pt = await page.evaluate(() => {
      const box = document.querySelector('#bigmap').getBoundingClientRect();
      for (const p of document.querySelectorAll('#bigmap .pin')) {
        const r = p.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > box.left + 60 && x < box.right - 70 && y > box.top + 60 && y < box.bottom - 90) return { x, y };
      }
      return null;
    });
    assert.ok(pt, 'на экране есть метка, по которой можно нажать');
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector('.peek .peek-card', { timeout: 4000 });
    // Esc закрывает карточку, переключатель «Карта / Список» возвращается
    await page.keyboard.press('Escape');
    await page.waitForSelector('#peek', { state: 'hidden', timeout: 2000 });
    // переключение на список и обратно
    await page.click('.map-seg [data-v="list"]');
    assert.ok(await page.locator('.mrow').count() >= 5, 'list rows');
    await page.click('.map-seg [data-v="map"]');
    await page.context().close();
  });
  it('у заявок с фото есть фото, без фото — оформленная заглушка', async () => {
    const page = await newPage();
    await open(page, '#/');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    assert.ok(await page.locator('.app-card img').count() >= 3, 'photos in cards');
    assert.ok(await page.locator('.app-card .media-ph .ph-ic svg').count() >= 1, 'designed placeholder');
    assert.ok(await page.locator('.story.has-photo .story-bg').count() >= 2, 'stories with photos');
    await page.context().close();
  });
  it('тёмная тема включается из шапки (на телефоне — в настройках, на компьютере — в шапке)', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, '#/');
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('#themeBtn').click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.notEqual(before, after);
    await page.context().close();
  });
});

describe('Вход и регистрация', () => {
  it('код из SMS подставляется автозаполнением целиком в первую ячейку → вход', async () => {
    const page = await newPage();
    await open(page, '#/login');
    await page.locator('input[name="target"]').fill('igor@example.com');
    await page.locator('#f1 button').click();
    await page.waitForSelector('.otp input');
    const code = (await page.locator('#view').innerText()).match(/\b\d{6}\b/)[0];
    await page.locator('.otp input').first().fill(code); // так ведут себя iOS/Android при автоподстановке
    await page.waitForFunction(() => location.hash.startsWith('#/me') || location.hash === '#/', null, { timeout: 5000 });
    const me = await page.evaluate(async () => (await (await fetch('/api/me')).json()).user);
    assert.equal(me.name, 'Игорь Волков');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('ячейки кода помещаются на узком экране', async () => {
    const page = await newPage({ viewport: { width: 320, height: 640 } });
    await open(page, '#/login');
    await page.locator('input[name="target"]').fill('newbie' + Date.now() + '@example.com');
    await page.locator('#f1 button').click();
    await page.waitForSelector('.otp input');
    await noOverflow(page, 'otp 320px');
    await page.context().close();
  });
  it('согласия — ссылки на документы: лист с текстом, «Принимаю» ставит галочку, PDF скачивается', async () => {
    const page = await newPage();
    await open(page, '#/login');
    await page.locator('input[name="target"]').fill('legal' + Date.now() + '@example.com');
    await page.locator('#f1 button').click();
    await page.waitForSelector('[name="consent_policy"]');
    assert.ok(!/\(текст\)/.test(await page.locator('#f2').innerText()), 'без подписи «(текст)»');
    await page.locator('a[data-for="consent_policy"]').click();
    await page.waitForSelector('.legal-sheet [data-accept]');
    assert.match(page.url(), /#\/login/, 'форма не покинута');
    await page.locator('.legal-sheet [data-t="privacy"]').click();
    await page.waitForFunction(() => /конфиденциальности/i.test(document.querySelector('.legal-sheet h3').textContent));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.legal-sheet-foot a[download]').click()]);
    assert.match(dl.suggestedFilename(), /\.pdf$/);
    await page.locator('.legal-sheet [data-accept]').click();
    assert.equal(await page.locator('[name="consent_policy"]').isChecked(), true);
    assert.equal(await page.locator('[name="consent_pd"]').isChecked(), false);
    await noOverflow(page, 'legal sheet');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('Личный кабинет (Анна)', () => {
  let page;
  before(async () => { page = await newPage(); await login(page, 'anna@example.com'); });
  after(async () => { await page.context().close(); });
  for (const tab of ['', 'apps', 'saved', 'profile', 'zone', 'family', 'registry', 'payments', 'rewards', 'settings']) {
    it(`вкладка «${tab || 'обзор'}» открывается и заполнена`, async () => {
      page.errors = [];
      await open(page, '#/me' + (tab ? '/' + tab : ''));
      const txt = await page.locator('#tab').innerText();
      assert.ok(txt.trim().length > 40, 'tab has content');
      await noOverflow(page, 'me/' + tab);
      assert.deepEqual(page.errors, []);
    });
  }
  it('переключатели и ползунок радиуса: область нажатия не меньше 40 px', async () => {
    for (const hash of ['#/me/settings', '#/me/zone']) {
      await open(page, hash);
      const hits = await page.evaluate(() => [...document.querySelectorAll('.switch, .range')].filter((e) => e.getClientRects().length).map((e) => {
        const b = e.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const ok = (y) => { const t = document.elementFromPoint(cx, y); return !!t && (t === e || e.contains(t)); };
        let up = 0, dn = 0; while (up < 30 && ok(cy - up - 1)) up++; while (dn < 30 && ok(cy + dn + 1)) dn++;
        return up + dn + 1;
      }));
      assert.ok(hits.length >= 1, hash + ': controls found');
      assert.ok(hits.every((x) => x >= 40), `${hash}: hit heights ${hits.join(', ')}`);
    }
  });
  it('SOS на странице своей заявки: выбор радиуса → запрос уходит модератору, кнопка сменяется статусом', async () => {
    page.errors = [];
    await open(page, '#/');
    const id = await page.evaluate(async () => {
      const r = await (await fetch('/api/applications', { method: 'POST', headers: { 'X-Requested-With': 'mba', 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'lost', category: 'animals', title: 'Пропала такса Жучка', species: 'собака', features: 'коричневая, синий ошейник', event_date: new Date().toISOString().slice(0, 10), lat: 55.7612, lng: 37.6201, address: 'Петровка', city: 'Москва', contact: '+79990000001' }) })).json();
      return r.item.id;
    });
    await open(page, '#/a/' + id);
    await page.locator('#emBtn').click();
    await page.waitForSelector('.sheet #rr');
    await page.locator('#rr').focus();
    await page.keyboard.press('ArrowRight'); // 3 → 4 км
    assert.match(await page.locator('#rv').innerText(), /^4 км$/);
    const [resp] = await Promise.all([page.waitForResponse((r) => /\/emergency$/.test(r.url()) && r.request().method() === 'POST'), page.locator('.sheet [data-ok]').click()]);
    assert.equal(resp.status(), 200);
    assert.deepEqual(JSON.parse(resp.request().postData()), { radius: 4 });
    await page.waitForSelector('.d-side .note-amber');
    assert.match(await page.locator('.d-side .note-amber').innerText(), /на проверке/);
    assert.match(await page.locator('#emNote .em-rad').innerText(), /Радиус 4 км/i, 'автор видит выбранный радиус');
    assert.equal(await page.locator('#mm path, #mm canvas').count() > 0, true, 'зона будущего оповещения на мини-карте');
    assert.equal(await page.locator('#emBtn').count(), 0, 'SOS button hidden while the request is pending');
    await page.waitForSelector('.overlay', { state: 'detached', timeout: 2000 });
    assert.deepEqual(page.errors, []);
  });
  it('уведомления и поддержка открываются', async () => {
    page.errors = [];
    await open(page, '#/notifications');
    assert.ok(await page.locator('.list > a').count() >= 1);
    await open(page, '#/support');
    assert.match(await page.locator('#view').innerText(), /оповещения по району/);
    assert.deepEqual(page.errors, []);
  });
  it('чат: сообщение отправляется и появляется в переписке', async () => {
    page.errors = [];
    await open(page, '#/chats');
    await page.locator('.list a, a[href^="#/chat/"]').first().click();
    await page.waitForSelector('#ct');
    const text = 'Тестовое сообщение ' + Date.now();
    await page.locator('#ct').fill(text);
    await page.locator('#cf .send').click();
    await page.waitForFunction((t) => document.querySelector('#msgs').innerText.includes(t), text, { timeout: 5000 });
    await noOverflow(page, 'chat');
    assert.deepEqual(page.errors, []);
  });
});

describe('Мастер заявки', () => {
  it('«Я нашёл → Животные» проходит все 5 шагов и публикуется сразу', async () => {
    const page = await newPage();
    await login(page, 'lisa@example.com');
    await open(page, '#/new/found');
    await page.locator('[data-cat="animals"]').click();
    await page.locator('input[name="title"]').fill('Найден серый кот в ошейнике');
    await page.locator('textarea[name="features"]').fill('серый, голубой ошейник');
    await page.locator('#next').click();
    await page.locator('#next').click(); // фото — пропустить
    await page.waitForSelector('.map-host.leaflet-container');
    const box = await page.locator('.map-host').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#next').click();
    await page.locator('#next').click(); // опубликовать
    await page.waitForSelector('.success h2');
    assert.match(await page.locator('.success h2').innerText(), /опубликована/i);
    await noOverflow(page, 'wizard success');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('фото из мастера сохраняются в заявке; метка на карте видна; карта разворачивается на весь экран', async () => {
    const page = await newPage();
    await login(page, 'lisa@example.com');
    await open(page, '#/new/found');
    await page.locator('[data-cat="things"]').click();
    await page.locator('input[name="title"]').fill('Найден синий зонт');
    await page.locator('#next').click();
    await page.locator('#ph input[type=file]').setInputFiles(path.join(__dirname, '..', 'public', 'assets', 'demo', 'keys.jpg'));
    await page.waitForSelector('#ph .ph-item img');
    await page.waitForFunction(() => !document.querySelector('#ph .ph-item.up'));
    await page.locator('#next').click();
    await page.waitForSelector('.map-host.leaflet-container');
    const box = await page.locator('.map-host').boundingBox();
    assert.ok(box.height >= 300, `карта выбора места достаточно высокая: ${box.height}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const pin = page.locator('.pin.pick-pin');
    await pin.waitFor();
    const pb = await pin.boundingBox();
    assert.ok(pb.width <= 40 && pb.height <= 40, 'метка — компактный значок, а не растянутый блок');
    const bg = await pin.evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(bg, 'rgb(255, 255, 255)', 'метка не белая');
    // разворот карты на весь экран и обратно
    await page.locator('.picker .map-full-btn').click();
    const fb = await page.locator('.picker').boundingBox();
    const vp = page.viewportSize();
    assert.ok(fb.width >= vp.width - 1 && fb.height >= vp.height - 1, 'карта развернулась на весь экран');
    await page.locator('.picker .map-done').click();
    assert.ok((await page.locator('.picker').boundingBox()).height < vp.height, 'карта свернулась');
    await page.locator('#next').click();
    await page.locator('#next').click(); // опубликовать
    await page.waitForSelector('.success h2');
    const href = await page.locator('.success a[href^="#/a/"]').first().getAttribute('href');
    const item = await page.evaluate(async (id) => (await (await fetch('/api/applications/' + id)).json()).item, href.split('/').pop());
    assert.equal(item.photos.length, 1, 'фото сохранилось в заявке');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('заявка о человеке без подтверждения прав не отправляется', async () => {
    const page = await newPage();
    await login(page, 'max@example.com');
    await open(page, '#/new/lost');
    await page.locator('[data-cat="people"]').click();
    await page.locator('#next').click();
    // ошибка показывается у поля: рамка, текст под полем, фокус в поле
    await page.waitForSelector('.field.has-err .ferr');
    assert.match(await page.locator('.field.has-err .ferr').innerText(), /ФИО/);
    assert.equal(await page.evaluate(() => document.activeElement.name), 'person_name');
    assert.equal(await page.locator('input[name=person_name]').getAttribute('aria-invalid'), 'true');
    await page.locator('input[name=person_name]').fill('Иван Петров');
    assert.equal(await page.locator('.field.has-err').count(), 0, 'исправили поле — подсветка снята');
    await page.locator('#next').click();
    await page.waitForSelector('.field.has-err .ferr');
    assert.match(await page.locator('.field.has-err .ferr').innerText(), /возраст/i);
    await page.context().close();
  });
});

// Доступность: axe-core (лежит в tests/vendor, сеть не нужна). Падаем только на серьёзных и критических нарушениях.
const AXE_SRC = path.join(__dirname, 'vendor', 'axe.min.js');
async function axeCheck(page, label) {
  // анимации появления и пульсации не должны влиять на замер контраста
  await page.evaluate(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')); });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.addScriptTag({ content: fs.readFileSync(AXE_SRC, 'utf8') });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'], rules: { region: { enabled: false } } })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  assert.deepEqual(v, [], `${label}: axe violations`);
}

describe('Карта', () => {
  it('на карте нет подписей (флага, названий); всё грузится с нашего сервера; источник данных — в подвале', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, '#/map');
    await page.waitForSelector('#bigmap img.leaflet-tile');
    assert.equal(await page.locator('#bigmap .leaflet-control-attribution').count(), 0, 'подписи на карте нет');
    assert.equal(await page.locator('script[src^="http"], link[rel="stylesheet"][href^="http"]').count(), 0, 'скрипты и стили — только со своего сервера');
    await open(page, '#/');
    assert.match(await page.locator('#foot').innerText(), /OpenStreetMap/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('Доступность (axe-core: serious/critical)', { skip: !fs.existsSync(AXE_SRC) && 'axe-core не найден' }, () => {
  for (const theme of ['light', 'dark']) {
    it(`публичные страницы, тема ${theme}`, async () => {
      const page = await newPage({ bypassCSP: true }); // CSP запрещает inline-скрипты, а axe внедряется именно так
      await page.context().addInitScript((th) => { try { localStorage.setItem('mba.theme', th); } catch (e) { /* about:blank */ } }, theme);
      for (const hash of ['#/', '#/map', '#/a/3', '#/a/1', '#/registry', '#/tariffs', '#/community', '#/login', '#/legal', '#/legal/terms']) {
        await open(page, hash);
        await axeCheck(page, hash + ' ' + theme);
      }
      assert.deepEqual(page.errors, []);
      await page.context().close();
    });
  }
  it('личный кабинет и чат (Анна), тёмная тема, английский', async () => {
    const page = await newPage({ locale: 'en-US', bypassCSP: true });
    await page.context().addInitScript(() => { try { localStorage.setItem('mba.theme', 'dark'); } catch (e) { /* about:blank */ } });
    await login(page, 'anna@example.com');
    for (const hash of ['#/me', '#/me/apps', '#/me/profile', '#/me/zone', '#/me/registry', '#/me/settings', '#/notifications', '#/chats', '#/chat/1', '#/support']) {
      await open(page, hash);
      await axeCheck(page, hash);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('окно «Новая заявка»: фокус внутри, Tab не выходит, Esc закрывает и возвращает фокус', async () => {
    const page = await newPage();
    await open(page, '#/');
    await page.focus('#fab');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.sheet[role="dialog"][aria-labelledby]');
    await page.waitForTimeout(200);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus stays inside the dialog');
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('.overlay', { state: 'detached', timeout: 2000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fab');
    await page.context().close();
  });
});

describe('Админ-панель', () => {
  it('все разделы открываются без ошибок', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, 'admin@mba.local');
    for (const sec of ['', 'moderation', 'emergency', 'complaints', 'applications', 'users', 'roles', 'support', 'deletion', 'leads', 'payments', 'tariffs', 'dicts', 'translations', 'stories', 'system', 'outbox', 'audit']) {
      await open(page, '#/admin' + (sec ? '/' + sec : ''));
      assert.ok((await page.locator('#body').innerText()).trim().length > 10, 'section ' + sec + ' has content');
    }
    // на компьютере — колонка разделов слева, кнопки-переключателя нет
    assert.equal(await page.locator('.admin-nav').isVisible(), true, 'side menu on desktop');
    assert.equal(await page.locator('#admPick').isVisible(), false, 'no picker on desktop');
    assert.equal(await page.locator('.admin-nav a[aria-current="page"] .grow').innerText(), 'Журнал действий');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('на телефоне: кнопка текущего раздела со счётчиком → лист всех разделов в две колонки', async () => {
    const page = await newPage();
    await login(page, 'admin@mba.local');
    await open(page, '#/admin/moderation');
    assert.equal(await page.locator('.admin-nav').isVisible(), false, 'no side menu / strip on phone');
    const pick = page.locator('#admPick');
    assert.match(await pick.innerText(), /Модерация/);
    const total = +(await pick.locator('.cnt').innerText());
    assert.ok(total > 0, 'pick shows the total of counters');
    await pick.click();
    await page.waitForSelector('.sheet[role="dialog"] .admin-sheet a');
    await page.waitForTimeout(450);
    const links = page.locator('.admin-sheet a');
    assert.equal(await links.count(), 18, 'all sections in the sheet');
    assert.equal(await page.locator('.admin-sheet a[aria-current="page"] .grow').innerText(), 'Модерация');
    assert.equal(await page.locator('.admin-sheet a .ic').count(), 18, 'icons');
    const sheetSum = await page.evaluate(() => [...document.querySelectorAll('.admin-sheet .cnt')].reduce((s, e) => s + +e.textContent, 0));
    assert.equal(sheetSum, total, 'counters in the sheet add up to the badge');
    const [a, b] = [await links.nth(0).boundingBox(), await links.nth(1).boundingBox()];
    assert.ok(Math.abs(a.y - b.y) < 2 && b.x > a.x + a.width - 1, 'two columns');
    assert.ok(a.height >= 44, 'touch-friendly tiles');
    await noOverflow(page, 'admin sheet');
    // доступность: фокус внутри листа, Esc закрывает и возвращает фокус на кнопку
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus inside the sheet');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.overlay', { state: 'detached', timeout: 2000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'admPick');
    // переход в раздел из листа
    await pick.click();
    await page.locator('.admin-sheet a[href="#/admin/users"]').click();
    await page.waitForFunction(() => location.hash === '#/admin/users' && /Пользователи/.test(document.querySelector('#admPick').innerText));
    await page.waitForSelector('.overlay', { state: 'detached', timeout: 2000 });
    await noOverflow(page, 'admin/users');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('админка на телефоне без горизонтальной прокрутки', async () => {
    const page = await newPage();
    await login(page, 'moderator@mba.local');
    for (const sec of ['', 'moderation', 'emergency', 'complaints']) { await open(page, '#/admin' + (sec ? '/' + sec : '')); await noOverflow(page, 'admin/' + sec); }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});
