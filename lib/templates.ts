import { defaultModel, type ModelParams } from './model.ts';
import { standardKeyway } from './keyway.ts';

/**
 * Generic starting points for common repair and hobby parts. They are not catalogue data of any
 * manufacturer: every value must still be checked against the actual part or drawing.
 */
export interface GearTemplate { id: string; title: string; hint: string; params: ModelParams }
const key = (bore: number) => { const k = standardKeyway(bore)!; return { keywayWidth: k.width, keywayDepth: k.depth }; };

export const gearTemplates: GearTemplate[] = [
  { id: 'spur-m1-z20', title: 'Шестерня m1 · z20 · вал 5 мм', hint: 'Мелкие приводы, моторедукторы, 3D-принтеры.',
    params: { ...defaultModel('spur'), teeth: 20, module: 1, width: 8, bore: 5 } },
  { id: 'spur-m15-z30-key', title: 'Колесо m1,5 · z30 · вал 12 мм со шпонкой', hint: 'Паз 4 × 1,8 по ГОСТ 23360.',
    params: { ...defaultModel('spur'), teeth: 30, module: 1.5, width: 12, bore: 12, ...key(12) } },
  { id: 'spur-m2-z40-hub', title: 'Колесо m2 · z40 со ступицей · вал 15 мм', hint: 'Ступица ⌀30 × 10 мм, паз 5 × 2,3.',
    params: { ...defaultModel('spur'), teeth: 40, module: 2, width: 12, bore: 15, hubDiameter: 30, hubLength: 10, ...key(15) } },
  { id: 'spur-stub', title: 'Укороченный зуб m2 · z18 (ha* = 0,8)', hint: 'Прочнее у корня; частый выбор для печатных колёс.',
    params: { ...defaultModel('spur'), teeth: 18, module: 2, width: 10, bore: 8, addendumCoefficient: .8, clearanceCoefficient: .25, profileShift: .2 } },
  { id: 'helical-m15-z25', title: 'Косозубое m1,5 · z25 · β = 15°', hint: 'Тише прямозубого; ответному колесу нужен противоположный наклон.',
    params: { ...defaultModel('helical'), teeth: 25, module: 1.5, helixAngleDeg: 15, width: 12, bore: 8 } },
  { id: 'dp24-z36', title: 'Дюймовое DP24 · z36 · α = 14,5°', hint: 'Старая американская и британская техника.',
    params: { ...defaultModel('spur'), teeth: 36, module: 25.4 / 24, pressureAngleDeg: 14.5, width: 6.35, bore: 6.35 } },
  { id: 'rack-m1', title: 'Рейка m1 · 20 зубьев', hint: 'Линейные приводы и столы.',
    params: { ...defaultModel('rack'), teeth: 20, module: 1, width: 10 } },
  { id: 'ring-m1-z60', title: 'Венец планетарной передачи m1 · z60', hint: 'Внутреннее прямозубое колесо, обод 4 мм.',
    params: { ...defaultModel('internal'), teeth: 60, module: 1, width: 10, rimThickness: 4 } },
  { id: 'worm-m1', title: 'Червяк m1 · один заход', hint: 'Самотормозящие приводы; колесо подбирается отдельно.',
    params: { ...defaultModel('worm'), module: 1, width: 16, bore: 3, wormStarts: 1, wormDiameterFactor: 10 } },
];
