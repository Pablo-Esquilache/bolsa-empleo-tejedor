import { APP_NAME } from './constants';

export async function sendTransactionalEmail(params: {
  toEmail: string;
  subject: string;
  htmlContent: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function buildOtpEmailHtml(code: string, roleLabel: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; color: #0f172a;">
      <h2 style="margin-top: 0; color: #0369a1;">${APP_NAME}</h2>
      <p style="font-size: 15px; line-height: 1.5;">
        Hola, solicitaste ingresar a <strong>${APP_NAME}</strong> (${roleLabel}).
      </p>
      <p style="font-size: 15px;">Tu código de acceso de 6 dígitos es:</p>
      <div style="background: #f0f7ff; border: 2px solid #0284c7; border-radius: 12px; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0c4a6e; margin: 20px 0;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #64748b;">
        Este código es válido por 15 minutos. Si no solicitaste este código, podés ignorar este mensaje.
      </p>
    </div>
  `;
}
