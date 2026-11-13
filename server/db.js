'use strict';
// База данных: встроенный SQLite Node.js (node:sqlite), без нативных зависимостей.
// Файл базы: platform/data/app.db (папку можно сменить переменной DATA_DIR).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_FILE = path.join(DATA_DIR, 'app.db');

// Доступ к папке данных — только владельцу процесса (БД, загрузки, копии, ключи).
// Linux/macOS: 700 на папку и 600 на файлы. Windows: снимаем унаследованные права, оставляем
// текущего пользователя, SYSTEM и администраторов (один раз, отметка .acl).
function lockDown(file, isDir) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(file, isDir ? 0o700 : 0o600); } catch { /* файл мог исчезнуть */ }
}
function lockDataDir() {
  if (process.platform !== 'win32') {
    lockDown(DATA_DIR, true);
    for (const f of fs.readdirSync(DATA_DIR)) { const p = path.join(DATA_DIR, f); lockDown(p, fs.statSync(p).isDirectory()); }
    return;
  }
  const mark = path.join(DATA_DIR, '.acl');
  if (fs.existsSync(mark) || !process.env.USERNAME) return;
  const icacls = (...a) => execFileSync('icacls', a, { stdio: 'ignore', windowsHide: true });
  try {
    // 1) права только на саму папку (с наследованием вниз), 2) вложенные файлы просто наследуют их
    icacls(DATA_DIR, '/grant:r', `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${process.env.USERNAME}:(OI)(CI)F`,
      '/grant:r', '*S-1-5-18:(OI)(CI)F', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '/inheritance:r', '/Q');
    if (fs.readdirSync(DATA_DIR).length) icacls(path.join(DATA_DIR, '*'), '/reset', '/T', '/C', '/Q');
    fs.writeFileSync(mark, new Date().toISOString());
  } catch (e) {
    console.warn('Не удалось ограничить права на папку данных:', e.message);
    try { icacls(DATA_DIR, '/reset', '/T', '/C', '/Q'); } catch { /* оставляем как было */ }
  }
}
lockDataDir();

// Секретный ключ сервера (вне БД): им подписываются коды входа. Утечка одного файла БД
// не даёт ни войти по сессии (хранятся только хэши токенов), ни подобрать коды.
const KEY_FILE = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const hashCode = (target, code) => crypto.createHmac('sha256', SECRET).update(target + '|' + code).digest('hex');
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const db = new DatabaseSync(DB_FILE);
// WAL — параллельное чтение во время записи; foreign_keys — целостность связей;
// secure_delete — удалённые данные затираются нулями, а не остаются в файле;
// trusted_schema=OFF — схема не может вызывать функции приложения; synchronous=NORMAL — надёжно в режиме WAL.
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
  PRAGMA secure_delete = ON; PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON; PRAGMA journal_size_limit = 67108864;`);
{
  const chk = db.prepare('PRAGMA quick_check').get();
  if (!chk || Object.values(chk)[0] !== 'ok') console.error('ВНИМАНИЕ: проверка целостности БД не пройдена:', chk, '— восстановите из data/backups');
}
for (const f of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + f)) lockDown(DB_FILE + f, false);
// Встроенный lower() SQLite меняет регистр только у латиницы: поиск «барсик» не находил «Барсик».
// Подменяем его на Unicode-версию — так работают все поиски по lower(...) LIKE ?.
db.function('lower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, phone TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '', birthdate TEXT, city TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user', lang TEXT NOT NULL DEFAULT 'ru',
  avatar TEXT DEFAULT '', org_name TEXT DEFAULT '',
  blocked INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
  notify_push INTEGER NOT NULL DEFAULT 1, notify_email INTEGER NOT NULL DEFAULT 1,
  zone_enabled INTEGER NOT NULL DEFAULT 0, zone_lat REAL, zone_lng REAL, zone_radius REAL DEFAULT 3,
  family_id INTEGER, card_token TEXT, card_mask TEXT,
  consent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otp (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, code TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT 'Семья',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS family_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, family_id INTEGER NOT NULL, target TEXT NOT NULL,
  user_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('lost','found')),
  category TEXT NOT NULL CHECK (category IN ('people','animals','things')),
  status TEXT NOT NULL DEFAULT 'published',
  title TEXT NOT NULL, description TEXT DEFAULT '', features TEXT DEFAULT '',
  person_name TEXT DEFAULT '', person_age INTEGER, relation TEXT DEFAULT '', is_minor INTEGER DEFAULT 0,
  last_seen TEXT DEFAULT '', species TEXT DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  event_date TEXT, event_time TEXT DEFAULT '', lat REAL, lng REAL, address TEXT DEFAULT '', city TEXT DEFAULT '',
  contact TEXT DEFAULT '', reward INTEGER DEFAULT 0,
  photos TEXT NOT NULL DEFAULT '[]',
  emergency_radius REAL, emergency_status TEXT NOT NULL DEFAULT 'none',
  promoted_until TEXT, reject_reason TEXT DEFAULT '', views INTEGER NOT NULL DEFAULT 0,
  found_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, category, kind);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lost_id INTEGER NOT NULL, found_id INTEGER NOT NULL,
  score INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(lost_id, found_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '', read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT UNIQUE NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL, other_id INTEGER NOT NULL, blocked_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(application_id, other_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL, text TEXT DEFAULT '', photo TEXT DEFAULT '', lat REAL, lng REAL,
  read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS saved (
  user_id INTEGER NOT NULL, application_id INTEGER NOT NULL, PRIMARY KEY(user_id, application_id)
);
CREATE TABLE IF NOT EXISTS valuables (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
  serials TEXT DEFAULT '', marks TEXT DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok', status_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tariffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name_ru TEXT NOT NULL, name_en TEXT NOT NULL,
  desc_ru TEXT DEFAULT '', desc_en TEXT DEFAULT '', audience TEXT NOT NULL DEFAULT 'user',
  price INTEGER NOT NULL, period_days INTEGER NOT NULL DEFAULT 30, feature TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tariff_id INTEGER NOT NULL, application_id INTEGER,
  amount INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  provider_id TEXT, receipt TEXT, save_card INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tariff_id INTEGER NOT NULL, until TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, tariff_id)
);
CREATE TABLE IF NOT EXISTS role_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, org_name TEXT DEFAULT '',
  org_type TEXT DEFAULT '', details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title_ru TEXT NOT NULL, title_en TEXT NOT NULL,
  text_ru TEXT NOT NULL, text_en TEXT NOT NULL, photo TEXT DEFAULT '', city TEXT DEFAULT '', published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
  org TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, target TEXT DEFAULT '', meta TEXT DEFAULT '',
  ip TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, value_ru TEXT NOT NULL, value_en TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS translations (
  key TEXT NOT NULL, lang TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key, lang)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, target TEXT NOT NULL, subject TEXT DEFAULT '', body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS uploads (
  name TEXT PRIMARY KEY, user_id INTEGER NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text_ru TEXT NOT NULL, text_en TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
  advertiser TEXT NOT NULL DEFAULT '', erid TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
  reason TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Миграции по номеру версии схемы
const ver = db.prepare('PRAGMA user_version').get().user_version;
if (ver < 1) {
  // v1: токены сессий и коды входа больше не хранятся в открытом виде
  db.exec('BEGIN');
  try {
    for (const r of db.prepare('SELECT token FROM sessions').all()) db.prepare('UPDATE sessions SET token = ? WHERE token = ?').run(hashToken(r.token), r.token);
    db.exec('DELETE FROM otp; PRAGMA user_version = 1;');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

if (ver < 2) {
  // v2: статус доставки e-mail/SMS в журнале «Исходящие»; ссылка на страницу оплаты ЮKassa
  db.exec('BEGIN');
  try {
    const cols = db.prepare('PRAGMA table_info(outbox)').all().map((c) => c.name);
    if (!cols.includes('status')) db.exec("ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'logged'");
    if (!cols.includes('error')) db.exec("ALTER TABLE outbox ADD COLUMN error TEXT NOT NULL DEFAULT ''");
    if (!db.prepare('PRAGMA table_info(payments)').all().some((c) => c.name === 'confirmation_url')) db.exec('ALTER TABLE payments ADD COLUMN confirmation_url TEXT');
    db.exec('PRAGMA user_version = 2;');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

if (ver < 3) {
  // v3: единые параметры заявки (приметы человека, место: ориентир, транспорт, фото места) и время события
  db.exec('BEGIN');
  try {
    const cols = db.prepare('PRAGMA table_info(applications)').all().map((c) => c.name);
    if (!cols.includes('details')) db.exec("ALTER TABLE applications ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    if (!cols.includes('event_time')) db.exec("ALTER TABLE applications ADD COLUMN event_time TEXT DEFAULT ''");
    db.exec('PRAGMA user_version = 3;');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

if (ver < 4) {
  // v4: рекламная строка на главной — первыми крутятся объявления платформы «Кадры здесь» (меняются в админке → «Реклама»)
  db.exec('BEGIN');
  try {
    const url = 'https://kadryzdes.ru/?utm_source=my-bestagent.ru&utm_medium=ticker&utm_campaign=platforms';
    const ins = db.prepare('INSERT INTO ads (text_ru, text_en, url, advertiser, sort) VALUES (?,?,?,?,?)');
    [['Вакансии и вахта по всей России', 'Jobs and rotational work across Russia'],
      ['Подбор персонала для вашей компании', 'Staff recruitment for your company'],
      ['Документы, визы, квоты и переезд в одном месте', 'Documents, visas, quotas and relocation in one place']]
      .forEach(([ru, en], i) => ins.run(ru, en, url, 'Кадры здесь', i + 1));
    db.exec('PRAGMA user_version = 4;');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Хелперы для запросов
function all(sql, ...p) { return db.prepare(sql).all(...p); }
function get(sql, ...p) { return db.prepare(sql).get(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Аккуратное закрытие: переносим журнал WAL в основной файл, чтобы app.db был самодостаточным
let closed = false;
function close() {
  if (closed) return; closed = true;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;'); } catch { /* ignore */ }
  try { db.close(); } catch { /* ignore */ }
}

module.exports = { db, all, get, run, tx, close, lockDown, hashToken, hashCode, sameHash, DATA_DIR, DB_FILE };
