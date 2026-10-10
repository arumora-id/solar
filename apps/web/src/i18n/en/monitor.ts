import { numEn, plural } from '../helpers';
import type { Dict } from '../id';

export const monitor: Dict['monitor'] = {
  status: {
    queued: 'Queued',
    running: 'Running',
    awaiting_confirmation: 'Awaiting confirmation',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },

  duration: {
    seconds: (s: number) => `${s} s`,
    minutes: (m: number, s: number) => `${m} min ${s} s`,
    hours: (h: number, m: number) => `${h} h ${m} min`,
  },

  title: 'Task Monitor',
  intro: 'Real-time updates from SOLAR AI AGENT: progress, work steps, approvals, cost and artifacts.',

  kpi: {
    label: 'Summary',
    total: 'Total tasks',
    running: 'Running',
    queued: (n: number) => `${numEn(n)} queued`,
    awaiting: 'Awaiting confirmation',
    completed: 'Completed',
    failedOrCancelled: 'Failed / cancelled',
    cancelled: (n: number) => `${numEn(n)} cancelled`,
    cost: 'Estimated API cost',
  },

  filters: {
    label: 'Status filter',
    all: 'All',
    active: 'Active',
    awaiting_confirmation: 'Waiting',
    completed: 'Completed',
    failed: 'Failed',
  },

  search: {
    placeholder: 'Search tasks…',
    label: 'Search tasks',
  },

  list: {
    label: 'Task list',
    heading: (n: number) => `Tasks (${numEn(n)})`,
    empty: 'No tasks match this filter yet.',
    columns: {
      task: 'Task',
      started: 'Started',
    },
    progressOf: (title: string) => `Progress of ${title}`,
  },

  detail: {
    label: 'Task details',
    empty: 'Select a task to see its details, work steps and artifacts.',
    cancel: 'Cancel',
    step: (step: string) => `Step: ${step}`,
    duration: (duration: string) => `Duration: ${duration}`,
    model: (model: string) => `Model: ${model}`,
    apiCalls: (n: string) => `API calls: ${n}`,
    tokens: (input: string, output: string, cache: string) => `Tokens: ${input} in · ${output} out · ${cache} cached`,
    cost: (cost: string) => `Cost: ${cost}`,
    request: 'Request',
    attachments: (n: number) => `Attached documents (${numEn(n)})`,
    result: 'Result',
    artifacts: (n: number) => `Artifacts (${numEn(n)})`,
    timeline: (n: number) => `Timeline (${numEn(n)} ${plural(n, 'event')})`,
  },

  timeline: {
    status: (status: string) => `Status: ${status}`,
    progress: (percent: number, step: string) => `Progress ${percent}% · ${step}`,
    thinking: 'Reasoning (summary)',
    agentNote: 'Agent note',
    toolResult: (tool: string, seconds: string) => `${tool} · ${seconds} s`,
    confirmationRequested: (action: string) => `Approval requested: ${action}`,
    approved: 'Approved by the user',
    rejected: 'Rejected by the user',
    artifact: (name: string) => `Artifact: ${name}`,
    error: 'Error',
    result: 'Final answer sent',
    input: 'Input',
  },
};
