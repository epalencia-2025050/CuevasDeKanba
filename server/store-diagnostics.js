import { createHash, timingSafeEqual } from 'node:crypto';

// TEMPORARY. Independent of user/admin sessions because the store may be invalid.
export function mountStoreDiagnostics(app, services) {
  app.all('/api/internal/store-diagnostics', async c => {
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Authorization');
    const secret = services.config.STORE_DIAGNOSTICS_TOKEN;
    const authorization = c.req.header('Authorization') || '';
    if (c.req.method !== 'GET' || !services.network(c).secure ||
        typeof secret !== 'string' || secret.length < 32 || secret.length > 256 ||
        !authorization.startsWith('Bearer ') || authorization.length > 263) {
      return c.body(null, 404);
    }
    const digest = value => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(authorization.slice(7)), digest(secret))) return c.body(null, 404);
    // Allowlist output; never serialize exceptions, config or the document.
    try {
      const result = await services.database.diagnoseStore();
      return c.json({
        connectionSource: result.connectionSource,
        schemaMatchesExpected: result.schemaMatchesExpected,
        rowFound: result.rowFound,
        sqlDocIsObject: result.sqlDocIsObject,
        jsDocType: result.jsDocType,
        usersIsArray: result.usersIsArray,
        metaIsObject: result.metaIsObject,
        sessionsIsObject: result.sessionsIsObject,
        userSessionsIsObject: result.userSessionsIsObject,
        invalidUserCount: result.invalidUserCount,
        validationStage: result.validationStage
      });
    } catch {
      // A failed SELECT cannot truthfully produce row/type diagnostics.
      return c.body(null, 503);
    }
  });
}
