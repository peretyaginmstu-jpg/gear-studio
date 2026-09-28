import test from 'node:test';
import assert from 'node:assert/strict';
import { changeFamilyAnswer, familyMemo, identifyFamily, selectFamilyApplication, type FamilyAnswers } from '../lib/familyIdentification.ts';

const shape = (body: FamilyAnswers['body'], direction: FamilyAnswers['direction'], known = false): FamilyAnswers => ({
  partnerGroup: known ? 'toothed' : 'unknown', ...(known ? { partner: 'gear-rack' as const } : {}), body, direction,
});
test('all seven photo families need actual direction observations; unknown mate is a conditional proposal', () => {
  const cases = [['external-cylinder', 'straight', 'spur'], ['external-cylinder', 'inclined', 'helical'],
    ['external-cylinder', 'opposed', 'herringbone'], ['internal-ring', 'straight', 'internal'],
    ['internal-ring', 'inclined', 'internal-helical'], ['rack', 'straight', 'rack'], ['rack', 'inclined', 'helical-rack']] as const;
  for (const [body, direction, kind] of cases) for (const known of [false, true]) {
    const result = identifyFamily(shape(body, direction, known));
    assert.equal(result.status, 'proposal'); assert.equal(result.modelKind, kind); assert.equal(result.photoKind, kind);
    assert.ok(result.notDetermined.includes('tooth-profile')); assert.ok(result.notDetermined.includes('tooth-count'));
    assert.ok(result.notDetermined.includes('pressure-angle')); assert.ok(result.notDetermined.includes('module'));
    if (!known) assert.ok(result.limitations.some(s => s.includes('Ответная деталь неизвестна')));
    assert.equal('acceptedByUser' in result, false);
  }
});
test('unknown observations and a circular photo never default to spur or confirm a kind', () => {
  for (const hint of [null, { type: 'external_circular' as const }, { type: 'internal_ring' as const }, { type: 'linear_rack' as const }]) {
    assert.equal(identifyFamily({}, hint).nextQuestion?.id, 'partnerGroup');
    const a = { partnerGroup: 'unknown', body: 'external-cylinder' } as const;
    assert.equal(identifyFamily(a, hint).nextQuestion?.id, 'direction');
    assert.equal(identifyFamily(a, hint).modelKind, null);
    const unseen = identifyFamily({ ...a, direction: 'unknown' }, hint);
    assert.equal(unseen.status, 'needs-inspection'); assert.equal(unseen.modelKind, null);
    assert.throws(() => selectFamilyApplication(unseen.answers, 'photo', hint));
  }
  assert.equal(identifyFamily({ partnerGroup: 'unknown', body: 'unknown' }).status, 'needs-inspection');
});
test('photo disagreement is recorded without replacing the users observations or vetoing acceptance', () => {
  const answers = shape('internal-ring', 'inclined');
  const hint = { type: 'external_circular' as const, evidence: 'test silhouette only' };
  const result = identifyFamily(answers, hint);
  assert.equal(result.modelKind, 'internal-helical'); assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].source, 'photo'); assert.equal(result.conflicts[0].blocking, false);
  const application = selectFamilyApplication(answers, 'photo', hint);
  assert.equal(application.acceptedByUser, true); assert.equal(application.decision.photoHint?.type, hint.type);
  assert.equal(identifyFamily(answers, null).modelKind, result.modelKind);
});
test('unsupported transmissions return concrete inspection steps without substituting a gear model', () => {
  const cases: [FamilyAnswers, string][] = [
    [{ partnerGroup: 'flexible', partner: 'belt' }, 'timing-pulley'],
    [{ partnerGroup: 'flexible', partner: 'chain' }, 'sprocket'],
    [{ partnerGroup: 'spline' }, 'spline'],
    [{ partnerGroup: 'toothed', partner: 'pins' }, 'pin-gear'],
    [{ partnerGroup: 'toothed', partner: 'worm', body: 'external-cylinder' }, 'worm-wheel'],
    [{ partnerGroup: 'unknown', body: 'face' }, 'face-gear'],
    [shape('internal-ring', 'opposed'), 'opposed-internal'], [shape('rack', 'opposed'), 'opposed-rack'],
    [{ partnerGroup: 'unknown', body: 'screw', screwPartner: 'nut' }, 'threaded-connection'],
    [{ partnerGroup: 'unknown', body: 'cone', coneDirection: 'curved' }, 'bevel-unresolved'],
  ];
  for (const [answers, family] of cases) {
    const result = identifyFamily(answers); assert.equal(result.status, 'unsupported'); assert.equal(result.family, family);
    assert.equal(result.modelKind, null); assert.equal(result.photoKind, null); assert.ok(result.nextSteps.length);
    assert.throws(() => selectFamilyApplication(answers, 'manual'));
    const memo = familyMemo(answers); assert.equal(memo.acceptedByUser, false); assert.deepEqual(memo.decision.answers, answers);
  }
});
test('limited straight bevel and worm choices name their mathematical model and require a separate acknowledgement', () => {
  for (const [answers, kind] of [
    [{ partnerGroup: 'unknown', body: 'cone', coneDirection: 'straight' }, 'bevel'],
    [{ partnerGroup: 'unknown', body: 'screw', screwPartner: 'wheel' }, 'worm'],
  ] as const) {
    const decision = identifyFamily(answers);
    assert.equal(decision.status, 'limited-manual'); assert.equal(decision.modelKind, kind); assert.equal(decision.photoKind, null);
    assert.throws(() => selectFamilyApplication(answers, 'photo'), /ограниченную ручную модель/);
    const app = selectFamilyApplication(answers, 'photo', null, true);
    assert.equal(app.method, 'limited-manual-model'); assert.equal(app.limitedModelAcknowledged, true);
    assert.equal(app.source, 'photo'); assert.ok(app.decision.limitations.some(s => /ZA|сферическая/.test(s)));
  }
  assert.equal(identifyFamily({ partnerGroup: 'unknown', body: 'screw', screwPartner: 'unknown' }).modelKind, null);
});
test('earlier edits prune inapplicable answers but identical answers and navigation can retain the route', () => {
  const full = shape('external-cylinder', 'inclined', true);
  assert.deepEqual(changeFamilyAnswer(full, 'direction', 'inclined'), full);
  const cone = changeFamilyAnswer(full, 'body', 'cone');
  assert.deepEqual(cone, { partnerGroup: 'toothed', partner: 'gear-rack', body: 'cone' });
  assert.equal(identifyFamily(cone).nextQuestion?.id, 'coneDirection');
  const flexible = changeFamilyAnswer(cone, 'partnerGroup', 'flexible');
  assert.deepEqual(flexible, { partnerGroup: 'flexible' });
  assert.deepEqual(changeFamilyAnswer(flexible, 'partner', 'belt'), { partnerGroup: 'flexible', partner: 'belt' });
  assert.throws(() => changeFamilyAnswer(flexible, 'direction', 'straight'));
  assert.throws(() => changeFamilyAnswer(flexible, 'partner', 'worm'));
});
test('cross-route and unresolved mate/body answers do not produce an accepted substitute', () => {
  for (const answers of [
    { partnerGroup: 'flexible', partner: 'chain', body: 'external-cylinder', direction: 'straight' },
    { partnerGroup: 'unknown', body: 'cone', direction: 'straight', coneDirection: 'straight' },
    { partnerGroup: 'toothed', partner: 'worm', body: 'internal-ring' },
    { partnerGroup: 'toothed', partner: 'worm', body: 'screw', screwPartner: 'wheel' },
    { partnerGroup: 'toothed', partner: 'worm', body: 'screw', screwPartner: 'nut' },
    { partnerGroup: 'toothed', partner: 'gear-rack', body: 'screw', screwPartner: 'nut' },
  ] as FamilyAnswers[]) {
    const result = identifyFamily(answers); assert.equal(result.status, 'contradictory'); assert.equal(result.modelKind, null);
    assert.ok(result.conflicts.some(c => c.blocking)); assert.throws(() => selectFamilyApplication(answers, 'manual', null, true));
  }
});
test('accepted evidence is an owned snapshot and does not invent numeric or profile confirmations', () => {
  const answers = shape('external-cylinder', 'straight');
  const app = selectFamilyApplication(answers, 'manual'); answers.direction = 'inclined';
  assert.equal(app.decision.answers.direction, 'straight'); assert.equal(app.modelKind, 'spur');
  assert.equal('parameters' in app, false); assert.equal('pressureAngleDeg' in app, false);
  assert.equal(app.decision.notDetermined.includes('tooth-profile'), true);
  const memo = familyMemo(answers); assert.equal(memo.acceptedByUser, false);
});
