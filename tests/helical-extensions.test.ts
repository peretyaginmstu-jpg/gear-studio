import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGearMesh,buildGearProfile,defaultGearParams,deriveGear,exportBinarySTL,validateMesh} from '../lib/gearMath.ts';
import type {GearParams,Point2} from '../lib/gearMath.ts';

const rad=Math.PI/180;
const p=(overrides:Partial<GearParams>={}):GearParams=>({...defaultGearParams,...overrides});
const close=(actual:number,expected:number,tolerance=1e-8)=>
  assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected} ±${tolerance}`);
const area=(points:Point2[])=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-a.y*b.x;},0)/2;

function readSTL(buffer:ArrayBuffer) {
  const view=new DataView(buffer),triangles=view.getUint32(80,true),positions:number[]=[],indices:number[]=[];
  const vertices=new Map<string,number>();
  assert.equal(buffer.byteLength,84+50*triangles);
  for(let i=0;i<triangles;i++)for(let j=0;j<3;j++) {
    const offset=84+50*i+12+12*j;
    const xyz=[view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true)];
    const key=xyz.join(',');let index=vertices.get(key);
    if(index===undefined){index=positions.length/3;vertices.set(key,index);positions.push(...xyz);}
    indices.push(index);
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}

test('helical rack reproduces KHK Table 4.13 normal-system angle and tooth depth',()=>{
  // Primary reference: https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/
  // KHK rounds beta to the nearest arcsecond and alpha_t to five decimal places.
  const beta=10+57/60+49/3600;
  const d=deriveGear(p({kind:'helical-rack',module:2.5,teeth:20,helixAngleDeg:beta,backlash:0})).dimensions;
  close(d.transversePressureAngleDeg,20.34160,.00001);
  close(d.transverseModule*20,50.92956,.00002);
  close(d.addendum,2.5);close(d.addendum+d.dedendum,5.625);
  close(d.normalCircularPitch,2.5*Math.PI);
  close(d.rackLength/20,Math.PI*d.transverseModule);
  close(d.pitchDiameter,0);close(d.twistAngleDeg,0);
});

test('internal helix uses normal module, internal shift convention and transverse involute angle',()=>{
  const q=p({kind:'internal-helical',module:3,teeth:60,helixAngleDeg:30,profileShift:.25,backlash:.12});
  const d=deriveGear(q).dimensions,cb=Math.sqrt(3)/2;
  close(d.pitchDiameter,180/cb);
  close(d.transverseModule,3/cb);
  close(d.transversePressureAngleDeg,22.79587725885847);
  close(d.baseDiameter,d.pitchDiameter*Math.cos(22.79587725885847*rad));
  close(d.tipDiameter,d.pitchDiameter-4.5);
  close(d.rootDiameter,d.pitchDiameter+9);
  close(d.outsideDiameter,d.rootDiameter+18);
  close(d.normalToothThickness,3*(Math.PI/2-.5*Math.tan(20*rad))-.12);
  close(d.transverseToothThickness*cb,d.normalToothThickness);
  close(d.rackAxialOffset,0);
});

test('internal helix retains the actual complementary involute and matching radial ring mapping',()=>{
  const q=p({kind:'internal-helical',module:2,teeth:60,helixAngleDeg:25,profileShift:.15});
  const profile=buildGearProfile(q,20),d=profile.dimensions,r=d.pitchDiameter/2,rb=d.baseDiameter/2;
  assert.ok(profile.hole);assert.equal(profile.outer.length,profile.hole.length);
  let checked=0;
  for(let i=0;i<profile.hole.length;i++) {
    const v=profile.hole[i],outer=profile.outer[i],radius=Math.hypot(v.x,v.y);
    close((outer.x*v.y-outer.y*v.x)/(Math.hypot(outer.x,outer.y)*radius),0,1e-14);
    assert.ok(outer.x*v.x+outer.y*v.y>0);
    close(Math.hypot(outer.x,outer.y),d.outsideDiameter/2,2e-12);
    if(radius<=d.tipDiameter/2+1e-8||radius>=d.rootDiameter/2-1e-8)continue;
    const angle=Math.abs(Math.atan2(v.y,v.x));
    if(angle>=Math.PI/q.teeth)continue;
    // The tooth is centered half a pitch away from the void; this measures its material arc.
    const measuredThickness=2*radius*(Math.PI/q.teeth-angle);
    const alpha=Math.acos(rb/radius),alphaT=Math.acos(rb/r);
    const expectedThickness=2*radius*(d.transverseToothThickness/(2*r)
      -(Math.tan(alphaT)-alphaT)+(Math.tan(alpha)-alpha));
    close(measuredThickness,expectedThickness,2e-12);checked++;
  }
  assert.ok(checked>=30);
  assert.ok(profile.warnings.some(w=>w.code==='SIMPLIFIED_ROOT'&&w.message.includes('долбяком')));
  assert.ok(profile.warnings.some(w=>w.code==='INTERNAL_PAIR'));
  assert.equal(profile.rootDiagnostics,undefined);
});

test('internal helix twists both radial contours by the signed reference-cylinder law',()=>{
  for(const beta of [-35,35]) {
    const mesh=buildGearMesh(p({kind:'internal-helical',teeth:60,width:25,helixAngleDeg:beta}));
    const n=mesh.profile.outer.length,ring=2*n,segments=mesh.tessellation.axialSegments;
    const rate=Math.tan(beta*rad)/(mesh.dimensions.pitchDiameter/2);
    for(const k of [0,Math.floor(segments/2),segments])for(const j of [0,n,Math.floor(n*1.4)]) {
      const loop=j<n?mesh.profile.outer:mesh.profile.hole!,v=loop[j%n];
      const offset=(k*ring+j)*3,z=mesh.positions[offset+2],angle=rate*z;
      close(mesh.positions[offset],v.x*Math.cos(angle)-v.y*Math.sin(angle),1e-5);
      close(mesh.positions[offset+1],v.x*Math.sin(angle)+v.y*Math.cos(angle),1e-5);
    }
    close(mesh.dimensions.twistAngleDeg*rad/mesh.params.width,rate);
    assert.ok(validateMesh(mesh).valid);
  }
});

test('helical rack normal sections recover straight-rack teeth and transverse slope uses alpha_t',()=>{
  for(const beta of [-40,25]) {
    const q=p({kind:'helical-rack',teeth:6,module:2,pressureAngleDeg:22,helixAngleDeg:beta,profileShift:.2,width:16});
    const mesh=buildGearMesh(q),d=mesh.dimensions,normal=buildGearProfile({...q,kind:'rack'});
    const cb=Math.cos(beta*rad),sb=Math.sin(beta*rad),n=mesh.profile.outer.length;
    assert.equal(mesh.tessellation.axialSegments,1,'planar ruled sides need only two end sections');
    assert.equal(n,normal.outer.length);
    for(let k=0;k<=1;k++)for(let j=0;j<n;j++) {
      const i=(k*n+j)*3,x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2];
      // u is distance normal to the oblique tooth trace in the pitch plane.
      close(x*cb-z*sb,normal.outer[j].x,3e-6);
      close(y,normal.outer[j].y,1e-6);
      close(x,mesh.profile.outer[j].x+z*Math.tan(beta*rad),3e-6);
    }
    let flanks=0;
    for(let i=0;i<n;i++) {
      const a=mesh.profile.outer[i],b=mesh.profile.outer[(i+1)%n];
      if(Math.abs(Math.abs(b.y-a.y)-(d.addendum+d.dedendum))>1e-9)continue;
      close(Math.abs((b.x-a.x)/(b.y-a.y)),Math.tan(d.transversePressureAngleDeg*rad));
      close(Math.abs((b.x-a.x)*cb/(b.y-a.y)),Math.tan(q.pressureAngleDeg*rad));flanks++;
    }
    assert.equal(flanks,2*q.teeth);
    close(d.tipThickness*cb,normal.dimensions.tipThickness);
    close(d.rackAxialOffset,q.width*Math.tan(beta*rad));
  }
});

test('helical rack envelope and volume include axial skew without adding or losing teeth',()=>{
  const q=p({kind:'helical-rack',teeth:7,helixAngleDeg:-30,width:19,module:2,backlash:.1});
  const mesh=buildGearMesh(q),d=mesh.dimensions,check=validateMesh(mesh);
  const coordinates=Array.from(mesh.positions).filter((_,i)=>i%3===0);
  close(Math.max(...coordinates)-Math.min(...coordinates),d.rackLength+Math.abs(d.rackAxialOffset),1e-5);
  const rootThickness=d.transverseToothThickness+2*d.dedendum*Math.tan(d.transversePressureAngleDeg*rad);
  const section=d.rackLength*3*q.module+q.teeth*(d.tipThickness+rootThickness)/2*(d.addendum+d.dedendum);
  close(check.signedVolume,section*q.width,.005);
  close(check.signedVolume,area(mesh.profile.outer)*q.width,.005);
  assert.equal(check.valid,true,JSON.stringify(check));
});

test('zero helix exactly retains straight internal and rack dimensions and profile',()=>{
  for(const [kind,straight] of [['internal-helical','internal'],['helical-rack','rack']] as const) {
    const params=p({kind,teeth:60,helixAngleDeg:0}),a=buildGearProfile(params),b=buildGearProfile({...params,kind:straight});
    assert.deepEqual(a.dimensions,b.dimensions);assert.deepEqual(a.outer,b.outer);assert.deepEqual(a.hole,b.hole);
    assert.ok(validateMesh(buildGearMesh(params)).valid);
  }
});

test('both extensions give closed, oriented, positive meshes after binary STL welded roundtrip',()=>{
  for(const kind of ['internal-helical','helical-rack'] as const)for(const beta of [-45,20,45]) {
    const mesh=buildGearMesh(p({kind,teeth:kind==='internal-helical'?60:8,helixAngleDeg:beta}));
    const check=validateMesh(mesh),reloaded=validateMesh(readSTL(exportBinarySTL(mesh)));
    assert.equal(check.valid,true,JSON.stringify({kind,beta,...check}));
    assert.equal(reloaded.valid,true,JSON.stringify({kind,beta,...reloaded}));
    const euler=check.vertices-check.triangles/2;
    assert.equal(euler,kind==='internal-helical'?0:2);
  }
});

test('new families retain angle, base-circle, tooth intersection and mesh budget guards',()=>{
  for(const kind of ['internal-helical','helical-rack'] as const) {
    assert.throws(()=>deriveGear(p({kind,teeth:60,helixAngleDeg:46})),{code:'HELIX_RANGE'});
    assert.throws(()=>deriveGear(p({kind,teeth:60,helixAngleDeg:NaN})),{code:'NON_FINITE'});
  }
  assert.throws(()=>deriveGear(p({kind:'internal-helical',teeth:12,helixAngleDeg:10})),{code:'INTERNAL_BASE_INTERFERENCE'});
  assert.throws(()=>buildGearMesh(p({kind:'internal-helical',teeth:60,rimThickness:.1})),{code:'RIM_THICKNESS'});
  assert.throws(()=>deriveGear(p({kind:'helical-rack',teeth:6,pressureAngleDeg:35,backlash:0})),{code:'RACK_INTERSECTION'});
  assert.throws(()=>buildGearMesh(p({kind:'internal-helical',module:.1,teeth:250,helixAngleDeg:45,width:118,backlash:0}),{flankSamples:64}),{code:'MESH_BUDGET'});
  assert.throws(()=>buildGearMesh(p({kind:'helical-rack',teeth:250}),{axialSegments:256}),{code:'MESH_BUDGET'});
});
