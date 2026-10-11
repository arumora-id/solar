import { plural } from '../helpers';
import type { Dict } from '../id';

export const app: Dict['app'] = {
  meta: {
    description:
      'SOLAR AI AGENT - an AI solution architect assistant with a selectable 3D character: ArchiMate, sequence diagrams and Technical Specification Documents.',
  },

  tokenGate: {
    title: 'Access token required',
    hint: 'This SOLAR server is protected by SOLAR_ACCESS_TOKEN. Enter the token to continue.',
    tokenLabel: 'Access token',
    submit: 'Sign in',
  },

  update: {
    available: 'A new version of SOLAR AI AGENT is available.',
  },

  topbar: {
    tagline: 'Solution Architect',
    navLabel: 'Main navigation',
    agent: 'Agent',
    monitor: 'Monitor',
    monitorWaiting: (n: number) => `Monitor (${n})`,
    monitorWaitingLabel: (n: number) => `Monitor, ${n} ${plural(n, 'approval')} waiting`,
    connected: 'Connected',
    disconnected: 'Disconnected',
    install: 'Install app',
    installTitle: 'Install SOLAR AI AGENT as an app',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    settings: 'Settings',
  },

  language: {
    label: 'Language / Bahasa',
    hint: 'Applies to the whole app right away and is saved on this device. The agent replies in the language of your request.',
  },

  settings: {
    title: 'Settings',
    tabs: {
      character: 'Character',
      models: 'AI models',
      knowledge: 'Knowledge',
      skills: 'Skills',
      plugins: 'MCP plugins',
      voice: 'Voice',
      system: 'System',
    },
    characterIntro:
      'Choose how SOLAR AI AGENT looks. Every character has the same animations: listening, thinking, working, speaking, asking, happy and sad. Your choice is saved on this device.',
  },

  status: {
    progress: 'Progress',
  },
};
