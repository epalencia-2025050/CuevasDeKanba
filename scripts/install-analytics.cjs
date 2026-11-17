/* ==========================================================================
   Instala Google Tag Manager (GTM-N8ZD2LM3) en las páginas públicas.
   Uso: node scripts/install-analytics.cjs
   - Inserta el contenedor justo después de <head> y el <noscript> tras <body>.
   - Carga js/analytics.js (eventos del embudo de reservas).
   - Omite admin.html y es idempotente (no duplica el código).
   ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');

const GTM_ID = 'GTM-N8ZD2LM3';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SKIP = new Set(['admin.html']);

const HEAD_SNIPPET = `  <!-- Google Tag Manager -->
  <script async src="https://www.googletagmanager.com/gtm.js?id=${GTM_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
  </script>
  <!-- End Google Tag Manager -->
  <script src="js/analytics.js"></script>
`;

const BODY_SNIPPET = `  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
`;

function install(file) {
  const full = path.join(PUBLIC_DIR, file);
  let html = fs.readFileSync(full, 'utf8');
  if (html.includes(GTM_ID)) {
    return 'omitido (ya instalado)';
  }
  if (!/<head(\s[^>]*)?>/i.test(html) || !/<body(\s[^>]*)?>/i.test(html)) {
    return 'omitido (sin <head> o <body>)';
  }
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const headSnippet = HEAD_SNIPPET.replace(/\n/g, eol);
  const bodySnippet = BODY_SNIPPET.replace(/\n/g, eol);
  html = html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${eol}${headSnippet}`);
  html = html.replace(/<body(\s[^>]*)?>/i, (match) => `${match}${eol}${bodySnippet}`);
  fs.writeFileSync(full, html, 'utf8');
  return 'instalado';
}

const files = fs.readdirSync(PUBLIC_DIR).filter((file) => file.endsWith('.html') && !SKIP.has(file)).sort();
for (const file of files) {
  console.log(`${file}: ${install(file)}`);
}
