import OpenAI from 'openai';
import { LlmError } from './types.js';

/** Maps an OpenAI SDK error (any OpenAI-compatible provider) to a friendly, provider-named LlmError. */
export function toLlmError(err: unknown, providerName: string, model: string, envProvider: boolean): unknown {
  if (!(err instanceof OpenAI.APIError)) return err;
  const p = providerName;
  if (err instanceof OpenAI.APIConnectionError) {
    const hint = envProvider ? 'cek koneksi internet / proxy / OPENAI_BASE_URL' : 'cek koneksi internet / proxy / base URL provider di Pengaturan → Model AI';
    return new LlmError('connection', `Tidak dapat terhubung ke ${p} (${hint}): ${err.message}`);
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return new LlmError(
      'auth',
      envProvider
        ? `Autentikasi ${p} gagal: isi OPENAI_API_KEY yang valid di .env lalu restart SOLAR AI AGENT.`
        : `Autentikasi ${p} gagal: periksa API key provider ini di Pengaturan → Model AI.`,
    );
  }
  if (err instanceof OpenAI.RateLimitError && err.code === 'insufficient_quota') {
    return new LlmError(
      'quota',
      `Saldo/kuota API ${p} habis (insufficient_quota).${envProvider ? ' Tambahkan kredit di platform.openai.com → Billing. Catatan: langganan ChatGPT Plus/Pro tidak termasuk kredit API.' : ''}`,
    );
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new LlmError('rate_limit', `Batas rate ${p} tercapai setelah percobaan ulang otomatis. Tunggu sebentar lalu kirim ulang task.`);
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new LlmError(
      'not_found',
      `Model "${model}" tidak ditemukan di ${p} atau belum tersedia untuk API key ini. ${envProvider ? 'Ganti SOLAR_MODEL di .env.' : 'Periksa id model di Pengaturan → Model AI.'} (${err.message})`,
    );
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new LlmError('permission', `Akses ${p} ditolak untuk model/proyek ini: ${err.message}`);
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new LlmError('bad_request', `Permintaan ditolak oleh ${p}: ${err.message}`);
  }
  return new LlmError('server', `${p} API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
}
