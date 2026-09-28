import { PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, translate, scale, setFillingRgbColor, moveTo, lineTo, closePath, fill, type PDFPage, type PDFFont, type PDFOperator } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { zipSync, strToU8 } from 'fflate';
import { dimensionText, inspectDocumentSTL, projectSTLSilhouette, type ModelDocumentInput, type Projection } from './modelDocumentData.ts';
import { manufacturingStatus, manufacturingPurposes, manufacturingProcesses, signedDeviation } from './manufacturing.ts';

export interface DocumentFonts { regular: Uint8Array; bold: Uint8Array }
export const documentNotes = [
  'Силуэты ортогональных проекций построены по граням этого STL. Они показывают заполненную проекцию, а не разрез, линии зубьев на скрытых поверхностях или посадочный чертёж.',
  'X, Y и Z - габариты по осям исходного STL, в миллиметрах. Номинальные размеры ядра указаны отдельно. Габарит проекции может отличаться от диаметра окружности или длины торцевого сечения.',
  'Масштаб видов подобран для листа. Не измеряйте размеры по изображению. Значения округлены до шести знаков после запятой; это не допуск изготовления.',
  'Перед изготовлением согласуйте материал, способ изготовления, посадки и допуски, ответную деталь, нагрузку, обороты, температуру и контроль опытного образца. Этот лист не заменяет утверждённый рабочий чертёж.',
];
export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Keep a single nonzero fill (no antialias seams), but bound each JS argument list.
 * PDFPage.drawSvgPath spreads the complete path, which overflows for real gear meshes.
 */
function drawSilhouette(page: PDFPage, path: string, x: number, y: number) {
  page.pushOperators(pushGraphicsState(), translate(x, y), scale(1, -1), setFillingRgbColor(.35, .4, .41));
  let batch: PDFOperator[] = [];
  for (const match of path.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)|(Z)/g)) {
    batch.push(match[4] ? closePath() : match[1] === 'M' ? moveTo(+match[2], +match[3]) : lineTo(+match[2], +match[3]));
    if (batch.length === 4096) { page.pushOperators(...batch); batch = []; }
  }
  if (batch.length) page.pushOperators(...batch);
  page.pushOperators(fill(), popGraphicsState());
}

/** One bundle owns the exact same STL, passport and dimensional sheet. Runs in a worker in the UI. */
export async function createModelDocuments(input: ModelDocumentInput, fonts: DocumentFonts, createdAt = new Date().toISOString()) {
  if (!/^[a-zA-Z0-9_.-]+\.stl$/.test(input.filename) || !Number.isFinite(Date.parse(createdAt))) throw new Error('Не удалось определить имя или дату комплекта.');
  const stl = inspectDocumentSTL(input.stl), passport = JSON.parse(input.passport);
  if (passport.artifact?.triangles !== stl.triangles || passport.artifact?.preset !== input.preset || passport.artifact?.purpose !== 'STL-export')
    throw new Error('Паспорт не соответствует подготовленному STL.');
  if (JSON.stringify(passport.manufacturing ?? null) !== JSON.stringify(input.manufacturing ?? null))
    throw new Error('Требования в документах не соответствуют паспорту STL.');
  const hash = await sha256(input.stl), stem = input.filename.slice(0, -4);
  const pdfName = `${stem}-dimensions.pdf`, passportName = `${stem}-passport.json`;
  const pdfDoc = await PDFDocument.create(); pdfDoc.registerFontkit(fontkit);
  const regular = await pdfDoc.embedFont(fonts.regular, { subset: true }), bold = await pdfDoc.embedFont(fonts.bold, { subset: true });
  pdfDoc.setTitle(`${input.projectName || 'Деталь'} - размерный лист`); pdfDoc.setAuthor('Зацепление');
  pdfDoc.setSubject(`STL ${input.filename}; SHA-256 ${hash}`); pdfDoc.setCreator(`Gear Studio ${input.appVersion}`);
  pdfDoc.setCreationDate(new Date(createdAt)); pdfDoc.setModificationDate(new Date(createdAt));
  const width = 841.89, height = 595.28, margin = 38, usable = width - margin * 2;
  const ink = rgb(.12, .15, .17), muted = rgb(.35, .39, .42), line = rgb(.78, .8, .81), tint = rgb(.95, .96, .96);
  const charset = new Set(regular.getCharacterSet()), boldCharset = new Set(bold.getCharacterSet());
  let escapedGlyph = false;
  const printable = (value: string) => [...value.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')].map(char => {
    const code = char.codePointAt(0)!;
    if (charset.has(code) && boldCharset.has(code)) return char;
    escapedGlyph = true; return `[U+${code.toString(16).toUpperCase()}]`;
  }).join('');
  const wrap = (value: string, size: number, maxWidth: number, font: PDFFont = regular) => {
    const lines: string[] = []; let current = '';
    for (const word of printable(value).split(/\s+/).filter(Boolean)) {
      if (current && font.widthOfTextAtSize(`${current} ${word}`, size) <= maxWidth) { current += ` ${word}`; continue; }
      if (current) { lines.push(current); current = ''; }
      for (const char of word) {
        if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) { lines.push(current); current = ''; }
        current += char;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  };
  const text = (page: PDFPage, value: string, x: number, y: number, size = 10, strong = false, color = ink) => page.drawText(printable(value), { x, y, size, font: strong ? bold : regular, color });
  const rule = (page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness = .6) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: line, thickness });
  const newPage = (title: string) => {
    const page = pdfDoc.addPage([width, height]);
    text(page, 'ЗАЦЕПЛЕНИЕ / ДОКУМЕНТЫ МОДЕЛИ', margin, height - 32, 8, true, muted);
    text(page, title, margin, height - 62, 22, true);
    rule(page, margin, 45, width - margin, 45);
    return page;
  };
  const page = newPage('Размерный лист модели');
  const nameLines = wrap(input.projectName || String(input.nominalRows[0]?.value || 'Деталь'), 11, usable, bold);
  nameLines.slice(0, 2).forEach((value, index) => text(page, value, margin, 510 - index * 14, 11, true));
  text(page, input.filename, margin, 470, 9);
  text(page, createdAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'), width - margin - 172, 470, 8, false, muted);
  text(page, `SHA-256: ${hash}`, margin, 455, 8, false, muted);
  const cardWidth = (usable - 24) / 3;
  (['XY', 'XZ', 'YZ'] as Projection[]).forEach((projection, index) => {
    const x = margin + index * (cardWidth + 12), top = 430;
    const drawing = projectSTLSilhouette(input.stl, projection, stl.bounds, cardWidth - 66, 142);
    page.drawRectangle({ x, y: 208, width: cardWidth, height: 225, borderWidth: .5, borderColor: line });
    text(page, `${projection} / вдоль ${projection === 'XY' ? 'Z' : projection === 'XZ' ? 'Y' : 'X'}`, x + 14, top - 20, 10, true);
    const px = x + 43 + (cardWidth - 66 - drawing.width) / 2, py = 384 - (142 - drawing.height) / 2;
    drawSilhouette(page, drawing.path, px, py);
    const bottom = py - drawing.height, dimensionY = bottom - 13, dimensionX = px - 13;
    rule(page, px, bottom - 3, px, dimensionY - 4); rule(page, px + drawing.width, bottom - 3, px + drawing.width, dimensionY - 4);
    rule(page, px, dimensionY, px + drawing.width, dimensionY);
    for (const edge of [px, px + drawing.width]) rule(page, edge - 2, dimensionY - 2, edge + 2, dimensionY + 2, 1);
    const hLabel = `${drawing.horizontal} ${dimensionText(drawing.horizontalSize)} мм`;
    text(page, hLabel, px + drawing.width / 2 - regular.widthOfTextAtSize(hLabel, 8) / 2, dimensionY - 12, 8);
    rule(page, px - 3, bottom, dimensionX - 4, bottom); rule(page, px - 3, py, dimensionX - 4, py);
    rule(page, dimensionX, bottom, dimensionX, py);
    for (const edge of [bottom, py]) rule(page, dimensionX - 2, edge - 2, dimensionX + 2, edge + 2, 1);
    const vLabel = `${drawing.vertical} ${dimensionText(drawing.verticalSize)} мм`;
    page.drawText(vLabel, { x: dimensionX - 6, y: bottom + drawing.height / 2 - regular.widthOfTextAtSize(vLabel, 8) / 2, size: 8, font: regular, color: ink, rotate: degrees(90) });
  });
  text(page, 'Габариты STL, мм', margin, 185, 11, true);
  stl.bounds.size.forEach((value, axis) => text(page, `${'XYZ'[axis]}  ${dimensionText(value)}`, margin + axis * (usable / 3), 163, 16, true));
  text(page, `${input.preset === 'pro' ? 'Pro' : 'Standard'} / ${stl.triangles.toLocaleString('ru-RU')} треугольников / объём сетки ${dimensionText(input.volume / 1000)} см³`, margin, 138, 9);
  const intro = 'Проекции вписаны в рамки; масштаб видов может различаться. Номинальные параметры и условия приведены далее. Это размерный лист сетки для проверки и согласования, а не утверждённый рабочий чертёж.';
  wrap(intro, 9, usable).forEach((value, index) => text(page, value, margin, 111 - index * 14, 9, false, muted));

  let tablePage = newPage('Номинальные параметры'), column = 0, y = 491;
  text(tablePage, 'Размеры аналитического ядра. Габариты самого файла показаны на первом листе.', margin, 510, 9, false, muted);
  const columnWidth = (usable - 30) / 2;
  for (const row of input.nominalRows) {
    const labels = wrap(row.label, 9, columnWidth * .6 - 12);
    const values = wrap(`${typeof row.value === 'number' ? dimensionText(row.value) : row.value}${row.unit ? ` ${row.unit}` : ''}`, 9, columnWidth * .4 - 12, bold);
    const rowHeight = Math.max(labels.length, values.length) * 13 + 12;
    if (y - rowHeight < 65) {
      if (!column) { column = 1; y = 491; }
      else { tablePage = newPage('Номинальные параметры / продолжение'); column = 0; y = 491; }
    }
    const x = margin + column * (columnWidth + 30);
    tablePage.drawRectangle({ x, y: y - rowHeight + 4, width: columnWidth, height: rowHeight, color: tint });
    labels.forEach((value, index) => text(tablePage, value, x + 6, y - 9 - index * 13, 9));
    values.forEach((value, index) => text(tablePage, value, x + columnWidth * .6, y - 9 - index * 13, 9, true));
    y -= rowHeight + 3;
  }

  let sectionTitle = input.manufacturing ? 'Требования к изготовлению' : 'Происхождение и условия';
  let notePage = newPage(sectionTitle); y = 499;
  const paragraph = (value: string, strong = false) => {
    const lines = wrap(value, strong ? 11 : 10, usable, strong ? bold : regular);
    if (strong && y - lines.length * 15 < 85) { notePage = newPage(`${sectionTitle} / продолжение`); y = 499; }
    if (!strong && lines.length <= 4 && y - (lines.length - 1) * 15 < 66) { notePage = newPage(`${sectionTitle} / продолжение`); y = 499; }
    for (const lineText of lines) {
      if (y < 66) { notePage = newPage(`${sectionTitle} / продолжение`); y = 499; }
      text(notePage, lineText, margin, y, strong ? 11 : 10, strong); y -= 15;
    }
    y -= strong ? 8 : 6;
  };
  if (input.manufacturing) {
    const m = input.manufacturing, r = m.request;
    const sentence = (value: string) => /[.!?…]$/.test(value.trimEnd()) ? value : `${value}.`;
    paragraph(manufacturingStatus[m.status], true);
    if (m.status !== 'reviewed') paragraph('Эта карточка ещё не сверена с текущей моделью. Перед передачей в изготовление откройте требования и устраните замечания.');
    else paragraph(`Сверено пользователем ${m.review!.reviewedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}. Это не согласование исполнителя.`);
    paragraph(`Назначение: ${manufacturingPurposes[r.purpose]}. Количество: ${(r.quantity ?? r.quantityInput) || 'не задано'} шт.`);
    paragraph(sentence(`Способ: ${manufacturingProcesses[r.process]}. Материал: ${r.material || 'уточнить с исполнителем'}`));
    paragraph(sentence(`Применение: ${r.application || 'не указано'}`));
    paragraph(sentence(`Нагрузка и условия: ${r.operatingConditions || 'не указаны'}`));
    paragraph(sentence(`Ответная деталь и сопряжение: ${r.matingPart || 'не указаны'}`));
    paragraph('Размеры готовой детали', true);
    if (!m.dimensions.length) paragraph('Предельные размеры не заданы.');
    for (const row of m.dimensions) {
      paragraph(`${row.label}: номинал ${row.nominal === null ? 'не применяется' : `${dimensionText(row.nominal)} мм`}; нижнее отклонение ${row.lowerDeviation === null ? row.lowerInput || 'не задано' : signedDeviation(row.lowerDeviation)}; верхнее отклонение ${row.upperDeviation === null ? row.upperInput || 'не задано' : signedDeviation(row.upperDeviation)} мм.`);
      paragraph(row.minimum === null || row.maximum === null ? `Требует уточнения: ${row.errors.join(' ')}` : `Предельные размеры: от ${dimensionText(row.minimum)} до ${dimensionText(row.maximum)} мм.`);
    }
    if (r.notes) paragraph(`Примечания и контроль: ${r.notes}`);
    if (m.issues.length) { paragraph('Исправить перед проверкой', true); m.issues.forEach(value => paragraph(value)); }
    paragraph(`Останется согласовать: ${m.clarifications.join('; ')}.`);
    paragraph(m.interpretation);
    sectionTitle = 'Происхождение и условия'; notePage = newPage(sectionTitle); y = 499;
  }
  paragraph('Исходные данные', true);
  paragraph(`Проект: ${input.projectName || 'Деталь'}.`);
  paragraph(input.origin.length > 2000 ? `${input.origin.slice(0, 2000)}... Полный текст - в JSON-паспорте.` : input.origin);
  paragraph('Исходные измерения, пользовательские подтверждения и сведения о дополнительных фото находятся в evidence JSON-паспорта. Сами фото и история редактирования передаются отдельным файлом проекта .gear.json.');
  paragraph('Как читать лист', true); documentNotes.forEach(value => paragraph(value));
  paragraph('Условия модели и проверки', true); input.warnings.forEach(value => paragraph(value));
  paragraph(`Отдельно не проверено: ${input.notVerified.join('; ')}.`);
  if (escapedGlyph) paragraph('Символы, которых нет в шрифте, записаны как [U+код]. Исходное название проекта сохранено в manifest.json, происхождение - в JSON-паспорте.');
  for (const [index, sheet] of pdfDoc.getPages().entries()) {
    text(sheet, `Gear Studio ${input.appVersion} / ${input.preset} / ${hash.slice(0, 16)}`, margin, 29, 8, false, muted);
    text(sheet, `${index + 1} / ${pdfDoc.getPageCount()}`, width - margin - 36, 29, 8, false, muted);
  }
  const pdf = await pdfDoc.save(), passportBytes = strToU8(input.passport);
  const readme = strToU8(`ЗАЦЕПЛЕНИЕ / КОМПЛЕКТ МОДЕЛИ\n\nПроект: ${input.projectName}\nПриложение: ${input.appVersion}\nСформирован: ${createdAt}\n\n${input.filename} - импортировать в миллиметрах.\n${pdfName} - проекции, габариты STL, номинальные параметры и условия.\n${passportName} - полный машиночитаемый паспорт этой сетки с происхождением данных.\nmanifest.json - имена, размеры и SHA-256 файлов.\n\nРазмерный лист не заменяет утверждённый рабочий чертёж с согласованными посадками, материалом и допусками. До применения требуется пробное изготовление и проверка сопряжения.\n\nИсходные фотографии и история версий не включены в ZIP. Для их передачи отдельно скачайте файл проекта .gear.json. Заказ на изготовление не отправлен, оплата не выполнена.\n`);
  const files: Record<string, Uint8Array> = { [input.filename]: new Uint8Array(input.stl), [passportName]: passportBytes, [pdfName]: pdf, 'README.txt': readme };
  const manifest = { schema: 'zatseplenie.model-documents.v1', appVersion: input.appVersion, createdAt, projectName: input.projectName,
    preset: input.preset, units: 'mm', stlBounds: stl.bounds, files: await Promise.all(Object.entries(files).map(async ([name, bytes]) => ({ name, bytes: bytes.byteLength, sha256: await sha256(bytes) }))) };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zip = zipSync(files, { level: 6 });
  return { pdf, zip, pdfName, zipName: `${stem}-package.zip`, pages: pdfDoc.getPageCount(), manifest };
}
