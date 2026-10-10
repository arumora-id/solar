/** Errors raised by the client itself in lib/api.ts (the server's own error messages arrive already translated). */
export const api = {
  uploadDisconnected: 'Koneksi ke server terputus saat mengunggah.',
  uploadCancelled: 'Unggahan dibatalkan.',
  /** A failed request without a message from the server (e.g. the server is down behind a proxy). */
  httpError: (status: number, statusText: string) => `Permintaan ke server gagal (HTTP ${status}${statusText ? ` ${statusText}` : ''}).`,
};
