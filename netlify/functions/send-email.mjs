export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const internalSecret = process.env.INTERNAL_MAIL_SECRET;
  const providedSecret =
    event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];

  if (!internalSecret || !providedSecret || providedSecret !== internalSecret) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: 'Acceso directo deshabilitado. Utilizá las funciones autenticadas del servidor.',
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
