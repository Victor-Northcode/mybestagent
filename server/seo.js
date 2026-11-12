'use strict';
// SEO: заголовки, описания, канонические адреса, Open Graph / Twitter, JSON-LD, robots.txt и sitemap.xml.
// Приложение работает на адресах с # (/#/map), а поисковики и мессенджеры видят только путь (/map).
// Поэтому у ключевых разделов и у каждой заявки есть «чистый» адрес: сервер отдаёт ту же страницу приложения
// с подходящими мета-тегами, а клиент сам переходит на /#/… (см. app.js, boot).

const BRAND = 'Мой лучший агент';
const BRAND_EN = 'My Best Agent';
const OG_IMAGE = { path: '/assets/og-image.jpg', width: 1200, height: 630, alt: `${BRAND} — поиск пропавших людей, животных и вещей` };

// Разделы, которые стоит индексировать. Остальные адреса приложения (кабинет, чаты, вход) — noindex.
const PAGES = {
  '/': {
    title: `${BRAND} — поиск пропавших людей, животных и вещей`,
    description: 'Потеряли или нашли человека, питомца или вещь? Заявка за 2 минуты: карта, автоподбор совпадений, оповещения волонтёров рядом, анонимный чат и телефоны экстренных служб под рукой.',
    priority: '1.0', changefreq: 'hourly'
  },
  '/map': {
    title: `Карта поиска: пропавшие и найденные рядом — ${BRAND}`,
    description: 'Заявки о пропавших и найденных людях, животных и вещах на карте. Фильтры по категории, дате и расстоянию, экстренные поиски рядом с вами.',
    crumb: 'Карта поиска', priority: '0.9', changefreq: 'hourly'
  },
  '/registry': {
    title: `Реестр ценностей: проверить, не краденая ли вещь — ${BRAND}`,
    description: 'Зарегистрируйте ценные вещи и антиквариат заранее. Перед покупкой проверьте по серийному номеру или названию, не числится ли вещь украденной.',
    crumb: 'Реестр ценностей', priority: '0.7', changefreq: 'daily'
  },
  '/community': {
    title: `Волонтёры и партнёры поиска — ${BRAND}`,
    description: 'Станьте волонтёром или партнёром: оповещения об экстренных поисках в вашем районе, рейтинг помощников, поисково-спасательные отряды и организации.',
    crumb: 'Волонтёры и партнёры', priority: '0.7', changefreq: 'daily'
  },
  '/tariffs': {
    title: `Тарифы — ${BRAND}`,
    description: 'Тарифы платформы: поднятие заявки в топ, расширенные оповещения и возможности для организаций.',
    crumb: 'Тарифы', priority: '0.5', changefreq: 'weekly'
  },
  '/legal': {
    title: `Документы и согласия — ${BRAND}`,
    description: 'Пользовательское соглашение, политика конфиденциальности и согласия на обработку персональных данных платформы.',
    crumb: 'Документы', priority: '0.3', changefreq: 'monthly'
  }
};
// Адреса приложения, которые есть, но в поиске не нужны (личное, служебное)
const PRIVATE = /^\/(new\/(lost|found)|edit\/\d+|chats?(\/\d+)?|notifications|me(\/[\w-]+)?|pay\/\d+|support(\/\d+)?|login|admin(\/[\w/-]+)?|404)$/;

const KIND = { lost: 'Потеряно', found: 'Найдено' };
const KIND_PEOPLE = { lost: 'Пропал человек', found: 'Найден человек' };
const CAT = { people: 'Люди', animals: 'Животные', things: 'Вещи' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/[\s,.;:—-]+\S*$/, '') + '…' : t; };
// Кусок текста → аккуратное предложение: с заглавной буквы и ровно одной точкой в конце
const sentence = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim().replace(/[.!?…;,\s]+$/, ''); return t ? t[0].toUpperCase() + t.slice(1) + '.' : ''; };
const ruDate = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
// JSON внутри <script>: «</script>» и комментарии HTML не должны закрыть тег
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function graphBase(site) {
  return [
    { '@type': 'Organization', '@id': `${site}/#org`, name: BRAND, alternateName: BRAND_EN, url: `${site}/`,
      logo: { '@type': 'ImageObject', url: `${site}/assets/logo.png`, width: 512, height: 416 },
      description: 'Платформа поиска и возврата пропавших людей, животных и вещей.' },
    { '@type': 'WebSite', '@id': `${site}/#website`, url: `${site}/`, name: BRAND, alternateName: BRAND_EN, inLanguage: ['ru-RU', 'en'],
      publisher: { '@id': `${site}/#org` },
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${site}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } }
  ];
}

// Мета-данные страницы → готовый блок тегов для <head>
function headTags(m, o) {
  const site = o.site;
  const url = site ? site + (m.path === '/' ? '/' : m.path) : '';
  const img = m.image ? m.image : { ...OG_IMAGE, url: site + OG_IMAGE.path };
  const robots = o.noindex || m.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
  const t = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<meta name="robots" content="${robots}">`
  ];
  if (o.yandex) t.push(`<meta name="yandex-verification" content="${esc(o.yandex)}">`);
  if (o.google) t.push(`<meta name="google-site-verification" content="${esc(o.google)}">`);
  if (url && !(o.noindex || m.noindex)) t.push(`<link rel="canonical" href="${esc(url)}">`);
  t.push(
    `<meta property="og:type" content="${m.ogType || 'website'}">`,
    `<meta property="og:locale" content="ru_RU">`,
    `<meta property="og:locale:alternate" content="en_US">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:title" content="${esc(m.ogTitle || m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`
  );
  if (url) t.push(`<meta property="og:url" content="${esc(url)}">`);
  if (img.url) {
    t.push(`<meta property="og:image" content="${esc(img.url)}">`);
    if (img.width) t.push(`<meta property="og:image:width" content="${img.width}">`, `<meta property="og:image:height" content="${img.height}">`);
    t.push(`<meta property="og:image:alt" content="${esc(img.alt || m.title)}">`);
  }
  t.push(
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.ogTitle || m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`
  );
  if (img.url) t.push(`<meta name="twitter:image" content="${esc(img.url)}">`);
  // разметка есть и на закрытом стенде (её можно проверить валидатором); у 404, личных и скрытых страниц — нет
  if (site && !m.noindex) {
    const page = { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: m.title, description: m.description, inLanguage: 'ru-RU',
      isPartOf: { '@id': `${site}/#website` }, about: { '@id': `${site}/#org` } };
    if (img.url) page.primaryImageOfPage = { '@type': 'ImageObject', url: img.url };
    const graph = [...graphBase(site), page];
    if (m.crumbs && m.crumbs.length) {
      graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Главная', url: `${site}/` }, ...m.crumbs]
        .map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) });
    }
    t.push(`<script type="application/ld+json">${ldJson({ '@context': 'https://schema.org', '@graph': graph })}</script>`);
  }
  return t.join('\n');
}

// Вставляет теги в index.html вместо блока <!--seo-->…<!--/seo-->
function render(html, m, o) {
  return html.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n${headTags(m, o)}\n<!--/seo-->`);
}

function sectionMeta(p) {
  const m = PAGES[p];
  return m && { ...m, path: p, crumbs: m.crumb ? [{ name: m.crumb, url: null }] : [] };
}
function legalMeta(id, doc, site) {
  return { path: `/legal/${id}`, title: `${doc.title} — ${BRAND}`, description: clip(doc.intro || doc.lead || doc.title, 200),
    crumbs: [{ name: 'Документы', url: site ? `${site}/legal` : null }, { name: doc.title, url: null }] };
}

// Заявка → мета-данные. Берём только публичное представление (то же, что видит гость): у найденных людей ПД скрыты.
function appMeta(d, site) {
  const kind = d.category === 'people' ? KIND_PEOPLE[d.kind] : KIND[d.kind];
  const place = d.city || d.address || '';
  const when = ruDate(d.event_date);
  const facts = [kind, d.category !== 'people' ? CAT[d.category] : '', place, when].filter(Boolean).join(' · ');
  const text = clip([d.description, d.features].map(sentence).filter(Boolean).join(' '), 160);
  const reward = d.reward ? ` Вознаграждение: ${Number(d.reward).toLocaleString('ru-RU')} ₽.` : '';
  const photo = d.photos && d.photos[0];
  const crumbs = [{ name: 'Карта поиска', url: site ? `${site}/map` : null }, { name: d.title, url: null }];
  return {
    path: `/a/${d.id}`,
    title: `${clip(d.title, 70)} — ${kind}${place ? ', ' + clip(place, 40) : ''} — ${BRAND}`,
    ogTitle: `${d.emergency ? 'Срочно! ' : ''}${clip(d.title, 90)}`,
    description: clip(`${facts}. ${text ? text + ' ' : ''}${reward ? reward.trim() + ' ' : ''}Если видели или знаете что-то — напишите в анонимный чат.`, 300),
    ogType: 'article',
    image: photo && site ? { url: /^https?:/.test(photo) ? photo : site + photo, alt: d.title } : null,
    // в поиске — только активные заявки; найденные и закрытые остаются доступны по ссылке, но не индексируются
    noindex: d.status !== 'published',
    crumbs
  };
}

function notFoundMeta(p) {
  return { path: p, title: `Страница не найдена — ${BRAND}`, description: PAGES['/'].description, noindex: true };
}
function privateMeta(p) {
  return { path: p, title: PAGES['/'].title, description: PAGES['/'].description, noindex: true };
}

function robots(site, closed) {
  if (closed) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /uploads/', 'Disallow: /search', '', site ? `Sitemap: ${site}/sitemap.xml` : ''].join('\n').trim() + '\n';
}

function sitemap(site, apps, legalIds) {
  const day = (s) => String(s || '').slice(0, 10);
  const urls = [
    ...Object.entries(PAGES).map(([p, m]) => ({ loc: site + (p === '/' ? '/' : p), changefreq: m.changefreq, priority: m.priority })),
    ...legalIds.map((id) => ({ loc: `${site}/legal/${id}`, changefreq: 'monthly', priority: '0.2' })),
    ...apps.map((a) => ({ loc: `${site}/a/${a.id}`, lastmod: day(a.updated_at), changefreq: 'daily', priority: a.emergency_status === 'active' ? '0.9' : '0.6' }))
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
}

module.exports = { PAGES, PRIVATE, render, sectionMeta, legalMeta, appMeta, notFoundMeta, privateMeta, robots, sitemap, esc };
