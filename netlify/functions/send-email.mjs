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

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Falta configurar BREVO_API_KEY en el servidor.' }),
      };
    }

    const payload = JSON.parse(event.body || '{}');
    const { toEmail, subject, htmlContent } = payload;

    if (!toEmail || !subject || !htmlContent) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Faltan parámetros de correo.' }),
      };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
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
        to: [{ email: toEmail }],
        subject,
        htmlContent,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Error desde Brevo API', details: errText }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Error interno enviando email' }),
    };
  }
};
