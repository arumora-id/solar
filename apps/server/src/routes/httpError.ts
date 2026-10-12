/**
 * An error answered as `{ error, code? }` with an HTTP status. `message` is already in the language of the request;
 * `code` is a stable machine-readable reason for clients (e.g. `account_pending`), `headers` are sent with the answer
 * (e.g. `Retry-After`).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}
