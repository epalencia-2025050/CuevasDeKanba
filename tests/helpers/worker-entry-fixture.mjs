import worker from '../../server/worker.js';
export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, {
      NODE_ENV: 'production', PUBLIC_URL: 'https://kanba.test', DB_SCHEMA: 'kanba',
      DATABASE_URL: 'postgres://synthetic:synthetic@db.example.invalid/kanba',
      ASSETS: { fetch: async () => new Response('asset from binding') }
    }, ctx);
  }
};
