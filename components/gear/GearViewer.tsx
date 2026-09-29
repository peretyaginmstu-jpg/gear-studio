"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RotateCcw, Plus, Minus, Move, Box, Waves, CircleDot, PanelTop, Ruler, Grid2X2 } from 'lucide-react';
import { isRackKind, type ModelMesh } from '@/lib/model';

type View = '3d' | '2d' | 'top' | 'side';
export function GearViewer({ mesh, error, compact = false }: { mesh: ModelMesh | null; error: string | null; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null), sceneRef = useRef<{ reset: () => void; zoom: (n: number) => void; setView: (v: View) => void; setWireframe: (on: boolean) => void } | null>(null);
  const [view, setView] = useState<View>('3d'), [webglError, setWebglError] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false), [wireframe, setWireframe] = useState(false);
  // Settings live in refs so orientation and wireframe changes reuse the renderer, environment and geometry.
  const viewRef = useRef(view), wireframeRef = useRef(wireframe), compactRef = useRef(compact), flat = view === '2d';
  useEffect(() => { viewRef.current = view; if (view !== '2d') sceneRef.current?.setView(view); }, [view]);
  useEffect(() => { wireframeRef.current = wireframe; sceneRef.current?.setWireframe(wireframe); }, [wireframe]);
  useEffect(() => {
    if (!host.current || !mesh || flat || webglError) return;
    let view = viewRef.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { const fallback = requestAnimationFrame(() => setWebglError(true)); return () => cancelAnimationFrame(fallback); }
    const mount = host.current;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Интерактивная 3D-модель зубчатого колеса'); renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(31, 1, .1, 10000);
    // OrbitControls caches the up-axis when it is created.
    camera.up.set(0, view === 'top' ? 1 : 0, view === 'top' ? 0 : 1);
    const pmrem = new THREE.PMREMGenerator(renderer), environmentScene = new RoomEnvironment(), env = pmrem.fromScene(environmentScene, .04);
    scene.environment = env.texture;
    const raw = new THREE.BufferGeometry(); raw.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3)); raw.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const geometry = toCreasedNormals(raw, Math.PI / 5); raw.dispose(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const material = new THREE.MeshStandardMaterial({ color: 0xb9965c, metalness: .72, roughness: .36, wireframe: wireframeRef.current });
    const model = new THREE.Mesh(geometry, material); model.castShadow = true; model.receiveShadow = true; scene.add(model);
    const r = geometry.boundingSphere?.radius || 30, centre = geometry.boundingSphere?.center ?? new THREE.Vector3();
    camera.near = Math.max(r / 1000, 1e-5); camera.far = r * 16; camera.updateProjectionMatrix();
    const light = new THREE.DirectionalLight(0xffffff, 1.8); light.position.copy(centre).add(new THREE.Vector3(-r, -r, r * 5)); light.target.position.copy(centre);
    light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.camera.left = -r * 1.5; light.shadow.camera.right = r * 1.5;
    light.shadow.camera.top = r * 1.5; light.shadow.camera.bottom = -r * 1.5; light.shadow.camera.near = r / 100; light.shadow.camera.far = r * 8;
    light.shadow.bias = -.0002; light.shadow.normalBias = r * .002; light.shadow.radius = 5; light.shadow.blurSamples = 8; scene.add(light, light.target);
    const fill = new THREE.DirectionalLight(0xe5ecff, .8); fill.position.copy(centre).add(new THREE.Vector3(r * 2, r, r * 2)); scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, .15));
    const floorGeometry = new THREE.PlaneGeometry(r * 8, r * 8), floorMaterial = new THREE.ShadowMaterial({ opacity: .14 });
    // VSM also draws shadow receivers into its depth pass. Keep this transparent
    // catcher out of that pass so its own depth cannot reveal the shadow frustum.
    const floorDepthMaterial = new THREE.MeshDepthMaterial({ colorWrite: false, depthWrite: false });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.customDepthMaterial = floorDepthMaterial;
    floor.position.set(centre.x, centre.y, (geometry.boundingBox?.min.z ?? 0) - r * .005); floor.receiveShadow = true; scene.add(floor);
    // Frames are drawn only after something changed: an idle model costs nothing, which matters without a GPU.
    let dirty = true, visible = true;
    const invalidate = () => { dirty = true; };
    const makeControls = () => { const c = new OrbitControls(camera, renderer.domElement); c.enableDamping = true; c.dampingFactor = .075; c.addEventListener('change', invalidate);
      c.minDistance = r * 1.3; c.maxDistance = r * 12; c.target.copy(centre);
      // The landing preview turns slowly until the visitor grabs it.
      if (compactRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { c.autoRotate = true; c.autoRotateSpeed = .9; c.addEventListener('start', () => { c.autoRotate = false; }); }
      return c; };
    let controls = makeControls();
    const reset = () => {
      controls.target.copy(centre);
      const halfAngle = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      const distance = r / Math.sin(halfAngle) / (camera.aspect >= 1.35 ? .97 : .92);
      const direction = view === 'top' ? new THREE.Vector3(0, 0, 1) : view === 'side' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(1.75, -2.55, 3.2).normalize();
      camera.up.set(0, view === 'top' ? 1 : 0, view === 'top' ? 0 : 1);
      camera.position.copy(centre).addScaledVector(direction, distance); controls.update();
    };
    sceneRef.current = { reset, zoom: factor => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); },
      // OrbitControls caches the up-axis, so a new orientation gets fresh controls on the same renderer.
      setView: next => { view = next; controls.dispose(); camera.up.set(0, next === 'top' ? 1 : 0, next === 'top' ? 0 : 1); controls = makeControls(); reset(); },
      setWireframe: on => { material.wireframe = on; invalidate(); } };
    let previousAspect = 0;
    const size = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix();
      if (Math.abs(camera.aspect - previousAspect) > .01) { reset(); previousAspect = camera.aspect; }
      invalidate();
    };
    const observer = new ResizeObserver(size); observer.observe(mount); size();
    // An auto-rotating preview scrolled out of view stops drawing until it is back.
    const seen = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (visible) invalidate(); }); seen.observe(mount);
    let frame = 0;
    const render = () => {
      if (visible) controls.update();
      if (dirty && visible) { dirty = false; renderer.render(scene, camera); }
      frame = requestAnimationFrame(render);
    }; render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); seen.disconnect(); controls.dispose(); geometry.dispose(); material.dispose();
      floorGeometry.dispose(); floorMaterial.dispose(); floorDepthMaterial.dispose(); light.shadow.map?.dispose(); light.shadow.mapPass?.dispose(); environmentScene.dispose(); env.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); sceneRef.current = null;
    };
  }, [mesh, flat, webglError]);
  const d = mesh?.dimensions, bevel = mesh && 'bevelDimensions' in mesh ? mesh.bevelDimensions : null;
  const bound = mesh ? mesh.profile.outer.reduce((r, p) => Math.max(r, Math.abs(p.x), Math.abs(p.y)), 0) * 1.24 : 40;
  const path = mesh ? [mesh.profile.outer, ...(mesh.profile.hole ? [mesh.profile.hole] : [])].map(loop => 'M' + loop.map(p => `${p.x},${-p.y}`).join('L') + 'Z').join(' ') : '';
  const is2d = view === '2d' || webglError;
  const choose = (next: View) => { setWebglError(false); setView(next); };
  return <div className={`gear-viewer${compact ? ' compact' : ''}`}>
    <div className="canvas-area">
      {!is2d && <div className="webgl-host" ref={host} />}
      {is2d && mesh && <svg className="profile-svg" viewBox={`${-bound} ${-bound} ${2 * bound} ${2 * bound}`} role="img" aria-label={bevel ? 'XY-проекция пространственного большого контура' : 'Расчётный поперечный профиль в масштабе'}>
        <path d={path} fill="#d5b774" fillRule="evenodd" stroke="#8a652f" strokeWidth={bound / 240} />
        {showDimensions && d && !isRackKind(mesh.params.kind) && <circle r={d.pitchDiameter / 2} fill="none" stroke="#6b7795" strokeWidth={bound / 220} strokeDasharray={`${bound / 18} ${bound / 35}`} />}
      </svg>}
      {showDimensions && d && <div className="dimension-overlay"><span>{mesh && isRackKind(mesh.params.kind) ? 'L' : '⌀ da'} {format(mesh && isRackKind(mesh.params.kind) ? d.rackLength : d.tipDiameter)} мм</span><span>{bevel ? 'H по оси' : mesh?.params.kind === 'worm' ? 'L' : 'b'} {format(bevel?.axialExtent ?? d.width)} мм</span></div>}
      {error && <div className="model-error" role="alert"><strong>Проверьте параметры</strong><p>{error}</p></div>}
    </div>
    {!compact && <><div className="viewer-control-row">
      <div className="viewer-view-buttons" role="group" aria-label="Вид модели">
        <button className={!is2d && view === '3d' ? 'active' : ''} aria-pressed={!is2d && view === '3d'} onClick={() => choose('3d')}><Box size={20} />3D</button>
        <button className={is2d ? 'active' : ''} aria-pressed={is2d} onClick={() => choose('2d')}><Waves size={20} />{bevel ? 'Проекция' : 'Профиль'}</button>
        <button className={!is2d && view === 'top' ? 'active' : ''} aria-pressed={!is2d && view === 'top'} onClick={() => choose('top')}><CircleDot size={20} />Сверху</button>
        <button className={!is2d && view === 'side' ? 'active' : ''} aria-pressed={!is2d && view === 'side'} onClick={() => choose('side')}><PanelTop size={20} />Сбоку</button>
      </div>
      <div className="viewer-tools" role="group" aria-label="Масштаб модели">
        <button aria-label="Приблизить" title="Приблизить" disabled={is2d || !mesh} onClick={() => sceneRef.current?.zoom(.82)}><Plus size={21} /></button>
        <button aria-label="Отдалить" title="Отдалить" disabled={is2d || !mesh} onClick={() => sceneRef.current?.zoom(1.22)}><Minus size={21} /></button>
        <button aria-label="Сбросить вид" title="Сбросить вид" disabled={is2d || !mesh} onClick={() => sceneRef.current?.reset()}><RotateCcw size={20} /></button>
      </div>
    </div>
    <div className="viewer-caption"><span><Move size={14} />{is2d ? bevel ? 'XY-проекция большого контура' : 'Расчётный профиль' : 'Вращайте мышью · масштаб колёсиком'}</span>
      <div><button className={showDimensions ? 'active' : ''} aria-label="Показать размеры" aria-pressed={showDimensions} title="Размеры" onClick={() => setShowDimensions(v => !v)}><Ruler size={17} /></button><button className={wireframe ? 'active' : ''} aria-label="Показать сетку" aria-pressed={wireframe} title="Сетка" onClick={() => setWireframe(v => !v)}><Grid2X2 size={17} /></button></div>
    </div></>}
  </div>;
}
function format(n: number) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }); }
