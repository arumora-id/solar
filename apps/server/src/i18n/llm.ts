import type { Catalog } from './helpers.js';

/**
 * Model providers and MCP plugins: errors of a model call (in the task's language), route warnings, the provider test
 * of Settings → AI models (in the request's language) and the connection status of MCP plugins.
 */
export const LLM_MESSAGES = {
  // ---- model call errors (llm/errors.ts and the clients) ---------------------------------------------------------
  'llm.connection': { id: 'Tidak dapat terhubung ke {provider} ({hint}): {error}', en: 'Cannot connect to {provider} ({hint}): {error}' },
  'llm.connection.hintEnv': { id: 'cek koneksi internet / proxy / OPENAI_BASE_URL', en: 'check the internet connection / proxy / OPENAI_BASE_URL' },
  'llm.connection.hintUser': {
    id: 'cek koneksi internet / proxy / base URL provider di Pengaturan → Model AI',
    en: "check the internet connection / proxy / the provider's base URL in Settings → AI models",
  },
  'llm.auth.env': {
    id: 'Autentikasi {provider} gagal: isi OPENAI_API_KEY yang valid di .env lalu restart SOLAR AI AGENT.',
    en: '{provider} authentication failed: set a valid OPENAI_API_KEY in .env and restart SOLAR AI AGENT.',
  },
  'llm.auth.user': {
    id: 'Autentikasi {provider} gagal: periksa API key provider ini di Pengaturan → Model AI.',
    en: "{provider} authentication failed: check this provider's API key in Settings → AI models.",
  },
  'llm.quota': { id: 'Saldo/kuota API {provider} habis (insufficient_quota).', en: 'The {provider} API balance/quota is used up (insufficient_quota).' },
  'llm.quota.hintEnv': {
    id: ' Tambahkan kredit di platform.openai.com → Billing. Catatan: langganan ChatGPT Plus/Pro tidak termasuk kredit API.',
    en: ' Add credit at platform.openai.com → Billing. Note: a ChatGPT Plus/Pro subscription does not include API credit.',
  },
  'llm.rateLimit': {
    id: 'Batas rate {provider} tercapai setelah percobaan ulang otomatis. Tunggu sebentar lalu kirim ulang task.',
    en: 'The {provider} rate limit was reached after automatic retries. Wait a moment, then send the task again.',
  },
  'llm.notFound': {
    id: 'Model "{model}" tidak ditemukan di {provider} atau belum tersedia untuk API key ini. {hint} ({error})',
    en: 'Model "{model}" was not found at {provider} or is not available for this API key yet. {hint} ({error})',
  },
  'llm.notFound.hintEnv': { id: 'Ganti SOLAR_MODEL di .env.', en: 'Change SOLAR_MODEL in .env.' },
  'llm.notFound.hintUser': { id: 'Periksa id model di Pengaturan → Model AI.', en: 'Check the model id in Settings → AI models.' },
  'llm.permission': { id: 'Akses {provider} ditolak untuk model/proyek ini: {error}', en: '{provider} denied access to this model/project: {error}' },
  'llm.badRequest': { id: 'Permintaan ditolak oleh {provider}: {error}', en: '{provider} rejected the request: {error}' },
  'llm.server': { id: 'API {provider} mengembalikan kesalahan: {error}', en: '{provider} API error: {error}' },
  'llm.serverWithStatus': {
    id: 'API {provider} mengembalikan kesalahan {status}: {error}',
    en: '{provider} API error {status}: {error}',
  },
  'llm.failed': { id: '{provider} gagal memproses permintaan: {error}', en: '{provider} could not process the request: {error}' },
  'llm.cut': {
    id: 'Koneksi ke {provider} terputus sebelum respons selesai. Kirim ulang task.',
    en: 'The connection to {provider} was lost before the response was complete. Send the task again.',
  },
  'llm.cutWithStatus': {
    id: 'Koneksi ke {provider} terputus sebelum respons selesai (status {status}). Kirim ulang task.',
    en: 'The connection to {provider} was lost before the response was complete (status {status}). Send the task again.',
  },

  // ---- model routes and provider test (llm/router.ts) ---------------------------------------------------------------
  'llm.route.providerMissing': {
    id: 'Provider "{provider}" untuk {entry} tidak ditemukan; dilewati.',
    en: 'Provider "{provider}" for {entry} was not found; skipped.',
  },
  'llm.route.providerDisabled': { id: 'Provider "{provider}" nonaktif; {entry} dilewati.', en: 'Provider "{provider}" is disabled; {entry} skipped.' },
  'llm.route.missingVars': { id: 'Provider "{provider}": variabel {vars} belum diisi.', en: 'Provider "{provider}": the variables {vars} are not set.' },
  'llm.route.envKeyMissing': {
    id: 'OPENAI_API_KEY belum diisi: isi API key OpenAI di .env (lihat README) lalu restart SOLAR AI AGENT.',
    en: 'OPENAI_API_KEY is not set: put your OpenAI API key in .env (see the README) and restart SOLAR AI AGENT.',
  },
  'llm.route.noKeyOrUrl': {
    id: 'Provider "{provider}" belum punya API key atau base URL (Pengaturan → Model AI).',
    en: 'Provider "{provider}" has no API key or base URL yet (Settings → AI models).',
  },
  'llm.test.notFound': { id: 'Provider "{provider}" tidak ditemukan', en: 'Provider "{provider}" not found' },
  'llm.test.envKeyMissing': { id: 'OPENAI_API_KEY belum diisi di .env', en: 'OPENAI_API_KEY is not set in .env' },

  // ---- MCP plugins (status shown in Settings → MCP plugins) ------------------------------------------------------------
  'mcp.missingVars': {
    id: 'Isi {vars} di file .env (atau edit plugin) untuk mengaktifkan.',
    en: 'Set {vars} in the .env file (or edit the plugin) to enable it.',
  },
  'mcp.invalidUrl': {
    id: 'URL tidak valid: "{url}" (harus diawali http:// atau https://)',
    en: 'Invalid URL: "{url}" (it must start with http:// or https://)',
  },
  'mcp.disconnected': { id: 'Koneksi terputus', en: 'Connection lost' },
  'mcp.connectFailed': { id: 'Tidak dapat terhubung ke {plugin}: {error}', en: 'Cannot connect to {plugin}: {error}' },
  'mcp.connectTimeout': {
    id: 'Tidak ada jawaban dari {plugin} dalam {seconds} detik saat menghubungkan',
    en: 'Connecting to {plugin} timed out after {seconds} s',
  },
  'mcp.listToolsTimeout': {
    id: 'Daftar tool dari {plugin} tidak datang dalam {seconds} detik',
    en: 'Listing the tools of {plugin} timed out after {seconds} s',
  },
  'mcp.notConnected': { id: 'Plugin "{plugin}" tidak terhubung', en: 'Plugin "{plugin}" is not connected' },
} as const satisfies Catalog;
