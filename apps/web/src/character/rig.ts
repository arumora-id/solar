import * as THREE from 'three';

export type CharacterState = 'idle' | 'listening' | 'thinking' | 'working' | 'talking' | 'asking' | 'happy' | 'sad';

/**
 * The animatable skeleton every character model provides. The scene animates these groups with GSAP; the numbers
 * describe each model's rest pose so one set of animations fits differently shaped characters.
 */
export interface Rig {
  /** Everything except the ground; squashed and stretched when breathing, hopping or clicked. */
  body: THREE.Group;
  /** Turns to follow the pointer, nods and tilts; holds the face. */
  head: THREE.Group;
  headRestY: number;
  /** How far the head sinks when sad. */
  sadHeadDrop: number;
  /** Ears, leaves, straw...: folded (rotation.x) and spread (rotation.z) to show emotion. */
  earL: THREE.Group;
  earR: THREE.Group;
  /** Rest rotation.z of the left ear (the right one mirrors it). */
  earRestZ: number;
  /** Scales every ear movement (1 = rabbit ears; smaller for stiff parts). */
  earSwing: number;
  /** Arms pivot at the shoulder. */
  armL: THREE.Group;
  armR: THREE.Group;
  /** Rest rotation.z of the right arm (the left one mirrors it). */
  armRestZ: number;
  eyes: THREE.Group[];
  eyeRestY: number;
  /** Scaled on y to talk (rest 0.12). */
  mouth: THREE.Mesh;
  /** Blush that brightens when happy (MeshBasicMaterial, transparent). */
  cheeks: THREE.Mesh[];
  /** Tablet held while working (already positioned in front of the body, hidden). */
  tablet: THREE.Group;
  /** Head-space anchor of the thinking dots and the "?"/"!" badges. */
  overhead: { x: number; y: number };
  /** How strongly the head follows the pointer. */
  look: number;
  /** Breathing: body scale at the top of a breath. */
  breath: { x: number; y: number };
  /** Content box (feet to the tip of the badges) used to frame the camera. */
  frame: { height: number; width: number };
  /** Meshes that react to hover/click. (The canvas' accessible description is `t.character.characters[id].sceneLabel`.) */
  pickables: THREE.Object3D[];
}

/** 3-step gradient for a soft cel-shaded look. */
export function toonGradient(): THREE.DataTexture {
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Helpers shared by the character models. */
export class Kit {
  readonly pickables: THREE.Object3D[] = [];
  private readonly gradient = toonGradient();

  toon(color: number): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient });
  }

  basic(color: number, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  }

  /** A mesh that reacts to hover/click (pick = false for decorations). */
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pick = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    if (pick) this.pickables.push(m);
    return m;
  }

  /** Two eyes (dark ellipsoid + glint) in `parent`, at ±x. */
  eyes(parent: THREE.Object3D, x: number, y: number, z: number, size = 0.13, color = 0x1f2328): THREE.Group[] {
    return [-1, 1].map((side) => {
      const eye = new THREE.Group();
      eye.position.set(side * x, y, z);
      const ball = this.mesh(new THREE.SphereGeometry(size, 24, 16), new THREE.MeshBasicMaterial({ color }));
      ball.scale.set(1, 1.15, 0.6);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(size * 0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(size * 0.3, size * 0.4, size * 0.55);
      eye.add(ball, glint);
      parent.add(eye);
      return eye;
    });
  }

  /** Round glasses (the architect look) centred on the eyes; `depth` is how far the temples reach back. */
  glasses(parent: THREE.Object3D, x: number, y: number, z: number, radius = 0.22, depth = 0.6, color = 0x2a78d6): void {
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.028, 12, 40), mat);
      rim.position.set(side * x, y, z);
      parent.add(rim);
      const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, depth, 8), mat);
      temple.rotation.x = Math.PI / 2;
      temple.position.set(side * (x + radius - 0.01), y + 0.02, z - depth / 2);
      parent.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, Math.max(0.05, 2 * (x - radius)), 8), mat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, y + 0.04, z + 0.04);
    parent.add(bridge);
  }

  /** Blush discs facing outwards at ±x. */
  cheeks(parent: THREE.Object3D, x: number, y: number, z: number, turn: number, color = 0xf6a5b8, size = 0.13): THREE.Mesh[] {
    return [-1, 1].map((side) => {
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(size, 24), this.basic(color, 0.55));
      cheek.position.set(side * x, y, z);
      cheek.rotation.y = side * turn;
      parent.add(cheek);
      return cheek;
    });
  }

  mouth(parent: THREE.Object3D, y: number, z: number, color = 0x8a2b3f): THREE.Mesh {
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), new THREE.MeshBasicMaterial({ color }));
    mouth.scale.set(1, 0.12, 0.5);
    mouth.position.set(0, y, z);
    parent.add(mouth);
    return mouth;
  }

  /** Tablet with a few text lines, hidden until the character works. */
  tablet(parent: THREE.Object3D, y: number, z: number): THREE.Group {
    const tablet = new THREE.Group();
    const slab = this.mesh(new THREE.BoxGeometry(0.95, 0.62, 0.06), new THREE.MeshStandardMaterial({ color: 0x24292f, roughness: 0.5 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.52), new THREE.MeshBasicMaterial({ color: 0x7cc4ff }));
    screen.position.z = 0.032;
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5 - i * 0.1, 0.05), lineMat);
      line.position.set(-0.1 + i * 0.05, 0.12 - i * 0.12, 0.034);
      tablet.add(line);
    }
    tablet.add(slab, screen);
    tablet.position.set(0, y, z);
    tablet.rotation.x = -0.35;
    tablet.scale.setScalar(0.001);
    tablet.visible = false;
    parent.add(tablet);
    return tablet;
  }

  /** Places a small decoration on an ellipsoid surface (angles in radians), facing outwards. */
  onSurface(obj: THREE.Object3D, radii: THREE.Vector3, azimuth: number, elevation: number, lift = 0): THREE.Object3D {
    const dir = new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
    const p = new THREE.Vector3(dir.x * radii.x, dir.y * radii.y, dir.z * radii.z);
    // the ellipsoid normal points along (x/a², y/b², z/c²)
    const normal = new THREE.Vector3(p.x / radii.x ** 2, p.y / radii.y ** 2, p.z / radii.z ** 2).normalize();
    obj.position.copy(p).addScaledVector(normal, lift);
    obj.lookAt(obj.position.clone().add(normal));
    return obj;
  }
}

/** Deterministic pseudo-random numbers in [0, 1) so decorations look the same on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
