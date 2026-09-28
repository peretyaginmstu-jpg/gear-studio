import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const num = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true });

async function buildKeyedGear(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: /Задать параметры/ }).click();
  await num(page, 'Число зубьев').fill('30');
  await num(page, 'Отверстие').fill('12');
  await page.getByText('Шпоночный паз и ступица').click();
  await page.getByRole('button', { name: /Паз по ГОСТ 23360/ }).click();
  await num(page, 'Диаметр ступицы').fill('30');
  await num(page, 'Длина ступицы').fill('8');
  await expect(page.getByText('Параметры можно использовать для построения.')).toBeVisible();
  await page.getByRole('button', { name: 'Построить модель' }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте модель' })).toBeVisible();
}

test('manual gear with keyway and hub: build, review, download STL and DXF', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await buildKeyedGear(page);
  await expect(page.locator('.parameter-summary')).toContainText('4 × 1,8 мм');
  await expect(page.locator('.parameter-summary')).toContainText('⌀ 30 × 8 мм');
  await expect(page.locator('.webgl-host canvas')).toHaveCount(1);

  await page.getByRole('button', { name: /Модель верна/ }).click();
  await page.getByText('Standard STL — бесплатно').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Скачать Standard STL' }).click();
  await expect(page.getByText(/треугольников ·/)).toBeVisible();
  await page.getByText('Условия модели понятны.').click();

  const [stl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('stl-download').click()]);
  const bytes = await readFile((await stl.path())!);
  expect(bytes.subarray(0, 11).toString()).toBe('Zatseplenie');
  expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80));

  const [dxf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-dxf').click()]);
  expect(dxf.suggestedFilename()).toMatch(/-profile\.dxf$/);
  const text = await readFile((await dxf.path())!, 'utf8');
  expect(text).toContain('POLYLINE');
  expect(text).toContain('BORE');
  expect(text.trimEnd().endsWith('EOF')).toBe(true);
  expect(errors).toEqual([]);
});

test('pin measurement and diametral pitch tools', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Задать параметры/ }).click();
  await page.getByText('Размер по роликам (M)').click();
  await expect(page.getByTestId('pin-measurement')).toHaveText(/^\d+,\d+ мм$/);
  await page.getByLabel('Диаметр ролика').fill('3.5');
  await page.getByLabel('Измеренный размер по роликам').fill('55');
  await page.getByRole('button', { name: /Применить x =/ }).click();
  await expect(num(page, 'Смещение')).not.toHaveValue('0');

  await page.getByRole('button', { name: 'Дюймовый DP' }).click();
  await num(page, 'Diametral pitch').fill('24');
  await expect(page.getByText(/m = 25,4 \/ P = 1,05833/)).toBeVisible();
  await page.getByRole('button', { name: 'Модуль, мм' }).click();
  await expect(page.getByText('Это дюймовый шаг DP 24.')).toBeVisible();
});

// Headless Chromium names Cyrillic blob downloads "download", so this file name stays Latin.
test('project file round-trips through download and import', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Название проекта').fill('E2E gear');
  await page.getByRole('button', { name: /Задать параметры/ }).click();
  await num(page, 'Число зубьев').fill('41');
  await expect(page.getByText('Сохранено на устройстве')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать проект' }).click()]);
  expect(file.suggestedFilename()).toMatch(/\.gear\.json$/);
  await page.getByRole('button', { name: 'Новый' }).click();
  await expect(page.getByLabel('Название проекта')).toHaveValue('Новая деталь');
  await page.getByLabel('Открыть файл проекта').setInputFiles((await file.path())!);
  await expect(page.getByLabel('Название проекта')).toHaveValue('E2E gear (импорт)');
  // The imported journey reopens where it was saved: on the manual input step.
  await expect(num(page, 'Число зубьев')).toHaveValue('41');
});
