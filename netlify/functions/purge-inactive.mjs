const DEFAULT_SUPABASE_URL = 'https://rgqnwlwcbwofreqignjd.supabase.co';

export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[purge-inactive] Falta SUPABASE_SERVICE_ROLE_KEY.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }),
    };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/purge_inactive_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: '{}',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[purge-inactive] Error al ejecutar limpieza:', res.status, data);
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: data }),
      };
    }

    console.log('[purge-inactive] Limpieza semanal ejecutada:', JSON.stringify(data));
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('[purge-inactive] Excepción inesperada:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Unexpected error' }),
    };
  }
};
