// Secrets are read at use time and never merged into the persisted settings.
export function paymentSecrets() {
  return {
    secretKey: process.env.PAYMENTS_SECRET_KEY || '',
    webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET || ''
  };
}

export function settingsWithoutSecrets(settings = {}) {
  return {
    ...settings,
    payments: { ...settings.payments, secretKey: '', webhookSecret: '' },
    smtp: { ...settings.smtp, pass: '' }
  };
}

export function serializeStore(db, space) {
  return JSON.stringify({ ...db, settings: settingsWithoutSecrets(db.settings) }, null, space);
}

export function containsIncomingSecrets(settings = {}) {
  return [settings.payments?.secretKey, settings.payments?.webhookSecret, settings.smtp?.pass]
    .some(value => value !== undefined && value !== null && String(value).trim() !== '');
}
