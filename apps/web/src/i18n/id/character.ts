/**
 * Characters: character/characters.ts, components/CharacterPicker.tsx, character/CharacterStage.tsx and
 * character/CharacterScene.ts (the accessible description of the 3D canvas).
 */
export const character = {
  /** One entry per character id of character/characters.ts. */
  characters: {
    robot: {
      name: 'Robo',
      description: 'Robot putih-biru dengan wajah layar bercahaya dan dua antena.',
      /** aria-label of the 3D canvas. */
      sceneLabel: 'SOLAR AI AGENT sebagai Robo, robot putih-biru dengan wajah layar bercahaya',
    },
    mochi: {
      name: 'Mochi',
      description: 'Kue mochi merah muda bertabur tepung, daun sakura di kepala.',
      sceneLabel: 'SOLAR AI AGENT sebagai Mochi, kue mochi merah muda berkacamata',
    },
    cocoa: {
      name: 'Cocoa Kelapa',
      description: 'Kelapa cokelat dengan sedotan dan payung kecil.',
      sceneLabel: 'SOLAR AI AGENT sebagai Cocoa Kelapa, buah kelapa cokelat berkacamata dengan sedotan',
    },
    rabbit: {
      name: 'Kelinci',
      description: 'Kelinci putih berkacamata, karakter klasik SOLAR.',
      sceneLabel: 'SOLAR AI AGENT sebagai kelinci 3D berkacamata',
    },
  },

  /** The character cards of Settings → Karakter (a radio group). */
  cardsLabel: 'Karakter',
  /** The character button on the stage and its menu. */
  switchTitle: 'Ganti karakter',
  menuLabel: 'Pilih karakter',
  /** The static picture shown when WebGL is unavailable (a button: clicking it starts voice input). */
  fallbackLabel: (name: string) => `SOLAR AI AGENT (${name})`,
};
