import test from 'node:test';
import assert from 'node:assert/strict';
import { gearTemplates } from '../lib/templates.ts';
import { buildModelMesh } from '../lib/model.ts';
import { validateMesh } from '../lib/gearMath.ts';
import { newProject, parseProject, serializeProject } from '../lib/project.ts';

for (const t of gearTemplates) test(`template ${t.id} builds a valid mesh and fits the project schema`, () => {
  assert.ok(validateMesh(buildModelMesh(t.params)).valid);
  const doc = newProject(); doc.journey = { ...doc.journey, manualDraft: t.params };
  assert.equal(parseProject(serializeProject(doc)).journey.manualDraft.teeth, t.params.teeth);
});
test('template ids are unique', () => assert.equal(new Set(gearTemplates.map(t => t.id)).size, gearTemplates.length));
