import gsap from 'gsap';
import * as THREE from 'three';

export type RabbitState = 'idle' | 'listening' | 'thinking' | 'working' | 'talking' | 'asking' | 'happy' | 'sad';

interface Palette {
  fur: number;
  furShade: number;
  belly: number;
  innerEar: number;
  nose: number;
  eye: number;
  glasses: number;
  cheek: number;
  accent: number;
  screen: number;
}

const PALETTE: Palette = {
  fur: 0xf6f1e8,
  furShade: 0xe6dccc,
  belly: 0xfffdf8,
  innerEar: 0xf4a7b9,
  nose: 0xe86f8a,
  eye: 0x1f2328,
  glasses: 0x2a78d6,
  cheek: 0xf6a5b8,
  accent: 0x2a78d6,
  screen: 0x7cc4ff,
};

/** 3-step gradient for a soft cel-shaded look. */
function toonGradient(): THREE.DataTexture {
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

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
 * Procedural, asset-free 3D rabbit ("SOLAR") animated with GSAP.
 * Every pose is a GSAP timeline on Object3D properties; three.js only renders.
 */
export class RabbitScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly earL = new THREE.Group();
  private readonly earR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly eyes: THREE.Group[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly cheeks: THREE.Mesh[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly tablet = new THREE.Group();
  private readonly dots: THREE.Mesh[] = [];
  private readonly question: THREE.Sprite;
  private readonly bang: THREE.Sprite;
  private readonly pickables: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly lookTarget = new THREE.Vector2(0, 0);
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion: boolean;
  private stateTl: gsap.core.Timeline | null = null;
  private breathTl: gsap.core.Timeline | null = null;
  private blinkCall: gsap.core.Tween | null = null;
  private state: RabbitState = 'idle';
  private disposed = false;
  onClick: (() => void) | null = null;

  constructor(private readonly container: HTMLElement) {
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'SOLAR, kelinci asisten solution architect');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);


    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c3d6, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfdcff, 1.1);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    const gradient = toonGradient();
    const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
    const furMat = toon(PALETTE.fur);
    const shadeMat = toon(PALETTE.furShade);
    const bellyMat = toon(PALETTE.belly);
    const innerMat = toon(PALETTE.innerEar);
    const noseMat = toon(PALETTE.nose);
    const eyeMat = new THREE.MeshBasicMaterial({ color: PALETTE.eye });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glassMat = new THREE.MeshStandardMaterial({ color: PALETTE.glasses, metalness: 0.3, roughness: 0.4 });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, pick = true) => {
      const m = new THREE.Mesh(geo, mat);
      if (pick) this.pickables.push(m);
      return m;
    };

    // ---- body ---------------------------------------------------------------
    this.scene.add(this.root);
    this.root.add(this.body);
    const torso = mesh(new THREE.SphereGeometry(1, 40, 32), furMat);
    torso.scale.set(1, 1.12, 0.95);
    torso.position.y = 1.15;
    this.body.add(torso);
    const belly = mesh(new THREE.SphereGeometry(0.72, 32, 24), bellyMat);
    belly.scale.set(1, 1.1, 0.6);
    belly.position.set(0, 1.0, 0.55);
    this.body.add(belly);
    for (const side of [-1, 1]) {
      const foot = mesh(new THREE.SphereGeometry(0.36, 24, 16), shadeMat);
      foot.scale.set(1, 0.5, 1.5);
      foot.position.set(side * 0.48, 0.15, 0.42);
      this.body.add(foot);
    }
    const tail = mesh(new THREE.SphereGeometry(0.3, 20, 16), bellyMat);
    tail.position.set(0, 0.75, -0.95);
    this.body.add(tail);

    // arms pivot at the shoulder so they can wave / hold the tablet
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * 0.78, 1.55, 0.25);
      const paw = mesh(new THREE.CapsuleGeometry(0.17, 0.5, 8, 16), furMat);
      paw.position.y = -0.38;
      arm.add(paw);
      arm.rotation.z = side * 0.25;
      this.body.add(arm);
    }

    // tablet (shown while working)
    const slab = mesh(new THREE.BoxGeometry(0.95, 0.62, 0.06), new THREE.MeshStandardMaterial({ color: 0x24292f, roughness: 0.5 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.52), new THREE.MeshBasicMaterial({ color: PALETTE.screen }));
    screen.position.z = 0.032;
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5 - i * 0.1, 0.05), lineMat);
      line.position.set(-0.1 + i * 0.05, 0.12 - i * 0.12, 0.034);
      this.tablet.add(line);
    }
    this.tablet.add(slab, screen);
    this.tablet.position.set(0, 1.25, 1.05);
    this.tablet.rotation.x = -0.35;
    this.tablet.scale.setScalar(0.001);
    this.tablet.visible = false;
    this.body.add(this.tablet);

    // ---- head ---------------------------------------------------------------
    this.head.position.set(0, 2.1, 0.05);
    this.body.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.88, 40, 32), furMat);
    skull.scale.set(1.08, 0.95, 0.95);
    skull.position.y = 0.5;
    this.head.add(skull);
    const muzzle = mesh(new THREE.SphereGeometry(0.36, 24, 16), bellyMat);
    muzzle.scale.set(1.25, 0.8, 0.8);
    muzzle.position.set(0, 0.3, 0.68);
    this.head.add(muzzle);

    for (const [ear, side] of [
      [this.earL, -1],
      [this.earR, 1],
    ] as const) {
      ear.position.set(side * 0.36, 1.2, -0.05);
      ear.rotation.z = -side * 0.12;
      const outer = mesh(new THREE.CapsuleGeometry(0.19, 0.95, 8, 20), furMat);
      outer.scale.set(1, 1, 0.65);
      outer.position.y = 0.62;
      const inner = mesh(new THREE.CapsuleGeometry(0.11, 0.78, 8, 16), innerMat);
      inner.scale.set(1, 1, 0.4);
      inner.position.set(0, 0.62, 0.1);
      ear.add(outer, inner);
      this.head.add(ear);
    }

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.32, 0.62, 0.74);
      const ball = mesh(new THREE.SphereGeometry(0.13, 24, 16), eyeMat);
      ball.scale.set(1, 1.15, 0.6);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), whiteMat);
      glint.position.set(0.04, 0.05, 0.07);
      eye.add(ball, glint);
      this.head.add(eye);
      this.eyes.push(eye);

      // glasses: the architect look
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 12, 40), glassMat);
      rim.position.set(side * 0.32, 0.62, 0.8);
      this.head.add(rim);
      const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), glassMat);
      temple.rotation.x = Math.PI / 2;
      temple.position.set(side * 0.53, 0.64, 0.5);
      this.head.add(temple);

      const cheek = new THREE.Mesh(
        new THREE.CircleGeometry(0.13, 24),
        new THREE.MeshBasicMaterial({ color: PALETTE.cheek, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      cheek.position.set(side * 0.58, 0.32, 0.72);
      cheek.rotation.y = side * 0.55;
      this.head.add(cheek);
      this.cheeks.push(cheek);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), glassMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.66, 0.84);
    this.head.add(bridge);

    const nose = mesh(new THREE.SphereGeometry(0.075, 16, 12), noseMat);
    nose.scale.set(1.3, 0.9, 0.9);
    nose.position.set(0, 0.42, 0.95);
    this.head.add(nose);
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), new THREE.MeshBasicMaterial({ color: 0x8a2b3f }));
    this.mouth.scale.set(1, 0.12, 0.5);
    this.mouth.position.set(0, 0.2, 0.92);
    this.head.add(this.mouth);

    // thinking dots & state sprites above the head
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.accent }));
      dot.position.set(0.75 + i * 0.28, 1.95 + i * 0.22, 0.2);
      dot.scale.setScalar(0.001);
      this.head.add(dot);
      this.dots.push(dot);
    }
    this.question = glyphSprite('?', '#2a78d6');
    this.question.position.set(1.05, 2.3, 0.2);
    this.question.visible = false;
    this.head.add(this.question);
    this.bang = glyphSprite('!', '#0ca30c');
    this.bang.position.set(1.05, 2.3, 0.2);
    this.bang.visible = false;
    this.head.add(this.bang);

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
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);

    // ---- interaction ----------------------------------------------------------
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

  // -------------------------------------------------------------------------

  private readonly handlePointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.lookTarget.set(this.pointer.x, this.pointer.y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.renderer.domElement.style.cursor = this.raycaster.intersectObjects(this.pickables, false).length ? 'pointer' : 'default';
  };

  private readonly handlePointerLeave = () => {
    this.lookTarget.set(0, 0);
  };

  private readonly handleClick = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObjects(this.pickables, false).length === 0) return;
    if (!this.reducedMotion) {
      gsap.fromTo(this.body.scale, { y: 0.92 }, { y: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    }
    this.onClick?.();
  };

  private readonly tick = () => {
    if (this.disposed) return;
    // head follows the pointer smoothly (unless a pose owns the head)
    const followY = this.lookTarget.x * 0.35;
    this.head.rotation.y += (followY - this.head.rotation.y) * 0.08;
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
    // Frame the whole rabbit (feet to ear tips, ~5 units tall, ~3.6 wide) in the lower 72-80% of the
    // view so the speech bubble at the top never covers the head or ears.
    const contentHeight = 5.1;
    const contentWidth = 3.8;
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
    this.breathTl.to(this.body.scale, { y: 1.025, x: 0.99, duration: 1.6, ease: 'sine.inOut' });
  }

  private scheduleBlink(): void {
    this.blinkCall = gsap.delayedCall(2 + Math.random() * 3.5, () => {
      if (this.disposed) return;
      const lids = this.eyes.map((e) => e.scale);
      gsap.timeline().to(lids, { y: 0.1, duration: 0.07, ease: 'power1.in' }).to(lids, { y: 1, duration: 0.12, ease: 'power1.out' });
      this.scheduleBlink();
    });
  }

  /** Pose shared by every state: everything back to neutral (except what `next` is about to use). */
  private neutral(tl: gsap.core.Timeline, next: RabbitState, d = 0.45): void {
    tl.to(this.root.position, { y: 0, duration: d, ease: 'power2.out' }, 0)
      .to(this.root.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.out' }, 0)
      .to(this.head.rotation, { x: 0, z: 0, duration: d, ease: 'power2.out' }, 0)
      .to(this.head.position, { y: 2.1, duration: d }, 0)
      .to(this.earL.rotation, { x: 0, z: 0.12, duration: d, ease: 'back.out(2)' }, 0)
      .to(this.earR.rotation, { x: 0, z: -0.12, duration: d, ease: 'back.out(2)' }, 0)
      .to(this.armL.rotation, { x: 0, z: -0.25, duration: d }, 0)
      .to(this.armR.rotation, { x: 0, z: 0.25, duration: d }, 0)
      .to(this.mouth.scale, { y: 0.12, duration: 0.2 }, 0)
      .to(this.ring.material as THREE.MeshBasicMaterial, { opacity: 0, duration: 0.3 }, 0)
      .to(this.ring.scale, { x: 1, y: 1, z: 1, duration: 0.3 }, 0)
      .to(this.dots.map((d2) => d2.scale), { x: 0.001, y: 0.001, z: 0.001, duration: 0.2 }, 0)
      .to(this.eyes.map((e) => e.position), { y: 0.62, duration: 0.3 }, 0);
    if (next !== 'working') {
      tl.to(this.tablet.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, onComplete: () => void (this.tablet.visible = false) }, 0);
    }
    if (next !== 'asking') this.question.visible = false;
    if (next !== 'happy') this.bang.visible = false;
  }

  getState(): RabbitState {
    return this.state;
  }

  setState(next: RabbitState, force = false): void {
    if (!force && next === this.state) return;
    this.state = next;
    this.stateTl?.kill();
    const tl = gsap.timeline();
    this.stateTl = tl;
    this.neutral(tl, next);
    const calm = this.reducedMotion;

    switch (next) {
      case 'idle':
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1, yoyo: true, delay: 0.5 })
              .to(this.root.rotation, { z: 0.035, duration: 2.2, ease: 'sine.inOut' })
              .to(this.earR.rotation, { x: -0.18, duration: 1.1, ease: 'sine.inOut' }, 0.6),
          );
        }
        break;

      case 'listening':
        tl.to(this.earL.rotation, { z: 0.02, x: -0.1, duration: 0.35, ease: 'back.out(3)' }, 0)
          .to(this.earR.rotation, { z: -0.02, x: -0.1, duration: 0.35, ease: 'back.out(3)' }, 0)
          .to(this.head.rotation, { z: 0.14, x: -0.05, duration: 0.5, ease: 'power2.out' }, 0)
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
        tl.to(this.head.rotation, { z: -0.16, x: -0.12, duration: 0.6, ease: 'power2.out' }, 0)
          .to(this.eyes.map((e) => e.position), { y: 0.66, duration: 0.4 }, 0)
          .to(this.earR.rotation, { x: 0.75, z: -0.3, duration: 0.6, ease: 'back.out(2)' }, 0)
          .to(this.armR.rotation, { x: -1.6, z: 0.6, duration: 0.6, ease: 'power2.out' }, 0);
        if (!calm) {
          this.dots.forEach((dot, i) => {
            tl.add(
              gsap
                .timeline({ repeat: -1, repeatDelay: 0.3 })
                .to(dot.scale, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'back.out(3)' })
                .to(dot.position, { y: `+=0.12`, duration: 0.35, yoyo: true, repeat: 1, ease: 'sine.inOut' })
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
        this.tablet.visible = true;
        tl.to(this.tablet.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2)' }, 0.1)
          .to(this.armL.rotation, { x: -1.15, z: 0.35, duration: 0.4 }, 0)
          .to(this.armR.rotation, { x: -1.15, z: -0.35, duration: 0.4 }, 0)
          .to(this.head.rotation, { x: 0.22, duration: 0.4 }, 0);
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1 })
              .to(this.armR.rotation, { x: -1.3, duration: 0.12, yoyo: true, repeat: 5 })
              .to(this.armL.rotation, { x: -1.3, duration: 0.12, yoyo: true, repeat: 5 }, 0.06)
              .to(this.root.position, { y: 0.45, duration: 0.28, ease: 'power2.out' }, 1.2)
              .to(this.body.scale, { y: 1.08, duration: 0.28 }, 1.2)
              .to(this.root.position, { y: 0, duration: 0.26, ease: 'power2.in' }, 1.48)
              .to(this.body.scale, { y: 0.9, duration: 0.1 }, 1.74)
              .to(this.body.scale, { y: 1, duration: 0.25, ease: 'elastic.out(1, 0.5)' }, 1.84)
              .to(this.earL.rotation, { x: 0.35, duration: 0.2, yoyo: true, repeat: 1 }, 1.3)
              .to(this.earR.rotation, { x: 0.35, duration: 0.2, yoyo: true, repeat: 1 }, 1.36),
            0.45,
          );
        }
        break;

      case 'talking':
        tl.to(this.head.rotation, { x: -0.04, duration: 0.3 }, 0);
        if (!calm) {
          const talk = gsap.timeline({ repeat: -1 });
          for (let i = 0; i < 8; i++) {
            talk.to(this.mouth.scale, { y: 0.35 + Math.random() * 0.65, duration: 0.09 + Math.random() * 0.06, ease: 'none' });
            talk.to(this.mouth.scale, { y: 0.15, duration: 0.08, ease: 'none' });
          }
          tl.add(talk, 0.1);
          tl.add(gsap.timeline({ repeat: -1, yoyo: true }).to(this.head.rotation, { x: 0.06, duration: 0.45, ease: 'sine.inOut' }), 0.2);
        } else {
          tl.to(this.mouth.scale, { y: 0.6, duration: 0.2 }, 0);
        }
        break;

      case 'asking':
        this.question.visible = true;
        tl.to(this.head.rotation, { z: 0.18, duration: 0.5, ease: 'back.out(2)' }, 0)
          .to(this.armR.rotation, { z: 2.4, x: 0, duration: 0.45, ease: 'back.out(2)' }, 0)
          .fromTo(this.question.scale, { x: 0.01, y: 0.01 }, { x: 0.55, y: 0.55, duration: 0.4, ease: 'back.out(3)' }, 0.1);
        if (!calm) {
          tl.add(
            gsap
              .timeline({ repeat: -1, yoyo: true })
              .to(this.armR.rotation, { z: 2.0, duration: 0.3, ease: 'sine.inOut' })
              .to(this.question.position, { y: 2.42, duration: 0.3, ease: 'sine.inOut' }, 0),
            0.5,
          );
        }
        break;

      case 'happy':
        this.bang.visible = true;
        tl.fromTo(this.bang.scale, { x: 0.01, y: 0.01 }, { x: 0.55, y: 0.55, duration: 0.35, ease: 'back.out(3)' }, 0)
          .to(this.armL.rotation, { z: -2.3, duration: 0.3, ease: 'back.out(2)' }, 0)
          .to(this.armR.rotation, { z: 2.3, duration: 0.3, ease: 'back.out(2)' }, 0)
          .to(this.cheeks.map((c) => c.material as THREE.MeshBasicMaterial), { opacity: 0.9, duration: 0.3 }, 0);
        if (!calm) {
          tl.to(this.root.position, { y: 1.1, duration: 0.38, ease: 'power2.out' }, 0.1)
            .to(this.root.rotation, { y: Math.PI * 2, duration: 0.75, ease: 'power2.inOut' }, 0.1)
            .to(this.root.position, { y: 0, duration: 0.36, ease: 'bounce.out' }, 0.5)
            .set(this.root.rotation, { y: 0 }, 0.86);
        }
        tl.to(this.cheeks.map((c) => c.material as THREE.MeshBasicMaterial), { opacity: 0.55, duration: 0.6 }, 1.6);
        break;

      case 'sad':
        tl.to(this.earL.rotation, { x: 1.15, z: 0.5, duration: 0.6, ease: 'power2.out' }, 0)
          .to(this.earR.rotation, { x: 1.15, z: -0.5, duration: 0.6, ease: 'power2.out' }, 0)
          .to(this.head.rotation, { x: 0.3, duration: 0.6 }, 0)
          .to(this.head.position, { y: 2.0, duration: 0.6 }, 0)
          .to(this.eyes.map((e) => e.position), { y: 0.58, duration: 0.4 }, 0);
        if (!calm) tl.to(this.root.rotation, { z: 0.05, duration: 0.15, yoyo: true, repeat: 3 }, 0.6);
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stateTl?.kill();
    this.breathTl?.kill();
    this.blinkCall?.kill();
    gsap.killTweensOf([this.root.position, this.root.rotation, this.body.scale]);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('click', this.handleClick);
    this.renderer.setAnimationLoop(null);
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
