import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const activity: Dict['activity'] = {
  introAll: "Every user's audit trail: who did what and when. Newest first.",
  introOwn: 'What your account did: logins, tasks, approvals and changes to the knowledge base and skills. Newest first.',

  filters: {
    label: 'Activity filters',
    search: 'Search names, targets or details…',
    searchLabel: 'Search the activity',
    actor: 'Actor',
    anyActor: 'All actors',
    me: 'Me',
    action: 'Action',
    anyAction: 'All actions',
    wholeGroup: (group: string) => `All: ${group}`,
    outcome: 'Outcome',
    from: 'From',
    to: 'To',
    reset: 'Reset filters',
  },

  groups: {
    auth: 'Login & own account',
    user: 'User administration',
    task: 'Tasks',
    confirmation: 'Approvals',
    knowledge: 'Knowledge base',
    skill: 'Skills',
    'settings.llm': 'AI models',
    'settings.plugin': 'MCP plugins',
    artifact: 'Artifacts',
    activity: 'Activity log',
  },

  outcome: {
    success: 'Succeeded',
    failure: 'Failed',
  },

  actorKind: {
    token: 'Access token (script)',
    anonymous: 'Not logged in',
    system: 'SOLAR system',
  },

  today: 'Today',
  yesterday: 'Yesterday',

  details: 'Details',
  target: 'Target',
  ip: 'IP address',
  userAgent: 'Device / browser',
  data: 'Data',

  loadMore: 'Load more',
  loading: 'Loading activity…',
  scanned: 'Part of the log has been searched. Load more to look further back.',
  end: 'You have reached the oldest entry.',
  empty: 'No activity matches these filters.',
  emptyNoFilter: 'No activity recorded yet.',
  shown: (n: number) => `${numEn(n)} ${plural(n, 'entry', 'entries')} shown`,

  export: 'Export CSV',
  exportTitle: 'Download these filtered entries as CSV (up to 100,000 rows)',
};
