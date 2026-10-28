import * as THREE from 'three';
import { Wisp } from './spirit.js';

// The start screen's wisp (owner, 2026-10-27: "make it a rendered wisp, even lo-res, flying in a circle"): the real
// wisp (spirit.js Wisp) rendered live in a small canvas of its own, flying one anticlockwise lap of a CIRCLE_M circle
// every LAP_S s, seen from above at a slant, in place of the pre-rendered sprite sheet (assets/opening/wisp.webp),
// whose frames were an irregular shape turning at an odd angle. Cheap: a SIZE px canvas at pixel ratio 1, its own
// small renderer, one wisp, a few hundred vertices. attach(el) puts the canvas into an .op-wisp element (the dark
// start's, then a loading card's, so one live wisp serves the screen); dispose() frees the context when the screen
// closes. The element's own CSS (the implode at the end of the boot, the glow) still applies to it.
const SIZE = 256, CIRCLE_M = 0.45, LAP_S = 1.6, CAM_UP = 2.0, CAM_BACK = 1.5, SWELL = 0.35;

export class WispLoop {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'op-wisp-live'; this.canvas.width = this.canvas.height = SIZE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1); this.renderer.setSize(SIZE, SIZE, false); this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50); this.camera.position.set(0, CAM_UP, CAM_BACK); this.camera.lookAt(0, 0.05, 0);
    this.wisp = new Wisp({ renderer: this.renderer, camera: this.camera, scene: this.scene, layer: 0 });
    // The page composites a WebGL canvas as premultiplied colour, where a channel may not exceed the alpha; the wisp's
    // additive materials write light with no meaningful alpha. So the scene renders to an opaque black target and a
    // full-canvas quad writes it to the canvas as light: alpha the brightest channel, so where nothing glows the page
    // shows through and where the wisp is only its light is added.
    this.rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tMap: { value: this.rt.texture } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { vec3 c = texture2D(tMap, vUv).rgb; gl_FragColor = vec4(c, max(max(c.r, c.g), c.b)); }' }));
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad); this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.t = 0; this.P = new THREE.Vector3(); this.last = performance.now(); this.on = true;
    const tick = now => { if (!this.on) return; const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now; this.frame(dt); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }
  frame(dt) {
    this.t += dt;
    const k = Math.PI * 2 / LAP_S, a = -this.t * k;   // anticlockwise seen from above
    this.P.set(Math.cos(a) * CIRCLE_M, 0, Math.sin(a) * CIRCLE_M);
    const vx = Math.sin(a) * CIRCLE_M * k, vz = -Math.cos(a) * CIRCLE_M * k;   // the tangent, as the flight's yaw reads it
    this.wisp.animate(dt, this.P, Math.atan2(-vx, -vz));
    const R = this.renderer;
    R.setRenderTarget(this.rt); R.setClearColor(0x000000, 1); R.clear(); R.render(this.scene, this.camera);
    R.setRenderTarget(null); R.setClearColor(0x000000, 0); R.clear(); R.render(this.quadScene, this.quadCam);
  }
  attach(el) {   // the sprite sheet is set inline on the slot (arrival.js); it goes, the live wisp takes its place
    if (!el || this.canvas.parentElement === el) return;
    el.classList.add('live'); el.style.backgroundImage = 'none'; el.append(this.canvas);
  }
  dispose() { this.on = false; cancelAnimationFrame(this.raf); this.wisp.dispose(); this.rt.dispose(); this.quad.geometry.dispose(); this.quad.material.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.canvas.remove(); }
}
