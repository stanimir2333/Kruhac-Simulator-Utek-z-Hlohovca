// src/core/engine.js — renderer + scéna + hlavná slučka (nulové alokácie v loope).
import * as THREE from 'three';

const DEFAULT_FPS_CAP = 60;
const MAX_DEVICE_PIXEL_RATIO = 2;

export function createEngine(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0906);
  scene.fog = new THREE.Fog(0x0b0906, 100, 900);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 4000);
  camera.position.set(0, 8, -14);

  const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
  sun.position.set(-400, 500, 200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, new THREE.HemisphereLight(0x9db8ff, 0x3a2c18, 0.7));

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);

  let raf = 0, last = performance.now(), fpsCap = DEFAULT_FPS_CAP, acc = 0;
  let renderOverride = null; // bloom composer (src/fx/bloom.js) sa sem zapojí
  const listeners = { tick: [] };
  const resizeExtra = [];    // callbacky z onResizeExtra (na odstránenie v dispose)
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    let dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    // FPS limit (settings)
    acc += dt;
    if (acc < 1 / fpsCap) return;
    dt = acc; acc = 0;
    for (const fn of listeners.tick) fn(dt, now / 1000);
    if (renderOverride) renderOverride();
    else renderer.render(scene, camera);
  };

  return {
    renderer, scene, camera, sun,
    onTick(fn) { listeners.tick.push(fn); },
    setRenderOverride(fn) { renderOverride = fn; },
    // (onRender/setViewDist odstránené: onRender nikto neprihlásil, setViewDist
    //  prekrýval s settings.applyViewDist, ktorý je jediný používaný zdroj.)
    // onResizeExtra drží odkaz na callback, aby ho dispose() vedel odobrať —
    // predtým sa resize listenery hromadili bez možnosti ich zrušiť.
    onResizeExtra(fn) { resizeExtra.push(fn); addEventListener('resize', fn); },
    setFpsCap(v) { fpsCap = v; },
    start() { last = performance.now(); raf = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(raf); },
    dispose() {
      removeEventListener('resize', onResize);
      for (const fn of resizeExtra) removeEventListener('resize', fn);
      renderer.dispose();
    },
  };
}
