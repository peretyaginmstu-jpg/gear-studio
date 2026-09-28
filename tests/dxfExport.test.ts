import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModel } from '../lib/model.ts';
import { modelProfileDxf, supportsDxf, writeDxf } from '../lib/dxfExport.ts';

/** Reads R12 POLYLINE/VERTEX groups back into loops. */
function parse(dxf: string) {
  const lines = dxf.split('\n'), pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);
  const loops: { layer: string; closed: boolean; points: { x: number; y: number }[] }[] = [], circles: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code !== 0) continue;
    const group = new Map<number, string>(); let j = i + 1; for (; j < pairs.length && pairs[j][0] !== 0; j++) group.set(pairs[j][0], pairs[j][1]);
    if (value === 'POLYLINE') loops.push({ layer: group.get(8)!, closed: (Number(group.get(70)) & 1) === 1, points: [] });
    if (value === 'VERTEX') loops.at(-1)!.points.push({ x: Number(group.get(10)), y: Number(group.get(20)) });
    if (value === 'CIRCLE') circles.push(Number(group.get(40)));
  }
  return { pairs, loops, circles };
}

test('DXF writer produces balanced R12 structure in millimetres', () => {
  const dxf = writeDxf([{ layer: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }], [{ layer: 'B', radius: 2 }]);
  const { pairs, loops, circles } = parse(dxf);
  assert.equal(pairs.filter(([c, v]) => c === 0 && v === 'SECTION').length, pairs.filter(([c, v]) => c === 0 && v === 'ENDSEC').length);
  assert.ok(dxf.includes('$INSUNITS\n70\n4\n'));
  assert.equal(pairs.at(-1)![1], 'EOF');
  assert.deepEqual(loops, [{ layer: 'A', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }]);
  assert.deepEqual(circles, [2]);
});

test('gear profile round-trips through DXF with keyway bore and pitch circle', () => {
  const params = { ...defaultModel('spur'), bore: 12, keywayWidth: 4, keywayDepth: 1.8 };
  const { dxf, loops } = modelProfileDxf(params), back = parse(dxf);
  assert.deepEqual(back.loops.map(l => l.layer), ['CONTOUR', 'BORE']);
  back.loops.forEach((loop, i) => { assert.equal(loop.points.length, loops[i].points.length);
    loop.points.forEach((p, k) => { assert.ok(Math.abs(p.x - loops[i].points[k].x) < 1e-6 && Math.abs(p.y - loops[i].points[k].y) < 1e-6); }); });
  assert.deepEqual(back.circles, [24]);
  assert.ok(Math.max(...back.loops[1].points.map(p => p.x)) > 7.79);
});

test('internal, rack and cycloidal profiles export; bevel and worm are refused', () => {
  for (const kind of ['internal', 'rack', 'cycloidal', 'helical'] as const) assert.ok(parse(modelProfileDxf(defaultModel(kind)).dxf).loops.length >= 1, kind);
  assert.equal(parse(modelProfileDxf(defaultModel('rack')).dxf).circles.length, 0);
  for (const kind of ['bevel', 'worm'] as const) { assert.equal(supportsDxf(defaultModel(kind)), false); assert.throws(() => modelProfileDxf(defaultModel(kind))); }
});
