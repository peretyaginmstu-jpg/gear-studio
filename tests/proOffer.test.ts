import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyAccessOffer, fetchProOffer, priceLabel, proPurchaseState, startProCheckout, validEmail } from '../lib/proOffer.ts';

const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
const token = 'a'.repeat(32);

test('offer comes from Layers only when payments are on; otherwise Pro stays free', async () => {
  assert.deepEqual(await fetchProOffer('', json({})), earlyAccessOffer);
  assert.deepEqual(await fetchProOffer('https://l.test', json({ price_rub: 290, payments_enabled: true })), { priceRub: 290, paymentsEnabled: true, source: 'layers' });
  assert.deepEqual(await fetchProOffer('https://l.test', json({ price_rub: 290, payments_enabled: false })), earlyAccessOffer);
  assert.deepEqual(await fetchProOffer('https://l.test', json({ price_rub: 0, payments_enabled: true })), earlyAccessOffer);
  assert.deepEqual(await fetchProOffer('https://l.test', (async () => { throw new Error('offline'); }) as unknown as typeof fetch), earlyAccessOffer);
  assert.equal(priceLabel({ priceRub: 1290, paymentsEnabled: true, source: 'layers' }), `${(1290).toLocaleString('ru-RU')} ₽`);
});

test('checkout posts the model and strips the fragment from the return address', async () => {
  let sent: { url: string; body: Record<string, unknown> } | null = null;
  const f = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ token, confirmation_url: 'https://yoomoney.ru/checkout/x' }), { status: 201 }); }) as unknown as typeof fetch;
  const r = await startProCheckout('https://l.test', { email: ' a@b.ru ', params: { kind: 'spur' }, title: 'T', appVersion: '0.29.0', returnUrl: 'https://g.test/gear-studio/#start' }, f);
  assert.equal(r.token, token);
  assert.equal(sent!.url, 'https://l.test/api/v1/integrations/gear-studio/pro/checkout');
  assert.deepEqual(sent!.body, { email: 'a@b.ru', params: { kind: 'spur' }, title: 'T', app_version: '0.29.0', return_url: 'https://g.test/gear-studio/' });
  await assert.rejects(startProCheckout('https://l.test', { email: 'a@b.ru', params: {}, title: '', appVersion: '', returnUrl: '' }, json({ detail: 'Онлайн-оплата Pro пока не подключена.' }, 400)), /не подключена/);
  await assert.rejects(startProCheckout('https://l.test', { email: 'a@b.ru', params: {}, title: '', appVersion: '', returnUrl: '' }, json({ token, confirmation_url: 'javascript:alert(1)' }, 201)), /неполный/);
});

test('purchase status exposes a download link only once paid', async () => {
  const paid = await proPurchaseState('https://l.test', token, json({ status: 'paid', title: 'T', price_rub: 290, download_url: 'https://l.test/gear-pro/x/download' }));
  assert.equal(paid.download_url, 'https://l.test/gear-pro/x/download');
  const pending = await proPurchaseState('https://l.test', token, json({ status: 'pending', title: 'T', price_rub: 290, download_url: 'https://l.test/x' }));
  assert.equal(pending.download_url, null);
  await assert.rejects(proPurchaseState('https://l.test', token, json({ detail: 'Покупка не найдена.' }, 404)), /не найдена/);
});

test('email check', () => {
  assert.ok(validEmail('user@example.com'));
  assert.ok(!validEmail('user@'));
  assert.ok(!validEmail(''));
});
