import type { Point2 } from './gearMath.ts';
import { buildModelMesh, isRackKind, type ModelParams } from './model.ts';
import { APP_VERSION } from './appVersion.ts';

/** Kernels whose profile is one planar section; bevel and worm surfaces have no single 2D profile. */
export const dxfKinds: readonly string[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack', 'cycloidal'];
export const supportsDxf = (params: ModelParams) => dxfKinds.includes(params.kind);

export interface DxfLoop { layer: string; points: Point2[] }
export interface DxfCircle { layer: string; radius: number }

const n = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(6);
const pair = (code: number, value: string | number) => `${code}\n${value}\n`;

/** Minimal AutoCAD R12 ASCII: closed POLYLINEs and reference CIRCLEs, millimetres, origin on the axis. */
export function writeDxf(loops: DxfLoop[], circles: DxfCircle[] = [], comment = ''): string {
  const layers = [...new Set([...loops.map(l => l.layer), ...circles.map(c => c.layer)])];
  let out = comment ? pair(999, comment.replace(/\n/g, ' ')) : '';
  out += pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC');
  out += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  layers.forEach((layer, i) => { out += pair(0, 'LAYER') + pair(2, layer) + pair(70, 0) + pair(62, i + 1) + pair(6, 'CONTINUOUS'); });
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES');
  for (const loop of loops) {
    out += pair(0, 'POLYLINE') + pair(8, loop.layer) + pair(66, 1) + pair(10, n(0)) + pair(20, n(0)) + pair(30, n(0)) + pair(70, 1);
    for (const p of loop.points) out += pair(0, 'VERTEX') + pair(8, loop.layer) + pair(10, n(p.x)) + pair(20, n(p.y)) + pair(30, n(0));
    out += pair(0, 'SEQEND') + pair(8, loop.layer);
  }
  for (const c of circles) out += pair(0, 'CIRCLE') + pair(8, c.layer) + pair(10, n(0)) + pair(20, n(0)) + pair(30, n(0)) + pair(40, n(c.radius));
  return out + pair(0, 'ENDSEC') + pair(0, 'EOF');
}

/** Transverse profile in the mid plane of the tooth width (helical twist zero), sampled finely. */
export function modelProfileDxf(params: ModelParams): { dxf: string; loops: DxfLoop[]; circles: DxfCircle[] } {
  if (!supportsDxf(params)) throw new Error('Для конических колёс и червяка нет одного плоского профиля; используйте STL.');
  const mesh = buildModelMesh(params, { flankSamples: 32 }), { outer, hole } = mesh.profile;
  const loops: DxfLoop[] = [{ layer: 'CONTOUR', points: outer }, ...(hole ? [{ layer: 'BORE', points: hole }] : [])];
  const circles: DxfCircle[] = isRackKind(params.kind) ? [] : [{ layer: 'PITCH_CIRCLE', radius: mesh.dimensions.pitchDiameter / 2 }];
  const comment = `Zatseplenie ${APP_VERSION}; ${params.kind}; z=${params.teeth}; m=${params.module} mm; transverse section at mid width; units mm; verify before cutting`;
  return { dxf: writeDxf(loops, circles, comment), loops, circles };
}
