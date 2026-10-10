import type { Dict } from '../id';

export const api: Dict['api'] = {
  uploadDisconnected: 'The connection to the server was lost while uploading.',
  uploadCancelled: 'Upload cancelled.',
  httpError: (status: number, statusText: string) => `The request to the server failed (HTTP ${status}${statusText ? ` ${statusText}` : ''}).`,
};
