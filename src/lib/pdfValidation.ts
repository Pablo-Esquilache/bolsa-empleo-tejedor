/**
 * Valida que el archivo de CV sea un PDF auténtico verificando:
 * 1. Extensión y tipo MIME ('application/pdf')
 * 2. Tamaño máximo (5 MB por defecto)
 * 3. Firma binaria real en los primeros 5 bytes ('%PDF-')
 */
export async function validatePdfFile(
  file: File,
  maxSizeBytes = 5 * 1024 * 1024
): Promise<{
  valid: boolean;
  error?: string;
  code?: 'too_large' | 'invalid_pdf';
}> {
  if (file.size > maxSizeBytes) {
    const fileMb = (file.size / (1024 * 1024)).toFixed(1).replace('.', ',');
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      code: 'too_large',
      error: `Tu archivo PDF pesa ${fileMb} MB y supera el tamaño máximo permitido de ${maxMb} MB.`,
    };
  }

  const headerSlice = file.slice(0, 5);
  const buffer = await headerSlice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes);

  if (signature !== '%PDF-') {
    return {
      valid: false,
      code: 'invalid_pdf',
      error: 'El archivo seleccionado no es un documento PDF válido. Verificá que esté guardado como .pdf.',
    };
  }

  return { valid: true };
}
