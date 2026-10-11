import OpenAI from 'openai';
import { DEFAULT_LANG, t, type Lang } from '../i18n.js';
import { LlmError } from './types.js';

/**
 * Maps an OpenAI SDK error (any OpenAI-compatible provider) to a friendly, provider-named LlmError, written in `lang`
 * (the task's language, or the request's for a provider test).
 */
export function toLlmError(err: unknown, providerName: string, model: string, envProvider: boolean, lang: Lang = DEFAULT_LANG): unknown {
  if (!(err instanceof OpenAI.APIError)) return err;
  const provider = providerName;
  if (err instanceof OpenAI.APIConnectionError) {
    const hint = t(lang, envProvider ? 'llm.connection.hintEnv' : 'llm.connection.hintUser');
    return new LlmError('connection', t(lang, 'llm.connection', { provider, hint, error: err.message }));
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return new LlmError('auth', t(lang, envProvider ? 'llm.auth.env' : 'llm.auth.user', { provider }));
  }
  if (err instanceof OpenAI.RateLimitError && err.code === 'insufficient_quota') {
    return new LlmError('quota', `${t(lang, 'llm.quota', { provider })}${envProvider ? t(lang, 'llm.quota.hintEnv') : ''}`);
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new LlmError('rate_limit', t(lang, 'llm.rateLimit', { provider }));
  }
  if (err instanceof OpenAI.NotFoundError) {
    const hint = t(lang, envProvider ? 'llm.notFound.hintEnv' : 'llm.notFound.hintUser');
    return new LlmError('not_found', t(lang, 'llm.notFound', { model, provider, hint, error: err.message }));
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new LlmError('permission', t(lang, 'llm.permission', { provider, error: err.message }));
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new LlmError('bad_request', t(lang, 'llm.badRequest', { provider, error: err.message }));
  }
  const error = err.message;
  return new LlmError('server', err.status ? t(lang, 'llm.serverWithStatus', { provider, status: err.status, error }) : t(lang, 'llm.server', { provider, error }));
}
