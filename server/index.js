'use strict';
// «Мой лучший агент» — серверная часть и API (первая очередь).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const ExcelJS = require('exceljs');
const { db, all, get, run, tx, close: closeDb, lockDown, hashToken, hashCode, sameHash, DATA_DIR } = require('./db');
const { seed } = require('./seed');
const S = require('./services');
const I18N = require('./i18n');
const YK = require('./yookassa');

if (seed()) for (const a of all("SELECT * FROM applications WHERE status = 'published' ORDER BY id")) S.runMatching(a);

const PORT = Number(process.env.PORT || 3000);
const DEV = process.env.NODE_ENV !== 'production'; // тестовый режим: код подтверждения показывается на экране
// Показывать код входа на экране можно только при локальном запуске (или явно DEV_OTP=1 на тестовом стенде):
// забытый NODE_ENV на публичном сервере не должен открывать вход в любой аккаунт.
const showCode = (req) => DEV && (process.env.DEV_OTP === '1' || /^(127\.|::1$|::ffff:127\.)/.test(req.ip || ''));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// Приём оплаты: ЮKassa (если заданы ключи); в тестовом режиме без ключей — тестовая страница оплаты; в рабочем без ключей — оплата недоступна
const PAY = YK.enabled ? 'yookassa' : DEV ? 'test' : 'none';
const UPLOAD_QUOTA = Number(process.env.UPLOAD_QUOTA_MB || 200) * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
// Доверяем X-Forwarded-For только от обратного прокси на этом же сервере (nginx/Caddy). Иначе IP можно подделать заголовком.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
// gzip для всего, кроме потока событий (SSE должен уходить без буферизации)
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/stream') && compression.filter(req, res) }));
// rawBody нужен для проверки подписи вебхука платёжного провайдера
const bigJson = express.json({ limit: '12mb' }), smallJson = express.json({ limit: '200kb', verify: (req, res, buf) => { req.rawBody = buf; } });
app.use((req, res, next) => (req.path === '/api/upload' ? bigJson : smallJson)(req, res, next));

/* ---------- безопасность ---------- */
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self)',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
      "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'self'"
    ].join('; ')
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

/* ---------- утилиты ---------- */
const N = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const fail = (status, code, msg) => { throw new HttpError(status, code, msg); };
const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function audit(req, action, target = '', meta = '') {
  run('INSERT INTO audit (user_id, action, target, meta, ip) VALUES (?,?,?,?,?)', N(req.user && req.user.id), action, String(target), typeof meta === 'string' ? meta : JSON.stringify(meta), req.ip || '');
}
const rl = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now(); const arr = (rl.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) fail(429, 'rate_limited', 'Слишком много запросов, попробуйте позже');
  arr.push(t); rl.set(key, arr);
}
setInterval(() => { const t = Date.now(); for (const [k, v] of rl) if (!v.some((x) => t - x < 3600e3)) rl.delete(k); }, 600e3).unref();

/* ---------- авторизация ---------- */
app.use('/api', (req, res, next) => {
  // Защита от CSRF: изменяющие запросы только с заголовком клиента платформы
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'mba' && req.path !== '/payments/webhook') return res.status(403).json({ error: 'csrf' });
  const sid = parseCookies(req).mba_sid;
  if (sid) {
    const u = get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', hashToken(sid));
    if (u && !u.blocked) req.user = u;
  }
  next();
});
const isMod = (u) => u && (u.role === 'moderator' || u.role === 'admin');
const needAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'auth_required' }));
const needMod = (req, res, next) => (isMod(req.user) ? next() : res.status(403).json({ error: 'forbidden' }));
const needAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' }));

function normTarget(t) {
  t = str(t, 120).toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { type: 'email', value: t };
  let d = t.replace(/[^\d+]/g, '');
  if (/^8\d{10}$/.test(d)) d = '+7' + d.slice(1);
  if (/^7\d{10}$/.test(d)) d = '+' + d;
  if (/^\+\d{10,15}$/.test(d)) return { type: 'phone', value: d };
  fail(400, 'bad_target', 'Укажите корректный e-mail или номер телефона');
}
function ageFrom(birth) {
  const b = new Date(birth); if (isNaN(b)) return -1;
  const n = new Date(); let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
function meDto(u) {
  const lvl = S.levelOf(u.points);
  const subs = all('SELECT s.*, t.code, t.name_ru, t.name_en, t.feature FROM subscriptions s JOIN tariffs t ON t.id = s.tariff_id WHERE s.user_id = ? AND s.until > ?', u.id, now());
  return {
    id: u.id, email: u.email, phone: u.phone, name: u.name, birthdate: u.birthdate, city: u.city, role: u.role, lang: u.lang,
    avatar: u.avatar, org_name: u.org_name, points: u.points, level: lvl, notify_push: !!u.notify_push, notify_email: !!u.notify_email,
    zone: { enabled: !!u.zone_enabled, lat: u.zone_lat, lng: u.zone_lng, radius: u.zone_radius },
    family_id: u.family_id, card: u.card_mask || null, subscriptions: subs, created_at: u.created_at,
    stats: get(`SELECT (SELECT COUNT(*) FROM applications WHERE user_id = ?) apps, (SELECT COUNT(*) FROM applications WHERE user_id = ? AND found_at IS NOT NULL) found,
      (SELECT COUNT(*) FROM points_log WHERE user_id = ? AND delta > 0) helped`, u.id, u.id, u.id),
    unread: get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0', u.id).c,
    unreadChats: get(`SELECT COUNT(*) c FROM messages m JOIN chats c ON c.id = m.chat_id WHERE (c.owner_id = ? OR c.other_id = ?) AND m.sender_id != ? AND m.read = 0`, u.id, u.id, u.id).c
  };
}
const hasFeature = (uid, feature) => !!get('SELECT 1 FROM subscriptions s JOIN tariffs t ON t.id = s.tariff_id WHERE s.user_id = ? AND t.feature = ? AND s.until > ?', uid, feature, now());

// Отправка одноразового кода. В рабочем режиме — только через подключённого провайдера; если он не подключён
// или не принял сообщение, код аннулируется и пользователь видит понятную ошибку.
function otpChannelReady(t) {
  if (DEV || S.channels[t.type === 'email' ? 'email' : 'sms']) return;
  fail(503, 'channel_unavailable', t.type === 'phone' ? 'Вход по номеру телефона временно недоступен. Войдите по e-mail.' : 'Вход по e-mail временно недоступен. Войдите по номеру телефона.');
}
async function deliverCode(t, subject, text, code) {
  const r = await (t.type === 'email' ? S.sendEmail(t.value, subject, text, code) : S.sendSms(t.value, text, code));
  if (r === 'failed') {
    run('DELETE FROM otp WHERE target = ? AND id = (SELECT MAX(id) FROM otp WHERE target = ?)', t.value, t.value);
    fail(502, 'send_failed', t.type === 'email' ? 'Не удалось отправить письмо с кодом. Проверьте адрес и попробуйте ещё раз.' : 'Не удалось отправить SMS с кодом. Проверьте номер и попробуйте ещё раз.');
  }
}
app.post('/api/auth/request', h(async (req, res) => {
  const t = normTarget(req.body.target);
  otpChannelReady(t);
  const last = get('SELECT created_at FROM otp WHERE target = ? ORDER BY id DESC LIMIT 1', t.value);
  if (last && Date.now() - last.created_at < 60e3) fail(429, 'otp_wait', 'Повторно код можно запросить через минуту');
  rateLimit('otpip:' + req.ip, 20, 3600e3);
  rateLimit('otp:' + t.value, 5, 3600e3);
  const code = String(crypto.randomInt(100000, 1000000));
  run('INSERT INTO otp (target, code, expires_at, created_at) VALUES (?,?,?,?)', t.value, hashCode(t.value, code), Date.now() + 10 * 60e3, Date.now());
  await deliverCode(t, 'Код входа', `Код входа в «Мой лучший агент»: ${code}. Никому не сообщайте его.`, code);
  const exists = !!get(`SELECT 1 FROM users WHERE ${t.type} = ?`, t.value);
  res.json({ ok: true, type: t.type, target: t.value, isNew: !exists, devCode: showCode(req) ? code : undefined });
}));

app.post('/api/auth/verify', h((req, res) => {
  const t = normTarget(req.body.target);
  const o = get('SELECT * FROM otp WHERE target = ? ORDER BY id DESC LIMIT 1', t.value);
  if (!o || o.expires_at < Date.now()) fail(400, 'otp_expired', 'Код устарел, запросите новый');
  if (o.attempts >= 5) fail(400, 'otp_attempts', 'Превышено число попыток, запросите новый код');
  if (!sameHash(hashCode(t.value, str(req.body.code, 10).replace(/\D/g, '')), o.code)) { run('UPDATE otp SET attempts = attempts + 1 WHERE id = ?', o.id); rateLimit('otpbad:' + req.ip, 30, 3600e3); fail(400, 'otp_wrong', 'Неверный код'); }
  let u = get(`SELECT * FROM users WHERE ${t.type} = ?`, t.value);
  if (!u) {
    const name = str(req.body.name, 80), birth = str(req.body.birthdate, 10);
    if (!name) fail(400, 'name_required', 'Укажите имя');
    if (ageFrom(birth) < 18) fail(400, 'age_18', 'Регистрация доступна только с 18 лет');
    if (!req.body.consent_pd || !req.body.consent_policy) fail(400, 'consent_required', 'Необходимо согласие на обработку персональных данных и с политикой конфиденциальности');
    const id = run(`INSERT INTO users (${t.type}, name, birthdate, lang, city, consent_at) VALUES (?,?,?,?,?,datetime('now'))`,
      t.value, name, birth, req.body.lang === 'en' ? 'en' : 'ru', str(req.body.city, 80)).lastInsertRowid;
    u = get('SELECT * FROM users WHERE id = ?', id);
    // привязка приглашений в семью, отправленных до регистрации
    run('UPDATE family_invites SET user_id = ? WHERE target = ? AND user_id IS NULL', id, t.value);
    req.user = u; audit(req, 'user.register', 'user:' + id);
  }
  if (u.blocked) fail(403, 'blocked', 'Аккаунт заблокирован. Обратитесь в поддержку.');
  run('DELETE FROM otp WHERE target = ?', t.value);
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id) VALUES (?,?)', hashToken(token), u.id); // в БД — только хэш
  res.cookie('mba_sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5, path: '/' });
  req.user = u; audit(req, 'user.login', 'user:' + u.id, t.type);
  res.json({ user: meDto(u) });
}));

app.post('/api/auth/logout', h((req, res) => {
  const sid = parseCookies(req).mba_sid; if (sid) run('DELETE FROM sessions WHERE token = ?', hashToken(sid));
  if (req.user && !get('SELECT 1 FROM sessions WHERE user_id = ?', req.user.id)) S.dropStreams(req.user.id);
  res.clearCookie('mba_sid', { path: '/' }); res.json({ ok: true });
}));

/* ---------- конфигурация и словари ---------- */
app.get('/api/config', h((req, res) => {
  const dicts = {};
  for (const d of all('SELECT * FROM dicts ORDER BY type, sort, id')) (dicts[d.type] = dicts[d.type] || []).push({ id: d.id, ru: d.value_ru, en: d.value_en });
  res.json({ vapidPublic: S.vapidPublic, dev: DEV, payments: PAY, levels: S.LEVELS, dicts, map: { provider: 'osm', center: [55.7558, 37.6173], zoom: 11 } });
}));
app.get('/api/i18n/:lang', h((req, res) => {
  const out = {}; for (const r of all('SELECT key, value FROM translations WHERE lang = ?', req.params.lang)) out[r.key] = r.value;
  res.set('Cache-Control', 'no-cache').json(out);
}));
/* ---------- юридические документы: JSON для страницы и PDF для скачивания ---------- */
const LEGAL = require('./legal');
app.get('/api/legal/:doc', h((req, res) => {
  const m = String(req.params.doc).match(/^([a-z]+?)(\.pdf)?$/);
  const lang = req.query.lang === 'en' ? 'en' : 'ru';
  if (!m || !LEGAL.DOC_IDS.includes(m[1])) fail(404, 'not_found', 'Документ не найден');
  if (m[2]) { rateLimit('pdf:' + req.ip, 60, 600e3); LEGAL.sendPdf(m[1], lang, res, req.query.inline === '1'); return; }
  res.set('Cache-Control', 'no-cache').json(LEGAL.getDoc(m[1], lang));
}));
app.get('/api/me',h((req, res) => res.json({ user: req.user ? meDto(req.user) : null })));

app.patch('/api/me', needAuth, h((req, res) => {
  const b = req.body, u = req.user, set = {};
  if ('name' in b) { set.name = str(b.name, 80); if (!set.name) fail(400, 'name_required', 'Укажите имя'); }
  if ('city' in b) set.city = str(b.city, 80);
  if ('lang' in b) set.lang = b.lang === 'en' ? 'en' : 'ru';
  if ('avatar' in b) set.avatar = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(b.avatar || '') ? b.avatar : '';
  if ('notify_push' in b) set.notify_push = b.notify_push ? 1 : 0;
  if ('notify_email' in b) set.notify_email = b.notify_email ? 1 : 0;
  // E-mail и телефон — это логины: меняются только с подтверждением кодом (/api/me/contact/*), иначе опечатка закроет вход в аккаунт
  if (('email' in b && (b.email || null) !== (u.email || null)) || ('phone' in b && (b.phone || null) !== (u.phone || null))) {
    fail(400, 'verify_contact', 'Контакт для входа меняется только с подтверждением кодом');
  }
  if (b.zone) {
    const r = num(b.zone.radius);
    set.zone_enabled = b.zone.enabled ? 1 : 0;
    if (b.zone.lat != null) { set.zone_lat = num(b.zone.lat); set.zone_lng = num(b.zone.lng); }
    if (r != null) set.zone_radius = Math.min(20, Math.max(0.5, r));
    if (set.zone_enabled && (set.zone_lat ?? u.zone_lat) == null) fail(400, 'zone_point', 'Укажите центр зоны на карте');
  }
  const keys = Object.keys(set);
  if (keys.length) run(`UPDATE users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => N(set[k])), u.id);
  audit(req, 'user.update', 'user:' + u.id, keys.join(','));
  res.json({ user: meDto(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));

/* ---------- смена контактов для входа с подтверждением кодом ---------- */
app.post('/api/me/contact/request', needAuth, h(async (req, res) => {
  const t = normTarget(req.body.target), u = req.user;
  otpChannelReady(t);
  if (t.value === u[t.type]) fail(400, 'same_contact', 'Этот контакт уже привязан к аккаунту');
  if (get(`SELECT 1 FROM users WHERE ${t.type} = ? AND id != ?`, t.value, u.id)) fail(400, t.type + '_taken', t.type === 'email' ? 'Этот e-mail уже используется' : 'Этот телефон уже используется');
  const last = get('SELECT created_at FROM otp WHERE target = ? ORDER BY id DESC LIMIT 1', t.value);
  if (last && Date.now() - last.created_at < 60e3) fail(429, 'otp_wait', 'Повторно код можно запросить через минуту');
  rateLimit('cc:' + u.id, 10, 3600e3);
  rateLimit('otp:' + t.value, 5, 3600e3);
  const code = String(crypto.randomInt(100000, 1000000));
  run('INSERT INTO otp (target, code, expires_at, created_at) VALUES (?,?,?,?)', t.value, hashCode(t.value, code), Date.now() + 10 * 60e3, Date.now());
  await deliverCode(t, 'Подтверждение e-mail', `Код подтверждения контакта в «Мой лучший агент»: ${code}. Если вы не меняли контакт — просто проигнорируйте сообщение.`, code);
  res.json({ ok: true, type: t.type, target: t.value, devCode: showCode(req) ? code : undefined });
}));
app.post('/api/me/contact/verify', needAuth, h((req, res) => {
  const t = normTarget(req.body.target), u = req.user;
  const o = get('SELECT * FROM otp WHERE target = ? ORDER BY id DESC LIMIT 1', t.value);
  if (!o || o.expires_at < Date.now()) fail(400, 'otp_expired', 'Код устарел, запросите новый');
  if (o.attempts >= 5) fail(400, 'otp_attempts', 'Превышено число попыток, запросите новый код');
  if (!sameHash(hashCode(t.value, str(req.body.code, 10).replace(/\D/g, '')), o.code)) { run('UPDATE otp SET attempts = attempts + 1 WHERE id = ?', o.id); rateLimit('otpbad:' + req.ip, 30, 3600e3); fail(400, 'otp_wrong', 'Неверный код'); }
  if (get(`SELECT 1 FROM users WHERE ${t.type} = ? AND id != ?`, t.value, u.id)) fail(400, t.type + '_taken', 'Контакт уже используется');
  const old = u[t.type];
  run(`UPDATE users SET ${t.type} = ? WHERE id = ?`, t.value, u.id);
  run('DELETE FROM otp WHERE target = ?', t.value);
  // предупреждаем старый адрес — если смену сделал не владелец, он узнает об этом
  if (old) { const msg = `В аккаунте «Мой лучший агент» ${t.type === 'email' ? 'e-mail' : 'телефон'} для входа изменён. Если это были не вы — напишите в поддержку.`; if (t.type === 'email') S.sendEmail(old, 'Контакт для входа изменён', msg); else S.sendSms(old, msg); }
  audit(req, 'user.contact', 'user:' + u.id, t.type);
  res.json({ user: meDto(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));
app.delete('/api/me/contact/:type', needAuth, h((req, res) => {
  const type = req.params.type, u = req.user;
  if (!['email', 'phone'].includes(type)) fail(400, 'bad_type', 'Неверный тип контакта');
  if (!u[type === 'email' ? 'phone' : 'email']) fail(400, 'need_contact', 'Нужен хотя бы один контакт для входа');
  run(`UPDATE users SET ${type} = NULL WHERE id = ?`, u.id);
  audit(req, 'user.contact_remove', 'user:' + u.id, type);
  res.json({ user: meDto(get('SELECT * FROM users WHERE id = ?', u.id)) });
}));
// Выгрузка своих данных (право субъекта ПДн на доступ, ст. 14 152-ФЗ)
app.get('/api/me/export', needAuth, h((req, res) => {
  const u = req.user;
  const data = {
    exported_at: new Date().toISOString(),
    profile: { name: u.name, email: u.email, phone: u.phone, birthdate: u.birthdate, city: u.city, role: u.role, lang: u.lang, points: u.points, registered_at: u.created_at, consent_at: u.consent_at,
      alert_zone: u.zone_enabled ? { lat: u.zone_lat, lng: u.zone_lng, radius_km: u.zone_radius } : null },
    applications: all('SELECT id, kind, category, status, title, description, features, person_name, person_age, species, event_date, address, city, reward, created_at FROM applications WHERE user_id = ?', u.id),
    valuables: all('SELECT id, title, description, serials, marks, status, created_at FROM valuables WHERE user_id = ?', u.id),
    messages_sent: all('SELECT chat_id, text, created_at FROM messages WHERE sender_id = ? ORDER BY id', u.id),
    payments: all('SELECT p.id, t.name_ru tariff, p.amount, p.method, p.status, p.created_at, p.paid_at FROM payments p JOIN tariffs t ON t.id = p.tariff_id WHERE p.user_id = ?', u.id),
    points: all('SELECT delta, reason, created_at FROM points_log WHERE user_id = ? ORDER BY id', u.id),
    support: all('SELECT id, subject, status, created_at FROM tickets WHERE user_id = ?', u.id)
  };
  audit(req, 'user.export', 'user:' + u.id);
  res.set('Content-Disposition', `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
}));

app.delete('/api/me', needAuth, h((req, res) => {
  audit(req, 'user.delete', 'user:' + req.user.id);
  tx(() => {
    run('DELETE FROM applications WHERE user_id = ?', req.user.id);
    run('DELETE FROM valuables WHERE user_id = ?', req.user.id);
    run('DELETE FROM push_subs WHERE user_id = ?', req.user.id);
    run('DELETE FROM notifications WHERE user_id = ?', req.user.id);
    run('DELETE FROM chats WHERE other_id = ?', req.user.id); // переписка по чужим заявкам (сообщения — каскадом)
    run('DELETE FROM messages WHERE sender_id = ?', req.user.id);
    run('DELETE FROM saved WHERE user_id = ?', req.user.id);
    run('DELETE FROM tickets WHERE user_id = ?', req.user.id);
    run('DELETE FROM complaints WHERE user_id = ?', req.user.id);
    run('DELETE FROM role_requests WHERE user_id = ?', req.user.id);
    run('DELETE FROM subscriptions WHERE user_id = ?', req.user.id);
    run('DELETE FROM points_log WHERE user_id = ?', req.user.id);
    run('DELETE FROM family_invites WHERE user_id = ? OR target IN (?, ?)', req.user.id, N(req.user.email) || '-', N(req.user.phone) || '-');
    const fam = req.user.family_id && get('SELECT * FROM families WHERE id = ? AND owner_id = ?', req.user.family_id, req.user.id);
    if (fam) { run('UPDATE users SET family_id = NULL WHERE family_id = ?', fam.id); run('UPDATE applications SET family_id = NULL WHERE family_id = ?', fam.id); run('DELETE FROM family_invites WHERE family_id = ?', fam.id); run('DELETE FROM families WHERE id = ?', fam.id); }
    // платежи остаются для бухгалтерского учёта (54-ФЗ), но без привязки к контактам — пользователь удаляется
    run('DELETE FROM users WHERE id = ?', req.user.id);
  });
  S.dropStreams(req.user.id);
  res.clearCookie('mba_sid', { path: '/' }); res.json({ ok: true });
}));

/* ---------- уведомления, push, поток событий ---------- */
app.get('/api/notifications', needAuth, h((req, res) => res.json({ items: I18N.localize(all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id), ['title', 'body'], I18N.isEn(req)) })));
app.post('/api/notifications/read', needAuth, h((req, res) => { run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id); res.json({ ok: true }); }));
app.post('/api/push/subscribe', needAuth, h((req, res) => {
  const sub = req.body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000 || !/^https:\/\/[^/\s]+\//.test(sub.endpoint)) fail(400, 'bad_sub', 'Некорректная подписка');
  const keys = sub.keys || {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) fail(400, 'bad_sub', 'Некорректная подписка');
  if (get('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?', req.user.id).c >= 10) run('DELETE FROM push_subs WHERE id = (SELECT MIN(id) FROM push_subs WHERE user_id = ?)', req.user.id);
  const clean = { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }; // храним только нужное для отправки
  run('INSERT INTO push_subs (user_id, endpoint, data) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, data = excluded.data', req.user.id, clean.endpoint, JSON.stringify(clean));
  res.json({ ok: true });
}));
app.post('/api/push/test', needAuth, h(async (req, res) => {
  await S.sendPush(req.user.id, { title: 'Мой лучший агент', body: 'Push-уведомления работают', url: '/#/me/settings' });
  res.json({ ok: true, subs: get('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?', req.user.id).c });
}));
app.get('/api/stream', needAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 4000\n\n');
  const off = S.addStream(req.user.id, res);
  req.on('close', off);
});

/* ---------- загрузка фото ---------- */
app.post('/api/upload', needAuth, h((req, res) => {
  rateLimit('up:' + req.user.id, 120, 3600e3);
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(req.body.data || ''));
  if (!m) fail(400, 'bad_image', 'Поддерживаются JPEG, PNG и WebP');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 8 * 1024 * 1024) fail(400, 'too_big', 'Файл больше 8 МБ');
  // Лимит места на пользователя (неиспользуемые файлы удаляются раз в сутки и в лимит не входят)
  const used = get('SELECT COALESCE(SUM(size), 0) s FROM uploads WHERE user_id = ?', req.user.id).s;
  if (used + buf.length > UPLOAD_QUOTA && !isMod(req.user)) fail(400, 'quota', 'Достигнут лимит хранилища фото. Удалите ненужные заявки или фото');
  const sig = buf.subarray(0, 12).toString('hex');
  const ok = sig.startsWith('ffd8ff') || sig.startsWith('89504e47') || (sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) fail(400, 'bad_image', 'Файл не является изображением');
  const name = crypto.randomBytes(16).toString('hex') + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  run('INSERT INTO uploads (name, user_id, size) VALUES (?,?,?)', name, req.user.id, buf.length);
  res.json({ url: '/uploads/' + name });
}));

/* ---------- заявки ---------- */
const CATS = ['people', 'animals', 'things'];
// Радиус экстренного оповещения — 1–5 км. Значение вне диапазона отклоняется (раньше молча «подрезалось» до 1/5 км).
function emRadius(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const r = num(v);
  if (r == null || r < 1 || r > 5) fail(400, 'bad_radius', 'Радиус экстренного оповещения — от 1 до 5 км');
  return r;
}
function canEdit(a, u) { return !!u && (a.user_id === u.id || (a.family_id && u.family_id === a.family_id) || isMod(u)); }
function appDto(a, viewer, extra = {}) {
  const owner = canEdit(a, viewer);
  const hidePd = a.category === 'people' && (a.status === 'found' || a.status === 'closed') && !isMod(viewer);
  const photos = JSON.parse(a.photos || '[]');
  const author = get('SELECT role, points FROM users WHERE id = ?', a.user_id) || { role: 'user', points: 0 };
  const o = {
    id: a.id, kind: a.kind, category: a.category, status: a.status, title: a.title,
    description: hidePd ? '' : a.description, features: hidePd ? '' : a.features,
    person_name: hidePd ? '' : a.person_name, person_age: hidePd ? null : a.person_age, last_seen: hidePd ? '' : a.last_seen,
    species: a.species, relation: owner ? a.relation : undefined, is_minor: !!a.is_minor,
    event_date: a.event_date, lat: hidePd ? null : a.lat, lng: hidePd ? null : a.lng, address: hidePd ? (a.city || '') : a.address, city: a.city,
    reward: a.reward, photos: hidePd ? [] : photos, hidden_pd: hidePd,
    emergency: a.emergency_status === 'active' ? a.emergency_radius : null, emergency_status: owner ? a.emergency_status : undefined,
    emergency_radius: owner ? a.emergency_radius : undefined,
    promoted: !!(a.promoted_until && a.promoted_until > now()), views: a.views,
    created_at: a.created_at, updated_at: a.updated_at, found_at: a.found_at,
    author: { role: author.role, level: S.levelOf(author.points).code },
    is_owner: owner, is_author: !!viewer && viewer.id === a.user_id,
    contact: owner ? a.contact : undefined, reject_reason: owner ? a.reject_reason : undefined, family_shared: !!a.family_id
  };
  return Object.assign(o, extra);
}
function readApp(b, isNew, existing) {
  const o = {};
  if (isNew) {
    o.kind = b.kind === 'found' ? 'found' : b.kind === 'lost' ? 'lost' : fail(400, 'bad_kind', 'Тип заявки');
    o.category = CATS.includes(b.category) ? b.category : fail(400, 'bad_category', 'Категория');
  }
  const kind = isNew ? o.kind : existing.kind, category = isNew ? o.category : existing.category;
  o.title = str(b.title, 140); if (!o.title) fail(400, 'title_required', 'Укажите заголовок');
  o.description = str(b.description, 4000); o.features = str(b.features, 1000);
  o.species = str(b.species, 60);
  o.event_date = str(b.event_date, 16) || new Date().toISOString().slice(0, 10);
  if (isNaN(new Date(o.event_date))) fail(400, 'bad_date', 'Некорректная дата');
  if (new Date(o.event_date) > new Date(Date.now() + 864e5)) fail(400, 'future_date', 'Дата не может быть в будущем');
  o.lat = num(b.lat); o.lng = num(b.lng);
  if (o.lat == null || o.lng == null || Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) fail(400, 'place_required', 'Отметьте место на карте');
  o.address = str(b.address, 200); o.city = str(b.city, 80);
  o.contact = str(b.contact, 120); if (!o.contact) fail(400, 'contact_required', 'Укажите контакт для связи');
  o.reward = Math.max(0, Math.min(10000000, Math.round(num(b.reward) || 0)));
  const photos = Array.isArray(b.photos) ? b.photos.filter((p) => typeof p === 'string' && /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(p)) : [];
  if (photos.length > 5) fail(400, 'photos_max', 'Не более 5 фото');
  o.photos = JSON.stringify(photos);
  if (category === 'people') {
    o.person_name = str(b.person_name, 120); o.person_age = num(b.person_age); o.last_seen = str(b.last_seen, 300);
    if (kind === 'lost') {
      if (!o.person_name) fail(400, 'fio_required', 'Укажите ФИО');
      if (o.person_age == null || o.person_age < 0 || o.person_age > 120) fail(400, 'age_required', 'Укажите возраст');
      if (!o.last_seen) fail(400, 'last_seen_required', 'Укажите последнее местонахождение');
      o.relation = ['relative', 'legal_rep'].includes(b.relation) ? b.relation : fail(400, 'relation_required', 'Укажите, кем вы приходитесь человеку');
      o.is_minor = o.person_age < 18 ? 1 : 0;
      if (o.is_minor && o.relation !== 'legal_rep') fail(400, 'minor_legal_rep', 'Заявку о несовершеннолетнем подаёт только законный представитель');
      if (!b.confirm_rights) fail(400, 'confirm_rights', 'Подтвердите право подачи заявки');
    } else { o.is_minor = o.person_age != null && o.person_age < 18 ? 1 : 0; o.relation = ''; }
  }
  return o;
}

app.get('/api/applications', h((req, res) => {
  const q = req.query, where = ["a.status IN ('published','found')"], p = [];
  if (CATS.includes(q.category)) { where.push('a.category = ?'); p.push(q.category); }
  if (q.kind === 'lost' || q.kind === 'found') { where.push('a.kind = ?'); p.push(q.kind); }
  if (q.status === 'active') where.push("a.status = 'published'");
  if (q.status === 'found') where.push("a.status = 'found'");
  if (q.from) { where.push('a.event_date >= ?'); p.push(str(q.from, 10)); }
  if (q.to) { where.push('a.event_date <= ?'); p.push(str(q.to, 10)); }
  if (q.emergency === '1') where.push("a.emergency_status = 'active'");
  if (q.q) {
    const terms = str(q.q, 100).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    // у найденных людей описание, приметы и адрес скрыты — по ним и не ищем, иначе поиск выдаёт скрытое
    for (const t of terms) { where.push("(lower(a.title) LIKE ? OR lower(a.species) LIKE ? OR (NOT (a.category = 'people' AND a.status IN ('found','closed')) AND (lower(a.description) LIKE ? OR lower(a.features) LIKE ? OR lower(a.address) LIKE ?)))"); const l = '%' + t + '%'; p.push(l, l, l, l, l); }
  }
  // Порядок: по умолчанию «рекомендуемые» (экстренные и поднятые в топ — выше), либо строго по дате / вознаграждению
  const ORDER = { new: 'a.created_at DESC, a.id DESC', old: 'a.created_at ASC, a.id ASC', reward: 'a.reward DESC, a.created_at DESC' }[q.sort];
  let rows = ORDER
    ? all(`SELECT a.* FROM applications a WHERE ${where.join(' AND ')} ORDER BY ${ORDER} LIMIT 500`, ...p)
    : all(`SELECT a.* FROM applications a WHERE ${where.join(' AND ')} ORDER BY (a.emergency_status = 'active') DESC, (a.promoted_until > ?) DESC, a.created_at DESC LIMIT 500`, ...p, now());
  const lat = num(q.lat), lng = num(q.lng), radius = num(q.radius);
  let list = rows.map((a) => {
    const d = lat != null && lng != null ? S.distKm(lat, lng, a.lat, a.lng) : null;
    return { a, d };
  });
  if (radius && lat != null) list = list.filter((x) => x.d != null && x.d <= radius);
  if (q.sort === 'near' && lat != null) list.sort((x, y) => (x.d ?? 1e9) - (y.d ?? 1e9));
  const limit = Math.min(200, Number(q.limit) || 100);
  res.json({ total: list.length, items: list.slice(0, limit).map((x) => appDto(x.a, req.user, { distance: x.d })) });
}));

app.get('/api/applications/:id', h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a) fail(404, 'not_found', 'Заявка не найдена');
  const visible = ['published', 'found'].includes(a.status) || canEdit(a, req.user) ||
    (a.status === 'closed' && req.user && !!get('SELECT 1 FROM chats WHERE application_id = ? AND other_id = ?', a.id, req.user.id));
  if (!visible) fail(404, 'not_found', 'Заявка не найдена или ещё на проверке');
  if (!req.user || req.user.id !== a.user_id) run('UPDATE applications SET views = views + 1 WHERE id = ?', a.id);
  const extra = {};
  if (req.user) {
    extra.saved = !!get('SELECT 1 FROM saved WHERE user_id = ? AND application_id = ?', req.user.id, a.id);
    const ch = get('SELECT id FROM chats WHERE application_id = ? AND other_id = ?', a.id, req.user.id);
    extra.chat_id = ch ? ch.id : null;
  }
  if (canEdit(a, req.user)) {
    const col = a.kind === 'lost' ? 'lost_id' : 'found_id', oth = a.kind === 'lost' ? 'found_id' : 'lost_id';
    extra.matches = all(`SELECT m.score, x.* FROM matches m JOIN applications x ON x.id = m.${oth} WHERE m.${col} = ? AND x.status IN ('published','found') ORDER BY m.score DESC`, a.id)
      .map((x) => appDto(x, req.user, { score: x.score }));
    extra.chats = all(`SELECT c.id, c.other_id, c.created_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) msgs FROM chats c WHERE c.application_id = ?`, a.id)
      .map((c, i) => ({ id: c.id, alias: 'Собеседник ' + (i + 1), helper_id: c.other_id, msgs: c.msgs }));
  }
  res.json({ item: appDto(a, req.user, extra) });
}));

app.post('/api/applications', needAuth, h((req, res) => {
  rateLimit('app:' + req.user.id, 20, 3600e3);
  const o = readApp(req.body, true);
  o.user_id = req.user.id;
  o.family_id = req.body.family && req.user.family_id ? req.user.family_id : null;
  o.status = o.category === 'people' ? 'pending' : 'published';
  if (num(req.body.emergency_radius) && o.kind === 'lost' && o.category !== 'things') { o.emergency_radius = emRadius(req.body.emergency_radius); o.emergency_status = 'pending'; }
  const keys = Object.keys(o);
  const id = run(`INSERT INTO applications (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => N(o[k]))).lastInsertRowid;
  const a = get('SELECT * FROM applications WHERE id = ?', id);
  audit(req, 'application.create', 'application:' + id, { kind: a.kind, category: a.category, status: a.status });
  let matches = [];
  if (a.status === 'published') matches = S.runMatching(a);
  else notifyMods('Новая заявка на проверке', `«${a.title}»`, '#/admin/moderation');
  if (a.emergency_status === 'pending') notifyMods('Запрос экстренного оповещения', `«${a.title}», радиус ${a.emergency_radius} км`, '#/admin/emergency');
  res.json({ item: appDto(a, req.user), matches: matches.length });
}));
// Защита от накрутки баллов вторыми аккаунтами: сколько начислений этого вида было за сутки
const pointsToday = (uid, prefix) => get("SELECT COUNT(*) c FROM points_log WHERE user_id = ? AND reason LIKE ? AND created_at > datetime('now','-1 day')", uid, prefix + '%').c;
function notifyMods(title, body, link) {
  for (const m of all("SELECT id FROM users WHERE role IN ('moderator','admin') AND blocked = 0")) S.notify(m.id, { type: 'moderation', title, body, link, pushTitle: title, pushBody: 'Откройте панель администратора', email: false });
}

app.patch('/api/applications/:id', needAuth, h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || !canEdit(a, req.user)) fail(404, 'not_found', 'Заявка не найдена');
  if (a.status === 'closed') fail(400, 'closed', 'Закрытую заявку нельзя редактировать');
  const o = readApp(Object.assign({ confirm_rights: true, relation: a.relation }, req.body), false, a);
  // Изменённая заявка о человеке снова проходит проверку (кроме правки модератором)
  if (a.category === 'people' && ['published', 'found'].includes(a.status) && !isMod(req.user)) o.status = 'pending';
  if (a.status === 'rejected') o.status = a.category === 'people' ? 'pending' : 'published';
  o.updated_at = now();
  const keys = Object.keys(o);
  run(`UPDATE applications SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => N(o[k])), a.id);
  const b = get('SELECT * FROM applications WHERE id = ?', a.id);
  audit(req, 'application.update', 'application:' + a.id);
  if (b.status === 'published') S.runMatching(b); else if (b.status === 'pending') notifyMods('Заявка изменена и ждёт проверки', `«${b.title}»`, '#/admin/moderation');
  res.json({ item: appDto(b, req.user) });
}));

app.post('/api/applications/:id/status', needAuth, h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || !canEdit(a, req.user)) fail(404, 'not_found', 'Заявка не найдена');
  const st = req.body.status;
  if (!['found', 'closed'].includes(st)) fail(400, 'bad_status', 'Недопустимый статус');
  if (a.status === 'closed') fail(400, 'closed', 'Заявка уже закрыта');
  if (st === 'found' && a.status !== 'published') fail(400, 'not_published', 'Отметить «найдено» можно только опубликованную заявку');
  run(`UPDATE applications SET status = ?, found_at = CASE WHEN ? = 'found' THEN datetime('now') ELSE found_at END,
       emergency_status = CASE WHEN emergency_status IN ('active','pending') THEN 'done' ELSE emergency_status END, updated_at = datetime('now') WHERE id = ?`, st, st, a.id);
  audit(req, 'application.status', 'application:' + a.id, st);
  // Баллы помощнику: собеседник из чата этой заявки, подтверждённый автором
  const helper = num(req.body.helper_id);
  const ch = st === 'found' && helper && helper !== a.user_id && get('SELECT id FROM chats WHERE application_id = ? AND other_id = ?', a.id, helper);
  if (ch && get('SELECT 1 FROM messages WHERE chat_id = ? AND sender_id = ?', ch.id, helper) && get('SELECT 1 FROM messages WHERE chat_id = ? AND sender_id != ?', ch.id, helper)
    && !get("SELECT 1 FROM audit WHERE action = 'points.helper' AND target = ? AND meta = ? AND created_at > datetime('now','-30 days')", 'user:' + helper, String(a.user_id))
    && pointsToday(helper, 'Подтверждённая помощь') < 3) {
    S.addPoints(helper, 50, `Подтверждённая помощь в заявке «${a.title}»`);
    audit(req, 'points.helper', 'user:' + helper, String(a.user_id));
  }
  if (st === 'found' && pointsToday(a.user_id, 'Заявка отмечена') < 3) S.addPoints(a.user_id, 10, 'Заявка отмечена как «найдено»');
  // уведомить участников чатов
  for (const c of all('SELECT other_id FROM chats WHERE application_id = ?', a.id))
    S.notify(c.other_id, { type: 'status', title: st === 'found' ? 'Заявка отмечена «найдено»' : 'Заявка закрыта', body: a.category === 'people' ? 'Спасибо за участие!' : `«${a.title}»`, link: `#/a/${a.id}`, email: false });
  res.json({ item: appDto(get('SELECT * FROM applications WHERE id = ?', a.id), req.user) });
}));

app.post('/api/applications/:id/emergency', needAuth, h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || !canEdit(a, req.user)) fail(404, 'not_found', 'Заявка не найдена');
  if (a.kind !== 'lost' || a.category === 'things') fail(400, 'not_allowed', 'Экстренный поиск — только для пропавших людей и животных');
  if (!['published', 'pending'].includes(a.status)) fail(400, 'not_allowed', 'Заявка неактивна');
  if (['pending', 'active'].includes(a.emergency_status)) fail(400, 'exists', 'Экстренное оповещение уже запрошено');
  const r = emRadius(req.body.radius, 3);
  run("UPDATE applications SET emergency_radius = ?, emergency_status = 'pending' WHERE id = ?", r, a.id);
  audit(req, 'emergency.request', 'application:' + a.id, { radius: r });
  notifyMods('Запрос экстренного оповещения', `«${a.title}», радиус ${r} км`, '#/admin/emergency');
  res.json({ ok: true });
}));

app.delete('/api/applications/:id', needAuth, h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || !canEdit(a, req.user)) fail(404, 'not_found', 'Заявка не найдена');
  tx(() => { run('DELETE FROM matches WHERE lost_id = ? OR found_id = ?', a.id, a.id); run('DELETE FROM saved WHERE application_id = ?', a.id); run('DELETE FROM applications WHERE id = ?', a.id); });
  audit(req, 'application.delete', 'application:' + a.id);
  res.json({ ok: true });
}));

app.post('/api/applications/:id/save', needAuth, h((req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT 1 FROM applications WHERE id = ?', id)) fail(404, 'not_found', 'Заявка не найдена');
  const ex = get('SELECT 1 FROM saved WHERE user_id = ? AND application_id = ?', req.user.id, id);
  if (ex) run('DELETE FROM saved WHERE user_id = ? AND application_id = ?', req.user.id, id);
  else run('INSERT INTO saved (user_id, application_id) VALUES (?,?)', req.user.id, id);
  res.json({ saved: !ex });
}));

// Запрос на удаление от человека, о котором подана заявка (без регистрации)
app.post('/api/applications/:id/deletion-request', h((req, res) => {
  rateLimit('del:' + req.ip, 5, 3600e3);
  const a = get('SELECT id, title FROM applications WHERE id = ?', Number(req.params.id));
  if (!a) fail(404, 'not_found', 'Заявка не найдена');
  const name = str(req.body.name, 120), contact = str(req.body.contact, 120);
  if (!name || !contact) fail(400, 'required', 'Укажите имя и контакт');
  run('INSERT INTO deletion_requests (application_id, name, contact, reason) VALUES (?,?,?,?)', a.id, name, contact, str(req.body.reason, 1000));
  notifyMods('Запрос на удаление заявки', `«${a.title}»`, '#/admin/deletion');
  audit(req, 'application.deletion_request', 'application:' + a.id);
  res.json({ ok: true });
}));

app.get('/api/my/applications', needAuth, h((req, res) => {
  const rows = all('SELECT * FROM applications WHERE user_id = ? OR (family_id IS NOT NULL AND family_id = ?) ORDER BY created_at DESC', req.user.id, N(req.user.family_id));
  res.json({ items: rows.map((a) => {
    const col = a.kind === 'lost' ? 'lost_id' : 'found_id';
    return appDto(a, req.user, { match_count: get(`SELECT COUNT(*) c FROM matches WHERE ${col} = ?`, a.id).c });
  }) });
}));
app.get('/api/my/saved', needAuth, h((req, res) => {
  res.json({ items: all("SELECT a.* FROM saved s JOIN applications a ON a.id = s.application_id WHERE s.user_id = ? AND a.status IN ('published','found','closed') ORDER BY a.created_at DESC", req.user.id).map((a) => appDto(a, req.user)) });
}));

/* ---------- анонимный чат ---------- */
function chatFor(id, u) {
  const c = get('SELECT c.*, a.title, a.kind, a.category, a.status app_status, a.user_id app_user, a.family_id FROM chats c JOIN applications a ON a.id = c.application_id WHERE c.id = ?', id);
  if (!c) fail(404, 'not_found', 'Чат не найден');
  const isOwnerSide = c.owner_id === u.id || (c.family_id && u.family_id === c.family_id);
  if (!isOwnerSide && c.other_id !== u.id && !isMod(u)) fail(404, 'not_found', 'Чат не найден');
  c.side = isOwnerSide ? 'owner' : c.other_id === u.id ? 'other' : 'moderator';
  return c;
}
function chatDto(c, u) {
  const last = get('SELECT text, photo, lat, created_at, sender_id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1', c.id);
  const myId = c.side === 'owner' ? c.owner_id : c.other_id;
  const aliasOther = c.side === 'owner' ? (c.kind === 'lost' ? 'Откликнувшийся' : 'Владелец') : (c.kind === 'lost' ? 'Автор заявки (ищет)' : 'Нашедший');
  return {
    id: c.id, application: { id: c.application_id, title: c.title, kind: c.kind, category: c.category, status: c.app_status },
    side: c.side, alias: aliasOther, blocked: !!c.blocked_by, blocked_by_me: c.blocked_by === u.id,
    last: last ? { text: last.text, photo: !!last.photo, location: last.lat != null, created_at: last.created_at, mine: last.sender_id === u.id } : null,
    unread: get('SELECT COUNT(*) c FROM messages WHERE chat_id = ? AND sender_id != ? AND read = 0', c.id, myId).c,
    created_at: c.created_at
  };
}
app.post('/api/applications/:id/chat', needAuth, h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a || a.status !== 'published') fail(400, 'not_available', 'Заявка недоступна для связи');
  if (canEdit(a, req.user) && !isMod(req.user)) fail(400, 'own', 'Это ваша заявка');
  let c = get('SELECT * FROM chats WHERE application_id = ? AND other_id = ?', a.id, req.user.id);
  if (!c) {
    const id = run('INSERT INTO chats (application_id, owner_id, other_id) VALUES (?,?,?)', a.id, a.user_id, req.user.id).lastInsertRowid;
    c = { id };
    S.notify(a.user_id, { type: 'chat', title: 'Новый отклик по заявке', body: `«${a.title}»`, link: `#/chat/${id}`, pushTitle: 'Новый отклик', pushBody: 'По вашей заявке написали в чат' });
  }
  res.json({ id: c.id });
}));
app.get('/api/chats', needAuth, h((req, res) => {
  const rows = all(`SELECT c.*, a.title, a.kind, a.category, a.status app_status, a.family_id FROM chats c JOIN applications a ON a.id = c.application_id
    WHERE c.owner_id = ? OR c.other_id = ? OR (a.family_id IS NOT NULL AND a.family_id = ?) ORDER BY c.id DESC`, req.user.id, req.user.id, N(req.user.family_id));
  const items = rows.map((c) => { c.side = c.other_id === req.user.id ? 'other' : 'owner'; return chatDto(c, req.user); })
    .sort((x, y) => String(y.last ? y.last.created_at : y.created_at).localeCompare(String(x.last ? x.last.created_at : x.created_at)));
  res.json({ items });
}));
app.get('/api/chats/:id', needAuth, h((req, res) => {
  const c = chatFor(Number(req.params.id), req.user);
  const myId = c.side === 'owner' ? c.owner_id : c.other_id;
  if (c.side !== 'moderator') run('UPDATE messages SET read = 1 WHERE chat_id = ? AND sender_id != ?', c.id, myId);
  const msgs = all('SELECT id, sender_id, text, photo, lat, lng, created_at FROM messages WHERE chat_id = ? ORDER BY id', c.id)
    .map((m) => ({ id: m.id, mine: m.sender_id === myId || (c.side === 'owner' && m.sender_id !== c.other_id), text: m.text, photo: m.photo, lat: m.lat, lng: m.lng, created_at: m.created_at, from: m.sender_id === c.other_id ? 'other' : 'owner' }));
  res.json({ chat: chatDto(c, req.user), messages: msgs });
}));
app.post('/api/chats/:id/messages', needAuth, h((req, res) => {
  const c = chatFor(Number(req.params.id), req.user);
  if (c.side === 'moderator') fail(403, 'forbidden', 'Модератор не может писать в чат');
  if (c.blocked_by) fail(403, 'blocked', 'Переписка заблокирована');
  rateLimit('msg:' + req.user.id, 60, 60e3);
  const text = str(req.body.text, 2000), photo = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.body.photo || '') ? req.body.photo : '';
  const lat = num(req.body.lat), lng = num(req.body.lng);
  if (!text && !photo && lat == null) fail(400, 'empty', 'Пустое сообщение');
  const id = run('INSERT INTO messages (chat_id, sender_id, text, photo, lat, lng) VALUES (?,?,?,?,?,?)', c.id, req.user.id, text, photo, N(lat), N(lng)).lastInsertRowid;
  const to = c.side === 'owner' ? c.other_id : c.owner_id;
  const msg = { id, chat_id: c.id, text, photo, lat, lng, created_at: now() };
  S.emit(to, 'message', Object.assign({ mine: false, from: c.side }, msg));
  // семья владельца тоже видит переписку
  if (c.family_id) for (const m of all('SELECT id FROM users WHERE family_id = ? AND id != ?', c.family_id, req.user.id)) if (m.id !== to) S.emit(m.id, 'message', Object.assign({ mine: c.side === 'owner', from: c.side }, msg));
  const recent = get("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'chat' AND link = ? AND created_at > datetime('now','-5 minutes')", to, `#/chat/${c.id}`).c;
  if (!recent) S.notify(to, { type: 'chat', title: 'Новое сообщение', body: `Чат по заявке «${c.title}»`, link: `#/chat/${c.id}`, pushTitle: 'Новое сообщение', pushBody: 'Вам написали в анонимном чате', email: false });
  res.json({ message: Object.assign({ mine: true, from: c.side }, msg) });
}));
app.post('/api/chats/:id/block', needAuth, h((req, res) => {
  const c = chatFor(Number(req.params.id), req.user);
  if (c.side === 'moderator') fail(403, 'forbidden', '');
  const block = req.body.block !== false;
  if (c.blocked_by && c.blocked_by !== req.user.id) fail(403, 'forbidden', 'Чат заблокирован собеседником или модератором');
  run('UPDATE chats SET blocked_by = ? WHERE id = ?', block ? req.user.id : null, c.id);
  audit(req, block ? 'chat.block' : 'chat.unblock', 'chat:' + c.id);
  res.json({ ok: true });
}));

/* ---------- жалобы ---------- */
app.post('/api/complaints', needAuth, h((req, res) => {
  rateLimit('cmp:' + req.user.id, 20, 3600e3);
  const tt = req.body.target_type;
  if (!['application', 'chat', 'message', 'user'].includes(tt)) fail(400, 'bad_target', 'Неверный объект жалобы');
  const tid = Number(req.body.target_id), reason = str(req.body.reason, 1000);
  if (!tid || !reason) fail(400, 'required', 'Укажите причину');
  if (tt === 'chat') chatFor(tid, req.user);
  const exists = { application: 'applications', message: 'messages', user: 'users', chat: 'chats' }[tt];
  if (!get(`SELECT 1 FROM ${exists} WHERE id = ?`, tid)) fail(404, 'not_found', 'Объект жалобы не найден');
  run('INSERT INTO complaints (user_id, target_type, target_id, reason) VALUES (?,?,?,?)', req.user.id, tt, tid, reason);
  notifyMods('Новая жалоба', reason.slice(0, 120), '#/admin/complaints');
  audit(req, 'complaint.create', `${tt}:${tid}`);
  res.json({ ok: true });
}));

/* ---------- реестр ценностей ---------- */
function valDto(v) { return Object.assign({}, v, { photos: JSON.parse(v.photos || '[]') }); }
function readVal(b) {
  const o = { title: str(b.title, 140), description: str(b.description, 3000), serials: str(b.serials, 500), marks: str(b.marks, 1000) };
  if (!o.title) fail(400, 'title_required', 'Укажите название предмета');
  const photos = Array.isArray(b.photos) ? b.photos.filter((p) => /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(p)) : [];
  if (photos.length > 5) fail(400, 'photos_max', 'Не более 5 фото');
  o.photos = JSON.stringify(photos);
  return o;
}
app.get('/api/valuables', needAuth, h((req, res) => res.json({
  items: all('SELECT * FROM valuables WHERE user_id = ? ORDER BY id DESC', req.user.id).map(valDto),
  limit: hasFeature(req.user.id, 'registry') ? 100 : 3
})));
app.post('/api/valuables', needAuth, h((req, res) => {
  const limit = hasFeature(req.user.id, 'registry') ? 100 : 3;
  if (get('SELECT COUNT(*) c FROM valuables WHERE user_id = ?', req.user.id).c >= limit) fail(402, 'limit', `Лимит бесплатного реестра — ${limit} предмета. Подключите тариф «Реестр ценностей+».`);
  const o = readVal(req.body);
  const id = run('INSERT INTO valuables (user_id, title, description, serials, marks, photos) VALUES (?,?,?,?,?,?)', req.user.id, o.title, o.description, o.serials, o.marks, o.photos).lastInsertRowid;
  audit(req, 'valuable.create', 'valuable:' + id);
  res.json({ item: valDto(get('SELECT * FROM valuables WHERE id = ?', id)) });
}));
app.patch('/api/valuables/:id', needAuth, h((req, res) => {
  const v = get('SELECT * FROM valuables WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!v) fail(404, 'not_found', 'Предмет не найден');
  if (req.body.status) {
    if (!['ok', 'stolen', 'lost'].includes(req.body.status)) fail(400, 'bad_status', 'Статус');
    run("UPDATE valuables SET status = ?, status_at = datetime('now') WHERE id = ?", req.body.status, v.id);
    audit(req, 'valuable.status', 'valuable:' + v.id, req.body.status);
  } else {
    const o = readVal(req.body);
    run('UPDATE valuables SET title = ?, description = ?, serials = ?, marks = ?, photos = ? WHERE id = ?', o.title, o.description, o.serials, o.marks, o.photos, v.id);
  }
  res.json({ item: valDto(get('SELECT * FROM valuables WHERE id = ?', v.id)) });
}));
app.delete('/api/valuables/:id', needAuth, h((req, res) => { run('DELETE FROM valuables WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id); res.json({ ok: true }); }));
// Публичная проверка предмета: только отметки «украдено / утеряно», без данных владельца
app.get('/api/registry/check', h((req, res) => {
  rateLimit('chk:' + req.ip, 60, 600e3);
  const q = str(req.query.q, 100).toLowerCase();
  if (q.length < 3) fail(400, 'short', 'Введите минимум 3 символа: серийный номер, гравировку или название');
  const qn = q.replace(/[\s\-_.]/g, '');
  const rows = all("SELECT * FROM valuables WHERE status IN ('stolen','lost')").filter((v) => {
    const serial = String(v.serials || '').toLowerCase().replace(/[\s\-_.]/g, '');
    return (qn.length >= 4 && serial.includes(qn)) || String(v.title + ' ' + v.marks).toLowerCase().includes(q);
  }).slice(0, 20);
  res.json({ items: rows.map((v) => ({ id: v.id, title: v.title, marks: v.marks, status: v.status, status_at: v.status_at, photo: JSON.parse(v.photos)[0] || '', serial_match: !!v.serials && qn.length >= 4 && v.serials.toLowerCase().replace(/[\s\-_.]/g, '').includes(qn) })) });
}));
app.post('/api/registry/:id/report', h((req, res) => {
  // Сообщить владельцу, что предмет замечен (без раскрытия контактов): уведомление владельцу
  rateLimit('rep:' + req.ip, 10, 3600e3);
  const v = get("SELECT * FROM valuables WHERE id = ? AND status IN ('stolen','lost')", Number(req.params.id));
  if (!v) fail(404, 'not_found', 'Предмет не найден');
  const msg = str(req.body.message, 1000); if (!msg) fail(400, 'required', 'Опишите, где замечен предмет');
  S.notify(v.user_id, { type: 'registry', title: 'Ваш предмет из реестра замечен', body: `«${v.title}»: ${msg}`, link: '#/me/registry', pushTitle: 'Предмет из реестра замечен', pushBody: 'Откройте платформу, чтобы узнать подробности' });
  res.json({ ok: true });
}));

/* ---------- тарифы и оплата (ЮKassa; тестовая страница — только в тестовом режиме) ---------- */
app.get('/api/tariffs', h((req, res) => {
  const disc = req.user ? S.levelOf(req.user.points).discount : 0;
  res.json({ discount: disc, items: all('SELECT * FROM tariffs WHERE active = 1 ORDER BY sort, id').map((t) => Object.assign(t, { final_price: Math.round(t.price * (100 - disc) / 100) })) });
}));
app.post('/api/payments', needAuth, h(async (req, res) => {
  if (PAY === 'none') fail(503, 'payments_unavailable', 'Оплата временно недоступна. Попробуйте позже.');
  const t = get('SELECT * FROM tariffs WHERE id = ? AND active = 1', Number(req.body.tariff_id));
  if (!t) fail(404, 'not_found', 'Тариф не найден');
  if (!['card', 'sbp', 'saved_card'].includes(req.body.method)) fail(400, 'bad_method', 'Способ оплаты');
  if (req.body.method === 'saved_card' && !req.user.card_token) fail(400, 'no_card', 'Нет привязанной карты');
  if (t.audience === 'partner' && req.user.role !== 'partner' && !isMod(req.user)) fail(403, 'partners_only', 'Тариф доступен только партнёрам');
  let appId = null;
  if (t.feature === 'promote') {
    const a = get('SELECT * FROM applications WHERE id = ?', Number(req.body.application_id));
    if (!a || !canEdit(a, req.user) || a.status !== 'published') fail(400, 'app_required', 'Выберите опубликованную заявку для продвижения');
    appId = a.id;
  }
  const disc = S.levelOf(req.user.points).discount;
  const amount = Math.round(t.price * (100 - disc) / 100);
  const id = run('INSERT INTO payments (user_id, tariff_id, application_id, amount, discount, method, save_card, provider_id) VALUES (?,?,?,?,?,?,?,?)',
    req.user.id, t.id, appId, amount, disc, req.body.method, req.body.save_card ? 1 : 0, PAY === 'test' ? 'test_' + crypto.randomBytes(8).toString('hex') : null).lastInsertRowid;
  audit(req, 'payment.create', 'payment:' + id, { tariff: t.code, amount });
  if (PAY === 'test') {
    if (req.body.method === 'saved_card') { completePayment(id, true, req.user.card_mask); return res.json({ id, status: 'succeeded' }); }
    return res.json({ id, status: 'pending', confirmation_url: `#/pay/${id}` });
  }
  // ЮKassa: создаём платёж и отправляем пользователя на страницу оплаты провайдера
  let yp;
  try {
    yp = await YK.createPayment({ localId: id, amount, description: `${t.name_ru}, заказ №${id}`, customer: req.user.email || req.user.phone, itemName: t.name_ru,
      method: req.body.method, saveCard: !!req.body.save_card, paymentMethodId: req.user.card_token, returnUrl: `${S.BASE_URL}/#/pay/${id}` });
  } catch (e) { run("UPDATE payments SET status = 'canceled' WHERE id = ?", id); throw e; }
  const url = (yp.confirmation && yp.confirmation.confirmation_url) || null;
  run('UPDATE payments SET provider_id = ?, confirmation_url = ? WHERE id = ?', yp.id, url, id);
  const r = await syncPayment(get('SELECT * FROM payments WHERE id = ?', id), yp);
  res.json({ id, status: r.status, confirmation_url: r.status === 'pending' ? url : null });
}));
// Сверка платежа с ЮKassa: статус и сумма берутся только из API провайдера (уведомлениям не доверяем на слово)
async function syncPayment(p, known) {
  if (PAY !== 'yookassa' || !p || p.status !== 'pending' || !p.provider_id) return p;
  const yp = known || await YK.getPayment(p.provider_id);
  if (yp.id !== p.provider_id) return p;
  if (yp.status === 'succeeded') {
    if (Number(yp.amount && yp.amount.value) !== p.amount) { console.error('ЮKassa: сумма платежа не совпадает', p.id); return p; }
    const c = YK.cardInfo(yp);
    return completePayment(p.id, true, c.mask, c.token);
  }
  if (yp.status === 'canceled') return completePayment(p.id, false);
  return p;
}
// Контрольная сумма номера карты (алгоритм Луна) — отсекает опечатки до обращения к банку
function luhn(n) { let sum = 0; for (let i = 0; i < n.length; i++) { let d = +n[n.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; }
function completePayment(id, ok, cardMask, cardToken) {
  const p = get('SELECT * FROM payments WHERE id = ?', id);
  if (!p || p.status !== 'pending') return p;
  const t = get('SELECT * FROM tariffs WHERE id = ?', p.tariff_id), u = get('SELECT * FROM users WHERE id = ?', p.user_id);
  if (!ok) { run("UPDATE payments SET status = 'canceled' WHERE id = ?", id); return get('SELECT * FROM payments WHERE id = ?', id); }
  const receipt = { customer: u.email || u.phone, items: [{ name: t.name_ru, quantity: 1, price: p.amount, vat: 'none', payment_subject: 'service', payment_mode: 'full_payment' }], total: p.amount, method: p.method };
  tx(() => {
    run("UPDATE payments SET status = 'succeeded', paid_at = datetime('now'), receipt = ? WHERE id = ?", JSON.stringify(receipt), id);
    if (t.feature === 'promote' && p.application_id) {
      run("UPDATE applications SET promoted_until = datetime(MAX(COALESCE(promoted_until, datetime('now')), datetime('now')), ?) WHERE id = ?", `+${t.period_days} days`, p.application_id);
    } else {
      const s = get('SELECT * FROM subscriptions WHERE user_id = ? AND tariff_id = ?', u.id, t.id);
      const base = s && s.until > now() ? s.until : now();
      const until = new Date(new Date(base.replace(' ', 'T') + 'Z').getTime() + t.period_days * 864e5).toISOString().replace('T', ' ').slice(0, 19);
      run('INSERT INTO subscriptions (user_id, tariff_id, until, auto_renew) VALUES (?,?,?,?) ON CONFLICT(user_id, tariff_id) DO UPDATE SET until = excluded.until, auto_renew = MAX(auto_renew, excluded.auto_renew)', u.id, t.id, until, p.save_card ? 1 : 0);
    }
    // карта сохраняется, только если пользователь согласился и провайдер вернул токен (в тестовом режиме — условный токен)
    const token = cardToken || (PAY === 'test' ? 'tok_' + crypto.randomBytes(12).toString('hex') : null);
    if (p.save_card && p.method === 'card' && cardMask && token) run('UPDATE users SET card_token = ?, card_mask = ? WHERE id = ?', token, cardMask, u.id);
  });
  S.notify(u.id, { type: 'payment', title: 'Оплата прошла успешно', body: `${t.name_ru} — ${p.amount} ₽. Чек отправлен на ${receipt.customer}.`, link: '#/me/payments', pushTitle: 'Оплата прошла', pushBody: 'Тариф подключён' });
  return get('SELECT * FROM payments WHERE id = ?', id);
}
app.get('/api/payments/:id', needAuth, h(async (req, res) => {
  const q = () => get('SELECT p.*, t.name_ru, t.name_en, t.feature FROM payments p JOIN tariffs t ON t.id = p.tariff_id WHERE p.id = ? AND p.user_id = ?', Number(req.params.id), req.user.id);
  let p = q();
  if (!p) fail(404, 'not_found', 'Платёж не найден');
  if (p.status === 'pending' && PAY === 'yookassa') { try { await syncPayment(p); p = q(); } catch (e) { /* провайдер недоступен — покажем текущий статус */ } }
  res.json({ item: Object.assign(p, { provider: PAY }) });
}));
// Уведомления ЮKassa (payment.succeeded / payment.canceled). Тело уведомления не считается доказательством оплаты:
// по id платежа запрашиваем его состояние у ЮKassa с нашими ключами и только после этого подключаем тариф.
app.post('/api/payments/webhook', h(async (req, res) => {
  if (PAY !== 'yookassa') fail(503, 'not_configured', 'Платёжный провайдер не подключён');
  const obj = req.body && req.body.object;
  if (!obj || typeof obj.id !== 'string') fail(400, 'bad_request', 'Неверное уведомление');
  const p = get('SELECT * FROM payments WHERE provider_id = ?', str(obj.id, 100));
  if (!p) return res.json({ ok: true }); // не наш платёж — отвечаем 200, чтобы ЮKassa не повторяла
  const r = await syncPayment(p);
  run('INSERT INTO audit (user_id, action, target, meta, ip) VALUES (?,?,?,?,?)', p.user_id, 'payment.webhook', 'payment:' + p.id, String(r.status), req.ip || '');
  res.json({ ok: true, status: r.status });
}));
// Подтверждение платежа на тестовой странице провайдера (в рабочем режиме — вебхук провайдера)
app.post('/api/payments/:id/confirm', needAuth, h((req, res) => {
  const p = get('SELECT * FROM payments WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!p) fail(404, 'not_found', 'Платёж не найден');
  // Тестовая страница оплаты существует только в тестовом режиме без ключей ЮKassa; иначе статус приходит от провайдера
  if (PAY !== 'test') fail(403, 'provider_required', 'Подтверждение оплаты приходит от платёжного провайдера');
  let mask = null;
  if (p.method === 'card' && req.body.success) {
    const card = String(req.body.card || '').replace(/\D/g, '');
    if (card.length < 16 || card.length > 19 || !luhn(card)) fail(400, 'bad_card', 'Проверьте номер карты');
    mask = '•••• ' + card.slice(-4);
  }
  const r = completePayment(p.id, !!req.body.success, mask);
  audit(req, 'payment.' + r.status, 'payment:' + p.id);
  res.json({ item: r });
}));
app.get('/api/my/payments', needAuth, h((req, res) => res.json({ items: all('SELECT p.*, t.name_ru, t.name_en FROM payments p JOIN tariffs t ON t.id = p.tariff_id WHERE p.user_id = ? ORDER BY p.id DESC', req.user.id) })));
app.post('/api/subscriptions/:id/auto', needAuth, h((req, res) => {
  run('UPDATE subscriptions SET auto_renew = ? WHERE id = ? AND user_id = ?', req.body.auto_renew ? 1 : 0, Number(req.params.id), req.user.id); res.json({ ok: true });
}));
app.delete('/api/me/card', needAuth, h((req, res) => {
  run('UPDATE users SET card_token = NULL, card_mask = NULL WHERE id = ?', req.user.id);
  run('UPDATE subscriptions SET auto_renew = 0 WHERE user_id = ?', req.user.id);
  audit(req, 'card.unlink', 'user:' + req.user.id); res.json({ ok: true });
}));
// Автопродление по привязанной карте (за сутки до окончания; не чаще одной попытки в сутки)
async function autoRenew() {
  if (PAY === 'none') return;
  const due = all("SELECT s.*, u.card_token, u.card_mask FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.auto_renew = 1 AND s.until < datetime('now', '+1 day') AND u.card_token IS NOT NULL AND u.blocked = 0");
  for (const s of due) {
    const t = get('SELECT * FROM tariffs WHERE id = ? AND active = 1', s.tariff_id); if (!t) continue;
    if (get("SELECT 1 FROM payments WHERE user_id = ? AND tariff_id = ? AND auto = 1 AND created_at > datetime('now', '-1 day')", s.user_id, t.id)) continue;
    const u = get('SELECT * FROM users WHERE id = ?', s.user_id);
    const disc = S.levelOf(u.points).discount, amount = Math.round(t.price * (100 - disc) / 100);
    const id = run("INSERT INTO payments (user_id, tariff_id, amount, discount, method, auto, provider_id) VALUES (?,?,?,?, 'saved_card', 1, ?)", u.id, t.id, amount, disc, PAY === 'test' ? 'test_auto_' + crypto.randomBytes(6).toString('hex') : null).lastInsertRowid;
    if (PAY === 'test') { completePayment(id, true, s.card_mask); continue; }
    try {
      const yp = await YK.createPayment({ localId: id, amount, description: `${t.name_ru}, автопродление, заказ №${id}`, customer: u.email || u.phone, itemName: t.name_ru, method: 'saved_card', paymentMethodId: s.card_token });
      run('UPDATE payments SET provider_id = ? WHERE id = ?', yp.id, id);
      const r = await syncPayment(get('SELECT * FROM payments WHERE id = ?', id), yp);
      if (r.status === 'canceled') {
        run('UPDATE subscriptions SET auto_renew = 0 WHERE id = ?', s.id);
        S.notify(u.id, { type: 'payment', title: 'Автопродление не прошло', body: `${t.name_ru}: банк отклонил списание. Оплатите тариф вручную в разделе «Тарифы».`, link: '#/tariffs' });
      }
    } catch (e) { run("UPDATE payments SET status = 'canceled' WHERE id = ?", id); console.error('Автопродление:', e.message); }
  }
}
setInterval(() => autoRenew().catch((e) => console.error('Автопродление:', e.message)), 3600e3).unref();

/* ---------- семейный аккаунт ---------- */
app.get('/api/family', needAuth, h((req, res) => {
  const invites = all("SELECT i.id, f.name, u.name owner FROM family_invites i JOIN families f ON f.id = i.family_id JOIN users u ON u.id = f.owner_id WHERE i.status = 'pending' AND (i.user_id = ? OR i.target = ? OR i.target = ?)", req.user.id, N(req.user.email) || '-', N(req.user.phone) || '-');
  if (!req.user.family_id) return res.json({ family: null, invites });
  const f = get('SELECT * FROM families WHERE id = ?', req.user.family_id);
  res.json({ family: {
    id: f.id, name: f.name, is_owner: f.owner_id === req.user.id,
    members: all('SELECT id, name, email, phone, avatar FROM users WHERE family_id = ?', f.id).map((m) => Object.assign(m, { owner: m.id === f.owner_id })),
    pending: all("SELECT id, target, created_at FROM family_invites WHERE family_id = ? AND status = 'pending'", f.id)
  }, invites });
}));
app.post('/api/family', needAuth, h((req, res) => {
  if (req.user.family_id) fail(400, 'exists', 'Вы уже состоите в семейном аккаунте');
  const id = run('INSERT INTO families (owner_id, name) VALUES (?,?)', req.user.id, str(req.body.name, 60) || 'Моя семья').lastInsertRowid;
  run('UPDATE users SET family_id = ? WHERE id = ?', id, req.user.id);
  audit(req, 'family.create', 'family:' + id); res.json({ ok: true });
}));
app.post('/api/family/invite', needAuth, h((req, res) => {
  const f = req.user.family_id && get('SELECT * FROM families WHERE id = ?', req.user.family_id);
  if (!f || f.owner_id !== req.user.id) fail(403, 'forbidden', 'Приглашать может владелец семейного аккаунта');
  if (get('SELECT COUNT(*) c FROM users WHERE family_id = ?', f.id).c >= 10) fail(400, 'limit', 'В семье не более 10 человек');
  const t = normTarget(req.body.target);
  const u = get(`SELECT * FROM users WHERE ${t.type} = ?`, t.value);
  if (u && u.family_id === f.id) fail(400, 'already', 'Уже в вашей семье');
  if (get("SELECT 1 FROM family_invites WHERE family_id = ? AND target = ? AND status = 'pending'", f.id, t.value)) fail(400, 'invited', 'Приглашение уже отправлено');
  rateLimit('finv:' + req.user.id, 10, 24 * 3600e3);
  rateLimit('finvt:' + t.value, 3, 24 * 3600e3);
  run('INSERT INTO family_invites (family_id, target, user_id) VALUES (?,?,?)', f.id, t.value, u ? u.id : null);
  if (u) S.notify(u.id, { type: 'family', title: 'Приглашение в семейный аккаунт', body: `${req.user.name} приглашает вас в «${f.name}»`, link: '#/me/family', pushTitle: 'Приглашение в семью', pushBody: 'Откройте личный кабинет' });
  else if (t.type === 'email') S.sendEmail(t.value, 'Приглашение в «Мой лучший агент»', `${req.user.name} приглашает вас в семейный аккаунт. Зарегистрируйтесь: ${S.BASE_URL}`);
  else S.sendSms(t.value, `${req.user.name} приглашает вас в семейный аккаунт «Мой лучший агент»: ${S.BASE_URL}`);
  audit(req, 'family.invite', 'family:' + f.id); res.json({ ok: true });
}));
app.post('/api/family/invites/:id/:action', needAuth, h((req, res) => {
  const i = get("SELECT * FROM family_invites WHERE id = ? AND status = 'pending' AND (user_id = ? OR target = ? OR target = ?)", Number(req.params.id), req.user.id, N(req.user.email) || '-', N(req.user.phone) || '-');
  if (!i) fail(404, 'not_found', 'Приглашение не найдено');
  if (req.params.action === 'accept') {
    if (req.user.family_id) fail(400, 'exists', 'Сначала выйдите из текущего семейного аккаунта');
    run('UPDATE users SET family_id = ? WHERE id = ?', i.family_id, req.user.id);
    run("UPDATE family_invites SET status = 'accepted', user_id = ? WHERE id = ?", req.user.id, i.id);
  } else run("UPDATE family_invites SET status = 'declined' WHERE id = ?", i.id);
  audit(req, 'family.invite_' + req.params.action, 'family:' + i.family_id); res.json({ ok: true });
}));
app.post('/api/family/leave', needAuth, h((req, res) => {
  const f = req.user.family_id && get('SELECT * FROM families WHERE id = ?', req.user.family_id);
  if (!f) fail(400, 'none', 'Вы не в семейном аккаунте');
  if (f.owner_id === req.user.id) {
    tx(() => { run('UPDATE users SET family_id = NULL WHERE family_id = ?', f.id); run('UPDATE applications SET family_id = NULL WHERE family_id = ?', f.id); run('DELETE FROM family_invites WHERE family_id = ?', f.id); run('DELETE FROM families WHERE id = ?', f.id); });
  } else { run('UPDATE users SET family_id = NULL WHERE id = ?', req.user.id); run('UPDATE applications SET family_id = NULL WHERE user_id = ?', req.user.id); }
  audit(req, 'family.leave', 'family:' + f.id); res.json({ ok: true });
}));
app.delete('/api/family/members/:uid', needAuth, h((req, res) => {
  const f = req.user.family_id && get('SELECT * FROM families WHERE id = ?', req.user.family_id);
  if (!f || f.owner_id !== req.user.id) fail(403, 'forbidden', 'Только владелец');
  const uid = Number(req.params.uid);
  if (run('UPDATE users SET family_id = NULL WHERE id = ? AND family_id = ? AND id != ?', uid, f.id, req.user.id).changes) run('UPDATE applications SET family_id = NULL WHERE user_id = ? AND family_id = ?', uid, f.id);
  audit(req, 'family.remove', 'user:' + uid); res.json({ ok: true });
}));

/* ---------- сообщество, рейтинг, истории, лиды ---------- */
app.post('/api/role-requests', needAuth, h((req, res) => {
  const role = req.body.role;
  if (!['volunteer', 'partner'].includes(role)) fail(400, 'bad_role', 'Роль');
  if (get("SELECT 1 FROM role_requests WHERE user_id = ? AND status = 'pending'", req.user.id)) fail(400, 'pending', 'Заявка уже на рассмотрении');
  if (role === 'partner' && !str(req.body.org_name)) fail(400, 'org_required', 'Укажите название организации');
  if (!req.user.zone_enabled) fail(400, 'zone_required', 'Сначала укажите зону оповещений в личном кабинете');
  run('INSERT INTO role_requests (user_id, role, org_name, org_type, details) VALUES (?,?,?,?,?)', req.user.id, role, str(req.body.org_name, 160), str(req.body.org_type, 80), str(req.body.details, 2000));
  notifyMods(role === 'partner' ? 'Заявка партнёра' : 'Заявка волонтёра', req.user.name, '#/admin/roles');
  audit(req, 'role.request', 'user:' + req.user.id, role); res.json({ ok: true });
}));
app.get('/api/role-requests/my', needAuth, h((req, res) => res.json({ items: all('SELECT * FROM role_requests WHERE user_id = ? ORDER BY id DESC', req.user.id) })));
app.get('/api/rating', h((req, res) => {
  const rows = all("SELECT id, name, role, org_name, points, avatar, city FROM users WHERE blocked = 0 AND role IN ('volunteer','partner','user') AND points > 0 ORDER BY points DESC LIMIT 50");
  res.json({ items: rows.map((u, i) => ({ place: i + 1, name: u.role === 'partner' && u.org_name ? u.org_name : u.name.split(' ')[0] + (u.name.split(' ')[1] ? ' ' + u.name.split(' ')[1][0] + '.' : ''), role: u.role, points: u.points, level: S.levelOf(u.points), avatar: u.avatar, city: u.city, me: req.user && req.user.id === u.id })) });
}));
app.get('/api/my/points', needAuth, h((req, res) => res.json({ items: I18N.localize(all('SELECT * FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id), ['reason'], I18N.isEn(req)) })));
app.get('/api/stories', h((req, res) => res.json({ items: all('SELECT * FROM stories WHERE published = 1 ORDER BY id DESC LIMIT 12') })));
app.get('/api/stats/public', h((req, res) => {
  res.set('Cache-Control', 'max-age=30');
  res.json({
    active: get("SELECT COUNT(*) c FROM applications WHERE status = 'published'").c,
    found: get("SELECT COUNT(*) c FROM applications WHERE status = 'found'").c,
    volunteers: get("SELECT COUNT(*) c FROM users WHERE role IN ('volunteer','partner')").c,
    matches: get('SELECT COUNT(*) c FROM matches').c,
    emergencies: get("SELECT COUNT(*) c FROM applications WHERE emergency_status = 'active'").c,
    byCategory: Object.fromEntries(CATS.map((c) => [c, {
      lost: get("SELECT COUNT(*) c FROM applications WHERE category = ? AND kind = 'lost' AND status = 'published'", c).c,
      found: get("SELECT COUNT(*) c FROM applications WHERE category = ? AND status = 'found'", c).c
    }]))
  });
}));
app.post('/api/leads', h((req, res) => {
  rateLimit('lead:' + req.ip, 5, 3600e3);
  const kind = ['partner', 'investor'].includes(req.body.kind) ? req.body.kind : 'partner';
  const name = str(req.body.name, 120), contact = str(req.body.contact, 120);
  if (!name || !contact) fail(400, 'required', 'Укажите имя и контакт');
  if (!req.body.consent) fail(400, 'consent_required', 'Нужно согласие на обработку персональных данных');
  run('INSERT INTO leads (kind, name, contact, org, message) VALUES (?,?,?,?,?)', kind, name, contact, str(req.body.org, 160), str(req.body.message, 2000));
  notifyMods(kind === 'investor' ? 'Заявка инвестора' : 'Заявка партнёра (с сайта)', name, '#/admin/leads');
  res.json({ ok: true });
}));

/* ---------- поддержка ---------- */
app.get('/api/tickets', needAuth, h((req, res) => res.json({ items: all('SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) msgs FROM tickets t WHERE user_id = ? ORDER BY updated_at DESC', req.user.id) })));
app.post('/api/tickets', needAuth, h((req, res) => {
  rateLimit('tk:' + req.user.id, 10, 3600e3);
  const subject = str(req.body.subject, 160), text = str(req.body.text, 4000);
  if (!subject || !text) fail(400, 'required', 'Заполните тему и сообщение');
  const id = run('INSERT INTO tickets (user_id, subject) VALUES (?,?)', req.user.id, subject).lastInsertRowid;
  run('INSERT INTO ticket_messages (ticket_id, user_id, text) VALUES (?,?,?)', id, req.user.id, text);
  notifyMods('Новое обращение в поддержку', subject, '#/admin/support');
  res.json({ id });
}));
function ticketFor(id, u) {
  const t = get('SELECT * FROM tickets WHERE id = ?', id);
  if (!t || (t.user_id !== u.id && !isMod(u))) fail(404, 'not_found', 'Обращение не найдено');
  return t;
}
app.get('/api/tickets/:id', needAuth, h((req, res) => {
  const t = ticketFor(Number(req.params.id), req.user);
  const user = get('SELECT id, name, email, phone FROM users WHERE id = ?', t.user_id);
  res.json({ ticket: t, user: isMod(req.user) ? user : undefined, messages: all('SELECT id, staff, text, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id', t.id) });
}));
app.post('/api/tickets/:id/messages', needAuth, h((req, res) => {
  const t = ticketFor(Number(req.params.id), req.user);
  const text = str(req.body.text, 4000); if (!text) fail(400, 'required', 'Пустое сообщение');
  const staff = isMod(req.user) && t.user_id !== req.user.id ? 1 : 0;
  run('INSERT INTO ticket_messages (ticket_id, user_id, staff, text) VALUES (?,?,?,?)', t.id, req.user.id, staff, text);
  run("UPDATE tickets SET updated_at = datetime('now'), status = ? WHERE id = ?", staff ? 'answered' : 'open', t.id);
  if (staff) { S.notify(t.user_id, { type: 'support', title: 'Ответ поддержки', body: t.subject, link: `#/support/${t.id}`, pushTitle: 'Ответ поддержки', pushBody: 'Откройте обращение' }); audit(req, 'support.reply', 'ticket:' + t.id); }
  else notifyMods('Новое сообщение в обращении', t.subject, '#/admin/support');
  res.json({ ok: true });
}));
app.post('/api/tickets/:id/close', needAuth, h((req, res) => {
  const t = ticketFor(Number(req.params.id), req.user);
  run("UPDATE tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?", t.id); res.json({ ok: true });
}));

/* =================== ПАНЕЛЬ АДМИНИСТРАТОРА =================== */
const A = express.Router();
A.use(needMod);

function statsData() {
  const byCat = all('SELECT category, kind, status, COUNT(*) c FROM applications GROUP BY category, kind, status');
  const regions = all("SELECT COALESCE(NULLIF(city,''),'не указан') city, COUNT(*) total, SUM(status = 'found') found, SUM(status = 'published') active FROM applications GROUP BY 1 ORDER BY total DESC LIMIT 20");
  const days = all("SELECT date(created_at) d, COUNT(*) c FROM applications WHERE created_at >= date('now','-29 days') GROUP BY 1 ORDER BY 1");
  const foundDays = all("SELECT date(found_at) d, COUNT(*) c FROM applications WHERE found_at >= date('now','-29 days') GROUP BY 1 ORDER BY 1");
  return {
    totals: {
      applications: get('SELECT COUNT(*) c FROM applications').c,
      pending: get("SELECT COUNT(*) c FROM applications WHERE status = 'pending'").c,
      published: get("SELECT COUNT(*) c FROM applications WHERE status = 'published'").c,
      found: get("SELECT COUNT(*) c FROM applications WHERE status = 'found'").c,
      matches: get('SELECT COUNT(*) c FROM matches').c,
      users: get('SELECT COUNT(*) c FROM users').c,
      volunteers: get("SELECT COUNT(*) c FROM users WHERE role = 'volunteer'").c,
      partners: get("SELECT COUNT(*) c FROM users WHERE role = 'partner'").c,
      emergencies_active: get("SELECT COUNT(*) c FROM applications WHERE emergency_status = 'active'").c,
      emergencies_pending: get("SELECT COUNT(*) c FROM applications WHERE emergency_status = 'pending'").c,
      complaints: get("SELECT COUNT(*) c FROM complaints WHERE status = 'open'").c,
      tickets: get("SELECT COUNT(*) c FROM tickets WHERE status = 'open'").c,
      roles: get("SELECT COUNT(*) c FROM role_requests WHERE status = 'pending'").c,
      deletion: get("SELECT COUNT(*) c FROM deletion_requests WHERE status = 'open'").c,
      leads: get("SELECT COUNT(*) c FROM leads WHERE status = 'new'").c,
      revenue: get("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE status = 'succeeded'").c
    },
    byCat, regions, days, foundDays
  };
}
A.get('/stats', h((req, res) => res.json(statsData())));

A.get('/applications', h((req, res) => {
  const q = req.query, where = ['1=1'], p = [];
  if (q.status) { where.push('a.status = ?'); p.push(str(q.status, 20)); }
  if (CATS.includes(q.category)) { where.push('a.category = ?'); p.push(q.category); }
  if (q.q) { where.push('(lower(a.title) LIKE ? OR lower(a.person_name) LIKE ? OR a.id = ?)'); p.push('%' + str(q.q).toLowerCase() + '%', '%' + str(q.q).toLowerCase() + '%', Number(q.q) || -1); }
  const rows = all(`SELECT a.*, u.name author_name, u.email author_email, u.phone author_phone FROM applications a JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 300`, ...p);
  res.json({ items: rows.map((a) => appDto(a, req.user, { author_name: a.author_name, author_contact: a.author_email || a.author_phone, contact: a.contact, relation: a.relation, complaints: get("SELECT COUNT(*) c FROM complaints WHERE target_type = 'application' AND target_id = ? AND status = 'open'", a.id).c })) });
}));
A.post('/applications/:id/moderate', h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a) fail(404, 'not_found', 'Заявка не найдена');
  const action = req.body.action;
  if (action === 'approve') {
    run("UPDATE applications SET status = 'published', reject_reason = '', updated_at = datetime('now') WHERE id = ?", a.id);
    S.notify(a.user_id, { type: 'moderation', title: 'Заявка опубликована', body: `«${a.title}» прошла проверку`, link: `#/a/${a.id}`, pushTitle: 'Заявка опубликована', pushBody: 'Ваша заявка прошла проверку' });
    S.runMatching(get('SELECT * FROM applications WHERE id = ?', a.id));
  } else if (action === 'reject') {
    const reason = str(req.body.reason, 500) || 'Не соответствует правилам';
    run("UPDATE applications SET status = 'rejected', reject_reason = ?, emergency_status = CASE WHEN emergency_status = 'pending' THEN 'rejected' ELSE emergency_status END WHERE id = ?", reason, a.id);
    S.notify(a.user_id, { type: 'moderation', title: 'Заявка отклонена', body: `«${a.title}»: ${reason}`, link: `#/a/${a.id}`, pushTitle: 'Заявка не прошла проверку', pushBody: 'Откройте заявку, чтобы узнать причину' });
  } else if (action === 'hide') {
    run("UPDATE applications SET status = 'closed' WHERE id = ?", a.id);
  } else if (action === 'delete') {
    tx(() => { run('DELETE FROM matches WHERE lost_id = ? OR found_id = ?', a.id, a.id); run('DELETE FROM applications WHERE id = ?', a.id); });
  } else fail(400, 'bad_action', 'Действие');
  audit(req, 'moderation.' + action, 'application:' + a.id, str(req.body.reason, 200));
  res.json({ ok: true });
}));
A.get('/emergencies', h((req, res) => {
  const rows = all("SELECT * FROM applications WHERE emergency_status IN ('pending','active') ORDER BY emergency_status = 'pending' DESC, id DESC");
  res.json({ items: rows.map((a) => appDto(a, req.user, { emergency_status: a.emergency_status, emergency_radius: a.emergency_radius,
    reach: all('SELECT zone_lat, zone_lng, zone_radius FROM users WHERE zone_enabled = 1 AND blocked = 0 AND id != ?', a.user_id).filter((u) => { const d = S.distKm(u.zone_lat, u.zone_lng, a.lat, a.lng); return d != null && d <= a.emergency_radius + u.zone_radius; }).length })) });
}));
A.post('/emergencies/:id', h((req, res) => {
  const a = get('SELECT * FROM applications WHERE id = ?', Number(req.params.id));
  if (!a) fail(404, 'not_found', 'Заявка не найдена');
  const action = req.body.action; let sent = 0;
  if (action === 'approve') {
    if (a.status !== 'published') fail(400, 'not_published', 'Сначала опубликуйте заявку (пройдите модерацию)');
    const r = emRadius(req.body.radius, null); if (r) run('UPDATE applications SET emergency_radius = ? WHERE id = ?', r, a.id);
    run("UPDATE applications SET emergency_status = 'active' WHERE id = ?", a.id);
    sent = S.broadcastEmergency(get('SELECT * FROM applications WHERE id = ?', a.id));
    S.notify(a.user_id, { type: 'emergency', title: 'Экстренное оповещение запущено', body: `Оповещено пользователей рядом: ${sent}`, link: `#/a/${a.id}`, pushTitle: 'Оповещение запущено', pushBody: 'Люди рядом получили уведомление' });
  } else if (action === 'reject') run("UPDATE applications SET emergency_status = 'rejected' WHERE id = ?", a.id);
  else if (action === 'stop') run("UPDATE applications SET emergency_status = 'done' WHERE id = ?", a.id);
  else if (action === 'resend') { if (a.emergency_status !== 'active') fail(400, 'not_active', 'Оповещение не активно'); sent = S.broadcastEmergency(a); }
  else fail(400, 'bad_action', 'Действие');
  audit(req, 'emergency.' + action, 'application:' + a.id, { sent });
  res.json({ ok: true, sent });
}));
A.get('/complaints', h((req, res) => {
  const rows = all("SELECT c.*, u.name author FROM complaints c JOIN users u ON u.id = c.user_id ORDER BY c.status = 'open' DESC, c.id DESC LIMIT 300");
  res.json({ items: rows.map((c) => {
    let target = null;
    if (c.target_type === 'application') { const a = get('SELECT id, title, status, user_id FROM applications WHERE id = ?', c.target_id); target = a && { title: a.title, link: `#/a/${a.id}`, user_id: a.user_id, status: a.status }; }
    if (c.target_type === 'chat') { const ch = get('SELECT c.*, a.title FROM chats c JOIN applications a ON a.id = c.application_id WHERE c.id = ?', c.target_id); target = ch && { title: 'Чат: ' + ch.title, chat_id: ch.id, user_ids: [ch.owner_id, ch.other_id].filter((x) => x !== c.user_id) }; }
    if (c.target_type === 'user') { const u = get('SELECT id, name FROM users WHERE id = ?', c.target_id); target = u && { title: u.name, user_id: u.id }; }
    return Object.assign(c, { target });
  }) });
}));
A.post('/complaints/:id', h((req, res) => {
  const c = get('SELECT * FROM complaints WHERE id = ?', Number(req.params.id)); if (!c) fail(404, 'not_found', 'Жалоба не найдена');
  run('UPDATE complaints SET status = ? WHERE id = ?', req.body.action === 'dismiss' ? 'dismissed' : 'resolved', c.id);
  if (req.body.hide && c.target_type === 'application') run("UPDATE applications SET status = 'closed' WHERE id = ?", c.target_id);
  if (req.body.block_user) {
    const bu = get('SELECT * FROM users WHERE id = ?', Number(req.body.block_user));
    if (!bu || bu.role === 'admin' || (bu.role === 'moderator' && req.user.role !== 'admin') || bu.id === req.user.id) fail(403, 'forbidden', 'Недостаточно прав');
    run('UPDATE users SET blocked = 1 WHERE id = ?', bu.id); run('DELETE FROM sessions WHERE user_id = ?', bu.id); S.dropStreams(bu.id);
  }
  if (req.body.block_chat && c.target_type === 'chat') run('UPDATE chats SET blocked_by = ? WHERE id = ?', req.user.id, c.target_id);
  audit(req, 'complaint.' + (req.body.action || 'resolve'), 'complaint:' + c.id, { hide: !!req.body.hide, block_user: req.body.block_user || null });
  res.json({ ok: true });
}));
A.get('/chats/:id', h((req, res) => {
  const c = get('SELECT c.*, a.title FROM chats c JOIN applications a ON a.id = c.application_id WHERE c.id = ?', Number(req.params.id)); if (!c) fail(404, 'not_found', 'Чат не найден');
  audit(req, 'moderation.chat_view', 'chat:' + c.id);
  res.json({ chat: c, messages: all('SELECT * FROM messages WHERE chat_id = ? ORDER BY id', c.id).map((m) => Object.assign(m, { from: m.sender_id === c.other_id ? 'other' : 'owner' })) });
}));
A.get('/users', h((req, res) => {
  const q = str(req.query.q).toLowerCase(), where = ['1=1'], p = [];
  if (q) { where.push('(lower(name) LIKE ? OR lower(email) LIKE ? OR phone LIKE ? OR lower(org_name) LIKE ?)'); p.push('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (req.query.role) { where.push('role = ?'); p.push(str(req.query.role, 20)); }
  res.json({ items: all(`SELECT id, email, phone, name, role, city, org_name, blocked, points, zone_enabled, created_at, (SELECT COUNT(*) FROM applications a WHERE a.user_id = users.id) apps FROM users WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`, ...p) });
}));
A.patch('/users/:id', h((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id)); if (!u) fail(404, 'not_found', 'Пользователь не найден');
  if ('role' in req.body) {
    if (req.user.role !== 'admin') fail(403, 'forbidden', 'Менять роли может только администратор');
    if (!['user', 'volunteer', 'partner', 'moderator', 'admin'].includes(req.body.role)) fail(400, 'bad_role', 'Роль');
    if (u.id === req.user.id) fail(400, 'self', 'Нельзя изменить собственную роль');
    run('UPDATE users SET role = ? WHERE id = ?', req.body.role, u.id);
  }
  if ('blocked' in req.body) {
    if (u.role === 'admin' || (u.role === 'moderator' && req.user.role !== 'admin')) fail(403, 'forbidden', 'Недостаточно прав');
    run('UPDATE users SET blocked = ? WHERE id = ?', req.body.blocked ? 1 : 0, u.id);
    if (req.body.blocked) { run('DELETE FROM sessions WHERE user_id = ?', u.id); S.dropStreams(u.id); }
  }
  if (req.body.points) {
    const pts = Math.round(num(req.body.points) || 0);
    if (u.id === req.user.id) fail(400, 'self', 'Нельзя начислять баллы самому себе');
    if (!pts || (req.user.role !== 'admin' && Math.abs(pts) > 500)) fail(400, 'bad_points', 'Модератор начисляет не более 500 баллов за раз');
    S.addPoints(u.id, pts, str(req.body.reason, 200) || 'Начисление модератором за полезную информацию');
  }
  audit(req, 'user.admin_update', 'user:' + u.id, req.body);
  res.json({ ok: true });
}));
A.get('/role-requests', h((req, res) => res.json({ items: all("SELECT r.*, u.name, u.email, u.phone, u.city, u.zone_lat, u.zone_lng, u.zone_radius FROM role_requests r JOIN users u ON u.id = r.user_id ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 200") })));
A.post('/role-requests/:id', h((req, res) => {
  const r = get('SELECT * FROM role_requests WHERE id = ?', Number(req.params.id)); if (!r || r.status !== 'pending') fail(404, 'not_found', 'Заявка не найдена');
  const ok = req.body.action === 'approve';
  run('UPDATE role_requests SET status = ? WHERE id = ?', ok ? 'approved' : 'rejected', r.id);
  if (ok) run("UPDATE users SET role = ?, org_name = CASE WHEN ? != '' THEN ? ELSE org_name END WHERE id = ? AND role NOT IN ('moderator','admin')", r.role, r.org_name, r.org_name, r.user_id);
  S.notify(r.user_id, { type: 'role', title: ok ? (r.role === 'partner' ? 'Вы стали партнёром платформы' : 'Вы стали волонтёром') : 'Заявка на роль отклонена', body: ok ? 'Теперь вы получаете экстренные оповещения по своей зоне' : str(req.body.reason, 300), link: '#/me', pushTitle: ok ? 'Роль подтверждена' : 'Заявка отклонена', pushBody: 'Откройте личный кабинет' });
  audit(req, 'role.' + (ok ? 'approve' : 'reject'), 'user:' + r.user_id, r.role);
  res.json({ ok: true });
}));
A.get('/deletion', h((req, res) => res.json({ items: all("SELECT d.*, a.title, a.status app_status FROM deletion_requests d LEFT JOIN applications a ON a.id = d.application_id ORDER BY d.status = 'open' DESC, d.id DESC") })));
A.post('/deletion/:id', h((req, res) => {
  const d = get('SELECT * FROM deletion_requests WHERE id = ?', Number(req.params.id)); if (!d) fail(404, 'not_found', 'Запрос не найден');
  if (req.body.action === 'delete') tx(() => { run('DELETE FROM matches WHERE lost_id = ? OR found_id = ?', d.application_id, d.application_id); run('DELETE FROM applications WHERE id = ?', d.application_id); });
  run('UPDATE deletion_requests SET status = ? WHERE id = ?', req.body.action === 'delete' ? 'done' : 'rejected', d.id);
  audit(req, 'deletion.' + req.body.action, 'application:' + d.application_id);
  res.json({ ok: true });
}));
A.get('/tickets', h((req, res) => res.json({ items: all("SELECT t.*, u.name, (SELECT text FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY id DESC LIMIT 1) last FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.status = 'open' DESC, t.updated_at DESC LIMIT 300") })));
A.get('/leads', h((req, res) => res.json({ items: all('SELECT * FROM leads ORDER BY id DESC LIMIT 300') })));
A.post('/leads/:id', h((req, res) => { run('UPDATE leads SET status = ? WHERE id = ?', str(req.body.status, 20) || 'done', Number(req.params.id)); res.json({ ok: true }); }));
A.get('/audit', h((req, res) => res.json({ items: all('SELECT l.*, u.name FROM audit l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 500') })));
A.get('/payments', h((req, res) => res.json({ items: all('SELECT p.*, t.name_ru, u.name FROM payments p JOIN tariffs t ON t.id = p.tariff_id JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 300') })));

// только администратор: тарифы, справочники, переводы, истории, резервные копии
const AD = express.Router(); AD.use(needAdmin);
// Готовность к работе: что подключено, а что ещё нужно настроить (показывается в админке → «Система» и в журнале при запуске)
function readiness() {
  const op = (k) => ((get("SELECT value FROM translations WHERE key = ? AND lang = 'ru'", 'legal.op.' + k) || {}).value || process.env['LEGAL_' + k.toUpperCase()] || '').trim();
  return [
    { key: 'mode', ok: !DEV, value: DEV ? 'test' : 'production' },
    { key: 'base_url', ok: !!process.env.BASE_URL && /^https:\/\//.test(process.env.BASE_URL), value: process.env.BASE_URL || '' },
    { key: 'admin', ok: !!get("SELECT 1 FROM users WHERE role = 'admin' AND blocked = 0"), value: process.env.ADMIN_EMAIL || '' },
    { key: 'email', ok: !!S.channels.email, value: S.channels.email },
    { key: 'sms', ok: !!S.channels.sms, value: S.channels.sms },
    { key: 'payments', ok: PAY === 'yookassa', value: PAY === 'yookassa' ? 'ЮKassa' : PAY },
    { key: 'legal', ok: !!(op('name') && op('inn') && op('ogrn') && op('address')), value: op('name') },
    { key: 'push', ok: !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) || fs.existsSync(path.join(DATA_DIR, 'vapid.json')), value: 'Web Push (VAPID)' },
    { key: 'demo', ok: !get("SELECT 1 FROM users WHERE email LIKE '%@example.com' OR email LIKE '%@mba.local'"), value: '' }
  ];
}
AD.get('/status', h((req, res) => res.json({ items: readiness() })));
AD.get('/outbox', h((req, res) => res.json({ items: all('SELECT * FROM outbox ORDER BY id DESC LIMIT 200') })));
AD.get('/tariffs', h((req, res) => res.json({ items: all('SELECT * FROM tariffs ORDER BY sort, id') })));
AD.post('/tariffs', h((req, res) => {
  const b = req.body, f = ['registry', 'promote', 'partner'].includes(b.feature) ? b.feature : fail(400, 'bad_feature', 'Функция тарифа');
  const vals = [str(b.name_ru, 80), str(b.name_en, 80) || str(b.name_ru, 80), str(b.desc_ru, 300), str(b.desc_en, 300), b.audience === 'partner' ? 'partner' : 'user', Math.max(0, Math.round(num(b.price) || 0)), Math.max(1, Math.round(num(b.period_days) || 30)), f, b.active === false ? 0 : 1, Math.round(num(b.sort) || 0)];
  if (!vals[0]) fail(400, 'name_required', 'Название');
  if (b.id) run('UPDATE tariffs SET name_ru=?, name_en=?, desc_ru=?, desc_en=?, audience=?, price=?, period_days=?, feature=?, active=?, sort=? WHERE id = ?', ...vals, Number(b.id));
  else run('INSERT INTO tariffs (name_ru, name_en, desc_ru, desc_en, audience, price, period_days, feature, active, sort, code) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...vals, f + '_' + Date.now().toString(36));
  audit(req, 'tariff.save', 'tariff:' + (b.id || 'new'), { price: vals[5] }); res.json({ ok: true });
}));
AD.get('/dicts', h((req, res) => res.json({ items: all('SELECT * FROM dicts ORDER BY type, sort, id') })));
AD.post('/dicts', h((req, res) => {
  const b = req.body; if (!str(b.type, 40) || !str(b.value_ru, 120)) fail(400, 'required', 'Заполните поля');
  if (b.id) run('UPDATE dicts SET value_ru = ?, value_en = ?, sort = ? WHERE id = ?', str(b.value_ru, 120), str(b.value_en, 120) || str(b.value_ru, 120), Math.round(num(b.sort) || 0), Number(b.id));
  else run('INSERT INTO dicts (type, value_ru, value_en, sort) VALUES (?,?,?,?)', str(b.type, 40), str(b.value_ru, 120), str(b.value_en, 120) || str(b.value_ru, 120), Math.round(num(b.sort) || 99));
  audit(req, 'dict.save', b.type); res.json({ ok: true });
}));
AD.delete('/dicts/:id', h((req, res) => { run('DELETE FROM dicts WHERE id = ?', Number(req.params.id)); audit(req, 'dict.delete', 'dict:' + req.params.id); res.json({ ok: true }); }));
AD.get('/translations', h((req, res) => res.json({ items: all('SELECT * FROM translations ORDER BY key') })));
AD.post('/translations', h((req, res) => {
  const key = str(req.body.key, 120), lang = req.body.lang === 'en' ? 'en' : 'ru', value = str(req.body.value, 4000);
  if (!key) fail(400, 'required', 'Ключ');
  if (value) run('INSERT INTO translations (key, lang, value) VALUES (?,?,?) ON CONFLICT(key, lang) DO UPDATE SET value = excluded.value', key, lang, value);
  else run('DELETE FROM translations WHERE key = ? AND lang = ?', key, lang);
  audit(req, 'translation.save', key + ':' + lang); res.json({ ok: true });
}));
AD.get('/stories', h((req, res) => res.json({ items: all('SELECT * FROM stories ORDER BY id DESC') })));
AD.post('/stories', h((req, res) => {
  const b = req.body; const v = [CATS.includes(b.category) ? b.category : 'people', str(b.title_ru, 160), str(b.title_en, 160) || str(b.title_ru, 160), str(b.text_ru, 2000), str(b.text_en, 2000) || str(b.text_ru, 2000), str(b.city, 80), b.published === false ? 0 : 1];
  if (!v[1] || !v[3]) fail(400, 'required', 'Заголовок и текст');
  if (b.id) run('UPDATE stories SET category=?, title_ru=?, title_en=?, text_ru=?, text_en=?, city=?, published=? WHERE id = ?', ...v, Number(b.id));
  else run('INSERT INTO stories (category, title_ru, title_en, text_ru, text_en, city, published) VALUES (?,?,?,?,?,?,?)', ...v);
  audit(req, 'story.save', 'story:' + (b.id || 'new')); res.json({ ok: true });
}));
AD.delete('/stories/:id', h((req, res) => { run('DELETE FROM stories WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); }));
AD.post('/backup', h((req, res) => { const f = backup(); audit(req, 'system.backup', path.basename(f)); res.json({ ok: true, file: path.basename(f) }); }));

const KIND = { lost: 'Потеряно', found: 'Найдено' }, CAT = { people: 'Люди', animals: 'Животные', things: 'Вещи' };
const ST = { pending: 'На проверке', published: 'Опубликована', found: 'Найдено', closed: 'Закрыта', rejected: 'Отклонена' };
A.get('/export.xlsx', h(async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Мой лучший агент'; wb.created = new Date();
  const head = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5202E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const s = statsData();
  const w1 = wb.addWorksheet('Сводка');
  w1.columns = [{ header: 'Показатель', key: 'k', width: 38 }, { header: 'Значение', key: 'v', width: 16 }];
  const T = s.totals;
  [['Всего заявок', T.applications], ['На проверке', T.pending], ['Опубликовано', T.published], ['Найдено', T.found], ['Совпадений', T.matches], ['Пользователей', T.users], ['Волонтёров', T.volunteers], ['Партнёров', T.partners], ['Активных экстренных оповещений', T.emergencies_active], ['Выручка, ₽', T.revenue]].forEach(([k, v]) => w1.addRow({ k, v }));
  head(w1);
  const w2 = wb.addWorksheet('По категориям');
  w2.columns = [{ header: 'Категория', key: 'c', width: 16 }, { header: 'Тип', key: 'k', width: 14 }, { header: 'Статус', key: 's', width: 16 }, { header: 'Количество', key: 'n', width: 14 }];
  s.byCat.forEach((r) => w2.addRow({ c: CAT[r.category], k: KIND[r.kind], s: ST[r.status] || r.status, n: r.c })); head(w2);
  const w3 = wb.addWorksheet('По регионам');
  w3.columns = [{ header: 'Город / регион', key: 'c', width: 28 }, { header: 'Всего', key: 't', width: 10 }, { header: 'Активных', key: 'a', width: 12 }, { header: 'Найдено', key: 'f', width: 12 }];
  s.regions.forEach((r) => w3.addRow({ c: r.city, t: r.total, a: r.active, f: r.found })); head(w3);
  const w4 = wb.addWorksheet('Заявки');
  w4.columns = [{ header: '№', key: 'id', width: 8 }, { header: 'Тип', key: 'k', width: 12 }, { header: 'Категория', key: 'c', width: 12 }, { header: 'Статус', key: 's', width: 15 }, { header: 'Заголовок', key: 't', width: 40 }, { header: 'Город', key: 'city', width: 16 }, { header: 'Адрес', key: 'a', width: 30 }, { header: 'Дата события', key: 'd', width: 14 }, { header: 'Создана', key: 'cr', width: 20 }, { header: 'Найдено', key: 'f', width: 20 }, { header: 'Совпадений', key: 'm', width: 12 }, { header: 'Просмотры', key: 'v', width: 12 }];
  for (const a of all('SELECT * FROM applications ORDER BY id DESC')) {
    const col = a.kind === 'lost' ? 'lost_id' : 'found_id';
    w4.addRow({ id: a.id, k: KIND[a.kind], c: CAT[a.category], s: ST[a.status] || a.status, t: a.title, city: a.city, a: a.address, d: a.event_date, cr: a.created_at, f: a.found_at || '', m: get(`SELECT COUNT(*) c FROM matches WHERE ${col} = ?`, a.id).c, v: a.views });
  }
  head(w4); w4.autoFilter = 'A1:L1';
  const w5 = wb.addWorksheet('Совпадения');
  w5.columns = [{ header: 'Потеряно №', key: 'l', width: 12 }, { header: 'Найдено №', key: 'f', width: 12 }, { header: 'Совпадение, %', key: 's', width: 14 }, { header: 'Дата', key: 'd', width: 20 }];
  all('SELECT * FROM matches ORDER BY id DESC').forEach((m) => w5.addRow({ l: m.lost_id, f: m.found_id, s: m.score, d: m.created_at })); head(w5);
  audit(req, 'stats.export', 'xlsx');
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="mba-stats-${new Date().toISOString().slice(0, 10)}.xlsx"` });
  await wb.xlsx.write(res); res.end();
}));

app.use('/api/admin', A);
app.use('/api/admin', AD);

/* ---------- резервное копирование ---------- */
function backup() {
  const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  lockDown(f, false);
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.db')).sort();
  while (files.length > 14) fs.unlinkSync(path.join(dir, files.shift())); // хранить 14 последних копий
  return f;
}
setInterval(() => { try { backup(); } catch (e) { console.error('backup', e); } }, 24 * 3600e3).unref();
// Сроки хранения из Политики конфиденциальности (раздел «Хранение»): истёкшие коды входа, сессии старше 30 дней,
// журнал действий и исходящие сообщения старше года удаляются раз в сутки.
// Фото, которые загрузили, но так и не прикрепили (или заявку удалили), удаляются через сутки
function cleanUploads() {
  const used = new Set();
  const grab = (v) => { for (const m of String(v || '').matchAll(/\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp))/g)) used.add(m[1]); };
  for (const r of all('SELECT photos FROM applications')) grab(r.photos);
  for (const r of all('SELECT photos FROM valuables')) grab(r.photos);
  for (const r of all("SELECT photo FROM messages WHERE photo != ''")) grab(r.photo);
  for (const r of all("SELECT avatar FROM users WHERE avatar != ''")) grab(r.avatar);
  for (const r of all("SELECT photo FROM stories WHERE photo != ''")) grab(r.photo);
  const dayAgo = Date.now() - 864e5; let n = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(f) || used.has(f)) continue;
    const p = path.join(UPLOAD_DIR, f);
    if (fs.statSync(p).mtimeMs > dayAgo) continue;
    fs.unlinkSync(p); run('DELETE FROM uploads WHERE name = ?', f); n++;
  }
  run("DELETE FROM uploads WHERE created_at < datetime('now', '-1 day') AND name NOT IN (" + (used.size ? [...used].map(() => '?').join(',') : "''") + ')', ...used);
  return n;
}
function retention() {
  try {
    run('DELETE FROM otp WHERE expires_at < ?', Date.now());
    run("DELETE FROM sessions WHERE created_at < datetime('now', '-30 days')");
    run("DELETE FROM audit WHERE created_at < datetime('now', '-1 year')");
    run("DELETE FROM outbox WHERE created_at < datetime('now', '-1 year')");
  } catch (e) { console.error('retention', e); }
  try { cleanUploads(); } catch (e) { console.error('uploads gc', e); }
}
retention();
setInterval(retention, 24 * 3600e3).unref();

/* ---------- статика и SPA ---------- */
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
const PUB = path.join(__dirname, '..', 'public');
// Главная страница: абсолютные ссылки для превью в мессенджерах и поисковиков (по BASE_URL)
const SITE = String(process.env.BASE_URL || '').replace(/\/$/, '').replace(/["<>]/g, '');
const INDEX_HTML = (() => {
  let html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  if (SITE) html = html.replace('content="/assets/icon-512.png"', `content="${SITE}/assets/icon-512.png"`)
    .replace('<meta property="og:title"', `<link rel="canonical" href="${SITE}/">\n<meta property="og:url" content="${SITE}/">\n<meta property="og:title"`);
  return html;
})();
const sendIndex = (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(INDEX_HTML); };
app.get(['/', '/index.html'], sendIndex);
// robots.txt: рабочий сайт открыт для поисковиков (кроме API), тестовый стенд — закрыт
app.get('/robots.txt', (req, res) => res.type('text/plain').send(DEV ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /uploads/\n'));
app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(PUB, { index: false, maxAge: DEV ? 0 : '1h', setHeaders: (res, p) => { if (/\.(js|css|html)$/.test(p)) res.set('Cache-Control', 'no-cache'); } }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.get('*', sendIndex);

/* ---------- ошибки ---------- */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_big', message: 'Слишком большой запрос' });
  console.error(err);
  res.status(500).json({ error: 'server', message: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, () => {
  console.log(`Мой лучший агент: http://localhost:${PORT}  (режим: ${DEV ? 'тестовый' : 'рабочий'})`);
  if (DEV) return;
  const NAMES = { base_url: 'BASE_URL (https-адрес сайта)', admin: 'администратор (ADMIN_EMAIL)', email: 'отправка e-mail (SMTP_URL)', sms: 'отправка SMS (SMSRU_API_ID)', payments: 'приём оплаты ЮKassa (YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY)', legal: 'реквизиты оператора (LEGAL_NAME, LEGAL_INN, LEGAL_OGRN, LEGAL_ADDRESS)', push: 'ключи push (VAPID_PUBLIC, VAPID_PRIVATE)', demo: 'в базе остались демо-пользователи' };
  const miss = readiness().filter((c) => !c.ok && NAMES[c.key]);
  if (miss.length) console.warn('ВНИМАНИЕ — не настроено для работы:\n' + miss.map((c) => '  • ' + NAMES[c.key]).join('\n') + '\nПодробности — README, раздел «Запуск в работу».');
});
// Корректная остановка (Ctrl+C, systemd, pm2): дожидаемся запросов и закрываем БД с переносом журнала в app.db
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => { closeDb(); process.exit(0); }, 3000).unref();
});
