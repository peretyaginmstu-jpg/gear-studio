import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModel } from '../lib/model.ts';
import { moduleForTipDiameter, supportsDiameterHelper, tipDiameterFor } from '../lib/quickSizing.ts';
import { decodeShare, encodeShare, shareUrl } from '../lib/shareLink.ts';

test('tip diameter follows da = m(z + 2) for a standard spur gear', () => {
  const p = defaultModel('spur');
  assert.ok(Math.abs(tipDiameterFor(p, 2)! - 52) < 1e-6);
  assert.equal(tipDiameterFor(defaultModel('worm'), 2), null);
  assert.ok(!supportsDiameterHelper('rack') && supportsDiameterHelper('helical'));
});

test('measured diameter picks the nearest standard module', () => {
  const p = { ...defaultModel('spur'), teeth: 30 };
  const s = moduleForTipDiameter(p, 64.3)!;
  assert.equal(s.module, 2);
  assert.ok(Math.abs(s.tipDiameter - 64) < 1e-6);
  assert.ok(Math.abs(s.exactModule - 64.3 / 32) < 1e-6);
  assert.equal(s.series, 1);
  // 2.25 mm (series 2) fits 72 mm exactly while series 1 is 4 mm off.
  assert.equal(moduleForTipDiameter(p, 72)!.module, 2.25);
  assert.equal(moduleForTipDiameter(p, 0), null);
});

test('helical gears account for the helix angle', () => {
  const p = { ...defaultModel('helical'), teeth: 20 };
  const da = tipDiameterFor(p, 3)!;
  assert.ok(da > 3 * 22);
  assert.equal(moduleForTipDiameter(p, da + .2)!.module, 3);
});

test('share links round-trip and carry only changed fields', () => {
  const p = { ...defaultModel('helical'), teeth: 31, module: 1.5, bore: 10 };
  const code = encodeShare(p);
  assert.deepEqual(JSON.parse(Buffer.from(code, 'base64url').toString()), { kind: 'helical', teeth: 31, module: 1.5, bore: 10 });
  assert.deepEqual(decodeShare(code), p);
  assert.equal(shareUrl(p, { origin: 'https://x.test', pathname: '/gear-studio/' }), `https://x.test/gear-studio/?gear=${code}`);
});

test('broken or hostile share codes are ignored', () => {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  assert.equal(decodeShare('%%%'), null);
  assert.equal(decodeShare(enc({ kind: 'teapot' })), null);
  assert.equal(decodeShare(enc({ kind: 'spur', teeth: null })), null);
  assert.equal(decodeShare(enc({ kind: 'spur', evil: '<script>' })), null);
  assert.equal(decodeShare('a'.repeat(3000)), null);
});
