"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RotateCcw, Plus, Minus, Move, Box, Maximize2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isRackKind, type ModelMesh } from '@/lib/model';
export function GearViewer({mesh, error, showDimensions, wireframe}:{mesh:ModelMesh|null;error:string|null;showDimensions:boolean;wireframe:boolean}){
 const host=useRef<HTMLDivElement>(null); const sceneRef=useRef<{reset:()=>void;zoom:(n:number)=>void}|null>(null); const [view,setView]=useState('3d'); const [webglError,setWebglError]=useState(false);
 useEffect(()=>{if(!host.current||!mesh||view!=='3d')return;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{setWebglError(true);return;}
 const mount=host.current;renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;mount.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','Интерактивная 3D-модель зубчатого колеса');renderer.domElement.setAttribute('role','img');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,1,.1,10000);camera.up.set(0,0,1);
 const pmrem=new THREE.PMREMGenerator(renderer);const environmentScene=new RoomEnvironment();const env=pmrem.fromScene(environmentScene,.04);scene.environment=env.texture;
 const rawGeometry=new THREE.BufferGeometry();rawGeometry.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));rawGeometry.setIndex(new THREE.BufferAttribute(mesh.indices,1));const geometry=toCreasedNormals(rawGeometry,Math.PI/5);rawGeometry.dispose();geometry.computeBoundingSphere();
 const material=new THREE.MeshStandardMaterial({color:0xb9965c,metalness:.72,roughness:.36,wireframe});const model=new THREE.Mesh(geometry,material);scene.add(model);
 const edgesGeometry=mesh.indices.length/3<=100000?new THREE.EdgesGeometry(geometry,38):new THREE.BufferGeometry();const edgesMaterial=new THREE.LineBasicMaterial({color:0x72521f,transparent:true,opacity:.12});const edges=new THREE.LineSegments(edgesGeometry,edgesMaterial);scene.add(edges);
 const r=geometry.boundingSphere?.radius||30;const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(-r,-r,r*4);scene.add(light);
 const rim=new THREE.DirectionalLight(0xd6e7ff,1.8);rim.position.set(r,r,r);scene.add(rim);
 const grid=new THREE.GridHelper(r*4,20,0xabb5c2,0xdce2e9);grid.rotation.x=Math.PI/2;grid.position.z=-mesh.params.width/2-.15;const gridMat=grid.material as THREE.Material;gridMat.transparent=true;gridMat.opacity=.28;scene.add(grid);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=r*1.3;controls.maxDistance=r*12;controls.target.copy(geometry.boundingSphere?.center??new THREE.Vector3());
 const reset=()=>{camera.position.set(r*2.2,-r*3.2,r*3.6);controls.target.copy(geometry.boundingSphere?.center??new THREE.Vector3());controls.update();};reset();sceneRef.current={reset,zoom:(n)=>{camera.position.sub(controls.target).multiplyScalar(n).add(controls.target);controls.update();}};
 const size=()=>{if(mount.clientWidth&&mount.clientHeight){renderer.setSize(mount.clientWidth,mount.clientHeight);camera.aspect=mount.clientWidth/mount.clientHeight;camera.updateProjectionMatrix();}};const observer=new ResizeObserver(size);observer.observe(mount);size();
 let frame=0;const render=()=>{controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render)};render();
 return()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometry.dispose();material.dispose();edgesGeometry.dispose();edgesMaterial.dispose();grid.geometry.dispose();gridMat.dispose();environmentScene.dispose();env.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
 },[mesh,view,wireframe]);
 const d=mesh?.dimensions; const bound=mesh?mesh.profile.outer.reduce((r,p)=>Math.max(r,Math.abs(p.x),Math.abs(p.y)),0)*1.36:40;
 const path=mesh?[mesh.profile.outer,...(mesh.profile.hole?[mesh.profile.hole]:[])].map(loop=>'M'+loop.map(p=>`${p.x},${-p.y}`).join('L')+'Z').join(' '):'';
 const is2d=view==='2d'||webglError;
 return <><div className="canvas-area"><div className="view-tabs"><Tabs value={is2d?'2d':'3d'} onValueChange={v=>{setWebglError(false);setView(v)}}><TabsList><TabsTrigger value="3d"><Box size={14}/>3D</TabsTrigger><TabsTrigger value="2d">Профиль</TabsTrigger></TabsList></Tabs></div>{!is2d&&<div className="webgl-host" ref={host}/>} {is2d&&mesh&&<svg className="profile-svg" viewBox={`${-bound} ${-bound} ${2*bound} ${2*bound}`} role="img" aria-label="Расчётный поперечный профиль в масштабе"><path d={path} fill="#d5a855" fillRule="evenodd" stroke="#8a652f" strokeWidth={bound/220}/>{showDimensions&&d&&!isRackKind(mesh.params.kind)&&<><circle r={d.pitchDiameter/2} fill="none" stroke="#6b7795" strokeWidth={bound/220} strokeDasharray={`${bound/18} ${bound/35}`}/><path d={`M${-bound*.86} 0 H${bound*.86} M0 ${-bound*.86} V${bound*.86}`} stroke="#9ea9b5" strokeWidth={bound/300} strokeDasharray={`${bound/25} ${bound/35}`}/></>}</svg>}
 {showDimensions&&d&&<div className="dimension-overlay"><span>{mesh&&isRackKind(mesh.params.kind)?'L':'⌀ da'} {format(mesh&&isRackKind(mesh.params.kind)?d.rackLength:d.tipDiameter)} мм</span><span>{mesh?.params.kind==='worm'?'L':'b'} {format(d.width)} мм</span></div>}
 {error&&<div className="model-error" role="alert"><strong>Проверьте параметры</strong><p>{error}</p></div>}
 <div className="view-label"><Move size={15}/>{is2d?'Поперечное сечение':'Вращайте мышью · масштаб колёсиком'}</div><div className="viewer-tools">{!is2d&&<><button aria-label="Приблизить" title="Приблизить" onClick={()=>sceneRef.current?.zoom(.82)}><Plus size={17}/></button><button aria-label="Отдалить" title="Отдалить" onClick={()=>sceneRef.current?.zoom(1.22)}><Minus size={17}/></button></>}<button aria-label="Сбросить вид" title="Сбросить вид" onClick={()=>sceneRef.current?.reset()}><RotateCcw size={17}/></button></div></div></>;
}
function format(n:number){return n.toLocaleString('ru-RU',{maximumFractionDigits:2})}
