'use strict';
// Оформленные письма (server/mail.js): HTML + текстовая версия, код в обоих, экранирование, язык, ссылки.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-mail-'));
process.env.BASE_URL = 'https://my-bestagent.ru';
const M = require('../server/mail');

const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe('Письма', () => {
  it('код входа: в теме, в HTML крупно и в текстовой версии; предупреждение; без внешних скриптов и шрифтов', () => {
    const m = M.codeMail('ru', 'login', '482915');
    assert.equal(m.subject, 'Код входа: 482915');
    assert.match(m.html, /class="code"[^>]*>482915</);
    assert.match(m.text, /Код: 482915/);
    assert.match(m.text, /Никому не сообщайте код/);
    assert.match(m.html, /^<!DOCTYPE html>/);
    assert.match(m.html, /<html lang="ru"/);
    assert.match(m.html, /src="https:\/\/my-bestagent\.ru\/assets\/logo-256\.png"/, 'логотип по абсолютному адресу');
    assert.doesNotMatch(m.html, /<script|<link|@import|fonts\.googleapis/i);
    assert.match(m.html, /support@my-bestagent\.ru/);
    assert.match(m.html, /max-width:600px/);
  });
  it('код на английском и код подтверждения контакта', () => {
    const en = M.codeMail('en', 'login', '111222');
    assert.equal(en.subject, 'Your sign-in code: 111222');
    assert.match(en.html, /<html lang="en"/);
    assert.match(en.text, /Never share this code/);
    const c = M.codeMail('ru', 'contact', '730146');
    assert.equal(c.subject, 'Код подтверждения: 730146');
    assert.match(c.html, /Подтвердите e-mail/);
  });
  it('данные пользователя экранируются в HTML, а в тексте остаются как есть', () => {
    const m = M.familyInviteMail('ru', 'Анна <img src=x onerror=alert(1)>');
    assert.doesNotMatch(m.html, /<img src=x/);
    assert.match(m.html, /Анна &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(m.text, /Анна <img src=x onerror=alert\(1\)>/);
    assert.match(m.html, /href="https:\/\/my-bestagent\.ru\/#\/me\/family"/);
    const n = M.notifyMail('ru', { type: 'chat', title: 'Новое сообщение', body: 'Чат по заявке «<b>x</b>»\nвторая строка', link: '#/chat/5' });
    assert.match(n.html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(n.html, /вторая строка/);
    assert.match(n.html, /<br>/);
  });
  it('уведомление: кнопка по типу ссылки, ссылка на сайт, причина письма и отключение', () => {
    const n = M.notifyMail('ru', { type: 'match', title: 'Возможное совпадение 82%', body: 'По вашей заявке найдена похожая', link: '#/a/12' });
    assert.equal(n.subject, 'Возможное совпадение 82%');
    assert.match(n.html, /href="https:\/\/my-bestagent\.ru\/#\/a\/12"[^>]*>Открыть заявку</);
    assert.match(n.html, /Отключить уведомления/);
    assert.match(n.html, /#\/me\/settings/);
    assert.match(n.text, /Открыть заявку: https:\/\/my-bestagent\.ru\/#\/a\/12/);
    assert.match(n.text, /уведомления на e-mail/);
    const e = M.notifyMail('en', { type: 'emergency', title: 'Urgent search for a person nearby', body: 'Missing man', link: '#/a/7' });
    assert.match(e.html, />Urgent</);
    assert.match(e.html, /Open report/);
    assert.match(visible(e.html), /Turn them off/);
  });
  it('письмо о смене контакта — со ссылкой на поддержку', () => {
    const m = M.contactChangedMail('ru', 'email');
    assert.equal(m.subject, 'Контакт для входа изменён');
    assert.match(m.html, /E-mail для входа изменён/);
    assert.match(m.html, /href="mailto:support@my-bestagent\.ru"/);
    assert.match(m.text, /support@my-bestagent\.ru/);
  });
});
