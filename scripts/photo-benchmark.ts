// Accuracy of the photo silhouette analysis on REAL labelled photos.
// Usage: node --experimental-strip-types scripts/photo-benchmark.ts [bench/photos] [--json report.json]
// The folder holds images and manifest.json (see bench/photos/README.md). Images are decoded by Chromium
// exactly like in the browser (canvas, max side 2048 px), then analysed by the same code as the site.
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { analyzeGearImage, type PhotoCandidateType } from '../lib/photo-analysis.ts';

interface Sample { file: string; teeth: number; type: PhotoCandidateType; note?: string }
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'bench/photos';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const samples: Sample[] = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
if (!samples.length) { console.log('manifest.json пуст: добавьте размеченные фотографии (bench/photos/README.md).'); process.exit(0); }

const browser = await chromium.launch(), page = await browser.newPage();
const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const rows = [];
for (const s of samples) {
  const bytes = await readFile(join(dir, s.file));
  const decoded = await page.evaluate(async ({ b64, type }) => {
    const blob = await (await fetch(`data:${type};base64,${b64}`)).blob(), bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale)), ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: img.width, height: img.height, data: Array.from(img.data) };
  }, { b64: bytes.toString('base64'), type: mime[extname(s.file).toLowerCase()] ?? 'image/jpeg' });
  const t0 = performance.now(), a = analyzeGearImage({ ...decoded, data: Uint8ClampedArray.from(decoded.data) }), ms = performance.now() - t0;
  const top = a.candidateTypes[0]?.type ?? 'undetermined';
  rows.push({ file: s.file, expectedType: s.type, type: top, typeOk: top === s.type, expectedTeeth: s.teeth, teeth: a.toothCount,
    teethOk: a.toothCount === s.teeth, ungated: a.diagnostics.ungatedToothCandidate, status: a.status, confidence: +a.confidence.toFixed(3), ms: Math.round(ms) });
}
await browser.close();
const n = rows.length, pct = (k: number) => `${k}/${n} (${Math.round(100 * k / n)} %)`;
console.table(rows.map(r => ({ file: r.file, type: `${r.type}${r.typeOk ? '' : ` ≠ ${r.expectedType}`}`, teeth: `${r.teeth ?? '—'} / ${r.expectedTeeth}`, ungated: r.ungated, status: r.status, ms: r.ms })));
const summary = { samples: n, typeAccuracy: pct(rows.filter(r => r.typeOk).length), teethExact: pct(rows.filter(r => r.teethOk).length),
  teethProposed: pct(rows.filter(r => r.teeth !== null).length), wrongTeethProposals: rows.filter(r => r.teeth !== null && !r.teethOk).length };
console.log(summary);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ summary, rows }, null, 2));
