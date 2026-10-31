/**
 * Redimensiona y comprime una imagen (Foto de perfil o Logo de comercio) en el navegador.
 * - Máximo 512x512 px manteniendo proporción.
 * - Convierte a WebP logrando un peso liviano y eliminando metadatos EXIF.
 */
export async function compressImageToWebP(
  file: File,
  maxDimension = 512,
  quality = 0.8
): Promise<File> {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('La imagen supera el límite de 15 MB. Elegí una foto más liviana.');
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif') || file.type === 'image/heic') {
    throw new Error('Formato HEIC no compatible. Por favor usá una foto en formato JPG o PNG.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo seleccionado no es una imagen válida (usá JPG o PNG).');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('No se pudo leer la imagen. Asegurate de que sea un archivo JPG o PNG válido.');
  }

  let { width, height } = bitmap;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el compresor de imagen.');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('Error al comprimir la imagen.'));
      },
      'image/webp',
      quality
    );
  });

  const cleanBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return new File([blob], `${cleanBaseName}.webp`, {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

export async function compressImageToDataUrl(
  file: File,
  maxDimension = 384,
  quality = 0.8
): Promise<string> {
  const webpFile = await compressImageToWebP(file, maxDimension, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    reader.readAsDataURL(webpFile);
  });
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}
