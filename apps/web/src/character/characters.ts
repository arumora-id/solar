import type * as THREE from 'three';
import { readPref, writePref } from '../lib/session';
import { buildCocoa } from './models/cocoa';
import { buildMochi } from './models/mochi';
import { buildRabbit } from './models/rabbit';
import type { Rig } from './rig';

export type CharacterId = 'mochi' | 'cocoa' | 'rabbit';

export interface CharacterInfo {
  id: CharacterId;
  name: string;
  description: string;
  build: (parent: THREE.Object3D) => Rig;
}

export const CHARACTERS: CharacterInfo[] = [
  { id: 'mochi', name: 'Mochi', description: 'Kue mochi merah muda bertabur tepung, daun sakura di kepala.', build: buildMochi },
  { id: 'cocoa', name: 'Cocoa Kelapa', description: 'Kelapa cokelat dengan sedotan dan payung kecil.', build: buildCocoa },
  { id: 'rabbit', name: 'Kelinci', description: 'Kelinci putih berkacamata, karakter klasik SOLAR.', build: buildRabbit },
];

export const DEFAULT_CHARACTER: CharacterId = 'mochi';
/** Fired on window when the user picks another character. */
export const CHARACTER_EVENT = 'solar:character';

export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}

export function readCharacter(): CharacterId {
  const id = readPref<string>('character', DEFAULT_CHARACTER);
  return CHARACTERS.some((c) => c.id === id) ? (id as CharacterId) : DEFAULT_CHARACTER;
}

export function saveCharacter(id: CharacterId): void {
  writePref('character', id);
  window.dispatchEvent(new CustomEvent(CHARACTER_EVENT));
}
