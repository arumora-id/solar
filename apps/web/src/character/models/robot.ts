import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Kit, type Rig } from '../rig';

/** Soft round glow (white, fading out) tinted by the material colour. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Robo: a small white-and-blue robot with a TV-like head. Its dark face screen shows glowing eyes, a smile and pink
 * blush lights; two antennas with sun-yellow tips play the ears, headset pods sit on the sides of the head and a
 * glowing sun core shines on its chest.
 */
export function buildRobot(parent: THREE.Object3D): Rig {
  const kit = new Kit();
  const shell = kit.toon(0xf3f6fb);
  const joint = kit.toon(0xc9d3e2);
  const blue = kit.toon(0x2a78d6);
  const blueSoft = kit.toon(0xcde2fb);
  const screen = kit.toon(0x1b2a47);
  const glow = kit.basic(0x7fe4ff);
  const sun = kit.basic(0xffc247);
  // one soft glow texture for the eye halos and the antenna lights
  const glowMap = glowTexture();

  const body = new THREE.Group();
  parent.add(body);

  // compact torso with a glowing sun core on the chest
  const torso = kit.mesh(new RoundedBoxGeometry(1.28, 0.88, 0.96, 4, 0.32), shell);
  torso.position.y = 0.66;
  body.add(torso);
  const plate = kit.mesh(new RoundedBoxGeometry(0.62, 0.46, 1, 4, 0.16), blueSoft);
  plate.scale.z = 0.12;
  plate.position.set(0, 0.7, 0.47);
  body.add(plate);
  const coreRing = kit.mesh(new THREE.TorusGeometry(0.15, 0.04, 10, 32), blue);
  coreRing.position.set(0, 0.7, 0.53);
  const core = kit.mesh(new THREE.SphereGeometry(0.13, 20, 14), sun);
  core.scale.set(1, 1, 0.45);
  core.position.set(0, 0.7, 0.53);
  body.add(coreRing, core);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 20), joint);
  neck.position.y = 1.12;
  body.add(neck);

  // sturdy rounded boots
  for (const side of [-1, 1]) {
    const foot = kit.mesh(new THREE.SphereGeometry(0.29, 20, 14), blue);
    foot.scale.set(1, 0.5, 1.25);
    foot.position.set(side * 0.35, 0.13, 0.1);
    body.add(foot);
  }

  // arms pivot at the shoulders: a short white arm and a round blue hand
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, side] of [
    [armL, -1],
    [armR, 1],
  ] as const) {
    arm.position.set(side * 0.68, 0.9, 0.05);
    const shoulder = kit.mesh(new THREE.SphereGeometry(0.13, 16, 12), joint);
    const limb = kit.mesh(new THREE.CapsuleGeometry(0.1, 0.26, 6, 14), shell);
    limb.position.y = -0.22;
    const hand = kit.mesh(new THREE.SphereGeometry(0.15, 18, 12), blue);
    hand.scale.set(1, 0.92, 0.85);
    hand.position.y = -0.48;
    arm.add(shoulder, limb, hand);
    arm.rotation.z = side * 0.35;
    body.add(arm);
  }
  const tablet = kit.tablet(body, 0.62, 0.92);

  // the head pivots at the neck so nods and tilts look natural
  const head = new THREE.Group();
  head.position.set(0, 1.14, 0);
  body.add(head);
  const skull = kit.mesh(new RoundedBoxGeometry(2.06, 1.48, 1.44, 6, 0.5), shell);
  skull.position.y = 0.76;
  head.add(skull);

  // face screen: a soft cushion-shaped panel (a rounded box flattened in depth)
  const face = kit.mesh(new RoundedBoxGeometry(1.7, 1.1, 1.0, 6, 0.34), screen);
  face.scale.z = 0.3;
  face.position.set(0, 0.78, 0.65);
  head.add(face);
  const faceFront = 0.65 + 0.15;
  // a soft reflection on the glass
  const shine = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), kit.basic(0xffffff, 0.16));
  shine.scale.set(1.8, 0.42, 1);
  shine.rotation.z = 0.4;
  shine.position.set(-0.6, 1.2, faceFront + 0.004);
  head.add(shine);

  // glowing pill eyes with a soft halo and a glint
  const eyeY = 0.88;
  const eyeGlow = new THREE.MeshBasicMaterial({ color: 0x7fe4ff, map: glowMap, transparent: true, opacity: 0.55, depthWrite: false });
  const glintMat = kit.basic(0xffffff);
  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.Group();
    eye.position.set(side * 0.38, eyeY, faceFront);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.76), eyeGlow);
    halo.position.z = 0.004;
    const pill = kit.mesh(new THREE.CapsuleGeometry(0.11, 0.13, 6, 16), glow);
    pill.scale.z = 0.35;
    pill.position.z = 0.01;
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), glintMat);
    glint.position.set(0.04, 0.08, 0.05);
    eye.add(halo, pill, glint);
    head.add(eye);
    return eye;
  });

  // pink blush lights on the screen: a light glow (brightened when happy) over a solid pink base, so it stays pink
  // on the dark glass
  const cheeks = kit.cheeks(head, 0.64, 0.68, faceFront + 0.008, 0, 0xffc4da, 0.1);
  const blushBase = kit.basic(0xe0668f);
  for (const cheek of cheeks) {
    cheek.scale.set(1.3, 0.75, 1);
    const base = new THREE.Mesh(cheek.geometry, blushBase);
    // under the eye halo (faceFront + 0.004) so the two never share a depth and z-fight
    base.position.set(cheek.position.x, cheek.position.y, faceFront + 0.002);
    base.scale.copy(cheek.scale);
    head.add(base);
  }

  // the mouth is a "D" (the lower half of an ellipse, 0.34 wide and 0.24 deep when fully open): its flat top stays
  // put and it opens downwards, so the rest pose reads as a small smile
  const mouthGeo = new THREE.CircleGeometry(0.17, 16, Math.PI, Math.PI);
  mouthGeo.scale(1, 0.24 / 0.17, 1);
  const mouth = new THREE.Mesh(mouthGeo, glow);
  mouth.scale.set(1, 0.12, 1);
  mouth.position.set(0, 0.64, faceFront + 0.008);
  head.add(mouth);

  // headset pods on the sides of the head
  for (const side of [-1, 1]) {
    const pod = kit.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.16, 28), blue);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(side * 1.07, 0.76, 0);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 24), blueSoft);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(side * 1.16, 0.76, 0);
    head.add(pod, cap);
  }

  // two antennas = the "ears": they perk up, wiggle and droop; the tips glow softly (a sprite always faces the camera)
  const tipGlow = new THREE.SpriteMaterial({ color: 0xffd36b, map: glowMap, transparent: true, opacity: 0.8, depthWrite: false });
  const earL = new THREE.Group();
  const earR = new THREE.Group();
  for (const [ear, side] of [
    [earL, -1],
    [earR, 1],
  ] as const) {
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.08, 18), blue);
    socket.position.set(side * 0.42, 1.51, 0);
    head.add(socket);
    ear.position.set(side * 0.42, 1.54, 0);
    ear.rotation.z = -side * 0.28;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), joint);
    const stalk = kit.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), joint);
    stalk.position.y = 0.18;
    const tip = kit.mesh(new THREE.SphereGeometry(0.09, 16, 12), sun);
    tip.position.y = 0.42;
    const halo = new THREE.Sprite(tipGlow);
    halo.scale.setScalar(0.42);
    halo.position.y = 0.42;
    ear.add(ball, stalk, tip, halo);
    head.add(ear);
  }

  return {
    body,
    head,
    headRestY: 1.14,
    sadHeadDrop: 0.08,
    earL,
    earR,
    earRestZ: 0.28,
    earSwing: 0.7,
    armL,
    armR,
    armRestZ: 0.35,
    eyes,
    eyeRestY: eyeY,
    mouth,
    cheeks,
    tablet,
    overhead: { x: 0.85, y: 1.55 },
    look: 0.3,
    breath: { x: 1.012, y: 0.985 },
    frame: { height: 3.7, width: 3.5 },
    pickables: kit.pickables,
    label: 'SOLAR AI AGENT sebagai Robo, robot putih-biru dengan wajah layar bercahaya',
  };
}
