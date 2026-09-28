import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizePairs, moduleSeries1 } from '../lib/pairSynthesis.ts';
import { deriveGear } from '../lib/gearMath.ts';
import { gearKernelParams } from '../lib/model.ts';
import { analyzeGearPair } from '../lib/pairAnalysis.ts';

test('standard centre distance gives an unshifted pair', () => {
  const [best] = synthesizePairs({ ratio: 2, centerDistanceMm: 60 });
  assert.ok(best);
  assert.equal(best.shiftSum, 0);
  assert.equal(best.referenceCenterMm, 60);
  assert.equal(best.teeth[1] / best.teeth[0], 2);
  assert.equal(best.report.status === 'fail', false);
});

test('non-standard centre distance is met by profile shift and passes the pair check', () => {
  const list = synthesizePairs({ ratio: 3.2, centerDistanceMm: 63.5 });
  assert.ok(list.length > 0);
  for (const c of list) {
    assert.ok(c.ratioErrorPct <= 2);
    assert.ok(Math.abs(c.profileShift[0] + c.profileShift[1] - c.shiftSum) < 1e-9);
    assert.notEqual(c.report.status, 'fail');
    // Independent check: the pair analysis derives the centre distance from the shifts alone.
    const free = analyzeGearPair({ first: c.gears[0], second: c.gears[1] });
    assert.ok(Math.abs(free.dimensions.operatingCenterDistanceMm! - 63.5) < 2e-3, `${c.module} ${c.teeth} ${free.dimensions.operatingCenterDistanceMm}`);
    assert.ok(c.report.dimensions.totalContactRatio! > 1.1);
    for (const g of c.gears) assert.doesNotThrow(() => deriveGear(gearKernelParams(g)));
    assert.ok(moduleSeries1.includes(c.module) || c.series === 2);
  }
});

test('helical synthesis uses opposite hands and the transverse relation', () => {
  const [c] = synthesizePairs({ ratio: 2.5, centerDistanceMm: 71, helixAngleDeg: 15 });
  assert.ok(c);
  assert.equal(c.gears[0].helixAngleDeg, 15); assert.equal(c.gears[1].helixAngleDeg, -15);
  assert.equal(c.gears[0].kind, 'helical');
});

test('input validation', () => {
  assert.throws(() => synthesizePairs({ ratio: .5, centerDistanceMm: 50 }), /Передаточное/);
  assert.throws(() => synthesizePairs({ ratio: 2, centerDistanceMm: 1 }), /Межосевое/);
});

test('ranking prefers a practical first-series module and plain cylindrical fields', () => {
  const [best] = synthesizePairs({ ratio: 3.2, centerDistanceMm: 63.5 });
  assert.equal(best.series, 1);
  assert.ok(best.teeth[0] >= 17 && best.teeth[0] <= 40, String(best.teeth));
  assert.equal('wormStarts' in best.gears[0], false);
});
