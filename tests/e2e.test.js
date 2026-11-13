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
  // неизвестное имя иконки (вместо неё рисуются три точки) — тоже ошибка
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[icon]')) page.errors.push('icon: ' + m.text()); });
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
  it('низ страницы: подвал не уходит под нижнюю панель и не отделён пустой полосой', async () => {
    const page = await newPage();
    for (const hash of ['#/', '#/registry', '#/a/1']) {
      await open(page, hash);
      await page.evaluate(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')); window.scrollTo(0, 1e6); });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const foot = document.querySelector('#foot');
        const last = [...foot.querySelectorAll('span, a, p')].pop().getBoundingClientRect().bottom;
        const gap = foot.getBoundingClientRect().top - [...document.querySelectorAll('#view > *')].pop().getBoundingClientRect().bottom;
        return { last, tab: document.querySelector('.tabbar').getBoundingClientRect().top, gap };
      });
      assert.ok(r.last <= r.tab, `${hash}: последняя строка подвала (${r.last}) под панелью (${r.tab})`);
      assert.ok(r.gap <= 48, `${hash}: пустая полоса перед подвалом ${r.gap}px`);
    }
    await page.context().close();
  });
  it('«Как это работает»: номер шага слева от текста, шаги компактные', async () => {
    const page = await newPage();
    await open(page, '#/');
    const s = await page.locator('.steps .step').first().evaluate((e) => ({ h: e.getBoundingClientRect().height, cols: getComputedStyle(e).gridTemplateColumns.split(' ').length }));
    assert.equal(s.cols, 2); assert.ok(s.h < 150, 'высота шага ' + s.h);
    await page.context().close();
  });
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
  it('только светлая тема: нет переключателя, тёмная настройка устройства и старый выбор не действуют', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    await page.context().addInitScript(() => { try { localStorage.setItem('mba.theme', 'dark'); } catch (e) { /* about:blank */ } });
    await open(page, '#/');
    assert.equal(await page.locator('#themeBtn').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    assert.ok(r > 200 && g > 200 && b > 200, 'светлый фон, а не тёмный: ' + bg);
    await page.context().close();
  });
  it('SEO: чистые адреса (/map, /a/3) открывают экран приложения; заголовок вкладки; «Поделиться» — ссылкой /a/3', async () => {
    const page = await newPage();
    await page.goto(BASE + '/map');
    await page.waitForFunction(() => location.hash === '#/map' && location.pathname === '/');
    await page.waitForSelector('.map-page');
    assert.match(await page.title(), /^Карта поиска — /);
    await page.goto(BASE + '/a/3');
    await page.waitForFunction(() => location.hash === '#/a/3');
    const t = await page.evaluate(async () => (await (await fetch('/api/applications/3', { headers: { 'X-Requested-With': 'mba' } })).json()).item.title);
    await page.waitForFunction((x) => document.title.startsWith(x), t);
    await page.locator('#share').click();
    await page.waitForSelector('.sheet a[href^="https://t.me/share"]');
    const tg = await page.locator('.sheet a[href^="https://t.me/share"]').getAttribute('href');
    assert.ok(tg.includes(encodeURIComponent(BASE + '/a/3')), 'share link uses the clean URL: ' + tg);
    assert.deepEqual(page.errors, []);
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
  it('переключатели и кнопки радиуса: область нажатия не меньше 40 px', async () => {
    for (const hash of ['#/me/settings', '#/me/zone']) {
      await open(page, hash);
      const hits = await page.evaluate(() => [...document.querySelectorAll('.switch, .range, .rchip')].filter((e) => e.getClientRects().length).map((e) => {
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
  it('компьютер: колонка разделов на всех экранах кабинета, включая «Сообщения», «Уведомления», «Поддержку»; «назад» браузера работает', async () => {
    page.errors = [];
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [hash, href] of [['#/me/zone', '#/me/zone'], ['#/chats', '#/chats'], ['#/notifications', '#/notifications'], ['#/support', '#/support'], ['#/support/1', '#/support']]) {
      await open(page, hash);
      assert.ok(await page.locator('.me-nav').isVisible(), 'колонка разделов: ' + hash);
      assert.equal(await page.locator('.me-nav [aria-current="page"]').getAttribute('href'), href, 'выделен текущий раздел: ' + hash);
      assert.equal(await page.locator('.acc-bar').isVisible().catch(() => false), false, 'на компьютере нет мобильной строки');
    }
    await open(page, '#/support');
    await page.locator('.me-nav a[href="#/me/family"]').click();
    await page.waitForFunction(() => location.hash === '#/me/family' && document.querySelector('.fam'));
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/support' && document.querySelector('.me-nav [aria-current="page"][href="#/support"]'));
    await noOverflow(page, 'кабинет 1280');
    assert.deepEqual(page.errors, []);
    await page.setViewportSize(MOBILE);
  });
  it('телефон: обзор — список всех разделов; в разделе «‹ Кабинет» возвращает в одно касание, «Разделы» — лист со всеми разделами', async () => {
    page.errors = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '#/me');
    assert.equal(await page.locator('.acc-tiles').isVisible(), false, 'плитки обзора — только на компьютере');
    assert.equal(await page.locator('.acc-rows a').count(), 12, 'все разделы строками');
    assert.equal(await page.locator('.acc-bar').count(), 0, 'на обзоре кнопка «Кабинет» не нужна');
    const rows = await page.$$eval('.acc-rows a', (as) => as.map((a) => Math.round(a.getBoundingClientRect().height)));
    assert.ok(rows.every((x) => x >= 44), 'строки разделов крупные: ' + rows.join(','));
    await page.locator('.acc-rows a[href="#/me/family"]').click();
    await page.waitForFunction(() => location.hash === '#/me/family' && document.querySelector('.acc-back'));
    await page.locator('.acc-back').click();
    await page.waitForFunction(() => location.hash === '#/me' && document.querySelector('.acc-rows'));
    for (const hash of ['#/support', '#/notifications', '#/chats', '#/me/settings']) {
      await open(page, hash);
      assert.ok(await page.locator('.acc-back').isVisible(), '«‹ Кабинет» на ' + hash);
      const b = await page.locator('.acc-back').boundingBox();
      assert.ok(b.height >= 40, 'кнопка возврата крупная');
      await noOverflow(page, 'кабинет 390 ' + hash);
    }
    await page.locator('#accAll').click();
    await page.waitForSelector('.sheet .acc-sheet');
    assert.equal(await page.locator('.sheet .acc-sheet a').count(), 13);
    await page.locator('.sheet .acc-sheet a[href="#/me/zone"]').click();
    await page.waitForFunction(() => location.hash === '#/me/zone' && !document.querySelector('.sheet .acc-sheet'));
    assert.deepEqual(page.errors, []);
    await page.setViewportSize(MOBILE);
  });
  it('зона оповещений: радиус — кнопками (без ползунка), выбор сохраняется', async () => {
    page.errors = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '#/me/zone');
    assert.equal(await page.locator('#tab input[type="range"]').count(), 0, 'ползунка нет');
    assert.deepEqual(await page.$$eval('.rchip', (b) => b.map((x) => x.textContent.trim())), ['1 км', '3 км', '5 км', '10 км', '20 км']);
    await page.locator('.rchip[data-r="10"]').click();
    assert.equal(await page.locator('.rchip[data-r="10"]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('.rchip[aria-checked="true"]').count(), 1);
    await page.locator('#zs').click();
    await page.waitForFunction(async () => (await (await fetch('/api/me', { headers: { 'X-Requested-With': 'mba' } })).json()).user.zone.radius === 10);
    await open(page, '#/me/zone');
    assert.equal(await page.locator('.rchip[data-r="10"]').getAttribute('aria-checked'), 'true', 'после перезагрузки выбран сохранённый радиус');
    await page.locator('.rchip[data-r="3"]').click(); await page.locator('#zs').click();
    await page.waitForFunction(async () => (await (await fetch('/api/me', { headers: { 'X-Requested-With': 'mba' } })).json()).user.zone.radius === 3);
    await noOverflow(page, 'зона 390');
    assert.deepEqual(page.errors, []);
    await page.setViewportSize(MOBILE);
  });
  it('семья: создание, приглашение, карточки участников ровной сеткой и не накладываются (телефон и компьютер)', async () => {
    page.errors = [];
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '#/me/family');
    await page.locator('#mk input[name="name"]').fill('Семья Смирновых');
    await page.locator('#mk button').click();
    await page.waitForSelector('.fam-grid .fam-m');
    await page.locator('#inv input[name="target"]').fill('relative@example.com');
    await page.locator('#inv button').click();
    await page.waitForSelector('.fam-pend');
    const overlaps = async () => page.evaluate(() => {
      const els = [...document.querySelectorAll('.fam-top, .fam-m, .fam-invite, .fam-foot')].map((e) => e.getBoundingClientRect());
      const bad = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push([i, j]);
      }
      return bad;
    });
    assert.deepEqual(await overlaps(), [], 'телефон: ничего не накладывается');
    await noOverflow(page, 'семья 390');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    assert.deepEqual(await overlaps(), [], 'компьютер: ничего не накладывается');
    await page.locator('#leave').click();
    await page.locator('.sheet [data-ok]').click();
    await page.waitForSelector('#mk');
    assert.deepEqual(page.errors, []);
    await page.setViewportSize(MOBILE);
  });
});

describe('Мастер заявки', () => {
  it('на телефоне: нижней панели нет, «Далее» прижата к низу экрана; у списков есть стрелка и подсказка «Выберите»', async () => {
    const page = await newPage();
    await login(page, 'anna@example.com');
    await open(page, '#/new/lost');
    assert.equal(await page.locator('.tabbar').isVisible(), false, 'нижняя панель скрыта');
    await page.locator('.pick[data-cat=people]').click();
    await page.waitForSelector('select[name=relation]');
    const next = await page.locator('#next').boundingBox();
    assert.ok(next.y + next.height > 780 - 80, '«Далее» у нижнего края: ' + JSON.stringify(next));
    const sel = page.locator('select[name=relation]');
    assert.equal(await sel.locator('option[value=""]').innerText(), 'Выберите');
    assert.match(await sel.evaluate((e) => getComputedStyle(e).backgroundImage), /svg/, 'стрелка ▾ у списка');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
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
  it('«Я потерял → Животные»: вид, порода, окрас, одежда, парк города и транспорт попадают в заявку', async () => {
    const page = await newPage();
    await login(page, 'lisa@example.com');
    await open(page, '#/new/lost');
    await page.locator('[data-cat="animals"]').click();
    await page.locator('select[name="species"]').selectOption('Собака');
    assert.ok(await page.locator('#breedList option[value="Такса"]').count(), 'подсказки пород для собак');
    await page.locator('input[name="breed"]').fill('Такса');
    await page.locator('input[name="color"]').fill('Рыжий');
    await page.locator('textarea[name="features"]').fill('белое пятно на груди');
    await page.locator('input[name="clothes"]').fill('зелёная шлейка');
    await page.locator('#next').click();
    await page.locator('#next').click(); // фото — пропустить
    await page.waitForSelector('.map-host.leaflet-container');
    const box = await page.locator('.map-host').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('input[name="city"]').fill('Екатеринбург');
    await page.locator('select[name="park_pick"]').selectOption('Харитоновский сад');
    await page.locator('select[name="transport"]').selectOption('tram');
    assert.ok(await page.locator('#routeBox').isVisible(), 'поле маршрута появилось');
    await page.locator('input[name="transport_route"]').fill('№ 15');
    await noOverflow(page, 'wizard place animals');
    await page.locator('#next').click();
    await page.locator('#next').click(); // опубликовать
    await page.waitForSelector('.success h2');
    await page.locator('.success a[href^="#/a/"]').click();
    await page.waitForSelector('dl.kv');
    assert.match(await page.locator('h1').innerText(), /Пропажа: собака, такса, рыжий/);
    const kv = await page.locator('dl.kv').first().innerText();
    for (const s of ['Такса', 'Рыжий', 'зелёная шлейка', 'Харитоновский сад', 'Трамвай, № 15']) assert.ok(kv.includes(s), `${s} — в параметрах заявки:\n${kv}`);
    assert.match(await page.locator('.d-rest').innerText(), /Особые приметы[\s\S]*белое пятно на груди/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('фото из мастера сохраняются в заявке; метка на карте видна; карта разворачивается на весь экран', async () => {
    const page = await newPage();
    await login(page, 'lisa@example.com');
    await open(page, '#/new/found');
    await page.locator('[data-cat="things"]').click();
    await page.locator('input[name="title"]').fill('Найден синий зонт');
    await page.locator('#next').click(); // тип вещи не выбран — шаг не пройти
    await page.waitForSelector('.field.has-err .tpick');
    assert.equal(await page.locator('input[name="th_color"]').count(), 0, 'уточнения появляются после выбора типа');
    await page.locator('.tpick label', { hasText: 'Аксессуары' }).click();
    await page.locator('input[name="th_color"]').fill('синий');
    assert.equal(await page.locator('input[name="title"]').inputValue(), 'Найден синий зонт', 'смена типа не стирает введённое');
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
    assert.deepEqual(item.details, { thing_type: 'accessories', color: 'синий' }, 'тип и уточнения вещи сохранились');
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
  it('заявка о пропавшем человеке: единые приметы, место с транспортом и фото места', async () => {
    const page = await newPage();
    await login(page, 'max@example.com');
    await open(page, '#/new/lost');
    await page.locator('[data-cat="people"]').click();
    assert.match(await page.locator('.wizard').innerText(), /Шаг 2 \/ 6/, 'у заявки о человеке отдельный шаг «Приметы»');
    assert.equal(await page.locator('[name=last_seen]').count(), 0, 'место — на шаге «Место», а не строкой в описании');
    await page.locator('input[name=person_name]').fill('Нина Петрова');
    await page.locator('input[name=person_age]').fill('74');
    await page.locator('select[name=relation]').selectOption('relative');
    await page.locator('#next').click();
    await page.waitForSelector('.field.has-err .ferr');
    assert.match(await page.locator('.field.has-err .ferr').innerText(), /пол/i);
    await page.locator('select[name=sex]').selectOption('female');
    await page.locator('#next').click();
    // «Приметы»: внешность, одежда, здоровье
    await page.waitForSelector('input[name=height]');
    for (const n of ['build', 'skin', 'hair_color', 'hair_length', 'eye_color', 'disability']) assert.equal(await page.locator(`select[name=${n}]`).count(), 1, n);
    await page.locator('input[name=height]').fill('158');
    await page.locator('select[name=hair_color]').selectOption('gray');
    await page.locator('input[name=clothes_top]').fill('Бордовое пальто');
    await page.locator('input[name=shoes]').fill('Чёрные сапоги');
    await page.locator('input[name=h_dementia]').check();
    await page.locator('input[name=language]').fill('Русский');
    await page.locator('#next').click();
    await page.locator('#next').click(); // фото человека — пропустить
    // «Место»: время, ориентир, транспорт, фото места
    await page.waitForSelector('.map-host.leaflet-container');
    assert.match(await page.locator('.wizard h2').innerText(), /видели последний раз/);
    const box = await page.locator('.map-host').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.pin.pick-pin').waitFor();
    assert.ok(await page.locator('#routeBox').evaluate((e) => e.classList.contains('hide')), 'маршрут скрыт, пока не выбран транспорт');
    await page.locator('select[name=transport]').selectOption('bus');
    assert.equal(await page.locator('#routeL').innerText(), 'Номер маршрута');
    await page.locator('input[name=transport_route]').fill('№ 24');
    await page.locator('input[name=landmark]').fill('Рижский вокзал');
    await page.locator('input[name=event_time]').fill('14:30');
    await page.locator('#pph input[type=file]').setInputFiles(path.join(__dirname, '..', 'public', 'assets', 'demo', 'keys.jpg'));
    await page.waitForSelector('#pph .ph-item img');
    assert.equal(await page.locator('#pph .ph-add').count(), 0, 'фото места — одно');
    await page.locator('#next').click();
    await page.locator('input[name=confirm_rights]').check();
    await page.locator('#next').click(); // отправить на проверку
    await page.waitForSelector('.success h2');
    const href = await page.locator('.success a[href^="#/a/"]').first().getAttribute('href');
    await open(page, href);
    await page.waitForSelector('#looks');
    const looks = await page.locator('#looks').innerText();
    for (const s of ['158', 'Седые', 'Бордовое пальто', 'Чёрные сапоги', 'Деменция', 'Русский']) assert.ok(looks.includes(s), s);
    const kv = await page.locator('.detail .kv:not(#looks)').innerText();
    for (const s of ['Женский', '14:30', 'Рижский вокзал', 'Автобус, № 24']) assert.ok(kv.includes(s), s);
    assert.equal(await page.locator('img.place-photo').count(), 1, 'фото места показано');
    assert.deepEqual(page.errors, []);
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
  it('на карте нет подписей (флага, названий); всё грузится с нашего сервера; источник данных — значок «©» на карте, в подвале его нет', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, '#/map');
    await page.waitForSelector('#bigmap img.leaflet-tile');
    assert.equal(await page.locator('#bigmap .leaflet-control-attribution').count(), 0, 'подписи на карте нет');
    assert.equal(await page.locator('script[src^="http"], link[rel="stylesheet"][href^="http"]').count(), 0, 'скрипты и стили — только со своего сервера');
    await open(page, '#/');
    assert.doesNotMatch(await page.locator('#foot').innerText(), /OpenStreetMap/, 'в подвале строки об OpenStreetMap нет');
    await open(page, '#/map');
    await page.waitForSelector('#bigmap .osm-attr');
    assert.equal(await page.locator('#bigmap .osm-attr a').isVisible(), false, 'на карте только значок «©»');
    await page.locator('#bigmap .osm-i').click();
    assert.equal(await page.locator('#bigmap .osm-attr a').getAttribute('href'), 'https://www.openstreetmap.org/copyright');
    assert.ok(await page.locator('#bigmap .osm-attr a').isVisible(), 'по нажатию — подпись источника');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});

describe('Доступность (axe-core: serious/critical)', { skip: !fs.existsSync(AXE_SRC) && 'axe-core не найден' }, () => {
  it('публичные страницы', async () => {
    const page = await newPage({ bypassCSP: true }); // CSP запрещает inline-скрипты, а axe внедряется именно так
    for (const hash of ['#/', '#/map', '#/a/3', '#/a/1', '#/registry', '#/tariffs', '#/community', '#/login', '#/legal', '#/legal/terms']) {
      await open(page, hash);
      await axeCheck(page, hash);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('личный кабинет и чат (Анна), английский', async () => {
    const page = await newPage({ locale: 'en-US', bypassCSP: true });
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
    for (const sec of ['', 'moderation', 'emergency', 'complaints', 'applications', 'users', 'roles', 'support', 'deletion', 'leads', 'payments', 'tariffs', 'dicts', 'translations', 'stories', 'ads', 'system', 'outbox', 'audit']) {
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
    assert.equal(await links.count(), 19, 'all sections in the sheet');
    assert.equal(await page.locator('.admin-sheet a[aria-current="page"] .grow').innerText(), 'Модерация');
    assert.equal(await page.locator('.admin-sheet a .ic').count(), 19, 'icons');
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

describe('Навигация и права доступа', () => {
  it('телефоны экстренных служб: на главной одной строкой, в подвале и в окне «Новая заявка»; баннера «Экстренный поиск» нет', async () => {
    const TELS = ['tel:112', 'tel:102', 'tel:103', 'tel:101', 'tel:88007005452'];
    for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await newPage({ viewport: vp });
      await open(page, '#/');
      assert.equal(await page.locator('.em-strip').count(), 0, 'баннера «Экстренный поиск» нет');
      const ph = page.locator('.hero-blk .sos-phones a.sos-ph');
      assert.deepEqual(await ph.evaluateAll((as) => as.map((a) => a.getAttribute('href'))), TELS);
      const tops = await ph.evaluateAll((as) => [...new Set(as.map((a) => Math.round(a.getBoundingClientRect().top)))]);
      assert.equal(tops.length, 1, 'номера в одну строку, места почти не занимают');
      assert.ok(await page.locator('.hero-blk .sos-phones').evaluate((e) => e.getBoundingClientRect().height) <= 48);
      assert.deepEqual(await page.locator('#foot .sos-phones a.sos-ph').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), TELS);
      await noOverflow(page, 'главная ' + vp.width);
      await page.locator(vp.width > 900 ? '#topNew' : '#fab').click();
      await page.waitForSelector('.sheet .sos-phones');
      assert.equal(await page.locator('.sheet .sos-phones a.sos-ph').count(), 5);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  });
  it('пустой блок «Пока нет заявок»: крупный серый значок только у самого блока, у «+» и «✓» в кнопках — обычный размер и цвет кнопки', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    await open(page, '#/');
    const r = await page.evaluate(() => {
      const box = document.createElement('div'); box.className = 'empty';
      box.innerHTML = '<svg class="ic"></svg><b>Пусто</b><div><a class="btn btn-lost" href="#"><svg class="ic ic-sm"></svg>Сообщить о пропаже</a></div>';
      document.querySelector('#view').appendChild(box);
      const [big, small] = box.querySelectorAll('svg'); const btn = box.querySelector('.btn');
      const out = { big: big.getBoundingClientRect().width, small: small.getBoundingClientRect().width, smallColor: getComputedStyle(small).color, btnColor: getComputedStyle(btn).color };
      box.remove(); return out;
    });
    assert.equal(r.big, 42);
    assert.ok(r.small <= 20, 'значок в кнопке ' + r.small + ' px');
    assert.equal(r.smallColor, r.btnColor, 'значок в кнопке — цвета текста кнопки');
    await page.context().close();
  });
  it('рекламная строка: бегущая, на всю ширину сразу под шапкой, над «Поиск пропавших…»; рекламные ссылки; повторы вне Tab', async () => {
    for (const vp of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
      const page = await newPage({ viewport: vp, touch: vp.width < 600 });
      await open(page, '#/');
      const line = page.locator('#adLine');
      const box = await line.boundingBox(), hero = await page.locator('.hero-blk').boundingBox(), top = await page.locator('#top').boundingBox();
      assert.ok(box.height <= 44, 'тонкая: ' + box.height);
      assert.ok(Math.abs(box.y - (top.y + top.height)) <= 1 && box.y + box.height <= hero.y, 'сразу под шапкой, над «Поиск пропавших…»');
      assert.ok(Math.abs(box.width - vp.width) <= 1, 'на всю ширину: ' + box.width);
      assert.equal(await page.locator('#adLine .ad-tag').innerText(), 'Реклама');
      const first = page.locator('#adLine .ad-run:not(.copy) .ad-item').first();
      assert.equal(await first.locator('b').innerText(), 'kadryzdes.ru');
      assert.equal(await first.getAttribute('target'), '_blank');
      assert.match(await first.getAttribute('rel'), /sponsored/);
      assert.match(await first.getAttribute('href'), /^https:\/\/kadryzdes\.ru\//);
      // в Tab — каждое объявление один раз, повторы для бегущей строки скрыты
      assert.equal(await page.locator('#adLine .ad-item:not([tabindex="-1"])').count(), 3);
      assert.ok(await page.locator('#adLine .ad-run.copy[aria-hidden="true"]').count() === 1, 'копия для бесшовного круга');
      // строка едет справа налево
      await page.waitForSelector('#adLine.go');
      const x0 = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#adLine .ad-track')).transform).m41);
      await page.waitForTimeout(700);
      const x1 = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#adLine .ad-track')).transform).m41);
      assert.ok(x1 < x0 - 5, `строка движется: ${x0} → ${x1}`);
      await noOverflow(page, 'рекламная строка ' + vp.width);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  });
  it('выпадающие списки: на телефоне — лист с крупными строками и галочкой, на компьютере — меню под полем; выбор меняет значение', async () => {
    // телефон: касание по сортировке → свой лист, системный список не нужен
    let page = await newPage({ viewport: { width: 390, height: 844 }, touch: true });
    await open(page, '#/map');
    await page.locator('.map-seg [data-v="list"]').tap();
    await page.locator('.sort-sel').tap();
    await page.waitForSelector('.sheet .opt-list');
    assert.equal(await page.locator('.sheet .opt.on').count(), 1, 'текущий вариант отмечен');
    const h = await page.locator('.sheet .opt').first().evaluate((b) => b.getBoundingClientRect().height);
    assert.ok(h >= 48, 'строка списка удобна для пальца: ' + h);
    const pick = page.locator('.sheet .opt:not(.on)').first(), txt = (await pick.innerText()).trim();
    await pick.tap();
    await page.waitForFunction(() => !document.querySelector('.sheet .opt-list'));
    assert.equal(await page.locator('select[data-sort]').evaluate((s) => s.options[s.selectedIndex].text.trim()), txt);
    assert.deepEqual(page.errors, []);
    await page.context().close();
    // компьютер: клик → меню под полем; стрелка вниз + Enter выбирают; Esc закрывает
    page = await newPage({ viewport: { width: 1366, height: 860 } });
    await open(page, '#/map');
    await page.locator('.sort-sel').click();
    await page.waitForSelector('.sel-pop');
    const sel = await page.locator('.sort-sel').boundingBox(), pop = await page.locator('.sel-pop').boundingBox();
    assert.ok(pop.y >= sel.y + sel.height && pop.y - (sel.y + sel.height) < 12, 'меню сразу под полем');
    const before = await page.locator('select[data-sort]').inputValue();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.sel-pop'));
    assert.notEqual(await page.locator('select[data-sort]').inputValue(), before, 'выбрано следующее');
    await page.locator('.sort-sel').click(); await page.waitForSelector('.sel-pop');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sel-pop'));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('телефон: «Карта / Список» — две равные половины без наложения; шапка всегда наверху; нижнее меню у нижнего края', async () => {
    const page = await newPage({ viewport: { width: 360, height: 740 }, touch: true });
    await open(page, '#/map');
    const m = await page.evaluate(() => {
      const s = document.querySelector('.map-seg'), r = s.getBoundingClientRect(), bs = [...s.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return { left: r.left, right: innerWidth - r.right, w: bs.map((b) => Math.round(b.width)), gap: bs[1].left - bs[0].right, pill: parseFloat(getComputedStyle(s, '::before').width) };
    });
    assert.ok(Math.abs(m.left - m.right) <= 1, 'по центру');
    assert.equal(m.w[0], m.w[1], 'кнопки одинаковой ширины');
    assert.ok(m.gap >= -0.5, 'кнопки не налезают друг на друга');
    assert.ok(Math.abs(m.pill - m.w[0]) <= 1.5, 'подложка ровно под кнопкой');
    await open(page, '#/');
    await page.evaluate(() => scrollTo(0, 1200)); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => Math.round(document.getElementById('top').getBoundingClientRect().top)), 0, 'шапка на месте при прокрутке');
    assert.equal(await page.evaluate(() => Math.round(document.getElementById('tabbar').getBoundingClientRect().bottom)), 740, 'нижнее меню у края экрана');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('кнопка SOS в шапке на любой ширине открывает окно служб: звонок в одно касание, «Разместить заявку» ведёт в мастер', async () => {
    for (const vp of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
      const page = await newPage({ viewport: vp });
      await open(page, '#/');
      const btn = page.locator('#sosBtn');
      assert.ok(await btn.isVisible(), 'SOS видна на ' + vp.width);
      const top = await btn.evaluate((b) => b.getBoundingClientRect().top);
      assert.ok(top < 80, 'SOS в шапке');
      await noOverflow(page, 'шапка с SOS ' + vp.width);
      const look = await btn.evaluate((b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, color: c.color, anim: c.animationName }; });
      assert.equal(look.color, 'rgb(255, 255, 255)', 'надпись SOS белая');
      assert.match(look.bg, /^rgb\((\d+), (\d+), (\d+)\)$/); const [r, g] = look.bg.match(/\d+/g).map(Number); assert.ok(r > 150 && g < 80, 'SOS залита красным: ' + look.bg);
      assert.equal(look.anim, 'sosBeacon', 'SOS мигает');
      assert.ok(await page.locator('#langBtn .ic').isVisible(), 'у языка значок глобуса');
      const brand = await page.locator('.top .brand').first().evaluate((a) => {
        const img = a.querySelector('img').getBoundingClientRect(), n = a.querySelector('.brand-name'), cs = getComputedStyle(n);
        const r = document.createRange(); r.selectNodeContents(n.firstChild); // только текст названия, без подписи
        return { logoH: img.height, nameLines: r.getClientRects().length, nameH: r.getBoundingClientRect().height, fs: parseFloat(cs.fontSize), sub: n.querySelector('small')?.checkVisibility() };
      });
      assert.ok(brand.logoH >= 44 && brand.logoH > brand.nameH, 'логотип крупный, крупнее названия: ' + JSON.stringify(brand));
      if (vp.width < 600) {
        assert.equal(brand.nameLines, 3, 'на телефоне название ровно в три строки: ' + JSON.stringify(brand));
        assert.ok(brand.fs >= 14 && brand.fs <= 15.5, 'на телефоне название чуть крупнее, но в три строки: ' + brand.fs);
        assert.ok(!brand.sub, 'на телефоне подписи нет');
      } else assert.equal(brand.nameLines, 1, 'на компьютере название в одну строку, как было: ' + JSON.stringify(brand));
      await btn.click();
      await page.waitForSelector('.sheet .svc-list');
      assert.deepEqual(await page.locator('.sheet a.svc[href^="tel:"]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))),
        ['tel:112', 'tel:102', 'tel:103', 'tel:101', 'tel:88007005452']);
      assert.equal(await page.locator('.sheet .svc-main').getAttribute('href'), 'tel:112');
      await page.locator('.sheet a.svc[href="#/new/lost"]').click();
      await page.waitForFunction(() => !document.querySelector('.sheet .svc-list'));
      assert.match(await page.evaluate(() => decodeURIComponent(location.hash)), /#\/new\/lost/, 'гость — на вход с возвратом в мастер');
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  });
  it('нижняя панель: значок текущего раздела выделен «таблеткой» и увеличен', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    await open(page, '#/map');
    const st = await page.locator('#tabbar .tab.on .tab-ic').evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, tf: c.transform }; });
    assert.notEqual(st.bg, 'rgba(0, 0, 0, 0)', 'фон-«таблетка» у текущего раздела');
    assert.match(st.tf, /^matrix\(1\.1/, 'значок увеличен: ' + st.tf);
    assert.equal(await page.locator('#tabbar .tab:not(.on) .tab-ic').first().evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('документы: разделы свёрнуты под плюсиками, раскрываются по нажатию, «Развернуть все» и оглавление открывают текст', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    await open(page, '#/legal/terms');
    const secs = page.locator('details.legal-sec');
    const n = await secs.count();
    assert.ok(n > 3, 'разделов ' + n);
    assert.equal(await page.locator('details.legal-sec[open]').count(), 0, 'сначала всё свёрнуто');
    assert.equal(await page.locator('.legal-hn').first().evaluate((e) => e.getBoundingClientRect().height < 32), true, 'номер раздела не переносится');
    await secs.nth(1).locator('summary').click();
    assert.equal(await secs.nth(1).evaluate((d) => d.open), true);
    await secs.nth(1).locator('.legal-sec-body > *').first().waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('[data-fold-all]').click();
    assert.equal(await page.locator('details.legal-sec[open]').count(), n, 'развёрнуто всё');
    assert.equal(await page.locator('[data-fold-all]').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-fold-all]').click();
    assert.equal(await page.locator('details.legal-sec[open]').count(), 0, 'свёрнуто всё');
    await page.locator('.legal-toc summary').click();
    const go = page.locator('.legal-toc [data-go]').nth(2);
    const id = 'lg-' + await go.getAttribute('data-go');
    await go.click();
    assert.equal(await page.locator('#' + id).evaluate((d) => d.open), true, 'оглавление раскрывает раздел');
    await noOverflow(page, 'документ');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('быстрый уход с карты (во время анимации и загрузки меток) не даёт ошибок', async () => {
    const page = await newPage({ viewport: { width: 1366, height: 860 } });
    await open(page, '#/');
    for (const wait of [0, 60, 150, 300, 450, 600]) {
      await page.goto(BASE + '/#/map');
      await page.waitForTimeout(wait);
      await page.goto(BASE + '/#/registry');
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(800);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('подвал на планшетной ширине (760–860 px): длинные названия документов не вылезают за экран', async () => {
    for (const width of [760, 800, 840, 860]) {
      const page = await newPage({ viewport: { width, height: 800 } });
      await open(page, '#/registry');
      await page.waitForSelector('#foot .footer-grid');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'нет сдвига вбок на ' + width);
      await noOverflow(page, 'подвал ' + width);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  });
  it('«Рейтинг» в подвале ведёт к рейтингу волонтёров; адрес со слешем на конце открывается', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, '#/');
    await page.locator('#foot a', { hasText: 'Рейтинг' }).click();
    await page.waitForSelector('#rating');
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => document.getElementById('rating').getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 200, 'блок рейтинга на экране, top=' + top);
    await login(page, 'admin@mba.local');
    await open(page, '#/admin/');
    assert.equal(await page.locator('.admin-nav a.on').innerText(), 'Статистика');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('нет прав — понятная страница «Нет доступа», а не ошибка или молчаливый переход', async () => {
    const page = await newPage();
    await login(page, 'moderator@mba.local');
    for (const sec of ['tariffs', 'translations', 'system', 'outbox']) {
      await open(page, '#/admin/' + sec);
      assert.match(await page.locator('#view').innerText(), /Нет доступа к этому разделу/, sec);
      assert.equal(await page.locator('#view a[href="#/admin"]').count(), 1, 'кнопка «В админ-панель»');
    }
    await login(page, 'anna@example.com');
    await open(page, '#/admin');
    assert.match(await page.locator('#view').innerText(), /модераторам и администраторам/);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
  it('разделы кабинета: у каждого своя иконка, все иконки существуют', async () => {
    const page = await newPage({ viewport: { width: 1280, height: 800 } });
    await login(page, 'anna@example.com');
    await open(page, '#/me');
    const icons = await page.$$eval('.me-nav nav a svg', (l) => l.map((s) => s.innerHTML));
    assert.equal(icons.length, 13, 'все разделы кабинета, включая «Сообщения», «Уведомления», «Поддержку»');
    assert.equal(new Set(icons).size, icons.length, 'иконки разделов не повторяются');
    const home = await page.$eval('#tabbar a[href="#/"] svg', (s) => s.innerHTML).catch(() => '');
    assert.ok(!icons.includes(home), '«Обзор» не совпадает с «Главной»');
    for (const tab of ['apps', 'saved', 'profile', 'zone', 'family', 'registry', 'payments', 'rewards', 'settings']) await open(page, '#/me/' + tab);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
});
