import * as THREE from 'three';
import { Kit, seeded, type Rig } from '../rig';

/** Mochi: a soft pink daifuku dusted with rice flour, sakura leaves on top, round glasses and little nub arms. */
export function buildMochi(parent: THREE.Object3D): Rig {
  const kit = new Kit();
  const dough = kit.toon(0xffe1e8);
  const doughShade = kit.toon(0xf6c9d4);
  const leaf = kit.toon(0x7fb77e);
  const petal = kit.toon(0xff9fb8);

  const body = new THREE.Group();
  parent.add(body);

  // the round mochi is the head: it turns and nods as a whole, so the face stays on its surface
  const head = new THREE.Group();
  head.position.set(0, 1.12, 0);
  body.add(head);
  const radii = new THREE.Vector3(1.3, 1.1, 1.18);
  const blob = kit.mesh(new THREE.SphereGeometry(1, 48, 36), dough);
  blob.scale.copy(radii);
  head.add(blob);

  // rice-flour dusting on the upper half, away from the face
  const random = seeded(7);
  const dustMat = kit.basic(0xffffff, 0.85);
  for (let i = 0; i < 18; i++) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.35 + random() * 0.95;
    if (Math.abs(Math.atan2(Math.sin(azimuth), Math.cos(azimuth))) < 0.9 && elevation < 0.75) continue;
    const speck = new THREE.Mesh(new THREE.CircleGeometry(0.03 + random() * 0.025, 10), dustMat);
    head.add(kit.onSurface(speck, radii, azimuth, elevation, 0.004));
  }

  // sakura leaves = the "ears"
  const earL = new THREE.Group();
  const earR = new THREE.Group();
  for (const [ear, side] of [
    [earL, -1],
    [earR, 1],
  ] as const) {
    ear.position.set(side * 0.12, 1.02, -0.05);
    ear.rotation.z = -side * 0.55;
    const blade = kit.mesh(new THREE.SphereGeometry(1, 20, 14), leaf);
    blade.scale.set(0.14, 0.36, 0.05);
    blade.position.y = 0.3;
    const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.56, 6), kit.basic(0x5c9a5b));
    vein.position.set(0, 0.3, 0.045);
    ear.add(blade, vein);
    head.add(ear);
  }
  const flower = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), petal);
    p.scale.set(0.085, 0.03, 0.13);
    const a = (i / 5) * Math.PI * 2;
    p.position.set(Math.sin(a) * 0.1, 0, Math.cos(a) * 0.1);
    p.rotation.y = a;
    flower.add(p);
  }
  const centre = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), kit.toon(0xffd166));
  centre.position.y = 0.02;
  flower.add(centre);
  flower.position.set(0, 1.09, 0.14);
  flower.rotation.x = 0.25;
  head.add(flower);

  const eyes = kit.eyes(head, 0.38, 0.13, 1.1, 0.14);
  kit.glasses(head, 0.38, 0.13, 1.19, 0.22, 0.35);
  const cheeks = kit.cheeks(head, 0.7, -0.08, 1.0, 0.6, 0xff8fa8, 0.14);
  const mouth = kit.mouth(head, -0.13, 1.17);

  // nub arms and feet belong to the body, so they stay put while the mochi looks around
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, side] of [
    [armL, -1],
    [armR, 1],
  ] as const) {
    arm.position.set(side * 1.18, 1.0, 0.25);
    const nub = kit.mesh(new THREE.CapsuleGeometry(0.15, 0.26, 8, 16), dough);
    nub.position.y = -0.2;
    arm.add(nub);
    arm.rotation.z = side * 0.55;
    body.add(arm);
  }
  for (const side of [-1, 1]) {
    const foot = kit.mesh(new THREE.SphereGeometry(0.28, 20, 14), doughShade);
    foot.scale.set(1, 0.45, 1.3);
    foot.position.set(side * 0.5, 0.1, 0.55);
    body.add(foot);
  }
  const tablet = kit.tablet(body, 0.6, 1.45);

  return {
    body,
    head,
    headRestY: 1.12,
    sadHeadDrop: 0.06,
    earL,
    earR,
    earRestZ: 0.55,
    earSwing: 0.6,
    armL,
    armR,
    armRestZ: 0.55,
    eyes,
    eyeRestY: 0.13,
    mouth,
    cheeks,
    tablet,
    overhead: { x: 0.8, y: 1.55 },
    look: 0.3,
    breath: { x: 1.02, y: 0.975 },
    frame: { height: 3.7, width: 3.5 },
    pickables: kit.pickables,
    label: 'SOLAR AI AGENT sebagai Mochi, kue mochi merah muda berkacamata',
  };
}
