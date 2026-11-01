export async function requestServerOtp(
  email: string,
  role: 'candidate' | 'employer' | 'admin'
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth-request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error || 'No pudimos enviar el código. Intentá nuevamente.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Error de conexión al solicitar el código. Verificá tu internet e intentá de nuevo.',
    };
  }
}

export async function notifyServerEvent(params: {
  token: string;
  eventType:
    | 'new_application'
    | 'application_status_changed'
    | 'admin_ticket_created'
    | 'admin_ticket_replied';
  targetId: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/notify-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function normalizeSearchText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/vendedora/g, 'vendedor')
    .replace(/cajera/g, 'cajero')
    .replace(/cocinera/g, 'cocinero')
    .replace(/administrativa/g, 'administrativo')
    .replace(/operaria/g, 'operario')
    .replace(/encargada/g, 'encargado')
    .trim();
}

export function formatWhatsAppNumber(rawPhone: string | null | undefined): string {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D/g, '');
  if (digits.startsWith('549') && digits.length >= 13) {
    digits = digits.slice(3);
  } else if (digits.startsWith('54') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  const threeDigitAreas = [
    '221', '223', '261', '291', '299', '341', '342', '343',
    '351', '376', '379', '381', '385', '387', '388',
  ];
  if (digits.length === 12 && digits.startsWith('1115')) {
    digits = '11' + digits.slice(4);
  } else if (
    digits.length === 12 &&
    threeDigitAreas.includes(digits.slice(0, 3)) &&
    digits.slice(3, 5) === '15'
  ) {
    digits = digits.slice(0, 3) + digits.slice(5);
  } else if (digits.length === 12 && digits.slice(4, 6) === '15') {
    digits = digits.slice(0, 4) + digits.slice(6);
  }
  return digits;
}

export function buildWhatsAppUrl(rawPhone: string | null | undefined): string {
  const clean = formatWhatsAppNumber(rawPhone);
  return clean ? `https://wa.me/549${clean}` : '#';
}
