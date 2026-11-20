import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeGoogleCode } from '../server/google-token.js';

const parameters = { client_id: 'synthetic', client_secret: 'synthetic-secret', code: 'synthetic-code',
  redirect_uri: 'https://kanba.test/api/auth/google/callback', grant_type: 'authorization_code' };
test('token exchange sends exact form parameters without foreign receiver or redirects', async () => {
  const token = await exchangeGoogleCode(function (url, options) {
    assert.equal(this, undefined);
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(options.headers.Accept, 'application/json');
    assert.deepEqual(Object.fromEntries(options.body), parameters);
    assert(options.signal instanceof AbortSignal);
    return Response.json({ access_token: 'synthetic-access' });
  }, parameters);
  assert.equal(token, 'synthetic-access');
});
test('token exchange classifies errors without exposing provider data or retrying', async () => {
  for (const [fetcher, code] of [
    [() => { throw new TypeError('SENSITIVE'); }, 'google_token_network_failed'],
    [() => { throw new DOMException('SENSITIVE', 'TimeoutError'); }, 'google_token_timeout'],
    [() => ({ status: 200, ok: true, json: async () => { throw new DOMException('SENSITIVE', 'AbortError'); } }), 'google_token_timeout'],
    [() => new Response('SENSITIVE', { status: 503 }), 'google_token_unavailable'],
    [() => new Response('SENSITIVE', { status: 429 }), 'google_token_unavailable'],
    [() => new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } }), 'google_token_invalid_response'],
    [() => new Response('SENSITIVE'), 'google_token_invalid_response'],
    [() => Response.json({}), 'google_token_invalid_response'],
    [() => Response.json({ error: 'invalid_client', error_description: 'SENSITIVE' }, { status: 401 }), 'google_client_rejected'],
    [() => Response.json({ error: 'invalid_grant' }, { status: 400 }), 'google_code_rejected'],
    [() => Response.json({ error: 'invalid_request' }, { status: 400 }), 'google_token_request_rejected'],
    [() => Response.json({ error: 'SENSITIVE' }, { status: 400 }), 'google_token_request_rejected']
  ]) {
    let calls = 0;
    await assert.rejects(exchangeGoogleCode((...args) => { calls++; return fetcher(...args); }, parameters), error => {
      assert.equal(error.code, code);
      assert(!error.message.includes('SENSITIVE'));
      return true;
    });
    assert.equal(calls, 1);
  }
});
