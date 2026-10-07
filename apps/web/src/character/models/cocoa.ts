import * as THREE from 'three';
import { Kit, seeded, type Rig } from '../rig';

/** Cocoa Kelapa: a cocoa-brown coconut with an opened top, a bendy straw and a cocktail umbrella, and round glasses. */
export function buildCocoa(parent: THREE.Object3D): Rig {
  const kit = new Kit();
  const shell = kit.toon(0x8a5a3b);
  const shellDark = kit.toon(0x6b4128);
  const face = kit.toon(0xf0d9bd);
  const meat = kit.toon(0xfbf6ea);

  const body = new THREE.Group();
  parent.add(body);

  // the coconut is the head: it turns and nods as a whole, so the face stays on its surface
  const head = new THREE.Group();
  head.position.set(0, 1.15, 0);
  body.add(head);
  const radii = new THREE.Vector3(1.2, 1.12, 1.15);
  const nut = kit.mesh(new THREE.SphereGeometry(1, 48, 36), shell);
  nut.scale.copy(radii);
  head.add(nut);

  // husk fibres, away from the face
  const random = seeded(11);
  const fibreMat = kit.basic(0x5c3820);
  for (let i = 0; i < 40; i++) {
    const azimuth = random() * Math.PI * 2;
    const elevation = -0.9 + random() * 1.75;
    const front = Math.abs(Math.atan2(Math.sin(azimuth), Math.cos(azimuth))) < 0.95;
    if (front && elevation > -0.65 && elevation < 0.7) continue;
    const fibre = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.2 + random() * 0.12, 4, 6), fibreMat);
    kit.onSurface(fibre, radii, azimuth, elevation, 0.012);
    fibre.rotateZ((random() - 0.5) * 0.5);
    head.add(fibre);
  }

  // light face patch so the eyes read well on the brown shell
  const patch = kit.mesh(new THREE.SphereGeometry(1, 32, 24), face);
  patch.scale.set(0.68, 0.54, 0.3);
  patch.position.set(0, -0.02, 0.92);
  head.add(patch);

  // opened top: white coconut flesh in a brown rim
  const flesh = kit.mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 40), meat);
  flesh.position.y = 1.0;
  head.add(flesh);
  const rim = kit.mesh(new THREE.TorusGeometry(0.56, 0.05, 10, 40), shellDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.02;
  head.add(rim);

  // "ears": the cocktail umbrella (left) and the bendy straw (right)
  const earL = new THREE.Group();
  earL.position.set(-0.24, 1.0, 0.06);
  earL.rotation.z = 0.2;
  const stick = kit.mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 6), kit.toon(0xf3e5c8));
  stick.position.y = 0.31;
  const canopy = kit.mesh(new THREE.ConeGeometry(0.36, 0.17, 12, 1, true), new THREE.MeshToonMaterial({ color: 0xffa94d, side: THREE.DoubleSide }));
  canopy.position.y = 0.66;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), kit.toon(0xff6b6b));
  tip.position.y = 0.76;
  earL.add(stick, canopy, tip);
  head.add(earL);

  const earR = new THREE.Group();
  earR.position.set(0.2, 1.0, -0.06);
  earR.rotation.z = -0.2;
  const strawMat = kit.toon(0xff6b6b);
  const straw = kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 12), strawMat);
  straw.position.y = 0.45;
  const bend = kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 12), strawMat);
  bend.position.set(-0.1, 0.96, 0);
  bend.rotation.z = 1.0;
  earR.add(straw, bend);
  for (const y of [0.25, 0.5, 0.75]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16), kit.basic(0xffffff));
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = y;
    earR.add(stripe);
  }
  head.add(earR);

  const eyes = kit.eyes(head, 0.3, 0.08, 1.12, 0.13);
  kit.glasses(head, 0.3, 0.08, 1.22, 0.2, 0.3);
  const cheeks = kit.cheeks(head, 0.5, -0.14, 1.12, 0.45, 0xf49a8a, 0.12);
  const mouth = kit.mouth(head, -0.22, 1.2, 0x6b2c2c);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, side] of [
    [armL, -1],
    [armR, 1],
  ] as const) {
    arm.position.set(side * 1.1, 1.0, 0.25);
    const nub = kit.mesh(new THREE.CapsuleGeometry(0.14, 0.26, 8, 16), shellDark);
    nub.position.y = -0.2;
    arm.add(nub);
    arm.rotation.z = side * 0.5;
    body.add(arm);
  }
  for (const side of [-1, 1]) {
    const foot = kit.mesh(new THREE.SphereGeometry(0.27, 20, 14), shellDark);
    foot.scale.set(1, 0.45, 1.3);
    foot.position.set(side * 0.48, 0.1, 0.55);
    body.add(foot);
  }
  const tablet = kit.tablet(body, 0.58, 1.42);

  return {
    body,
    head,
    headRestY: 1.15,
    sadHeadDrop: 0.06,
    earL,
    earR,
    earRestZ: 0.2,
    earSwing: 0.7,
    armL,
    armR,
    armRestZ: 0.5,
    eyes,
    eyeRestY: 0.08,
    mouth,
    cheeks,
    tablet,
    overhead: { x: 0.8, y: 1.6 },
    look: 0.3,
    breath: { x: 1.012, y: 0.985 },
    frame: { height: 3.9, width: 3.5 },
    pickables: kit.pickables,
    label: 'SOLAR AI AGENT sebagai Cocoa Kelapa, buah kelapa cokelat berkacamata dengan sedotan',
  };
}
