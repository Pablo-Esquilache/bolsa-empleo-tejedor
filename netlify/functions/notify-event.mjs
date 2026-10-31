const DEFAULT_SUPABASE_URL = 'https://rgqnwlwcbwofreqignjd.supabase.co';
const SERVER_RPC_KEY = 'bt_srv_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const apiKey = process.env.BREVO_API_KEY;
    const senderName = process.env.BREVO_SENDER_NAME || 'Bolsa de Empleo Tejedor';
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'pabloesquilache@gmail.com';
    const supabaseUrl = process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!apiKey || !supabaseKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Servicio de notificaciones no configurado.' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { token, eventType, targetId } = body;

    if (!token || !eventType || !targetId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Parámetros incompletos.' }),
      };
    }

    const rpcResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/server_prepare_notification_email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          p_token: token,
          p_event_type: eventType,
          p_target_id: targetId,
          p_server_key: SERVER_RPC_KEY,
        }),
      }
    );

    const rpcData = await rpcResponse.json().catch(() => ({}));

    if (!rpcResponse.ok || !rpcData?.to_email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No se pudo preparar la notificación.' }),
      };
    }

    const mailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [{ email: rpcData.to_email }],
        subject: rpcData.subject,
        htmlContent: rpcData.html,
      }),
    });

    if (!mailRes.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'No se pudo entregar el correo.' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno de notificación.' }),
    };
  }
};
