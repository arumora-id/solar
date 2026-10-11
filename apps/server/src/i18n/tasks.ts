import { count, plural, type Catalog } from './helpers.js';

/**
 * Task-scoped text: written in the language of the task (Task.language), because every open UI receives it through
 * the event stream. Covers the task manager, the agent loop and what the tools show in the UI (display names are
 * declared with each tool). What the tools return to the model stays English.
 */
export const TASK_MESSAGES = {
  // ---- task manager --------------------------------------------------------------------------------------
  'task.untitled': { id: 'Task tanpa judul', en: 'Untitled task' },
  'task.step.queued': { id: 'Menunggu antrean', en: 'Waiting in the queue' },
  'task.step.starting': { id: 'Memulai', en: 'Starting' },
  'task.step.completed': { id: 'Selesai', en: 'Done' },
  'task.step.cancelled': { id: 'Dibatalkan', en: 'Cancelled' },
  'task.step.failed': { id: 'Gagal', en: 'Failed' },
  'task.step.awaitingApproval': { id: 'Menunggu persetujuan: {tool}', en: 'Waiting for approval: {tool}' },
  'task.step.approved': { id: 'Disetujui, melanjutkan', en: 'Approved, continuing' },
  'task.step.declined': { id: 'Ditolak, melanjutkan', en: 'Rejected, continuing' },
  'task.status.created': { id: 'Task dibuat', en: 'Task created' },
  'task.status.started': { id: 'Agent mulai bekerja', en: 'The agent started working' },
  'task.cancelledByUser': { id: 'Dibatalkan oleh pengguna', en: 'Cancelled by the user' },
  'task.interrupted': {
    id: 'Task terhenti karena server SOLAR AI AGENT di-restart. Silakan kirim ulang permintaannya.',
    en: 'The task stopped because the SOLAR AI AGENT server was restarted. Please send the request again.',
  },
  'confirmation.note.serverRestarted': { id: 'Server di-restart', en: 'The server was restarted' },
  'confirmation.note.taskCancelled': { id: 'Task dibatalkan', en: 'Task cancelled' },
  'confirmation.note.taskFinished': { id: 'Task sudah selesai', en: 'The task has already finished' },
  'confirmation.note.timeout': { id: 'Tidak ada jawaban sampai batas waktu konfirmasi', en: 'No answer before the confirmation time limit' },

  // ---- agent loop ----------------------------------------------------------------------------------------
  'agent.noModel': {
    id: 'Tidak ada model AI yang bisa dipakai: aktifkan provider di Pengaturan → Model AI atau isi OPENAI_API_KEY di .env.',
    en: 'No AI model is available: enable a provider in Settings → AI models or set OPENAI_API_KEY in .env.',
  },
  'agent.step.reading': { id: 'Membaca permintaan', en: 'Reading the request' },
  'agent.step.planning': { id: 'Merencanakan', en: 'Planning' },
  'agent.step.thinking': { id: 'Berpikir', en: 'Thinking' },
  'agent.maxTurns': {
    id: 'Dihentikan setelah {max} giliran model (SOLAR_MAX_TURNS). Artefak yang sudah dibuat tetap tersimpan.',
    en: 'Stopped after {max} model turns (SOLAR_MAX_TURNS). The artifacts created so far are kept.',
  },
  'agent.fallback': {
    id: 'Model {from} gagal: {error} Beralih ke model cadangan {to}.',
    en: 'Model {from} failed: {error} Switching to the fallback model {to}.',
  },
  'agent.refusal': {
    id: 'Model menolak melanjutkan permintaan ini: "{refusal}". Ubah kalimat permintaan atau pecah menjadi bagian yang lebih kecil.',
    en: 'The model refused to continue this request: "{refusal}". Rephrase the request or split it into smaller parts.',
  },
  'agent.contentFilter': {
    id: 'Jawaban dihentikan oleh filter konten {provider}. Ubah kalimat permintaan atau pecah menjadi bagian yang lebih kecil.',
    en: 'The answer was stopped by the {provider} content filter. Rephrase the request or split it into smaller parts.',
  },
  'agent.truncatedRetry': {
    id: 'Output model terpotong ({reason}); giliran diulang dengan max_output_tokens={max}.',
    en: 'The model output was cut off ({reason}); the turn is retried with max_output_tokens={max}.',
  },
  'agent.truncatedAnswer': { id: '_(jawaban terpotong: batas output tercapai)_', en: '_(answer cut off: output limit reached)_' },
  'agent.truncatedError': {
    id: 'Output model terpotong walau sudah ukuran maksimum (max_output_tokens). Pecah permintaan menjadi bagian yang lebih kecil.',
    en: 'The model output was cut off even at the maximum size (max_output_tokens). Split the request into smaller parts.',
  },
  'agent.done': { id: 'Selesai.', en: 'Done.' },

  // ---- tool call results in the timeline (ToolOutput.summary) -------------------------------------------------
  'tool.unknown': { id: 'tool tidak dikenal', en: 'unknown tool' },
  'tool.invalidJson': { id: 'JSON tidak valid', en: 'invalid JSON' },
  'tool.invalidInput': { id: 'input tidak valid', en: 'invalid input' },
  'tool.declined': { id: 'ditolak pengguna', en: 'rejected by the user' },
  'tool.failed': { id: 'gagal: {message}', en: 'error: {message}' },
  'tool.notFound': { id: 'tidak ditemukan', en: 'not found' },
  'tool.validationErrors': { id: '{n} kesalahan validasi', en: (p: { n: number }) => `${count(p.n, 'validation error')}` },
  'tool.skillNotFound': { id: 'skill tidak ditemukan', en: 'skill not found' },
  'tool.fileNotFound': { id: 'file tidak ditemukan', en: 'file not found' },
  'tool.pairs': { id: '{n} pasangan', en: (p: { n: number }) => count(p.n, 'pair') },
  'tool.artifacts': { id: '{n} artefak', en: (p: { n: number }) => count(p.n, 'artifact') },
  'tool.binaryFile': { id: 'file biner', en: 'binary file' },
  'tool.fileSize': { id: '{name} ({size} byte)', en: '{name} ({size} bytes)' },
  'tool.github.noRepository': { id: 'repository belum ditentukan', en: 'no repository' },
  'tool.github.artifactNotFound': { id: 'artefak tidak ditemukan', en: 'artifact not found' },
  'tool.github.duplicateName': { id: 'nama file ganda', en: 'duplicate file name' },
  'tool.github.committed': {
    id: '{n} file -> {target}',
    en: (p: { n: number; target: string }) => `${count(p.n, 'file')} -> ${p.target}`,
  },
  'tool.plane.projects': { id: '{n} project', en: (p: { n: number }) => count(p.n, 'project') },
  'tool.plane.noProject': { id: 'project belum ditentukan', en: 'no project' },
  'tool.plane.partial': {
    id: 'sebagian: {created} dibuat, {remaining} tidak dibuat ({error})',
    en: 'partial: {created} created, {remaining} not created ({error})',
  },
  'tool.plane.done': { id: '{created} dibuat, {skipped} dilewati di {project}', en: '{created} created, {skipped} skipped in {project}' },
  'tool.documents': { id: '{n} dokumen', en: (p: { n: number }) => count(p.n, 'document') },
  'tool.documents.offsetPastEnd': { id: 'offset melewati akhir dokumen', en: 'offset past the end' },
  'tool.documents.budgetUsed': { id: 'jatah baca task habis', en: 'read budget used up' },
  'tool.documents.matches': {
    id: (p: { shown: number; total: number | null; query: string; documents: number }) =>
      `${p.shown}${p.total !== null ? ` dari ${p.total}+` : ''} hasil untuk "${p.query}" di ${p.documents} dokumen`,
    en: (p: { shown: number; total: number | null; query: string; documents: number }) =>
      `${p.shown}${p.total !== null ? ` of ${p.total}+` : ''} ${plural(p.total ?? p.shown, 'match', 'matches')} for "${p.query}" in ${count(p.documents, 'document')}`,
  },
  'tool.knowledge.files': { id: '{n} file', en: (p: { n: number }) => count(p.n, 'file') },
  'tool.knowledge.results': {
    id: '{n} hasil untuk "{query}"',
    en: (p: { n: number; query: string }) => `${count(p.n, 'result')} for "${p.query}"`,
  },
  'tool.knowledge.invalidPath': { id: 'path tidak valid', en: 'invalid path' },
  'tool.knowledge.notWritten': { id: 'tidak ditulis', en: 'not written' },
  'tool.knowledge.saved': { id: 'disimpan: {path}', en: 'saved: {path}' },
  'tool.knowledge.replaced': { id: 'diganti: {path}', en: 'replaced: {path}' },
  'tool.knowledge.exists': { id: 'sudah ada', en: 'already exists' },
  'tool.knowledge.refused': { id: 'ditolak', en: 'refused' },
  'tool.knowledge.failed': { id: 'gagal', en: 'failed' },

  // ---- approval reasons (Confirmation.reason) and previews ---------------------------------------------------
  'confirm.github': {
    id: 'Commit {n} file ke {target}',
    en: (p: { n: number; target: string }) => `Commit ${count(p.n, 'file')} to ${p.target}`,
  },
  'confirm.plane': {
    id: 'Membuat {n} work item di project Plane {project}',
    en: (p: { n: number; project: string }) => `Create ${count(p.n, 'work item')} in the Plane project ${p.project}`,
  },
  'confirm.knowledge.save': {
    id: 'Menyimpan {what} ke knowledge base: {path}{replaces}. Isi knowledge base diikuti agent di atas aturan bawaan pada task berikutnya.',
    en: 'Save {what} to the knowledge base: {path}{replaces}. From the next task on, the agent follows the knowledge base over its built-in rules.',
  },
  'confirm.knowledge.replacesBuiltin': { id: ' - MENGGANTI file bawaan "{title}" ({path})', en: ' - REPLACES the built-in file "{title}" ({path})' },
  'confirm.knowledge.replacesExisting': {
    id: ' - MENGGANTI file yang sudah ada "{title}" ({path})',
    en: ' - REPLACES the existing file "{title}" ({path})',
  },
  'confirm.knowledge.artifact': { id: 'artefak {name}', en: 'artifact {name}' },
  'confirm.knowledge.artifactPreview': { id: 'Artefak {name} ({id}, task {task}, {created}):', en: 'Artifact {name} ({id}, task {task}, {created}):' },
  'confirm.mcp.always': { id: '{plugin} mewajibkan persetujuan Anda untuk setiap pemanggilan', en: '{plugin} requires your approval for every call' },
  'confirm.mcp.write': { id: '{tool} dapat mengubah data di {plugin}', en: '{tool} can change data in {plugin}' },

  // ---- artifact titles and descriptions (shown in the artifact list) -------------------------------------------
  'artifact.archimate.view': { id: '{name} (view ArchiMate)', en: '{name} (ArchiMate view)' },
  'artifact.archimate.source': { id: '{name} (sumber model)', en: '{name} (model source)' },
  'artifact.source': { id: '{name} (sumber)', en: '{name} (source)' },
  'artifact.html': { id: '{name} (HTML, siap cetak)', en: '{name} (HTML, print-ready)' },
  'artifact.archimate.summary': {
    id: '{elements} elemen, {relationships} relasi, {views} view',
    en: (p: { elements: number; relationships: number; views: number }) =>
      `${count(p.elements, 'element')}, ${count(p.relationships, 'relationship')}, ${count(p.views, 'view')}`,
  },
  'artifact.archimate.viewSummary': {
    id: '{elements} elemen, {relationships} relasi',
    en: (p: { elements: number; relationships: number }) => `${count(p.elements, 'element')}, ${count(p.relationships, 'relationship')}`,
  },
  'artifact.sequence.summary': {
    id: '{participants} partisipan, {messages} pesan',
    en: (p: { participants: number; messages: number }) => `${count(p.participants, 'participant')}, ${count(p.messages, 'message')}`,
  },
  'artifact.tsd.summary': {
    id: '{functional} kebutuhan fungsional / {nonFunctional} non-fungsional',
    en: '{functional} functional / {nonFunctional} non-functional requirements',
  },
  'artifact.tsd.docx': {
    id: 'Dokumen Word untuk serah terima: {sections} bab, {figures} diagram',
    en: (p: { sections: number; figures: number }) => `Word delivery document: ${count(p.sections, 'section')}, ${count(p.figures, 'diagram')}`,
  },
} as const satisfies Catalog;
