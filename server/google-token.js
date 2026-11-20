// Only fixed application codes escape this module; never provider bodies or credentials.
export class GoogleTokenError extends Error {
  constructor(code) { super('Google token exchange failed.'); this.code = code; }
}
export async function exchangeGoogleCode(fetcher, parameters) {
  const signal = AbortSignal.timeout(10000);
  let response;
  try {
    // Invoke as a function, not as services.fetch (a foreign receiver in Workers).
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(parameters), signal
    });
  } catch (error) {
    throw new GoogleTokenError(signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'google_token_timeout' : 'google_token_network_failed');
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleTokenError('google_token_unavailable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleTokenError('google_token_invalid_response');
  }
  let tokens;
  try { tokens = await response.json(); }
  catch (error) {
    throw new GoogleTokenError(signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'google_token_timeout' : 'google_token_invalid_response');
  }
  if (!response.ok || tokens?.error) {
    const codes = {
      invalid_client: 'google_client_rejected', invalid_grant: 'google_code_rejected',
      invalid_request: 'google_token_request_rejected', unauthorized_client: 'google_client_rejected',
      unsupported_grant_type: 'google_token_request_rejected'
    };
    const code = typeof tokens?.error === 'string' && Object.hasOwn(codes, tokens.error)
      ? codes[tokens.error] : 'google_token_request_rejected';
    throw new GoogleTokenError(code);
  }
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token.trim()) {
    throw new GoogleTokenError('google_token_invalid_response');
  }
  return tokens.access_token;
}
