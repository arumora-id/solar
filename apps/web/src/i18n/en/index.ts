import type { Dict } from '../id';
import { agent } from './agent';
import { api } from './api';
import { app } from './app';
import { artifacts } from './artifacts';
import { character } from './character';
import { common } from './common';
import { monitor } from './monitor';
import { settings } from './settings';
import { voice } from './voice';

/** English. Typed with the Indonesian shape: a missing or extra key is a compile error (in the namespace file). */
export const en: Dict = { common, app, agent, character, monitor, artifacts, settings, voice, api };
