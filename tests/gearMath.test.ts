import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGearMesh,buildGearProfile,deriveGear,defaultGearParams,exportBinarySTL,involute,involuteAtRadius,validateMesh} from '../lib/gearMath.ts';
import type {GearParams,GearMesh} from '../lib/gearMath.ts';
const p=(values:Partial<GearParams>={}):GearParams=>({...defaultGearParams,...values});
const close=(actual:number,expected:number,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected} ±${tolerance}`);
const area=(points:{x:number,y:number}[])=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-a.y*b.x},0)/2;
function roundtripSTL(buffer:ArrayBuffer) {
  const view=new DataView(buffer),count=view.getUint32(80,true),positions:number[]=[],indices:number[]=[],map=new Map<string,number>();
  assert.equal(buffer.byteLength,84+50*count);
  for(let k=0;k<count;k++)for(let j=0;j<3;j++){
    const offset=84+50*k+12+12*j,xyz=[view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true)];
    const key=xyz.join(',');let index=map.get(key);if(index===undefined){index=positions.length/3;positions.push(...xyz);map.set(key,index)}indices.push(index);
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}
test('KHK table 4.1 spur example m=3,z=24 gives d=72,da=78,df=64.5',()=>{
  const {dimensions:d}=deriveGear(p({teeth:24,module:3,backlash:0}));
  close(d.pitchDiameter,72);close(d.tipDiameter,78);close(d.rootDiameter,64.5);close(d.baseDiameter,67.657868696586);
});
test('normal-to-transverse conversion and KHK helical thickness example',()=>{
  const {dimensions:d}=deriveGear(p({kind:'helical',module:5,teeth:16,pressureAngleDeg:20,helixAngleDeg:25,profileShift:.2,backlash:0}));
  close(d.normalToothThickness,8.5819,.00005);close(d.virtualTeeth,21.4928,.00005);
  close(d.pitchDiameter,80/Math.cos(25*Math.PI/180));
  close(Math.tan(d.transversePressureAngleDeg*Math.PI/180),Math.tan(20*Math.PI/180)/Math.cos(25*Math.PI/180));
  close(d.transverseToothThickness*Math.cos(25*Math.PI/180),d.normalToothThickness);
});
test('involute polar samples agree with independent unwinding-string Cartesian equation',()=>{
  for(const rb of [1,10,47.3])for(const t of [.05,.2,.5,1.1]){
    const x=rb*(Math.cos(t)+t*Math.sin(t)),y=rb*(Math.sin(t)-t*Math.cos(t));
    close(Math.hypot(x,y),rb*Math.sqrt(1+t*t));
    close(involuteAtRadius(Math.hypot(x,y),rb),Math.atan2(y,x));
  }
  assert.throws(()=>involuteAtRadius(9,10));
  close(involute(20*Math.PI/180),0.014904383867336446);
});
test('sampled working flanks satisfy analytic tooth-thickness equation',()=>{
  const q=p({backlash:.1,profileShift:.15}),profile=buildGearProfile(q,20),d=profile.dimensions;
  const r=d.pitchDiameter/2,rb=d.baseDiameter/2,limit=Math.PI/q.teeth;
  let checked=0;
  for(const v of profile.outer){const radius=Math.hypot(v.x,v.y),angle=Math.abs(Math.atan2(v.y,v.x));
    if(angle<limit&&radius>(profile.rootDiagnostics?.joinRadius??rb)+1e-7&&radius<d.tipDiameter/2-1e-7&&radius>d.rootDiameter/2+1e-7){
      const independent=d.transverseToothThickness/(2*r)+involute(d.transversePressureAngleDeg*Math.PI/180)-involuteAtRadius(radius,rb);
      close(angle,independent,1e-9);checked++;
    }
  }
  assert.ok(checked>=20);
});
test('positive external shift increases pitch thickness; internal convention decreases it',()=>{
  for(const kind of ['spur','internal'] as const){
    const zero=deriveGear(p({kind,teeth:60,profileShift:0})).dimensions;
    const shifted=deriveGear(p({kind,teeth:60,profileShift:.3})).dimensions;
    close(shifted.pitchDiameter,zero.pitchDiameter);
    close(shifted.tipDiameter-zero.tipDiameter,1.2);
    close(shifted.normalToothThickness-zero.normalToothThickness,(kind==='internal'?-1:1)*2*.3*2*Math.tan(20*Math.PI/180));
  }
});
test('undercut screen uses rack cutter condition; correcting x removes screen warning',()=>{
  const a=deriveGear(p({teeth:12}));assert.ok(a.warnings.some(w=>w.code==='UNDERCUT'));
  const b=deriveGear(p({teeth:12,profileShift:.35}));assert.ok(!b.warnings.some(w=>w.code==='UNDERCUT'));
});
test('invalid, unsupported and ambiguous below-base internal inputs are rejected',()=>{
  for(const q of [p({module:0}),p({teeth:24.5}),p({bore:100}),p({backlash:10}),p({kind:'internal',teeth:12}),p({width:NaN}),p({kind:'worm' as unknown as GearParams['kind']}),p({helixAngleDeg:undefined as unknown as number})])assert.throws(()=>buildGearMesh(q));
});
for(const kind of ['spur','helical','herringbone','internal','rack'] as const)test(`${kind}: watertight winding, STL welded roundtrip, positive volume`,()=>{
  const mesh=buildGearMesh(p({kind,teeth:kind==='internal'?48:24}));
  const check=validateMesh(mesh);assert.equal(check.valid,true,JSON.stringify(check));
  const stl=roundtripSTL(exportBinarySTL(mesh));assert.equal(validateMesh(stl).valid,true);
  if(kind==='spur'||kind==='internal'||kind==='rack')close(check.signedVolume,(area(mesh.profile.outer)-(mesh.profile.hole?area(mesh.profile.hole):0))*mesh.params.width,.02);
});
test('rack volume agrees with independent base plus trapezoidal teeth',()=>{
  const q=p({kind:'rack',teeth:10,module:2,backlash:.1}),mesh=buildGearMesh(q),d=mesh.dimensions;
  const top=d.tipThickness,root=d.transverseToothThickness+2*d.dedendum*Math.tan(q.pressureAngleDeg*Math.PI/180);
  const expected=(d.rackLength*6+q.teeth*(top+root)/2*(d.addendum+d.dedendum))*q.width;
  close(validateMesh(mesh).signedVolume,expected,.005);
});
test('single helix obeys tan(beta)=r*dtheta/dz; left hand has opposite twist',()=>{
  for(const beta of [-25,25]) {
    const mesh=buildGearMesh(p({kind:'helical',helixAngleDeg:beta}));
    // External rims are stored ring by ring first; the straight bore prism follows them.
    const n=mesh.profile.outer.length,off=mesh.tessellation.axialSegments*n*3;
    const a=Math.atan2(mesh.positions[1],mesh.positions[0]),b=Math.atan2(mesh.positions[off+1],mesh.positions[off]);
    close((b-a)/mesh.params.width*(mesh.dimensions.pitchDiameter/2),Math.tan(beta*Math.PI/180),1e-6);
  }
});
test('herringbone ends coincide in angle and middle has exactly half total helix twist',()=>{
  const mesh=buildGearMesh(p({kind:'herringbone',helixAngleDeg:30})),n=mesh.profile.outer.length;
  const end=mesh.tessellation.axialSegments*n*3,mid=end/2;
  const angle=(off:number)=>Math.atan2(mesh.positions[off+1],mesh.positions[off]);
  close(angle(0),angle(end),1e-7);close(angle(mid)-angle(0),mesh.dimensions.twistAngleDeg*Math.PI/360,1e-7);
});
test('solid gear without shaft hole is a closed genus-zero mesh',()=>{
  const mesh=buildGearMesh(p({bore:0})),v=validateMesh(mesh);
  assert.ok(v.valid);close(v.vertices-3*v.triangles/2+v.triangles,2);
});
test('representative parameter matrix is valid or explicitly rejected',()=>{
  let valid=0,rejected=0;
  for(const kind of ['spur','helical','herringbone','internal','rack'] as const)for(const teeth of [12,24,48,90])for(const profileShift of [-.2,0,.3]){
    let mesh:GearMesh;
    try {mesh=buildGearMesh(p({kind,teeth,profileShift,module:1.25,bore:2}),{flankSamples:7});}
    catch(error){assert.ok(error instanceof Error);rejected++;continue;}
    assert.ok(validateMesh(mesh).valid,JSON.stringify({kind,teeth,profileShift}));valid++;
  }
  assert.ok(valid>=40);assert.ok(rejected>=1);
});
test('external root is the independent circular-center trochoid offset, not a fitted fillet',()=>{
  const q=p({kind:'spur',module:2,teeth:24,backlash:0}),profile=buildGearProfile(q,12),d=profile.dimensions;
  const rho=.3*q.module,r=d.pitchDiameter/2,h=d.dedendum-rho,alpha=q.pressureAngleDeg*Math.PI/180;
  const cutterHalfLand=(d.normalCircularPitch-d.normalToothThickness)/2-h*Math.tan(alpha)-rho/Math.cos(alpha);
  const C=d.normalCircularPitch/2-cutterHalfLand,rootRoll=-C/r,joinSpan=h/(r*Math.tan(alpha));
  for(const fraction of [0,.25,.5,.75,1]){
    const phi=rootRoll-fraction*joinSpan,T=C+r*phi,denom=Math.hypot(h,T);
    // Center curve plus its inward unit normal times rho; independent of ellipse solver.
    const xr=r-h-rho*h/denom,yt=T+rho*T/denom;
    const x=xr*Math.cos(phi)+yt*Math.sin(phi),y=-xr*Math.sin(phi)+yt*Math.cos(phi);
    const closest=Math.min(...profile.outer.map(v=>Math.hypot(v.x-x,v.y+y)));
    assert.ok(closest<1e-9,`Generated trochoid point absent: ${closest}`);
  }
});
test('generated circular and elliptical roots join analytic involutes with positional/tangent checks',()=>{
  for(const kind of ['spur','helical','herringbone'] as const){
    const profile=buildGearProfile(p({kind,teeth:24,helixAngleDeg:25}),12),g=profile.rootDiagnostics!;
    assert.ok(g.joinError<1e-9);assert.ok(g.tangentErrorDeg<.02);assert.ok(g.maxSampledChordError<=g.profileTolerance);
    assert.ok(profile.warnings.some(w=>w.code==='GENERATED_ROOT'));assert.ok(!profile.warnings.some(w=>w.code==='SIMPLIFIED_ROOT'));
  }
});
test('unsupported undercut is rejected instead of exporting a decorative replacement root',()=>{
  assert.throws(()=>buildGearMesh(p({teeth:12,profileShift:0})),/подрезан/);
  assert.ok(validateMesh(buildGearMesh(p({teeth:12,profileShift:.4}))).valid);
});
test('tighter profile sampling tolerance converges area and remains closed',()=>{
  const loose=buildGearMesh(p({profileTolerance:.01}));
  const fine=buildGearMesh(p({profileTolerance:.0002}));
  const finer=buildGearMesh(p({profileTolerance:.00005}));
  assert.ok(validateMesh(fine).valid);assert.ok(validateMesh(finer).valid);
  assert.ok(finer.profile.outer.length>loose.profile.outer.length);
  const av=area(finer.profile.outer),errorFine=Math.abs(area(fine.profile.outer)-av),errorLoose=Math.abs(area(loose.profile.outer)-av);
  assert.ok(errorFine<errorLoose);assert.ok(errorFine<.01);
});
test('helical root matches independent ellipse-parameterized rolling-tool envelope',()=>{
  const q=p({kind:'helical',teeth:24,helixAngleDeg:30,profileTolerance:.0005}),profile=buildGearProfile(q,12),d=profile.dimensions;
  const cb=Math.cos(q.helixAngleDeg*Math.PI/180),an=q.pressureAngleDeg*Math.PI/180,r=d.pitchDiameter/2,rho=.3*q.module,h=d.dedendum-rho;
  const a=rho/cb,b=rho,halfLand=(d.normalCircularPitch-d.normalToothThickness)/2-h*Math.tan(an)-rho/Math.cos(an);
  const C=(d.normalCircularPitch/2-halfLand)/cb;
  const distanceToProfile=(point:{x:number,y:number})=>{
    let result=Infinity;
    for(let i=0;i<profile.outer.length;i++){
      const v=profile.outer[i],w=profile.outer[(i+1)%profile.outer.length],dx=w.x-v.x,dy=w.y-v.y;
      const fraction=Math.max(0,Math.min(1,((point.x-v.x)*dx+(point.y-v.y)*dy)/(dx*dx+dy*dy)));
      result=Math.min(result,Math.hypot(point.x-v.x-fraction*dx,point.y-v.y-fraction*dy));
    }return result;
  };
  for(let k=0;k<=80;k++){
    // Direct tool-tip parameter eliminates the Newton solve used by production code.
    const theta=-Math.PI/2+(-Math.PI+an+Math.PI/2)*k/80;
    const T=-(b*h*Math.cos(theta)+(a*a-b*b)*Math.sin(theta)*Math.cos(theta))/(a*Math.sin(theta));
    const phi=(T-C)/r,xlocal=r-h+b*Math.sin(theta),ylocal=T+a*Math.cos(theta);
    const point={x:xlocal*Math.cos(phi)+ylocal*Math.sin(phi),y:-xlocal*Math.sin(phi)+ylocal*Math.cos(phi)};
    assert.ok(distanceToProfile(point)<.00051);
  }
});
test('resource preflight rejects a formally valid but browser-exhausting dense helix',()=>{
  assert.throws(()=>buildGearMesh(p({kind:'helical',module:.1,teeth:250,helixAngleDeg:45,width:118,bore:2,backlash:0}),{flankSamples:64}),
    (e:unknown)=>typeof e==='object'&&e!==null&&'code' in e&&e.code==='MESH_BUDGET');
});
