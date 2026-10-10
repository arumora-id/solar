import gsap from 'gsap';
import * as THREE from 'three';
import { subscribeLang, t } from '../lib/i18n';
import { characterInfo, type CharacterId } from './characters';
import type { CharacterState, Rig } from './rig';

export type { CharacterState } from './rig';

const ACCENT = 0x2a78d6;

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function glyphSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sprite.scale.set(0.55, 0.55, 0.55);
  return sprite;
}

/**
 * Procedural, asset-free 3D character of SOLAR AI AGENT (Robo, Mochi, Cocoa Kelapa or the classic rabbit) animated with
 * GSAP. Every pose is a GSAP timeline on Object3D properties of the model's rig; three.js only renders.
 */
export class CharacterScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private readonly root = new THREE.Group();
  private readonly rig: Rig;
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly dots: THREE.Mesh[] = [];
  private readonly question: THREE.Sprite;
  private readonly bang: THREE.Sprite;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly lookTarget = new THREE.Vector2(0, 0);
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion: boolean;
  private stateTl: gsap.core.Timeline | null = null;
  private breathTl: gsap.core.Timeline | null = null;
  private blinkCall: gsap.core.Tween | null = null;
  private state: CharacterState = 'idle';
  private disposed = false;
  /** Stops re-labelling the canvas on language switches. */
  private readonly unsubscribeLang: () => void;
  onClick: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly character: CharacterId,
  ) {
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c3d6, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfdcff, 1.1);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    this.scene.add(this.root);
    this.rig = characterInfo(character).build(this.root);
    // the accessible description follows the interface language
    this.applyLabel();
    this.unsubscribeLang = subscribeLang(this.applyLabel);

    // thinking dots & state badges above the head
    const { x: ox, y: oy } = this.rig.overhead;
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshBasicMaterial({ color: ACCENT }));
      dot.position.set(ox + i * 0.28, this.dotBaseY(i), 0.2);
      dot.scale.setScalar(0.001);
      this.rig.head.add(dot);
      this.dots.push(dot);
    }
    this.question = glyphSprite('?', '#2a78d6');
    this.bang = glyphSprite('!', '#0ca30c');
    for (const badge of [this.question, this.bang]) {
      badge.position.set(ox + 0.3, oy + 0.35, 0.2);
      badge.visible = false;
      this.rig.head.add(badge);
    }

    // ground: soft shadow + listening ring
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.scene.add(this.shadow);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.55, 64),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('click', this.handleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.startBreathing();
    this.scheduleBlink();
    this.setState('idle', true);
    this.renderer.setAnimationLoop(this.tick);
  }

  private readonly applyLabel = () => {
    this.renderer.domElement.setAttribute('aria-label', t().character.characters[this.character].sceneLabel);
  };

  /** Resting height of the i-th thinking dot (head space). */
  private dotBaseY(i: number): number {
    return this.rig.overhead.y + i * 0.22;
  }

  // -------------------------------------------------------------------------

  private readonly handlePointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.lookTarget.set(this.pointer.x, this.pointer.y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.renderer.domElement.style.cursor = this.raycaster.intersectObjects(this.rig.pickables, false).length ? 'pointer' : 'default';
  };

  private readonly handlePointerLeave = () => {
    this.lookTarget.set(0, 0);
  };

  private readonly handleClick = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObjects(this.rig.pickables, false).length === 0) return;
    if (!this.reducedMotion) {
      gsap.fromTo(this.rig.body.scale, { y: 0.92 }, { y: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    }
    this.onClick?.();
  };

  private readonly tick = () => {
    if (this.disposed) return;
    // the head follows the pointer smoothly
    const head = this.rig.head;
    head.rotation.y += (this.lookTarget.x * this.rig.look - head.rotation.y) * 0.08;
    this.shadow.scale.setScalar(Math.max(0.55, 1 - this.root.position.y * 0.35));
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Frame the whole character (feet to the badges above the head) in the lower 72-80% of the view so the speech
    // bubble at the top never covers it.
    const { height: contentHeight, width: contentWidth } = this.rig.frame;
    const fill = h < 520 ? 0.72 : 0.8;
    const visibleHeight = Math.max(contentHeight / fill, contentWidth / (aspect * 0.92));
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const bottom = -0.3;
    const centerY = bottom + visibleHeight / 2;
    this.camera.position.set(0, centerY + 0.35, distance);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
  }

  private startBreathing(): void {
    if (this.reducedMotion) return;
    this.breathTl = gsap.timeline({ repeat: -1, yoyo: true });
    this.breathTl.to(this.rig.body.scale, { y: this.rig.breath.y, x: this.rig.breath.x, duration: 1.6, ease: 'sine.inOut' });
  }

  private scheduleBlink(): void {
    this.blinkCall = gsap.delayedCall(2 + Math.random() * 3.5, () => {
      if (this.disposed) return;
      const lids = this.rig.eyes.map((e) => e.scale);
      gsap.timeline().to(lids, { y: 0.1, duration: 0.07, ease: 'power1.in' }).to(lids, { y: 1, duration: 0.12, ease: 'power1.out' });
      this.scheduleBlink();
    });
  }

  /** Ear rotation for a pose: `fold` tips the ear forward, `spread` opens it outwards (scaled by the model's earSwing). */
  private ear(side: 'L' | 'R', fold: number, spread: number): { x: number; z: number } {
    const { earRestZ, earSwing } = this.rig;
    const z = earRestZ + spread * earSwing;
    return { x: fold * earSwing, z: side === 'L' ? z : -z };
  }

  /** Pose shared by every state: everything back to neutral (except what `next` is about to use). */
  private neutral(tl: gsap.core.Timeline, next: CharacterState, d = 0.45): void {
    const r = this.rig;
    tl.to(this.root.position, { y: 0, duration: d, ease: 'power2.out' }, 0)
      .to(this.root.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.out' }, 0)
      .to(r.head.rotation, { x: 0, z: 0, duration: d, ease: 'power2.out' }, 0)
      .to(r.head.position, { y: r.headRestY, duration: d }, 0)
      .to(r.earL.rotation, { ...this.ear('L', 0, 0), duration: d, ease: 'back.out(2)' }, 0)
      .to(r.earR.rotation, { ...this.ear('R', 0, 0), duration: d, ease: 'back.out(2)' }, 0)
      .to(r.armL.rotation, { x: 0, z: -r.armRestZ, duration: d }, 0)
      .to(r.armR.rotation, { x: 0, z: r.armRestZ, duration: d }, 0)
      .to(r.mouth.scale, { y: 0.12, duration: 0.2 }, 0)
      .to(this.ring.material as THREE.MeshBasicMaterial, { opacity: 0, duration: 0.3 }, 0)
      .to(this.ring.scale, { x: 1, y: 1, z: 1, duration: 0.3 }, 0)
      .to(this.dots.map((d2) => d2.scale), { x: 0.001, y: 0.001, z: 0.001, duration: 0.2 }, 0)
      .to(this.dots.map((d2) => d2.position), { y: (i: number) => this.dotBaseY(i), duration: 0.2 }, 0)
      .to(r.eyes.map((e) => e.position), { y: r.eyeRestY, duration: 0.3 }, 0)
      .to(r.cheeks.map((c) => c.material as THREE.MeshBasicMaterial), { opacity: 0.55, duration: 0.3 }, 0);
    if (next !== 'working') {
      tl.to(r.tablet.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, onComplete: () => void (r.tablet.visible = false) }, 0);
    }
    if (next !== 'asking') this.question.visible = false;
    if (next !== 'happy') this.bang.visible = false;
  }

  getState(): CharacterState {
    return this.state;
  }

  setState(next: CharacterState, force = false): void {
    if (!force && next === this.state) return;
    this.state = next;
    this.stateTl?.kill();
    const tl = gsap.timeline();
    this.stateTl = tl;
    this.neutral(tl, next);
    const calm = this.reducedMotion;
    const r = this.rig;
    const badgeY = r.overhead.y + 0.35;

    switch (next) {
      case 'idle':
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1, yoyo: true, delay: 0.5 })
              .to(this.root.rotation, { z: 0.035, duration: 2.2, ease: 'sine.inOut' })
              .to(r.earR.rotation, { x: -0.18 * r.earSwing, duration: 1.1, ease: 'sine.inOut' }, 0.6),
          );
        }
        break;

      case 'listening':
        tl.to(r.earL.rotation, { ...this.ear('L', -0.1, -0.1), duration: 0.35, ease: 'back.out(3)', overwrite: 'auto' }, 0)
          .to(r.earR.rotation, { ...this.ear('R', -0.1, -0.1), duration: 0.35, ease: 'back.out(3)', overwrite: 'auto' }, 0)
          .to(r.head.rotation, { z: 0.14, x: -0.05, duration: 0.5, ease: 'power2.out' }, 0)
          .to(this.ring.material as THREE.MeshBasicMaterial, { opacity: 0.85, duration: 0.3 }, 0);
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1, yoyo: true })
              .to(this.ring.scale, { x: 1.12, y: 1.12, z: 1.12, duration: 0.7, ease: 'sine.inOut' })
              .to(this.root.position, { y: 0.06, duration: 0.7, ease: 'sine.inOut' }, 0),
            0.3,
          );
        }
        break;

      case 'thinking':
        tl.to(r.head.rotation, { z: -0.16, x: -0.12, duration: 0.6, ease: 'power2.out' }, 0)
          .to(r.eyes.map((e) => e.position), { y: r.eyeRestY + 0.04, duration: 0.4 }, 0)
          .to(r.earR.rotation, { ...this.ear('R', 0.75, 0.18), duration: 0.6, ease: 'back.out(2)' }, 0)
          .to(r.armR.rotation, { x: -1.6, z: 0.6, duration: 0.6, ease: 'power2.out' }, 0);
        if (!calm) {
          this.dots.forEach((dot, i) => {
            tl.add(
              gsap
                .timeline({ repeat: -1, repeatDelay: 0.3 })
                .to(dot.scale, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'back.out(3)' })
                // absolute target: an interrupted bounce must not shift the dot's base position
                .to(dot.position, { y: this.dotBaseY(i) + 0.12, duration: 0.35, yoyo: true, repeat: 1, ease: 'sine.inOut' })
                .to(dot.scale, { x: 0.6, y: 0.6, z: 0.6, duration: 0.25 }),
              0.2 + i * 0.25,
            );
          });
          tl.add(gsap.timeline({ repeat: -1, yoyo: true }).to(this.root.rotation, { y: 0.12, duration: 1.8, ease: 'sine.inOut' }), 0.4);
        } else {
          tl.to(this.dots.map((d) => d.scale), { x: 1, y: 1, z: 1, duration: 0.2 }, 0.2);
        }
        break;

      case 'working':
        r.tablet.visible = true;
        tl.to(r.tablet.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' }, 0.1)
          .to(r.armL.rotation, { x: -1.15, z: 0.35, duration: 0.4, overwrite: 'auto' }, 0)
          .to(r.armR.rotation, { x: -1.15, z: -0.35, duration: 0.4, overwrite: 'auto' }, 0)
          .to(r.head.rotation, { x: 0.22, duration: 0.4, overwrite: 'auto' }, 0);
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1 })
              .to(r.armR.rotation, { x: -1.3, duration: 0.12, yoyo: true, repeat: 5 })
              .to(r.armL.rotation, { x: -1.3, duration: 0.12, yoyo: true, repeat: 5 }, 0.06)
              .to(this.root.position, { y: 0.45, duration: 0.28, ease: 'power2.out' }, 1.2)
              .to(r.body.scale, { y: 1.08, duration: 0.28 }, 1.2)
              .to(this.root.position, { y: 0, duration: 0.26, ease: 'power2.in' }, 1.48)
              .to(r.body.scale, { y: 0.9, duration: 0.1 }, 1.74)
              .to(r.body.scale, { y: 1, duration: 0.25, ease: 'elastic.out(1, 0.5)' }, 1.84)
              .to(r.earL.rotation, { x: 0.35 * r.earSwing, duration: 0.2, yoyo: true, repeat: 1 }, 1.3)
              .to(r.earR.rotation, { x: 0.35 * r.earSwing, duration: 0.2, yoyo: true, repeat: 1 }, 1.36),
            0.45,
          );
        }
        break;

      case 'talking':
        tl.to(r.head.rotation, { x: -0.04, duration: 0.3, overwrite: 'auto' }, 0);
        if (!calm) {
          const talk = gsap.timeline({ repeat: -1 });
          for (let i = 0; i < 8; i++) {
            talk.to(r.mouth.scale, { y: 0.35 + Math.random() * 0.65, duration: 0.09 + Math.random() * 0.06, ease: 'none' });
            talk.to(r.mouth.scale, { y: 0.15, duration: 0.08, ease: 'none' });
          }
          tl.add(talk, 0.1);
          tl.add(gsap.timeline({ repeat: -1, yoyo: true }).to(r.head.rotation, { x: 0.06, duration: 0.45, ease: 'sine.inOut' }), 0.2);
        } else {
          tl.to(r.mouth.scale, { y: 0.6, duration: 0.2 }, 0);
        }
        break;

      case 'asking':
        this.question.visible = true;
        tl.to(r.head.rotation, { z: 0.18, duration: 0.5, ease: 'back.out(2)' }, 0)
          .to(r.armR.rotation, { z: 2.4, x: 0, duration: 0.45, ease: 'back.out(2)' }, 0)
          .set(this.question.position, { y: badgeY }, 0)
          .fromTo(this.question.scale, { x: 0.01, y: 0.01 }, { x: 0.55, y: 0.55, duration: 0.4, ease: 'back.out(3)' }, 0.1);
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1, yoyo: true })
              .to(r.armR.rotation, { z: 2.0, duration: 0.3, ease: 'sine.inOut' })
              .to(this.question.position, { y: badgeY + 0.12, duration: 0.3, ease: 'sine.inOut' }, 0),
            0.5,
          );
        }
        break;

      case 'happy':
        this.bang.visible = true;
        tl.fromTo(this.bang.scale, { x: 0.01, y: 0.01 }, { x: 0.55, y: 0.55, duration: 0.35, ease: 'back.out(3)' }, 0)
          .to(r.armL.rotation, { z: -2.3, duration: 0.3, ease: 'back.out(2)', overwrite: 'auto' }, 0)
          .to(r.armR.rotation, { z: 2.3, duration: 0.3, ease: 'back.out(2)', overwrite: 'auto' }, 0)
          .to(r.cheeks.map((c) => c.material as THREE.MeshBasicMaterial), { opacity: 0.9, duration: 0.3, overwrite: 'auto' }, 0);
        if (!calm) {
          tl.to(this.root.position, { y: 1.1, duration: 0.38, ease: 'power2.out' }, 0.1)
            .to(this.root.rotation, { y: Math.PI * 2, duration: 0.75, ease: 'power2.inOut' }, 0.1)
            .to(this.root.position, { y: 0, duration: 0.36, ease: 'bounce.out' }, 0.5)
            .set(this.root.rotation, { y: 0 }, 0.86);
        }
        tl.to(r.cheeks.map((c) => c.material as THREE.MeshBasicMaterial), { opacity: 0.55, duration: 0.6 }, 1.6);
        break;

      case 'sad':
        tl.to(r.earL.rotation, { ...this.ear('L', 1.15, 0.38), duration: 0.6, ease: 'power2.out' }, 0)
          .to(r.earR.rotation, { ...this.ear('R', 1.15, 0.38), duration: 0.6, ease: 'power2.out' }, 0)
          .to(r.head.rotation, { x: 0.3, duration: 0.6 }, 0)
          .to(r.head.position, { y: r.headRestY - r.sadHeadDrop, duration: 0.6 }, 0)
          .to(r.eyes.map((e) => e.position), { y: r.eyeRestY - 0.04, duration: 0.4 }, 0);
        if (!calm) tl.to(this.root.rotation, { z: 0.05, duration: 0.15, yoyo: true, repeat: 3 }, 0.6);
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeLang();
    this.stateTl?.kill();
    this.breathTl?.kill();
    this.blinkCall?.kill();
    gsap.killTweensOf([this.root.position, this.root.rotation, this.rig.body.scale]);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('click', this.handleClick);
    this.renderer.setAnimationLoop(null);
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        const withMaps = mat as THREE.MeshToonMaterial;
        if (withMaps.map) textures.add(withMaps.map);
        if (withMaps.gradientMap) textures.add(withMaps.gradientMap);
        mat.dispose();
      }
    });
    for (const t of textures) t.dispose();
    this.renderer.dispose();
    // release the WebGL context now (WEBGL_lose_context) instead of whenever the canvas is garbage-collected
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}
