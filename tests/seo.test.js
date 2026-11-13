'use strict';
// SEO: мета-теги, Open Graph, JSON-LD, robots.txt, sitemap.xml, «чистые» адреса разделов и заявок.
// Сервер в рабочем режиме с демо-данными (SEED_DEMO=1) и второй — с закрытой индексацией (NOINDEX=1).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const SEO = require('../server/seo');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://mybestagent.test';
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

async function startServer(extra) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-seo-'));
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'production', BASE_URL: SITE, SEED_DEMO: '1' }, extra);
  for (const k of ['SMTP_URL', 'SMSRU_API_ID', 'YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY', 'DEV_OTP', 'NOINDEX', 'YANDEX_VERIFICATION', 'GOOGLE_SITE_VERIFICATION']) if (!(k in extra)) delete env[k];
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/config')).ok) return { proc, base, dataDir }; } catch (e) { /* стартует */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start\n' + log);
}
const page = async (s, p) => { const r = await fetch(s.base + p, { redirect: 'manual' }); return { status: r.status, headers: r.headers, html: await r.text() }; };
const meta = (html, attr, name) => { const m = html.match(new RegExp(`<meta ${attr}="${name.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`)); return m ? m[1] : null; };
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const canonical = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
const ld = (html) => { const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]) : null; };
const types = (j) => j['@graph'].map((x) => x['@type']);

let S = null, C = null, apps = null;
before(async () => {
  S = await startServer({ YANDEX_VERIFICATION: 'ya-code-123', GOOGLE_SITE_VERIFICATION: 'g-code-456' });
  C = await startServer({ NOINDEX: '1' });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(S.dataDir, 'app.db'), { readOnly: true });
  apps = db.prepare('SELECT id, status, category, kind, title, person_name, photos FROM applications ORDER BY id').all();
  db.close();
});
after(() => { for (const s of [S, C]) if (s) s.proc.kill(); });

describe('SEO: главная и разделы', () => {
  it('главная: заголовок, описание, robots, canonical, превью, Twitter, подтверждение Яндекса и Google', async () => {
    const { status, html } = await page(S, '/');
    assert.equal(status, 200);
    assert.match(title(html), /^Мой лучший агент — поиск пропавших людей, животных и вещей$/);
    const d = meta(html, 'name', 'description');
    assert.ok(d.length >= 120 && d.length <= 200, 'description 120–200 chars: ' + d.length);
    assert.match(meta(html, 'name', 'robots'), /^index, follow/);
    assert.equal(canonical(html), SITE + '/');
    assert.equal(meta(html, 'property', 'og:url'), SITE + '/');
    assert.equal(meta(html, 'property', 'og:image'), SITE + '/assets/og-image.jpg');
    assert.equal(meta(html, 'property', 'og:image:width'), '1200');
    assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'name', 'yandex-verification'), 'ya-code-123');
    assert.equal(meta(html, 'name', 'google-site-verification'), 'g-code-456');
    assert.equal((html.match(/<title>/g) || []).length, 1, 'exactly one <title>');
    assert.equal((html.match(/name="description"/g) || []).length, 1, 'exactly one description');
    const img = await fetch(S.base + '/assets/og-image.jpg');
    assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image\/jpeg/);
  });
  it('JSON-LD: организация, сайт с поиском, страница', async () => {
    const j = ld((await page(S, '/')).html);
    assert.deepEqual(types(j), ['Organization', 'WebSite', 'WebPage']);
    const site = j['@graph'][1];
    assert.equal(site.potentialAction['@type'], 'SearchAction');
    assert.equal(site.potentialAction.target.urlTemplate, SITE + '/search?q={search_term_string}');
  });
  it('у каждого раздела — свой заголовок, описание, canonical и хлебные крошки', async () => {
    const seen = new Set();
    for (const [p, re] of [['/map', /^Карта поиска/], ['/registry', /^Реестр ценностей/], ['/community', /^Волонтёры и партнёры/], ['/tariffs', /^Тарифы/], ['/legal', /^Документы/], ['/legal/terms', /^Пользовательское соглашение/], ['/legal/privacy', /^Политика конфиденциальности/]]) {
      const { status, html } = await page(S, p);
      assert.equal(status, 200, p);
      assert.match(title(html), re, p);
      assert.equal(canonical(html), SITE + p, p);
      const d = meta(html, 'name', 'description'); assert.ok(d && !seen.has(d), p + ': unique description'); seen.add(d);
      assert.ok(types(ld(html)).includes('BreadcrumbList'), p + ': breadcrumbs');
    }
    assert.equal((await page(S, '/map/')).status, 200, 'trailing slash');
  });
  it('личные разделы — noindex; несуществующие адреса — 404 и noindex; поиск ведёт на карту', async () => {
    for (const p of ['/me', '/me/apps', '/chats', '/login', '/new/lost', '/admin/support/3']) {
      const { status, html } = await page(S, p);
      assert.equal(status, 200, p); assert.match(meta(html, 'name', 'robots'), /^noindex/, p); assert.equal(canonical(html), undefined, p);
    }
    const nf = await page(S, '/no-such-page');
    assert.equal(nf.status, 404); assert.match(meta(nf.html, 'name', 'robots'), /^noindex/); assert.match(nf.html, /id="view"/, 'SPA still loads');
    const s = await page(S, '/search?q=' + encodeURIComponent('рыжий кот'));
    assert.equal(s.status, 302); assert.equal(s.headers.get('location'), '/#/map?q=' + encodeURIComponent('рыжий кот'));
  });
});

describe('SEO: страницы заявок', () => {
  it('активная заявка: свой заголовок, описание, превью статьи, canonical, индексация', async () => {
    const a = apps.find((x) => x.status === 'published' && x.category === 'animals' && JSON.parse(x.photos).length);
    assert.ok(a, 'seed has a published animal with a photo');
    const { status, html } = await page(S, '/a/' + a.id);
    assert.equal(status, 200);
    assert.ok(title(html).startsWith(a.title.slice(0, 40)), 'title starts with the report title');
    assert.match(title(html), /— Мой лучший агент$/);
    assert.equal(meta(html, 'property', 'og:type'), 'article');
    assert.equal(canonical(html), `${SITE}/a/${a.id}`);
    assert.equal(meta(html, 'property', 'og:image'), SITE + JSON.parse(a.photos)[0]);
    assert.match(meta(html, 'name', 'robots'), /^index/);
    assert.match(meta(html, 'name', 'description'), /анонимный чат/);
    const j = ld(html); assert.ok(types(j).includes('BreadcrumbList'));
  });
  it('заявка на проверке — 404 без персональных данных; неизвестный номер — 404', async () => {
    const p = apps.find((x) => x.status === 'pending' && x.category === 'people' && x.person_name);
    assert.ok(p, 'seed has a pending person report');
    const r = await page(S, '/a/' + p.id);
    assert.equal(r.status, 404); assert.match(meta(r.html, 'name', 'robots'), /^noindex/);
    assert.ok(!r.html.includes(p.person_name) && !r.html.includes(p.title), 'no personal data leaks');
    assert.equal((await page(S, '/a/999999')).status, 404);
  });
  it('sitemap.xml: главная, разделы, документы и только активные заявки; robots.txt ссылается на него', async () => {
    const r = await fetch(S.base + '/sitemap.xml'); const xml = await r.text();
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /xml/);
    for (const p of ['/', '/map', '/registry', '/community', '/tariffs', '/legal', '/legal/terms', '/legal/publication']) assert.ok(xml.includes(`<loc>${SITE}${p}</loc>`), p);
    for (const a of apps) assert.equal(xml.includes(`<loc>${SITE}/a/${a.id}</loc>`), a.status === 'published', `/a/${a.id} (${a.status})`);
    const robots = await (await fetch(S.base + '/robots.txt')).text();
    assert.match(robots, /Allow: \//); assert.match(robots, /Disallow: \/api\//); assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
  });
  it('/favicon.ico отдаёт значок сайта (его запрашивают браузеры и Яндекс)', async () => {
    const r = await fetch(S.base + '/favicon.ico');
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /image\/png/);
    assert.ok((await r.arrayBuffer()).byteLength > 100);
  });
});

describe('SEO: закрытый стенд (NOINDEX=1)', () => {
  it('robots.txt закрывает сайт, страницы — noindex без canonical, sitemap не отдаётся; превью и разметка на месте', async () => {
    assert.match(await (await fetch(C.base + '/robots.txt')).text(), /Disallow: \/\n/);
    const { html } = await page(C, '/');
    assert.match(meta(html, 'name', 'robots'), /^noindex/); assert.equal(canonical(html), undefined);
    assert.ok(types(ld(html)).includes('WebSite'), 'structured data stays for validators');
    assert.equal(meta(html, 'property', 'og:image'), SITE + '/assets/og-image.jpg', 'previews in messengers still work');
    assert.equal((await fetch(C.base + '/sitemap.xml')).status, 404);
  });
});

describe('SEO: экранирование пользовательского текста', () => {
  it('заголовок заявки с HTML и </script> не ломает разметку', () => {
    const evil = 'Кот "Барсик" </script><script>alert(1)</script> & <b>';
    const html = SEO.render('<head><!--seo--><!--/seo--></head>', SEO.appMeta({ id: 7, kind: 'lost', category: 'animals', status: 'published', title: evil, description: evil, features: '', city: 'Москва', photos: [] }, SITE), { site: SITE });
    assert.ok(!html.includes('<script>alert'), 'no raw script');
    assert.ok(!/<\/script><script>/.test(html), 'JSON-LD not broken out');
    assert.match(html, /&quot;Барсик&quot;/);
    const j = ld(html); assert.ok(j['@graph'].some((x) => x.name && x.name.includes('</script>')), 'JSON-LD keeps the text, escaped');
  });
});
