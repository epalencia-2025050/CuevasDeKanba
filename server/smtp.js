import net from 'node:net';
import tls from 'node:tls';
import { verifiedTlsOptions } from './tls-config.js';

function sanitizeSmtpHeader(value = '') {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

// All messages are local constants: SMTP responses and transport errors may contain secrets.
function smtpError(code) {
  const error = new Error(`SMTP ${code}: operaci\u00f3n rechazada o transporte seguro no disponible.`);
  error.code = 'SMTP_SECURE_FAILURE';
  return error;
}

export function sendSmtpMail({ host, port = 465, secure = true, user, pass, fromEmail, fromName, to, subject, html, text, messageId }, transportConfig = {}) {
  const cleanFrom = sanitizeSmtpHeader(fromEmail);
  const cleanTo = sanitizeSmtpHeader(to);
  const cleanName = sanitizeSmtpHeader(fromName);
  const cleanSubject = sanitizeSmtpHeader(subject);
  let tlsOptions;
  try { tlsOptions = verifiedTlsOptions('SMTP', host, transportConfig); }
  catch { return Promise.reject(smtpError('TLS_CONFIG')); }

  return new Promise((resolve, reject) => {
    let socket;
    let buffer = '';
    let lines = [];
    let responseCode = null;
    let settled = false;
    let tlsVerified = false;
    let terminalError;
    const responses = [];
    const waiters = [];
    const timer = setTimeout(() => fail(smtpError('TIMEOUT')), 20000);

    function cleanup() {
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* noop */ }
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      terminalError = error;
      for (const waiter of waiters.splice(0)) waiter.reject(error);
      cleanup();
      reject(error);
    }
    function readResponse() {
      if (terminalError) return Promise.reject(terminalError);
      if (responses.length) return Promise.resolve(responses.shift());
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    }
    function onData(chunk) {
      buffer += chunk;
      if (buffer.length + lines.join('').length > 65536) return fail(smtpError('RESPONSE_LIMIT'));
      while (!settled) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const match = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!match || (responseCode !== null && responseCode !== Number(match[1]))) {
          return fail(smtpError('PROTOCOL'));
        }
        responseCode = Number(match[1]);
        lines.push(match[3]);
        if (match[2] === '-') continue;
        const response = { code: responseCode, lines };
        lines = [];
        responseCode = null;
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(response);
        else {
          if (responses.length >= 8) return fail(smtpError('PROTOCOL'));
          responses.push(response);
        }
      }
    }
    const onError = () => fail(smtpError('TRANSPORT'));
    const onClose = () => fail(smtpError('CLOSED'));
    function attach(connection) {
      connection.setEncoding('utf8');
      connection.on('data', onData);
      connection.on('error', onError);
      connection.on('close', onClose);
    }
    async function connectTls(options) {
      socket = tls.connect({ ...options, ...tlsOptions });
      attach(socket);
      await new Promise((resolve, reject) => {
        const failed = () => { detach(); reject(smtpError('TLS')); };
        const connected = () => {
          detach();
          if (!socket.authorized) return reject(smtpError('TLS'));
          tlsVerified = true;
          resolve();
        };
        const detach = () => {
          socket.removeListener('error', failed);
          socket.removeListener('close', failed);
          socket.removeListener('secureConnect', connected);
        };
        socket.once('error', failed);
        socket.once('close', failed);
        socket.once('secureConnect', connected);
      });
    }
    async function cmd(line, expected = [250]) {
      if (terminalError) throw terminalError;
      socket.write(line + '\r\n');
      const response = await readResponse();
      if (!expected.includes(response.code)) throw smtpError(response.code);
      return response;
    }
    async function auth(ehlo) {
      if (!tlsVerified || !socket.authorized) throw smtpError('TLS_REQUIRED');
      if (!user || !pass) return;
      const capabilities = ehlo.lines.join('\n');
      if (/^AUTH[ =].*\bPLAIN\b/im.test(capabilities)) {
        await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235]);
      } else if (/^AUTH[ =].*\bLOGIN\b/im.test(capabilities)) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(user).toString('base64'), [334]);
        await cmd(Buffer.from(pass).toString('base64'), [235]);
      } else {
        throw smtpError('AUTH_UNSUPPORTED');
      }
    }
    async function start() {
      if (secure) await connectTls({ host, port });
      else {
        socket = net.connect({ host, port });
        attach(socket);
      }
      const greeting = await readResponse();
      if (greeting.code !== 220) throw smtpError(greeting.code);
      let ehlo = await cmd('EHLO kanba.local');
      if (!secure) {
        if (!ehlo.lines.some(line => /^STARTTLS(?:\s|$)/i.test(line))) throw smtpError('STARTTLS_REQUIRED');
        await cmd('STARTTLS', [220]);
        // Never carry plaintext replies/capabilities over into the authenticated channel.
        if (buffer || lines.length || responses.length) throw smtpError('PROTOCOL');
        const plain = socket;
        plain.removeListener('data', onData);
        plain.removeListener('error', onError);
        plain.removeListener('close', onClose);
        await connectTls({ socket: plain });
        ehlo = await cmd('EHLO kanba.local');
      }
      await auth(ehlo);
      await cmd(`MAIL FROM:<${cleanFrom}>`);
      await cmd(`RCPT TO:<${cleanTo}>`, [250, 251]);
      await cmd('DATA', [354]);
      const encodedSubject = `=?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`;
      const boundary = `kanba-${Date.now().toString(36)}`;
      const headers = [
        `From: "=?UTF-8?B?${Buffer.from(cleanName, 'utf8').toString('base64')}?=" <${cleanFrom}>`,
        `To: <${cleanTo}>`,
        `Subject: ${encodedSubject}`,
        `Date: ${new Date().toUTCString()}`,
        ...(messageId ? [`Message-ID: <${String(messageId).replace(/[^a-zA-Z0-9_-]/g, '')}@kanba.invalid>`] : []),
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`
      ];
      const payload = [
        ...headers,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
        '',
        `--${boundary}--`
      ].join('\r\n');

      const dotted = payload
        .replace(/\r\n|\r|\n/g, '\r\n')
        .split('\r\n')
        .map((line) => (line.startsWith('.') ? '.' + line : line))
        .join('\r\n');


      await cmd(dotted + '\r\n.', [250]);
      // Delivery is acknowledged. QUIT is best effort and must not create a retry.
      settled = true;
      try { socket.write('QUIT\r\n'); } catch { /* noop */ }
      cleanup();
      resolve({ ok: true });
    }
    start().catch(error => fail(error?.code === 'SMTP_SECURE_FAILURE' ? error : smtpError('TRANSPORT')));
  });
}
