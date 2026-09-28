import {generatedExternalOutline} from './generatedRoot.ts';
import type {RootDiagnostics} from './generatedRoot.ts';
import {defaultInternalCutter, deriveInternalCutter, generatedInternalOutline, internalCutterKeys} from './generatedInternalRoot.ts';
import type {InternalCutterGeometry, InternalRootDiagnostics} from './generatedInternalRoot.ts';
/**
 * Dependency-free involute gear kernel. All linear dimensions are millimetres.
 * Analytic flanks; rack-generated external roots and pinion-generated internal spur roots.
 * Internal helical roots remain an explicitly separate simplified transverse model.
 * A valid closed mesh is not an ISO/JIS precision grade or a strength/meshability certificate.
 */
export type GearKind = 'spur' | 'helical' | 'herringbone' | 'internal' | 'internal-helical' | 'rack' | 'helical-rack';
export interface GearParams {
  kind: GearKind;
  teeth: number;
  /** Normal module mn, also for helical gears. */
  module: number;
  /** Normal pressure angle alpha_n in degrees. */
  pressureAngleDeg: number;
  /** Signed helix angle at the reference cylinder or rack pitch plane; ignored for straight teeth. */
  helixAngleDeg: number;
  width: number;
  /** Shaft hole diameter; only for external circular gears. */
  bore: number;
  /** Normal profile shift coefficient xn. */
  profileShift: number;
  /** Normal tooth-thickness reduction PER GEAR at reference cylinder, not total pair backlash. */
  backlash: number;
  /** Basic rack addendum coefficient ha*, default 1. Stub and long-addendum systems change it. */
  addendumCoefficient?: number;
  /** Basic rack bottom clearance coefficient c*, default 0.25; not used by the generated internal spur root. */
  clearanceCoefficient?: number;
  /** Parallel-key slot width b in the bore of an external circular gear, millimetres. */
  keywayWidth?: number;
  /** Slot depth t2 beyond the bore surface at the key centreline, millimetres. */
  keywayDepth?: number;
  /** One-sided cylindrical hub on the +z face of an external circular gear. */
  hubDiameter?: number;
  hubLength?: number;
  /** Material outside an internal gear's root circle, default 3 mn. */
  rimThickness?: number;
  /** Backing below a rack's root line, default 3 mn. */
  rackBaseHeight?: number;
  /** Normal-plane radius of the explicitly assumed rounded rack cutter tip / mn. Default 0.3. */
  toolTipRadiusCoefficient?: number;
  /** Adaptive 2D contour sampling tolerance in mm. Not a certified 3D STL tolerance. */
  profileTolerance?: number;
  /** Explicit/assumed straight internal pinion cutter; never inferred from a photograph. */
  internalCutterTeeth?: number;
  internalCutterProfileShift?: number;
  internalCutterAddendumCoefficient?: number;
  internalCutterTipRadiusCoefficient?: number;
  /** Cutter reference-circle thickness reduction, millimetres. */
  internalCutterThinning?: number;
}
export interface GearWarning { code: string; severity: 'info' | 'warning'; message: string }
export interface GearDimensions {
  normalModule: number;
  transverseModule: number;
  normalPressureAngleDeg: number;
  transversePressureAngleDeg: number;
  pitchDiameter: number;
  baseDiameter: number;
  tipDiameter: number;
  rootDiameter: number;
  outsideDiameter: number;
  normalCircularPitch: number;
  transverseCircularPitch: number;
  basePitch: number;
  normalToothThickness: number;
  transverseToothThickness: number;
  tipThickness: number;
  addendum: number;
  dedendum: number;
  width: number;
  minimumProfileShift: number;
  virtualTeeth: number;
  /** Total end-to-end twist for a single helix; twice the half-width twist for herringbone. */
  twistAngleDeg: number;
  rackLength: number;
  rackHeight: number;
  /** Signed x offset between rack end faces, width * tan(beta); zero for circular gears. */
  rackAxialOffset: number;
  /** Present for the cylindrical involute kernel; other kernels keep their own tooth systems. */
  addendumCoefficient?: number;
  clearanceCoefficient?: number;
  /** Axial length including a hub; equals width without one. */
  overallLength?: number;
}
export interface GearDerived { params: GearParams; dimensions: GearDimensions; warnings: GearWarning[]; internalCutterGeometry?: InternalCutterGeometry }
export interface Point2 { x: number; y: number }
export interface GearProfile extends GearDerived {
  /** CCW material outer contour; unclosed, no duplicate endpoint. */
  outer: Point2[];
  /** CCW hole contour if present. Both loops use matching radial samples. */
  hole: Point2[] | null;
  rootDiagnostics?: RootDiagnostics;
  internalRootDiagnostics?: InternalRootDiagnostics;
}
export interface GearMesh extends GearDerived {
  positions: Float32Array;
  indices: Uint32Array;
  profile: GearProfile;
  tessellation: { flankSamples: number; axialSegments: number };
}
export interface MeshQuality { flankSamples?: number; axialSegments?: number }
export class GearGeometryError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'GearGeometryError'; this.code = code; }
}
const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const fail = (code: string, message: string): never => { throw new GearGeometryError(code, message); };
const polar = (r: number, a: number): Point2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
export const involute = (a: number): number => Math.tan(a) - a;
/** Polar angle of an involute at radius r; the curve does not exist below rb. */
export function involuteAtRadius(r: number, rb: number): number {
  if (rb <= 0 || r < rb - 1e-10) fail('BELOW_BASE', 'Эвольвента не существует ниже основной окружности.');
  const t = Math.sqrt(Math.max(0, (r / rb) ** 2 - 1));
  return t - Math.atan(t);
}
export const defaultGearParams: GearParams = {
  kind: 'spur', teeth: 24, module: 2, pressureAngleDeg: 20, helixAngleDeg: 20,
  width: 10, bore: 8, profileShift: 0, backlash: 0.08,
};
export function deriveGear(input: GearParams): GearDerived {
  const p = { ...input };
  if (!['spur','helical','herringbone','internal','internal-helical','rack','helical-rack'].includes(p.kind))
    fail('UNSUPPORTED_KIND', 'Конические, червячные и циклоидальные передачи требуют отдельных математических ядер.');
  for (const key of ['teeth','module','pressureAngleDeg','helixAngleDeg','width','bore','profileShift','backlash'] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) fail('NON_FINITE', `Параметр ${key} должен быть конечным числом.`);
  }
  for (const [key, value] of Object.entries(p)) {
    if (key !== 'kind' && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
      fail('NON_FINITE', `Параметр ${key} должен быть конечным числом.`);
  }
  const internal = p.kind === 'internal' || p.kind === 'internal-helical';
  if (p.kind !== 'internal' && internalCutterKeys.some(key => p[key] !== undefined))
    fail('INTERNAL_CUTTER_KIND', 'Параметры плоского долбяка применимы только к внутреннему прямозубому колесу.');
  if (p.kind === 'internal') for (const key of internalCutterKeys) p[key] ??= defaultInternalCutter[key];
  const rack = p.kind === 'rack' || p.kind === 'helical-rack';
  if (!Number.isInteger(p.teeth) || p.teeth < (rack ? 1 : 6) || p.teeth > 250)
    fail('TEETH_RANGE', 'Число зубьев должно быть целым: 6–250 для колеса, 1–250 для рейки.');
  if (!(p.module >= 0.1 && p.module <= 30)) fail('MODULE_RANGE', 'Нормальный модуль должен быть от 0,1 до 30 мм.');
  if (!(p.width > 0 && p.width <= 500)) fail('WIDTH_RANGE', 'Ширина должна быть больше 0 и не больше 500 мм.');
  if (!(p.pressureAngleDeg >= 10 && p.pressureAngleDeg <= 35)) fail('ANGLE_RANGE', 'Угол профиля должен быть от 10° до 35°.');
  if (!(p.profileShift >= -0.8 && p.profileShift <= 1)) fail('SHIFT_RANGE', 'Коэффициент смещения должен быть от −0,8 до +1.');
  if (!(p.backlash >= 0)) fail('BACKLASH_RANGE', 'Уменьшение толщины зуба не может быть отрицательным.');
  if (!(p.bore >= 0)) fail('BORE_RANGE', 'Диаметр отверстия не может быть отрицательным.');
  const helical = p.kind === 'helical' || p.kind === 'herringbone' || p.kind === 'internal-helical' || p.kind === 'helical-rack';
  if (helical && Math.abs(p.helixAngleDeg) > 45) fail('HELIX_RANGE', 'Модуль поддерживает угол наклона зубьев до 45°.');
  const beta = helical ? p.helixAngleDeg * DEG : 0;
  const an = p.pressureAngleDeg * DEG, cb = Math.cos(beta), mn = p.module;
  const mt = mn / cb, at = Math.atan(Math.tan(an) / cb);
  const d = p.teeth * mt, rb = d / 2 * Math.cos(at);
  const sn = mn * (PI / 2 + (internal ? -2 : 2) * p.profileShift * Math.tan(an)) - p.backlash;
  const st = sn / cb, pt = PI * mt;
  if (!(sn > 0.05 * mn && st < pt - 0.05 * mn)) fail('TOOTH_THICKNESS', 'Смещение и зазор дают недопустимую толщину зуба.');
  const haStar = p.addendumCoefficient ?? 1, cStar = p.clearanceCoefficient ?? .25;
  if (!(haStar >= .5 && haStar <= 1.5)) fail('ADDENDUM_COEFFICIENT', 'Коэффициент высоты головки ha* должен быть от 0,5 до 1,5.');
  if (!(cStar >= .05 && cStar <= .6)) fail('CLEARANCE_COEFFICIENT', 'Коэффициент радиального зазора c* должен быть от 0,05 до 0,6.');
  const ha = mn * (haStar + (internal ? -1 : 1) * p.profileShift);
  let hf = mn * (haStar + cStar + (internal ? 1 : -1) * p.profileShift);
  const ra = internal ? d / 2 - ha : d / 2 + ha;
  let rf = internal ? d / 2 + hf : d / 2 - hf;
  const warnings: GearWarning[] = [];
  if (!rack && !(Math.min(ra, rf) > mn * 0.05)) fail('ROOT_RADIUS', 'Радиусы при этих параметрах недопустимы.');
  const zv = p.teeth / cb ** 3;
  const xmin = haStar - zv * Math.sin(an) ** 2 / 2;
  if (!rack && !internal && p.profileShift < xmin - 1e-8)
    warnings.push({code:'UNDERCUT',severity:'warning',message:`Возможное подрезание: ориентир x ≥ ${xmin.toFixed(3)}. Подрезанная переходная кривая здесь не моделируется.`});
  if (internal && ra < rb)
    fail('INTERNAL_BASE_INTERFERENCE', 'Вершины внутренних зубьев ниже основной окружности: выбранные параметры требуют специального профиля и проверки интерференции. Увеличьте z, угол профиля или смещение.');
  const internalCutterGeometry = p.kind === 'internal' ? deriveInternalCutter(p) : undefined;
  if (internalCutterGeometry) { rf = internalCutterGeometry.rootRadius; hf = rf - d / 2; }
  if (!rack && !internal && p.bore / 2 >= rf - mn * 0.05)
    fail('BORE_INTERSECTION', 'Отверстие пересекает основание зубьев. Уменьшите его диаметр.');
  const bodyKeys = ['keywayWidth', 'keywayDepth', 'hubDiameter', 'hubLength'] as const;
  const keyway = (p.keywayWidth ?? 0) > 0 || (p.keywayDepth ?? 0) > 0, hub = (p.hubDiameter ?? 0) > 0 || (p.hubLength ?? 0) > 0;
  if ((keyway || hub) && (rack || internal)) fail('BODY_FEATURE_KIND', 'Шпоночный паз и ступица доступны только для наружных цилиндрических колёс.');
  for (const key of bodyKeys) if ((p[key] ?? 0) < 0) fail('BODY_FEATURE_RANGE', 'Размеры паза и ступицы не могут быть отрицательными.');
  if (hub) {
    const D = p.hubDiameter ?? 0, L = p.hubLength ?? 0;
    if (!(D > 0 && L > 0)) fail('HUB_INCOMPLETE', 'Для ступицы задайте и диаметр, и длину.');
    if (!(L <= 500)) fail('HUB_RANGE', 'Длина ступицы не должна превышать 500 мм.');
    if (!(D / 2 <= rf - mn * .25)) fail('HUB_DIAMETER', 'Ступица должна быть меньше диаметра впадин хотя бы на 0,5 модуля.');
    if (!(D / 2 >= p.bore / 2 + Math.max(.5, .1 * p.bore))) fail('HUB_WALL', 'Стенка ступицы вокруг отверстия слишком тонкая.');
  }
  if (keyway) {
    const b = p.keywayWidth ?? 0, t = p.keywayDepth ?? 0, R = p.bore / 2;
    if (!(R > 0)) fail('KEYWAY_WITHOUT_BORE', 'Шпоночный паз требует отверстия.');
    if (!(b > 0 && t > 0)) fail('KEYWAY_INCOMPLETE', 'Для шпоночного паза задайте ширину и глубину.');
    if (!(b <= 1.6 * R)) fail('KEYWAY_WIDTH', 'Ширина паза не должна превышать 0,8 диаметра отверстия.');
    const wall = Math.min(rf - mn * .25, hub ? (p.hubDiameter ?? 0) / 2 : Infinity) - Math.max(.5, .05 * p.bore);
    if (!(Math.hypot(R + t, b / 2) <= wall)) fail('KEYWAY_WALL', 'Паз слишком глубокий: стенка до впадин зубьев или поверхности ступицы слишком тонкая.');
  }
  const rim = p.rimThickness ?? 3 * mn;
  if (internal && !(rim >= 0.25 * mn)) fail('RIM_THICKNESS', 'Толщина обода должна быть не менее 0,25 модуля.');
  const baseHeight = p.rackBaseHeight ?? 3 * mn;
  if (rack && !(baseHeight > 0)) fail('RACK_BASE', 'Высота основания рейки должна быть положительной.');
  let tipThickness = 0;
  if (rack) {
    // KHK normal-system helical rack: x_t = x_n / cos(beta), y_t = y_n.
    // Its straight flanks therefore use alpha_t, not alpha_n, in a transverse section.
    tipThickness = st - 2 * ha * Math.tan(at);
    if (tipThickness <= 0.02 * mn || st + 2 * hf * Math.tan(at) >= pt)
      fail('RACK_INTERSECTION', 'При этих параметрах вершины или впадины зубьев рейки пересекаются.');
  } else {
    const half = internal
      ? st / d - involute(at) + involuteAtRadius(ra, rb)
      : st / d + involute(at) - involuteAtRadius(ra, rb);
    tipThickness = 2 * ra * half;
    if (tipThickness <= 0.02 * mn) fail('POINTED_TOOTH', 'Зуб заостряется: уменьшите смещение/зазор или измените число зубьев.');
  }
  warnings.push({ code:internalCutterGeometry?'GENERATED_INTERNAL_ROOT':!rack&&!internal?'ROOT_TOOL':'SIMPLIFIED_ROOT',severity:'info',message: rack
    ? 'Профиль рейки прямолинейный; у основания зубьев острые углы без скругления инструмента.'
    : internalCutterGeometry ? `Корень — огибающая долбяка zс=${internalCutterGeometry.tool.teeth}, ρс=${internalCutterGeometry.toolTipRadius.toFixed(3)} мм. Инструмент задан или принят; по фото он не установлен.`
    : internal ? 'Внутреннее косозубое: торцевая эвольвента до окружности впадин, без производящей переходной поверхности косозубого долбяка. Плоская огибающая к нему не применяется.'
    : `Корень рассчитывается как огибающая производящей рейки с радиусом вершины ${(mn*(p.toolTipRadiusCoefficient??.3)).toFixed(3)} мм; профиль инструмента принят как исходный параметр.` });
  if (internal) warnings.push({code:'INTERNAL_PAIR',severity:'warning',message:'Для внутреннего зацепления необходимы данные ответного колеса: интерференция и собираемость пары ещё не проверены.'});
  if (rack && p.profileShift !== 0) warnings.push({code:'RACK_DATUM',severity:'info',message:'Смещение рейки меняет положение исходной линии; размещение в паре нужно учитывать отдельно.'});
  if (haStar !== 1 || (cStar !== .25 && p.kind !== 'internal')) warnings.push({code:'NONSTANDARD_RACK',severity:'info',message:`Исходный контур задан вручную: ha* = ${haStar}, c* = ${cStar}. Проверьте его по чертежу или инструменту.`});
  if (keyway) warnings.push({code:'KEYWAY',severity:'info',message:`Шпоночный паз ${p.keywayWidth} × ${p.keywayDepth} мм (b × t₂) с острыми углами; скругления и допуск паза задаются отдельно в требованиях.`});
  if (p.kind === 'herringbone') warnings.push({code:'HERRINGBONE_SEAM',severity:'info',message:'Шеврон построен с общей средней кромкой, без технологической канавки; обе половины имеют одну замкнутую оболочку.'});
  const dimensions: GearDimensions = {
    normalModule:mn, transverseModule:mt, normalPressureAngleDeg:p.pressureAngleDeg,
    transversePressureAngleDeg:at/DEG, pitchDiameter:rack?0:d, baseDiameter:rack?0:rb*2,
    tipDiameter:rack?0:ra*2, rootDiameter:rack?0:rf*2,
    outsideDiameter:rack?0:(internal?2*(rf+rim):2*ra),
    normalCircularPitch:PI*mn, transverseCircularPitch:pt, basePitch:pt*Math.cos(at),
    normalToothThickness:sn, transverseToothThickness:st, tipThickness,
    addendum:ha, dedendum:hf, width:p.width, minimumProfileShift:xmin, virtualTeeth:zv,
    twistAngleDeg:rack?0:p.width*Math.tan(beta)/(d/2)/DEG,
    rackLength:rack?pt*p.teeth:0, rackHeight:rack?ha+hf+baseHeight:0,
    rackAxialOffset:rack?p.width*Math.tan(beta):0,
    addendumCoefficient:haStar, clearanceCoefficient:cStar, overallLength:p.width+(hub?p.hubLength??0:0),
  };
  return { params:p, dimensions, warnings, internalCutterGeometry };
}

/** Samples a CCW star-shaped involute outline, with a chord transition below rb. */
function involuteOutline(teeth:number, pitchRadius:number, rb:number, low:number, high:number, toothThickness:number, samples:number):Point2[] {
  const pitch = TAU / teeth;
  const invRef = involuteAtRadius(pitchRadius, rb);
  const startR = Math.max(low, rb);
  const halfAt = (r:number) => toothThickness/(2*pitchRadius)+invRef-involuteAtRadius(r,rb);
  const halfStart = halfAt(startR), halfTip = halfAt(high);
  if (!(halfTip > 1e-7 && halfStart > halfTip && halfStart < pitch/2 - 1e-7))
    fail('PROFILE_INTERSECTION','Профили соседних зубьев пересекаются или вершина заостряется. Измените параметры.');
  // Deliberately explicit approximation below the base circle, not an invented involute.
  const rootExtension = startR > low + 1e-10 ? Math.min((pitch/2-halfStart)*0.3, 0.12*pitch) : 0;
  const halfRoot = halfStart + rootExtension;
  const result:Point2[]=[];
  const add=(r:number,a:number)=>{ const q=polar(r,a), last=result.at(-1); if(!last || Math.hypot(q.x-last.x,q.y-last.y)>1e-10) result.push(q); };
  for(let tooth=0;tooth<teeth;tooth++) {
    const c=tooth*pitch;
    add(low,c-halfRoot);
    if(startR>low+1e-10) add(startR,c-halfStart);
    for(let j=1;j<=samples;j++) { const r=startR+(high-startR)*j/samples; add(r,c-halfAt(r)); }
    const tipSteps=Math.max(3,Math.ceil(samples/3));
    for(let j=1;j<=tipSteps;j++) add(high,c-halfTip+2*halfTip*j/tipSteps);
    for(let j=samples-1;j>=0;j--) { const r=startR+(high-startR)*j/samples; add(r,c+halfAt(r)); }
    if(startR>low+1e-10) add(low,c+halfRoot);
    const rootSteps=Math.max(3,Math.ceil(samples/3));
    for(let j=1;j<rootSteps;j++) add(low,c+halfRoot+(pitch-2*halfRoot)*j/rootSteps);
  }
  return result;
}
export function buildGearProfile(p:GearParams, flankSamples=12):GearProfile {
  const derived=deriveGear(p), d=derived.dimensions;
  const samples=Math.max(5,Math.min(64,Math.round(flankSamples)));
  if(!Number.isFinite(flankSamples)) fail('QUALITY_RANGE','Качество сетки должно быть конечным числом.');
  if(p.kind==='rack'||p.kind==='helical-rack') {
    const pitch=d.transverseCircularPitch, root=-d.dedendum, top=d.addendum;
    const bottom=root-(p.rackBaseHeight??3*p.module), length=d.rackLength;
    const halfTip=d.tipThickness/2;
    const halfRoot=d.transverseToothThickness/2+d.dedendum*Math.tan(d.transversePressureAngleDeg*DEG);
    const chain:Point2[]=[{x:-length/2,y:root}];
    for(let k=0;k<p.teeth;k++) {
      const c=-length/2+(k+.5)*pitch;
      chain.push({x:c-halfRoot,y:root},{x:c-halfTip,y:top},{x:c+halfTip,y:top},{x:c+halfRoot,y:root});
    }
    chain.push({x:length/2,y:root},{x:length/2,y:bottom},{x:-length/2,y:bottom});
    return {...derived,outer:chain.reverse(),hole:null};
  }
  const r=d.pitchDiameter/2, rb=d.baseDiameter/2, internal=p.kind==='internal'||p.kind==='internal-helical';
  const generated = internal ? null : generatedExternalOutline(p,d,samples);
  const generatedInternal = derived.internalCutterGeometry ? generatedInternalOutline(derived.params,d,derived.internalCutterGeometry,samples) : null;
  const outline=generated?.outline ?? generatedInternal?.outline ?? involuteOutline(p.teeth,r,rb,d.tipDiameter/2,d.rootDiameter/2,
    d.transverseCircularPitch-d.transverseToothThickness,samples);
  if(generated){
    derived.warnings=derived.warnings.filter(w=>w.code!=='SIMPLIFIED_ROOT'&&w.code!=='ROOT_TOOL');
    derived.warnings.push({code:'GENERATED_ROOT',severity:'info',message:`Корень — огибающая производящей рейки с радиусом вершины ${generated.diagnostics.toolTipRadius.toFixed(3)} мм. Радиус инструмента принят как параметр, по фото не установлен.`});
  }
  const circle=(radius:number)=>outline.map(v=>polar(radius,Math.atan2(v.y,v.x)));
  return {...derived,outer:internal?circle(d.outsideDiameter/2):outline,
    hole:internal?outline:p.bore>0?boreContour(p.bore/2,p.keywayWidth??0,p.keywayDepth??0,samples):null,rootDiagnostics:generated?.diagnostics,internalRootDiagnostics:generatedInternal?.diagnostics};
}

/** CCW bore, optionally with a sharp-cornered parallel-key slot along +x. Strictly angle-monotone about the axis. */
export function boreContour(radius:number, keywayWidth:number, keywayDepth:number, flankSamples=12):Point2[] {
  const count=Math.max(48,flankSamples*8), points:Point2[]=[];
  if(!(keywayWidth>0&&keywayDepth>0)) { for(let k=0;k<count;k++)points.push(polar(radius,TAU*k/count)); return points; }
  const half=keywayWidth/2, corner=Math.asin(half/radius), top=radius+keywayDepth, x0=radius*Math.cos(corner);
  const arcSteps=Math.max(8,Math.ceil(count*(TAU-2*corner)/TAU)), edgeSteps=Math.max(4,Math.ceil(flankSamples/2));
  for(let k=0;k<arcSteps;k++)points.push(polar(radius,corner+(TAU-2*corner)*k/arcSteps));
  for(let k=0;k<edgeSteps;k++)points.push({x:x0+(top-x0)*k/edgeSteps,y:-half});
  for(let k=0;k<edgeSteps;k++)points.push({x:top,y:-half+keywayWidth*k/edgeSteps});
  for(let k=0;k<edgeSteps;k++)points.push({x:top-(top-x0)*k/edgeSteps,y:half});
  return points;
}
/** Triangulates the planar ring between two CCW loops that are angle-monotone about the origin. */
export function stitchLoops(outer:{id:number;p:Point2}[], inner:{id:number;p:Point2}[], upward:boolean):number[] {
  const norm=(a:number)=>((a%TAU)+TAU)%TAU, angle=(q:Point2)=>norm(Math.atan2(q.y,q.x));
  const n=outer.length,m=inner.length;
  let i0=0; for(let k=1;k<n;k++)if(angle(outer[k].p)<angle(outer[i0].p))i0=k;
  const base=angle(outer[i0].p), rel=(q:Point2)=>norm(angle(q)-base);
  let j0=0; for(let k=1;k<m;k++)if(rel(inner[k].p)<rel(inner[j0].p))j0=k;
  const unwrap=(loop:{p:Point2}[],start:number)=>{ const out:number[]=[]; for(let k=0;k<loop.length;k++){ let a=base+rel(loop[(start+k)%loop.length].p); while(k&&a<out[k-1]-1e-12)a+=TAU; out.push(a);} out.push(out[0]+TAU); return out; };
  const A=unwrap(outer,i0),B=unwrap(inner,j0),O=(k:number)=>outer[(i0+k)%n].id,H=(k:number)=>inner[(j0+k)%m].id,faces:number[]=[];
  const tri=(a:number,b:number,c:number)=>upward?faces.push(a,b,c):faces.push(a,c,b);
  const P=(loop:{p:Point2}[],start:number,k:number)=>loop[(start+k)%loop.length].p;
  const ccw=(a:Point2,b:Point2,c:Point2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>1e-12;
  let i=0,j=0;
  while(i<n||j<m) {
    // Angular order first; a non-convex bore (key slot) may force the other valid diagonal.
    const outerOk=i<n&&ccw(P(outer,i0,i),P(outer,i0,i+1),P(inner,j0,j)), innerOk=j<m&&ccw(P(outer,i0,i),P(inner,j0,j+1),P(inner,j0,j));
    const preferOuter=j>=m||(i<n&&A[i+1]<=B[j+1]);
    if(outerOk&&(preferOuter||!innerOk)){tri(O(i),O(i+1),H(j));i++;}
    else if(innerOk){tri(O(i),H(j+1),H(j));j++;}
    else fail('CAP_TRIANGULATION','Не удалось построить торец между зубчатым венцом и отверстием.');
  }
  return faces;
}
function signedArea(points:Point2[]):number { return points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2; }
/** General simple-polygon ear clipping, used only by the rack cap. */
function triangulatePolygon(points:Point2[]):number[] {
  const polygon=points.map((_,i)=>i), faces:number[]=[];
  const cross=(a:Point2,b:Point2,c:Point2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  let guard=points.length*points.length;
  while(polygon.length>3 && guard-->0) {
    let found=false;
    for(let k=0;k<polygon.length;k++) {
      const ai=polygon[(k+polygon.length-1)%polygon.length], bi=polygon[k], ci=polygon[(k+1)%polygon.length];
      const a=points[ai],b=points[bi],c=points[ci];
      if(cross(a,b,c)<=1e-11) continue;
      let inside=false;
      for(const pi of polygon) { if(pi===ai||pi===bi||pi===ci)continue; const v=points[pi];
        if(cross(a,b,v)>=-1e-11&&cross(b,c,v)>=-1e-11&&cross(c,a,v)>=-1e-11){inside=true;break;}
      }
      if(inside) continue;
      faces.push(ai,bi,ci); polygon.splice(k,1); found=true; break;
    }
    if(!found) fail('TRIANGULATION','Не удалось построить непересекающуюся сетку профиля.');
  }
  if(polygon.length===3)faces.push(...polygon);
  return faces;
}
export function buildGearMesh(params:GearParams, quality:MeshQuality={}):GearMesh {
  const flankSamples=Math.max(5,Math.min(64,Math.round(quality.flankSamples??12)));
  const profile=buildGearProfile(params,flankSamples),{outer,hole,dimensions:d}=profile;
  if(signedArea(outer)<=0 || (hole&&signedArea(hole)<=0))fail('WINDING','Некорректная ориентация контура.');
  const rack=params.kind==='rack'||params.kind==='helical-rack';
  const helical=params.kind==='helical'||params.kind==='herringbone'||params.kind==='internal-helical';
  const twist=d.twistAngleDeg*DEG;
  let axialSegments=helical?Math.max(8,Math.ceil(Math.abs(d.twistAngleDeg)/1.5)):1;
  if(quality.axialSegments!==undefined) {
    if(!Number.isFinite(quality.axialSegments))fail('QUALITY_RANGE','Качество сетки должно быть конечным числом.');
    axialSegments=Math.max(axialSegments,Math.min(256,Math.round(quality.axialSegments)));
  }
  if(params.kind==='herringbone'&&axialSegments%2)axialSegments++;
  if(axialSegments>256)fail('EXCESSIVE_TWIST','Для такой ширины и наклона требуется слишком много сечений. Уменьшите ширину или наклон.');
  if(!rack&&params.kind!=='internal'&&params.kind!=='internal-helical'&&(hole||(params.hubLength??0)>0))
    return buildExternalBodyMesh(params,profile,axialSegments,flankSamples,helical,twist);
  const ringCount=outer.length+(hole?.length??0);
  const estimatedVertices=(axialSegments+1)*ringCount+(!hole&&!rack?2:0);
  const estimatedTriangles=2*axialSegments*ringCount+(hole?4*outer.length:rack?2*(outer.length-2):2*outer.length);
  if(estimatedVertices>250_000||estimatedTriangles>500_000)
    fail('MESH_BUDGET','Слишком сложная сетка для браузера. Уменьшите ширину, число зубьев или качество дискретизации.');
  const positions:number[]=[], indices:number[]=[];
  const vertex=(x:number,y:number,z:number)=>{positions.push(x,y,z);return positions.length/3-1;};
  const face=(a:number,b:number,c:number)=>indices.push(a,b,c);
  for(let k=0;k<=axialSegments;k++) {
    const t=k/axialSegments;
    // Positive beta: angle increases with +z. For herringbone it reverses at z=0.
    const phase=helical?(params.kind==='herringbone'?twist*(.5-Math.abs(t-.5)):twist*(t-.5)):0;
    const co=Math.cos(phase),si=Math.sin(phase),z=(t-.5)*params.width;
    // A rack tooth is a plane u = x*cos(beta) - z*sin(beta) = constant.
    // Linear skew is exact with one axial segment; rotating rack sections would be wrong.
    const rackOffset=rack?d.rackAxialOffset*(t-.5):0;
    for(const loop of [outer,...(hole?[hole]:[])]) for(const p of loop)vertex(p.x*co-p.y*si+rackOffset,p.x*si+p.y*co,z);
  }
  for(let k=0;k<axialSegments;k++) {
    const low=k*ringCount,high=(k+1)*ringCount;
    for(let j=0;j<outer.length;j++) {const next=(j+1)%outer.length;
      face(low+j,low+next,high+next);face(low+j,high+next,high+j);
    }
    if(hole)for(let j=0;j<hole.length;j++){const next=(j+1)%hole.length,off=outer.length;
      face(low+off+j,high+off+next,low+off+next);face(low+off+j,high+off+j,high+off+next);
    }
  }
  const top=axialSegments*ringCount;
  if(hole) {
    if(hole.length!==outer.length)fail('CAP_MAPPING','Число узлов сопряжённых контуров различается.');
    for(let j=0;j<outer.length;j++){const next=(j+1)%outer.length,inner=outer.length;
      face(top+j,top+next,top+inner+next);face(top+j,top+inner+next,top+inner+j);
      face(j,inner+next,next);face(j,inner+j,inner+next);
    }
  } else if(rack) {
    const cap=triangulatePolygon(outer);
    for(let k=0;k<cap.length;k+=3){const[a,b,c]=cap.slice(k,k+3);face(top+a,top+b,top+c);face(a,c,b);}
  } else {
    const bottomCentre=vertex(0,0,-params.width/2),topCentre=vertex(0,0,params.width/2);
    for(let j=0;j<outer.length;j++){const next=(j+1)%outer.length;face(topCentre,top+j,top+next);face(bottomCentre,next,j);}
  }
  return {...profile,profile,positions:new Float32Array(positions),indices:new Uint32Array(indices),tessellation:{flankSamples,axialSegments}};
}

/** External gear whose bore/keyway and optional hub are straight prisms; only the toothed rim twists. */
function buildExternalBodyMesh(params:GearParams,profile:GearProfile,axialSegments:number,flankSamples:number,helical:boolean,twist:number):GearMesh {
  const {outer,hole}=profile,w=params.width,hubLength=(params.hubLength??0)>0?params.hubLength??0:0;
  const hub=hubLength>0?Array.from({length:Math.max(48,flankSamples*8)},(_,k)=>polar((params.hubDiameter??0)/2,TAU*k/Math.max(48,flankSamples*8))):null;
  const estimatedTriangles=2*axialSegments*outer.length+4*(outer.length+(hole?.length??0)+(hub?.length??0)*2);
  if((axialSegments+1)*outer.length>250_000||estimatedTriangles>500_000)
    fail('MESH_BUDGET','Слишком сложная сетка для браузера. Уменьшите ширину, число зубьев или качество дискретизации.');
  const positions:number[]=[],indices:number[]=[];
  const vertex=(x:number,y:number,z:number)=>{positions.push(x,y,z);return positions.length/3-1;};
  const ring=(loop:Point2[],z:number,phase=0)=>{const co=Math.cos(phase),si=Math.sin(phase);return loop.map(p=>{const q={x:p.x*co-p.y*si,y:p.x*si+p.y*co};return {id:vertex(q.x,q.y,z),p:q};});};
  const wall=(low:{id:number}[],high:{id:number}[],outward:boolean)=>{for(let j=0;j<low.length;j++){const n=(j+1)%low.length;
    if(outward){indices.push(low[j].id,low[n].id,high[n].id,low[j].id,high[n].id,high[j].id);}
    else{indices.push(low[j].id,high[n].id,low[n].id,low[j].id,high[j].id,high[n].id);}}};
  const fan=(loop:{id:number}[],z:number,upward:boolean)=>{const c=vertex(0,0,z);for(let j=0;j<loop.length;j++){const n=(j+1)%loop.length;
    if(upward)indices.push(c,loop[j].id,loop[n].id);else indices.push(c,loop[n].id,loop[j].id);}};
  const rings:{id:number;p:Point2}[][]=[];
  for(let k=0;k<=axialSegments;k++){const t=k/axialSegments;
    const phase=helical?(params.kind==='herringbone'?twist*(.5-Math.abs(t-.5)):twist*(t-.5)):0;
    rings.push(ring(outer,(t-.5)*w,phase));}
  for(let k=0;k<axialSegments;k++)wall(rings[k],rings[k+1],true);
  const bottom=rings[0],top=rings[axialSegments],zTop=w/2+hubLength;
  const holeLow=hole?ring(hole,-w/2):null,holeHigh=hole?ring(hole,zTop):null;
  if(holeLow&&holeHigh){wall(holeLow,holeHigh,false);indices.push(...stitchLoops(bottom,holeLow,false));}
  else fan(bottom,-w/2,false);
  if(hub){
    const hubLow=ring(hub,w/2),hubHigh=ring(hub,zTop);
    indices.push(...stitchLoops(top,hubLow,true));wall(hubLow,hubHigh,true);
    if(holeHigh)indices.push(...stitchLoops(hubHigh,holeHigh,true));else fan(hubHigh,zTop,true);
  } else if(holeHigh)indices.push(...stitchLoops(top,holeHigh,true));
  else fan(top,w/2,true);
  return {...profile,profile,positions:new Float32Array(positions),indices:new Uint32Array(indices),tessellation:{flankSamples,axialSegments}};
}

export interface MeshValidation { valid:boolean; boundaryEdges:number; nonManifoldEdges:number; inconsistentEdges:number; degenerateTriangles:number; signedVolume:number; triangles:number; vertices:number }
/** Checks indexed topology, winding, finite coordinates, zero-area triangles and volume. */
export function validateMesh(mesh:Pick<GearMesh,'positions'|'indices'>):MeshValidation {
  const {positions:p,indices:f}=mesh,edges=new Map<string,{count:number,direction:number}>();
  let degenerateTriangles=0,volume=0;
  for(let k=0;k<f.length;k+=3){
    const ids=[f[k],f[k+1],f[k+2]],a=ids[0]*3,b=ids[1]*3,c=ids[2]*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2];
    const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(!Number.isFinite(nx+ny+nz)||Math.hypot(nx,ny,nz)<=1e-11)degenerateTriangles++;
    volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;
    for(let j=0;j<3;j++){const u=ids[j],v=ids[(j+1)%3],key=u<v?`${u},${v}`:`${v},${u}`;const e=edges.get(key)??{count:0,direction:0};e.count++;e.direction+=u<v?1:-1;edges.set(key,e);}
  }
  let boundaryEdges=0,nonManifoldEdges=0,inconsistentEdges=0;
  for(const e of edges.values()){if(e.count===1)boundaryEdges++;if(e.count!==2)nonManifoldEdges++;if(e.count===2&&e.direction!==0)inconsistentEdges++;}
  return {valid:boundaryEdges===0&&nonManifoldEdges===0&&inconsistentEdges===0&&degenerateTriangles===0&&volume>0,
    boundaryEdges,nonManifoldEdges,inconsistentEdges,degenerateTriangles,signedVolume:volume,triangles:f.length/3,vertices:p.length/3};
}
/** Binary STL in millimetres (STL itself is unitless). Throws if topology validation fails. */
export function exportBinarySTL(mesh:Pick<GearMesh,'positions'|'indices'>):ArrayBuffer {
  const check=validateMesh(mesh);
  if(!check.valid)fail('INVALID_MESH','Экспорт запрещён: сетка не прошла проверку замкнутости и ориентации.');
  const buffer=new ArrayBuffer(84+check.triangles*50),view=new DataView(buffer);
  const header='Zatseplenie; units mm; see model passport; verify mating and load';
  for(let i=0;i<header.length;i++)view.setUint8(i,header.charCodeAt(i));
  view.setUint32(80,check.triangles,true);
  const p=mesh.positions,f=mesh.indices;
  for(let k=0;k<check.triangles;k++) {
    const a=f[k*3]*3,b=f[k*3+1]*3,c=f[k*3+2]*3;
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);
    let offset=84+k*50;
    for(const value of [...n.map(x=>x/length),...p.slice(a,a+3),...p.slice(b,b+3),...p.slice(c,c+3)]){view.setFloat32(offset,value,true);offset+=4;}
    view.setUint16(offset,0,true);
  }
  return buffer;
}
