/** Rounded rack-tip secondary envelope, derived from the rolling tool Jacobian.
 * The normal-plane circular tip projects to a transverse ellipse for helical teeth.
 * Ports the geometric construction in the preserved gear-engine Python kernel,
 * with a closed-form ellipse/straight-flank tangency span instead of its nominal span.
 */
import {GearGeometryError,involuteAtRadius} from './gearMath.ts';
import type {GearParams,GearDimensions,Point2} from './gearMath.ts';
export interface RootDiagnostics {
  method:'circular-rack-envelope'|'elliptical-rack-envelope';
  toolTipRadius:number;
  joinRadius:number;
  joinError:number;
  tangentErrorDeg:number;
  maxSampledChordError:number;
  profileTolerance:number;
  rootLand:number;
}
const fail=(message:string):never=>{throw new GearGeometryError('GENERATED_ROOT_INVALID',message);};
const distance=(a:Point2,b:Point2)=>Math.hypot(a.x-b.x,a.y-b.y);
const polar=(r:number,a:number):Point2=>({x:r*Math.cos(a),y:r*Math.sin(a)});
const cross=(a:Point2,b:Point2)=>a.x*b.y-a.y*b.x;
function segmentDistance(p:Point2,a:Point2,b:Point2):number {
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** 1/4, 1/2, 3/4 point residuals; reported tolerance is a sampling check, not a formal bound. */
export function sampleParametric(fn:(t:number)=>Point2,start:number,end:number,tolerance:number,minSegments=8):{points:Point2[],maxError:number}{
  const points:Point2[]=[fn(start)];let maxError=0;
  const refine=(s:number,a:Point2,e:number,b:Point2,depth:number)=>{
    const t1=s+(e-s)/4,t2=(s+e)/2,t3=s+3*(e-s)/4,mid=fn(t2);
    const error=Math.max(segmentDistance(fn(t1),a,b),segmentDistance(mid,a,b),segmentDistance(fn(t3),a,b));
    if(error>tolerance&&depth<16){refine(s,a,t2,mid,depth+1);refine(t2,mid,e,b,depth+1)}
    else {if(error>tolerance)fail('Не достигнут допуск аппроксимации профиля.');maxError=Math.max(maxError,error);points.push(b);}
  };
  for(let i=0;i<minSegments;i++){const s=start+(end-start)*i/minSegments,e=start+(end-start)*(i+1)/minSegments;refine(s,fn(s),e,fn(e),0)}
  return {points,maxError};
}
export function generatedExternalOutline(p:GearParams,d:GearDimensions,flankSamples:number):{outline:Point2[],diagnostics:RootDiagnostics} {
  const beta=(p.kind==='helical'||p.kind==='herringbone'?p.helixAngleDeg:0)*Math.PI/180,cb=Math.cos(beta),an=p.pressureAngleDeg*Math.PI/180;
  const r=d.pitchDiameter/2,rb=d.baseDiameter/2,ra=d.tipDiameter/2,rf=d.rootDiameter/2;
  const tolerance=p.profileTolerance??Math.min(.01,p.module*.005),rho=p.module*(p.toolTipRadiusCoefficient??.3);
  if(!(rho>0 && rho<d.dedendum))fail('Радиус вершины инструмента должен быть положительным и меньше глубины впадины.');
  if(!(tolerance>=1e-5&&tolerance<=p.module*.05))fail('Допуск контура должен быть от 0,00001 мм до 0,05 модуля.');
  const h=d.dedendum-rho,a=rho/cb,b=rho,delta=a*a-b*b;
  const toolSpace=d.normalCircularPitch-d.normalToothThickness;
  const halfTipLand=toolSpace/2-h*Math.tan(an)-rho/Math.cos(an);
  if(halfTipLand<0)fail('Скругления вершины производящей рейки перекрываются; уменьшите радиус инструмента или смещение.');
  const C=(d.normalCircularPitch/2-halfTipLand)/cb,rootRoll=-C/r;
  // At the tip/straight-flank join the normal-plane ellipse parameter is -pi+alpha_n.
  const joinSpan=(h*cb/Math.tan(an)-delta*Math.cos(an)/a)/r;
  if(!(joinSpan>0))fail('У производящей рейки отсутствует корректный участок перехода.');
  function envelope(span:number):Point2 {
    const phi=rootRoll-span,T=C+r*phi;
    let q=Math.atan2(-h,T),residual=Infinity;
    for(let j=0;j<40;j++) {
      const si=Math.sin(q),co=Math.cos(q);
      residual=a*T*si+b*h*co+delta*si*co;
      const derivative=a*T*co-b*h*si+delta*(co*co-si*si);
      if(Math.abs(derivative)<1e-16)fail('Вырожденное условие огибающей инструмента.');
      const step=residual/derivative;q-=step;if(Math.abs(step)<1e-14)break;
    }
    if(Math.abs(residual)>1e-8*Math.max(1,p.module*p.module))fail('Решатель огибающей не сошёлся.');
    const radial=b*Math.sin(q),tangential=a*Math.cos(q),co=Math.cos(phi),si=Math.sin(phi);
    return {x:(r-h+radial)*co+(T+tangential)*si,y:-(r-h+radial)*si+(T+tangential)*co};
  }
  const halfAt=(radius:number)=>d.transverseToothThickness/(2*r)+involuteAtRadius(r,rb)-involuteAtRadius(radius,rb);
  const join=envelope(joinSpan),joinRadius=Math.hypot(join.x,join.y);
  if(!(joinRadius>=rb && joinRadius<ra))fail('Огибающая инструмента не стыкуется с рабочей эвольвентой до вершины зуба.');
  const exact=polar(joinRadius,halfAt(joinRadius)),joinError=distance(join,exact);
  if(joinError>Math.max(1e-7,p.module*1e-7))fail('Параметры требуют подрезания. Огибающая ещё не обрезана по самопересечению; увеличьте смещение или число зубьев.');
  const before=envelope(joinSpan*(1-1e-6)),after=polar(joinRadius+p.module*1e-6,halfAt(joinRadius+p.module*1e-6));
  const u={x:exact.x-before.x,y:exact.y-before.y},v={x:after.x-exact.x,y:after.y-exact.y};
  const tangentErrorDeg=Math.abs(Math.atan2(cross(u,v),u.x*v.x+u.y*v.y))*180/Math.PI;
  // The base-circle cusp makes a one-sided finite-difference angle unstable; reject it conservatively.
  if(tangentErrorDeg>.2)fail('Переход находится у границы подрезания. Увеличьте смещение или число зубьев.');
  const root=envelope(0),rootAngle=Math.atan2(root.y,root.x),pitch=2*Math.PI/p.teeth,rootLand=(pitch-2*rootAngle)*rf;
  if(rootLand<=p.module*1e-5)fail('Огибающие соседних зубьев перекрываются у корня.');
  const sampledRoot=sampleParametric(envelope,0,joinSpan,tolerance,Math.max(8,flankSamples));
  sampledRoot.points[sampledRoot.points.length-1]=exact;
  const sampledFlank=sampleParametric(radius=>polar(radius,halfAt(radius)),joinRadius,ra,tolerance,flankSamples);
  const halfTip=halfAt(ra),tip=sampleParametric(a=>polar(ra,a),-halfTip,halfTip,tolerance,3);
  const gap=sampleParametric(a=>polar(rf,a),rootAngle,pitch-rootAngle,tolerance,3);
  const one=[...sampledRoot.points.map(v=>({x:v.x,y:-v.y})),...sampledFlank.points.slice(1).map(v=>({x:v.x,y:-v.y})),
    ...tip.points.slice(1),...sampledFlank.points.slice(0,-1).reverse(),...sampledRoot.points.slice(0,-1).reverse(),...gap.points.slice(1,-1)];
  // This radial annulus mesher requires a strictly star-shaped contour. Undercut loops are rejected.
  let last=-Infinity;
  for(const point of one){const angle=Math.atan2(point.y,point.x);if(angle<=last+1e-12)fail('Профиль имеет подрезание или немонотонный переход. Нужен отдельный алгоритм обрезки огибающей.');last=angle;}
  const outline:Point2[]=[];
  for(let tooth=0;tooth<p.teeth;tooth++){const co=Math.cos(tooth*pitch),si=Math.sin(tooth*pitch);for(const v of one)outline.push({x:v.x*co-v.y*si,y:v.x*si+v.y*co});}
  return {outline,diagnostics:{method:Math.abs(beta)>1e-9?'elliptical-rack-envelope':'circular-rack-envelope',toolTipRadius:rho,joinRadius,joinError,tangentErrorDeg,
    maxSampledChordError:Math.max(sampledRoot.maxError,sampledFlank.maxError,tip.maxError,gap.maxError),profileTolerance:tolerance,rootLand}};
}
