'use strict';
// ЮKassa (API v3): приём оплаты картами РФ и через СБП, чеки 54-ФЗ, сохранённая карта для автопродления.
// Документация: https://yookassa.ru/developers/api
// Ключи: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY (личный кабинет ЮKassa → Интеграция → Ключи API).
// Уведомления: в кабинете ЮKassa указать URL https://<сайт>/api/payments/webhook, события payment.succeeded и payment.canceled.
const crypto = require('crypto');

const API = (process.env.YOOKASSA_API_URL || 'https://api.yookassa.ru/v3').replace(/\/$/, '');
const SHOP = process.env.YOOKASSA_SHOP_ID || '';
const KEY = process.env.YOOKASSA_SECRET_KEY || '';
// Ставка НДС в чеке: 1 — без НДС (по умолчанию), 2 — 0%, 3 — 10%, 4 — 20%, 5 — 10/110, 6 — 20/120 (справочник ЮKassa)
const VAT = Number(process.env.YOOKASSA_VAT_CODE || 1);
const TAX_SYSTEM = process.env.YOOKASSA_TAX_SYSTEM ? Number(process.env.YOOKASSA_TAX_SYSTEM) : null;

const enabled = !!(SHOP && KEY);
const rub = (n) => ({ value: Number(n).toFixed(2), currency: 'RUB' });

async function call(method, path, body, idempotenceKey) {
  const headers = { Authorization: 'Basic ' + Buffer.from(`${SHOP}:${KEY}`).toString('base64'), 'Content-Type': 'application/json' };
  if (idempotenceKey) headers['Idempotence-Key'] = idempotenceKey;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw Object.assign(new Error('Платёжный сервис не отвечает. Попробуйте через минуту.'), { status: 502, code: 'provider_unavailable' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('ЮKassa', res.status, data.code || '', data.description || '');
    throw Object.assign(new Error('Платёжный сервис отклонил запрос. Попробуйте позже или выберите другой способ оплаты.'), { status: 502, code: 'provider_error' });
  }
  return data;
}

// Создание платежа. method: 'card' | 'sbp' | 'saved_card' (тогда нужен paymentMethodId)
function createPayment({ localId, amount, description, customer, itemName, method, saveCard, paymentMethodId, returnUrl }) {
  const receipt = {
    customer: /@/.test(customer) ? { email: customer } : { phone: String(customer).replace(/\D/g, '') },
    items: [{ description: String(itemName).slice(0, 128), quantity: '1.00', amount: rub(amount), vat_code: VAT, payment_subject: 'service', payment_mode: 'full_payment' }]
  };
  if (TAX_SYSTEM) receipt.tax_system_code = TAX_SYSTEM;
  const body = { amount: rub(amount), capture: true, description: String(description).slice(0, 128), receipt, metadata: { payment_id: String(localId) } };
  if (method === 'saved_card') body.payment_method_id = paymentMethodId;
  else {
    body.payment_method_data = { type: method === 'sbp' ? 'sbp' : 'bank_card' };
    body.confirmation = { type: 'redirect', return_url: returnUrl };
    if (method === 'card' && saveCard) body.save_payment_method = true;
  }
  return call('POST', '/payments', body, `mba-${localId}-${crypto.randomBytes(6).toString('hex')}`);
}

const getPayment = (id) => call('GET', '/payments/' + encodeURIComponent(id));

// Сведения о карте из ответа ЮKassa: маска и id сохранённого способа оплаты (если пользователь согласился)
function cardInfo(p) {
  const pm = p && p.payment_method;
  if (!pm || pm.type !== 'bank_card') return { mask: null, token: null };
  return { mask: pm.card && pm.card.last4 ? '•••• ' + pm.card.last4 : null, token: pm.saved ? pm.id : null };
}

module.exports = { enabled, createPayment, getPayment, cardInfo };
