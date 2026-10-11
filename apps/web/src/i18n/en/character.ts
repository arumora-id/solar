import type { Dict } from '../id';

export const character: Dict['character'] = {
  characters: {
    robot: {
      name: 'Robo',
      description: 'A white-and-blue robot with a glowing screen face and two antennas.',
      sceneLabel: 'SOLAR AI AGENT as Robo, a white-and-blue robot with a glowing screen face',
    },
    mochi: {
      name: 'Mochi',
      description: 'A pink mochi cake dusted with flour, with a sakura leaf on its head.',
      sceneLabel: 'SOLAR AI AGENT as Mochi, a pink mochi cake wearing glasses',
    },
    cocoa: {
      name: 'Cocoa Kelapa',
      description: 'A cocoa-brown coconut with a straw and a little umbrella.',
      sceneLabel: 'SOLAR AI AGENT as Cocoa Kelapa, a brown coconut with glasses and a straw',
    },
    rabbit: {
      name: 'Rabbit',
      description: "A white rabbit with glasses, SOLAR's classic character.",
      sceneLabel: 'SOLAR AI AGENT as a 3D rabbit wearing glasses',
    },
  },

  cardsLabel: 'Character',
  switchTitle: 'Change character',
  menuLabel: 'Choose a character',
  fallbackLabel: (name: string) => `SOLAR AI AGENT (${name})`,
};
