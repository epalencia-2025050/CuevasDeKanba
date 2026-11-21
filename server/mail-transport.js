// Portable HTTPS mail gateway contract; credentials never come from the admin panel.
export function createHttpMailTransport(config, fetcher = fetch) {
  return async message => {
    if (!config.MAIL_API_URL || !config.MAIL_API_TOKEN) throw new Error('Mail transport not configured.');
    const response = await fetcher(config.MAIL_API_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${config.MAIL_API_TOKEN}`, 'Content-Type': 'application/json',
        ...(message.messageId ? { 'Idempotency-Key': message.messageId } : {}) },
      body: JSON.stringify(config.MAIL_API_URL === 'https://api.resend.com/emails' ? {
        from: message.fromEmail, to: [message.to], subject: message.subject, html: message.html, text: message.text
      } : { from: { email: message.fromEmail, name: message.fromName },
        to: message.to, subject: message.subject, html: message.html, text: message.text, messageId: message.messageId })
    });
    if (!response.ok) throw new Error('Mail delivery failed.');
    await response.body?.cancel();
  };
}
