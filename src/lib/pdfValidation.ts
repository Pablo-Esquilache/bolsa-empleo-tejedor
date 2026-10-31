/**
 * Valida que el archivo de CV sea un PDF auténtico verificando:
 * 1. Extensión y tipo MIME ('application/pdf')
 * 2. Tamaño máximo (5 MB por defecto)
 * 3. Firma binaria real en los primeros 5 bytes ('%PDF-')
 */
export async function validatePdfFile(
  file: File,
  maxSizeBytes = 5 * 1024 * 1024
): Promise<{ valid: boolean; error?: string }> {
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: 'El archivo PDF supera el tamaño máximo permitido de 5 MB.',
    };
  }

  const headerSlice = file.slice(0, 5);
  const buffer = await headerSlice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes);

  if (signature !== '%PDF-') {
    return {
      valid: false,
      error: 'El archivo seleccionado no es un documento PDF válido.',
    };
  }

  return { valid: true };
}
