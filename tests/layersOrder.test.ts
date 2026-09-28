import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultModel } from '../lib/model.ts';
import { LAYERS_MANIFEST_SCHEMA, modelTitle, prepareLayersDraft, sendLayersDraft } from '../lib/layersOrder.ts';

const input = { params: { ...defaultModel('spur'), teeth: 30, bore: 12, keywayWidth: 4, keywayDepth: 1.8 }, origin: 'Параметры заданы вручную',
  evidence: null, projectName: 'Редуктор миксера', revision: 3 };

test('draft carries the exact STL, its hash and the model contract, not photos or contacts', async () => {
  const draft = await prepareLayersDraft(input);
  assert.equal(draft.manifest.schema, LAYERS_MANIFEST_SCHEMA);
  assert.equal(draft.manifest.units, 'mm');
  assert.equal(draft.manifest.stl.sha256, createHash('sha256').update(new Uint8Array(draft.stl)).digest('hex'));
  assert.equal(draft.manifest.model.params.keywayWidth, 4);
  assert.equal(draft.manifest.model.dimensions.tipDiameter, 64);
  assert.equal(draft.manifest.title, 'Прямозубое колесо z=30 m=2');
  assert.deepEqual(draft.manifest.project, { name: 'Редуктор миксера', revision: 3 });
  assert.equal(draft.manifest.manufacturing, null);
  assert.ok(!JSON.stringify(draft.manifest).includes('data:image'));
  assert.match(draft.idempotencyKey, /^[0-9a-f]{48}$/);
  assert.equal((await prepareLayersDraft(input)).idempotencyKey, draft.idempotencyKey);
  assert.notEqual((await prepareLayersDraft({ ...input, revision: 4 })).idempotencyKey, draft.idempotencyKey);
});

test('sends one multipart POST without credentials and validates the returned link', async () => {
  const draft = await prepareLayersDraft(input);
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (body: unknown, status = 201) => (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  const link = await sendLayersDraft(draft, 'https://layers.test/', ok({ token: 'abc', expires_at: '2026-10-01T00:00:00Z', order_url: 'https://layers.test/order/gear#abc' }));
  assert.equal(link.orderUrl, 'https://layers.test/order/gear#abc');
  assert.equal(calls[0].url, 'https://layers.test/api/v1/integrations/gear-studio/drafts');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers, undefined);
  const form = calls[0].init.body as FormData;
  assert.equal((form.get('stl') as File).size, draft.stl.byteLength);
  assert.equal(form.get('idempotency_key'), draft.idempotencyKey);
  assert.equal(JSON.parse(form.get('manifest') as string).stl.sha256, draft.manifest.stl.sha256);
  await assert.rejects(sendLayersDraft(draft, 'https://layers.test', ok({ token: 'abc', order_url: 'https://evil.test/order/gear#abc' })), /неожиданную/);
  await assert.rejects(sendLayersDraft(draft, 'https://layers.test', ok({ detail: 'STL не прочитан' }, 400)), /STL не прочитан/);
  await assert.rejects(sendLayersDraft(draft, 'https://layers.test', (async () => { throw new TypeError('offline'); }) as typeof fetch), /недоступен/);
  await assert.rejects(sendLayersDraft(draft, ''), /не настроен/);
});

test('titles name the family, count and module', () => {
  assert.equal(modelTitle({ ...defaultModel('worm'), wormStarts: 2, module: 1.25 }), 'Червяк ZA z₁=2 m=1.25');
});
