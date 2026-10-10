import type { TaskStatus } from '@solar/shared';
import { numId } from '../helpers';

/**
 * Monitor page (pages/MonitorPage.tsx) and the task status / duration texts of lib/format.ts, which the Agent page
 * uses too.
 */
export const monitor = {
  /** Task status names (StatusBadge, timeline); lib/format.ts statusLabel() reads them. */
  status: {
    queued: 'Antre',
    running: 'Berjalan',
    awaiting_confirmation: 'Menunggu konfirmasi',
    completed: 'Selesai',
    failed: 'Gagal',
    cancelled: 'Dibatalkan',
  } satisfies Record<TaskStatus, string>,

  /** Durations of lib/format.ts formatDuration(). */
  duration: {
    seconds: (s: number) => `${s} dtk`,
    minutes: (m: number, s: number) => `${m} mnt ${s} dtk`,
    hours: (h: number, m: number) => `${h} jam ${m} mnt`,
  },

  title: 'Monitor Task',
  intro: 'Pembaruan realtime dari SOLAR AI AGENT - progres, langkah kerja, persetujuan, biaya dan artefak.',

  /** The summary tiles above the task list. */
  kpi: {
    label: 'Ringkasan',
    total: 'Total task',
    running: 'Sedang berjalan',
    /** Under "Sedang berjalan": how many of them still wait in the queue. */
    queued: (n: number) => `${numId(n)} antre`,
    awaiting: 'Menunggu konfirmasi',
    completed: 'Selesai',
    failedOrCancelled: 'Gagal / batal',
    /** Under "Gagal / batal": how many of them were cancelled. */
    cancelled: (n: number) => `${numId(n)} dibatalkan`,
    cost: 'Estimasi biaya API',
  },

  /** Status filter buttons (keys are the filters of MonitorPage). */
  filters: {
    label: 'Filter status',
    all: 'Semua',
    active: 'Aktif',
    awaiting_confirmation: 'Menunggu',
    completed: 'Selesai',
    failed: 'Gagal',
  },

  search: {
    placeholder: 'Cari task…',
    label: 'Cari task',
  },

  list: {
    label: 'Daftar task',
    heading: (n: number) => `Task (${numId(n)})`,
    empty: 'Belum ada task untuk filter ini.',
    columns: {
      task: 'Task',
      started: 'Mulai',
    },
    /** Accessible name of a row's progress meter. */
    progressOf: (title: string) => `Progres ${title}`,
  },

  detail: {
    label: 'Detail task',
    empty: 'Pilih task untuk melihat detail, langkah kerja dan artefaknya.',
    cancel: 'Batalkan',
    step: (step: string) => `Langkah: ${step}`,
    duration: (duration: string) => `Durasi: ${duration}`,
    model: (model: string) => `Model: ${model}`,
    apiCalls: (n: string) => `API call: ${n}`,
    /** Token counts, already formatted ("1,2 rb"). */
    tokens: (input: string, output: string, cache: string) => `Token: ${input} in · ${output} out · ${cache} cache`,
    cost: (cost: string) => `Biaya: ${cost}`,
    request: 'Permintaan',
    attachments: (n: number) => `Dokumen terlampir (${numId(n)})`,
    result: 'Hasil',
    artifacts: (n: number) => `Artefak (${numId(n)})`,
    timeline: (n: number) => `Timeline (${numId(n)} event)`,
  },

  /** Titles of the timeline entries (task events). */
  timeline: {
    status: (status: string) => `Status: ${status}`,
    progress: (percent: number, step: string) => `Progres ${percent}% · ${step}`,
    thinking: 'Penalaran (ringkasan)',
    agentNote: 'Catatan agent',
    /** A finished tool call: the tool name and its duration in seconds (already formatted, "1,5"). */
    toolResult: (tool: string, seconds: string) => `${tool} · ${seconds} dtk`,
    confirmationRequested: (action: string) => `Minta persetujuan: ${action}`,
    approved: 'Disetujui pengguna',
    rejected: 'Ditolak pengguna',
    artifact: (name: string) => `Artefak: ${name}`,
    error: 'Error',
    result: 'Jawaban akhir dikirim',
    /** Toggle that shows the input of a tool call or confirmation. */
    input: 'Input',
  },
};
