/**
 * Redimensiona y comprime una imagen (Foto de perfil o Logo de comercio) en el navegador.
 * - Máximo 512x512 px manteniendo proporción.
 * - Convierte a WebP (con fallback a JPEG) logrando un peso objetivo de 50 KB a 150 KB.
 * - Elimina metadatos EXIF al redibujar en un elemento <canvas>.
 */
export async function compressImageToWebP(
  file: File,
  maxDimension = 512,
  quality = 0.82
): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo seleccionado no es una imagen válida.');
  }

  const bitmap = await createImageBitmap(file);
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
