import type * as THREE from 'three';
import { readPref, writePref } from '../lib/session';
import { buildCocoa } from './models/cocoa';
import { buildMochi } from './models/mochi';
import { buildRabbit } from './models/rabbit';
import { buildRobot } from './models/robot';
import type { Rig } from './rig';

export type CharacterId = 'robot' | 'mochi' | 'cocoa' | 'rabbit';

/**
 * A selectable character. Its name, description and canvas label are texts of the interface language:
 * `t.character.characters[id]` (i18n/<lang>/character.ts).
 */
export interface CharacterInfo {
  id: CharacterId;
  build: (parent: THREE.Object3D) => Rig;
}

export const CHARACTERS: CharacterInfo[] = [
  { id: 'robot', build: buildRobot },
  { id: 'mochi', build: buildMochi },
  { id: 'cocoa', build: buildCocoa },
  { id: 'rabbit', build: buildRabbit },
];

export const DEFAULT_CHARACTER: CharacterId = 'robot';
/** Fired on window when the user picks another character. */
export const CHARACTER_EVENT = 'solar:character';

export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}

/** The choice for this page when storage is unavailable (blocked site data, full quota). */
let unsaved: CharacterId | null = null;

export function readCharacter(): CharacterId {
  const id = unsaved ?? readPref<string>('character', DEFAULT_CHARACTER);
  return CHARACTERS.some((c) => c.id === id) ? (id as CharacterId) : DEFAULT_CHARACTER;
}

export function saveCharacter(id: CharacterId): void {
  writePref('character', id);
  // storage stays the source of truth (and syncs other windows) whenever the write actually persisted
  unsaved = readPref<string | null>('character', null) === id ? null : id;
  window.dispatchEvent(new CustomEvent(CHARACTER_EVENT));
}
