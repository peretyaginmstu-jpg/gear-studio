import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../lib/appVersion.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const packageVersion = JSON.parse(read('../package.json')).version as string;
const lockFile = JSON.parse(read('../package-lock.json')) as { version: string; packages: { '': { version: string } } };

test('app version, README, and current product documents stay aligned', () => {
  assert.equal(APP_VERSION, packageVersion);
  assert.equal(lockFile.version, packageVersion);
  assert.equal(lockFile.packages[''].version, packageVersion);
  assert.ok(read('../README.md').includes(`Версия приложения: **${packageVersion}**`));
  for (const path of ['../docs/user-journey.md', '../docs/product-packages.md', '../docs/photo-draft-qa.md', '../docs/projects.md', '../docs/project-versions-qa.md', '../docs/measurement-guide.md', '../docs/measurement-guide-qa.md', '../docs/reference-photos.md', '../docs/reference-photos-qa.md', '../docs/project-archive.md', '../docs/project-archive-qa.md', '../docs/model-documents.md', '../docs/model-documents-qa.md', '../docs/manufacturing.md', '../docs/manufacturing-qa.md', '../docs/sample-inspection.md', '../docs/sample-inspection-qa.md'])
    assert.ok(read(path).includes(`v${packageVersion}`), `${path} must identify release v${packageVersion}`);
});
