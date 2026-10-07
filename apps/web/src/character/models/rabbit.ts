import * as THREE from 'three';
import { Kit, type Rig } from '../rig';

/** The original SOLAR rabbit: long ears, round glasses, white fur. */
export function buildRabbit(parent: THREE.Object3D): Rig {
  const kit = new Kit();
  const fur = kit.toon(0xf6f1e8);
  const shade = kit.toon(0xe6dccc);
  const belly = kit.toon(0xfffdf8);
  const inner = kit.toon(0xf4a7b9);
  const nose = kit.toon(0xe86f8a);

  const body = new THREE.Group();
  parent.add(body);
  const torso = kit.mesh(new THREE.SphereGeometry(1, 40, 32), fur);
  torso.scale.set(1, 1.12, 0.95);
  torso.position.y = 1.15;
  body.add(torso);
  const tummy = kit.mesh(new THREE.SphereGeometry(0.72, 32, 24), belly);
  tummy.scale.set(1, 1.1, 0.6);
  tummy.position.set(0, 1.0, 0.55);
  body.add(tummy);
  for (const side of [-1, 1]) {
    const foot = kit.mesh(new THREE.SphereGeometry(0.36, 24, 16), shade);
    foot.scale.set(1, 0.5, 1.5);
    foot.position.set(side * 0.48, 0.15, 0.42);
    body.add(foot);
  }
  const tail = kit.mesh(new THREE.SphereGeometry(0.3, 20, 16), belly);
  tail.position.set(0, 0.75, -0.95);
  body.add(tail);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, side] of [
    [armL, -1],
    [armR, 1],
  ] as const) {
    arm.position.set(side * 0.78, 1.55, 0.25);
    const paw = kit.mesh(new THREE.CapsuleGeometry(0.17, 0.5, 8, 16), fur);
    paw.position.y = -0.38;
    arm.add(paw);
    arm.rotation.z = side * 0.25;
    body.add(arm);
  }
  const tablet = kit.tablet(body, 1.25, 1.05);

  const head = new THREE.Group();
  head.position.set(0, 2.1, 0.05);
  body.add(head);
  const skull = kit.mesh(new THREE.SphereGeometry(0.88, 40, 32), fur);
  skull.scale.set(1.08, 0.95, 0.95);
  skull.position.y = 0.5;
  head.add(skull);
  const muzzle = kit.mesh(new THREE.SphereGeometry(0.36, 24, 16), belly);
  muzzle.scale.set(1.25, 0.8, 0.8);
  muzzle.position.set(0, 0.3, 0.68);
  head.add(muzzle);

  const earL = new THREE.Group();
  const earR = new THREE.Group();
  for (const [ear, side] of [
    [earL, -1],
    [earR, 1],
  ] as const) {
    ear.position.set(side * 0.36, 1.2, -0.05);
    ear.rotation.z = -side * 0.12;
    const outer = kit.mesh(new THREE.CapsuleGeometry(0.19, 0.95, 8, 20), fur);
    outer.scale.set(1, 1, 0.65);
    outer.position.y = 0.62;
    const innerEar = kit.mesh(new THREE.CapsuleGeometry(0.11, 0.78, 8, 16), inner);
    innerEar.scale.set(1, 1, 0.4);
    innerEar.position.set(0, 0.62, 0.1);
    ear.add(outer, innerEar);
    head.add(ear);
  }

  const eyes = kit.eyes(head, 0.32, 0.62, 0.74);
  kit.glasses(head, 0.32, 0.62, 0.8);
  const cheeks = kit.cheeks(head, 0.58, 0.32, 0.72, 0.55);
  const noseMesh = kit.mesh(new THREE.SphereGeometry(0.075, 16, 12), nose);
  noseMesh.scale.set(1.3, 0.9, 0.9);
  noseMesh.position.set(0, 0.42, 0.95);
  head.add(noseMesh);
  const mouth = kit.mouth(head, 0.2, 0.92);

  return {
    body,
    head,
    headRestY: 2.1,
    sadHeadDrop: 0.1,
    earL,
    earR,
    earRestZ: 0.12,
    earSwing: 1,
    armL,
    armR,
    armRestZ: 0.25,
    eyes,
    eyeRestY: 0.62,
    mouth,
    cheeks,
    tablet,
    overhead: { x: 0.75, y: 1.95 },
    look: 0.35,
    breath: { x: 0.99, y: 1.025 },
    frame: { height: 5.1, width: 3.8 },
    pickables: kit.pickables,
    label: 'SOLAR AI AGENT sebagai kelinci 3D berkacamata',
  };
}
