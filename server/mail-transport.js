// Portable HTTPS mail gateway contract; credentials never come from the admin panel.
export function createHttpMailTransport(config, fetcher = fetch) {
  return async message => {
    if (!config.MAIL_API_URL || !config.MAIL_API_TOKEN) {
      const err = new Error('Mail transport not configured.');
      err.code = 'MAIL_CONFIG_ERROR';
      throw err;
    }
    const response = await fetcher(config.MAIL_API_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${config.MAIL_API_TOKEN}`, 'Content-Type': 'application/json',
        ...(message.messageId ? { 'Idempotency-Key': message.messageId } : {}) },
      body: JSON.stringify(config.MAIL_API_URL === 'https://api.resend.com/emails' ? {
        from: message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text
      } : {
        from: { email: message.fromEmail, name: message.fromName },
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId
      })
    });
    if (!response.ok) {
      let code = 'MAIL_DELIVERY_FAILED';
      if (response.status === 401 || response.status === 403) code = 'MAIL_AUTH_FAILED';
      else if (response.status === 422) code = 'MAIL_DOMAIN_UNVERIFIED';
      else if (response.status === 429) code = 'MAIL_RATE_LIMITED';
      const err = new Error(`Mail delivery failed with status ${response.status}.`);
      err.code = code;
      err.status = response.status;
      throw err;
    }
    await response.body?.cancel();
  };
}
