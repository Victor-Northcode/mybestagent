// Ручная резервная копия БД: npm run backup  (можно повесить на cron сервера).
// Копия делается без остановки платформы (VACUUM INTO), хранятся 14 последних.
const fs = require('fs');
const path = require('path');
const { db, close, lockDown, DATA_DIR } = require('./db');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, `app-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
lockDown(f, false);
const files = fs.readdirSync(dir).filter((x) => x.endsWith('.db')).sort();
while (files.length > 14) fs.unlinkSync(path.join(dir, files.shift()));
close();
console.log('Резервная копия:', f);
