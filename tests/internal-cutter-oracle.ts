/** Independent numerical stock removal. No production envelope, joining phases,
 * root points or derivatives are used. Below the base circle the tool closes
 * radially to a core; root comparisons require r > a + rb_c to exclude it.
 */
import type { GearParams } from '../lib/gearMath.ts';
const PI = Math.PI, inv = (a: number) => Math.tan(a) - a;
function zero(fn: (x: number) => number, lo: number, hi: number) {
  const sign = Math.sign(fn(lo));
  if (sign === Math.sign(fn(hi))) throw new Error('Oracle root is not bracketed');
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (Math.sign(fn(mid)) === sign) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function maximum(fn: (x: number) => number, lo: number, hi: number) {
  const f = (Math.sqrt(5) - 1) / 2;
  let x = hi - f * (hi - lo), y = lo + f * (hi - lo), fx = fn(x), fy = fn(y);
  for (let i = 0; i < 55; i++) {
    if (fx > fy) { hi = y; y = x; fy = fx; x = hi - f * (hi - lo); fx = fn(x); }
    else { lo = x; x = y; fx = fy; y = lo + f * (hi - lo); fy = fn(y); }
  }
  return Math.max(fx, fy);
}
export function cutterSweep(p: GearParams) {
  const m = p.module, z = p.teeth, zc = p.internalCutterTeeth ?? 24, xc = p.internalCutterProfileShift ?? 0;
  const alpha = p.pressureAngleDeg * PI / 180, rc = m * zc / 2, r = m * z / 2, cb = rc * Math.cos(alpha), rb = r * Math.cos(alpha);
  const rho = m * (p.internalCutterTipRadiusCoefficient ?? .3), co = rc + m * (xc + (p.internalCutterAddendumCoefficient ?? 1.25)), cr = co - rho;
  const k = z / zc - 1, pitch = 2 * PI / zc;
  const s = m * (PI / 2 - 2 * p.profileShift * Math.tan(alpha)) - p.backlash;
  const sc = m * (PI / 2 + 2 * xc * Math.tan(alpha)) - (p.internalCutterThinning ?? 0);
  // Solve working tooth widths = a working pitch, independently of inverse inv(αg).
  const a = zero(distance => {
    const wc = distance / k, wg = wc * z / zc, ag = Math.acos(Math.min(1, cb / wc)), delta = inv(ag) - inv(alpha);
    return wg * (s / r + 2 * delta) + wc * (sc / rc - 2 * delta) - 2 * PI * wg / z;
  }, rb - cb, 5 * (rb - cb));
  const A = sc / (2 * rc) + inv(alpha);
  const center = (t: number) => {
    const angle = t - A, x = cb, y = rho - cb * t;
    return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
  };
  const tc = zero(t => Math.hypot(center(t).x, center(t).y) - cr, rho / cb, 10);
  const c = center(tc), gamma = Math.abs(Math.atan2(c.y, c.x)), cj = cb * Math.hypot(1, tc);
  const ringTip = r - m * (1 - p.profileShift), core = Math.min(cb - 2 * m, .95 * (ringTip - a));
  const occupancy = (x: number, y: number) => {
    const radius = Math.hypot(x, y), angle = Math.abs(((Math.atan2(y, x) + pitch / 2) % pitch + pitch) % pitch - pitch / 2);
    if (radius < core) return core - radius;
    let allowed = A;
    if (radius >= cb && radius <= cj) { const t = Math.sqrt((radius / cb) ** 2 - 1); allowed -= t - Math.atan(t); }
    else if (radius > cj) allowed = gamma + Math.acos(Math.max(-1, Math.min(1, (radius ** 2 + cr ** 2 - rho ** 2) / (2 * radius * cr))));
    return Math.min(co - radius, radius * (allowed - angle));
  };
  const margin = (radius: number, theta: number, grid = 512) => {
    const span = Math.acos(Math.max(-1, Math.min(1, (radius ** 2 + a ** 2 - co ** 2) / (2 * radius * a))));
    theta -= PI / z;
    const px = radius * Math.cos(theta), py = radius * Math.sin(theta), lo = -theta - span, hi = -theta + span;
    const fn = (phi: number) => {
      const x = px - a * Math.cos(phi), y = py + a * Math.sin(phi), c = Math.cos(k * phi), s = Math.sin(k * phi);
      return occupancy(x * c + y * s, y * c - x * s);
    };
    const values = Array.from({ length: grid + 1 }, (_, i) => fn(lo + (hi - lo) * i / grid));
    let best = Math.max(...values);
    for (let i = 1; i < grid; i++) if (values[i] >= values[i - 1] && values[i] >= values[i + 1])
      best = Math.max(best, maximum(fn, lo + (hi - lo) * (i - 1) / grid, lo + (hi - lo) * (i + 1) / grid));
    return best;
  };
  const radialBoundary = (theta: number) => {
    let lo = a + cb + 1e-7 * m, hi = a + co;
    if (margin(lo, theta) < -1e-8 * m) throw new Error('Oracle root sample reaches lower closure');
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (margin(mid, theta) >= 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  return { a, cb, co, margin, radialBoundary };
}
