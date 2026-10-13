import type { Dict } from '../id';
import { activity } from './activity';
import { agent } from './agent';
import { api } from './api';
import { app } from './app';
import { artifacts } from './artifacts';
import { auth } from './auth';
import { character } from './character';
import { common } from './common';
import { monitor } from './monitor';
import { settings } from './settings';
import { users } from './users';
import { voice } from './voice';

/** English. Typed with the Indonesian shape: a missing or extra key is a compile error (in the namespace file). */
export const en: Dict = { common, app, auth, agent, character, monitor, artifacts, settings, users, activity, voice, api };
