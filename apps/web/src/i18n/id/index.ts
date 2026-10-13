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

/** Indonesian, the source dictionary: its shape is the type every other language must match. */
export const id = { common, app, auth, agent, character, monitor, artifacts, settings, users, activity, voice, api };

/** The shape of a dictionary. Leaves are strings, or functions returning a string for texts with parameters. */
export type Dict = typeof id;
