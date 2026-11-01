const DEFAULT_SUPABASE_URL = 'https://rgqnwlwcbwofreqignjd.supabase.co';

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
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !serviceRoleKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error:
            'Falta configurar SUPABASE_SERVICE_ROLE_KEY o BREVO_API_KEY en las variables de entorno del servidor.',
        }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const cleanEmail = String(body.email || '')
      .trim()
      .toLowerCase();
    const role = ['candidate', 'employer', 'admin'].includes(body.role)
      ? body.role
      : 'candidate';

    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 160) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Ingresá un correo electrónico válido.' }),
      };
    }

    const clientIp =
      event.headers?.['x-nf-client-connection-ip'] ||
      event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      'unknown';

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/server_issue_otp_challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        p_email: cleanEmail,
        p_role: role,
        p_client_ip: clientIp,
      }),
    });

    const rpcData = await rpcResponse.json().catch(() => ({}));

    if (!rpcResponse.ok) {
      const msg =
        rpcData?.message ||
        rpcData?.error ||
        'No se pudo generar el código de acceso.';
      return {
        statusCode: 400,
        body: JSON.stringify({ error: msg }),
      };
    }

    const otpCode = rpcData?.code;
    if (!otpCode) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Error al generar el código de verificación.' }),
      };
    }

    const roleTitle =
      role === 'admin'
        ? 'Panel de Administración'
        : role === 'employer'
          ? 'Cuenta de Comercio / Empresa'
          : 'Cuenta de Postulante';

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
        <h2 style="color:#0f172a;margin-top:0;">Tu código de acceso</h2>
        <p style="color:#475569;font-size:14px;">Ingresá estos 6 dígitos en <strong>Bolsa de Empleo Tejedor</strong> (${roleTitle}):</p>
        <div style="background:#f8fafc;border:2px dashed #0284c7;border-radius:12px;padding:18px;text-align:center;margin:20px 0;">
          <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0369a1;">${otpCode}</span>
        </div>
        <p style="color:#64748b;font-size:12px;">Este código es válido por 10 minutos y admite hasta 5 intentos. Nunca compartas este código.</p>
      </div>
    `;

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
        to: [{ email: cleanEmail }],
        subject: `${otpCode} es tu código de acceso - Bolsa de Empleo Tejedor`,
        htmlContent,
      }),
    });

    if (!mailRes.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'No pudimos enviar el correo de verificación. Intentá de nuevo en unos segundos.',
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Ocurrió un error al procesar la solicitud. Probá de nuevo.',
      }),
    };
  }
};
