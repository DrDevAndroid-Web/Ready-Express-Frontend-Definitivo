import sharp from "sharp";

export async function compressImage(buffer) {
  // Optimización: balance entre legibilidad y tamaño
  // quality: 75% permite screenshots legibles sin perder mucho en compresión
  return await sharp(buffer)
    .rotate() // Detectar y rotar automáticamente
    .resize(800, 1200, {
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 75,
      progressive: true,
      mozjpeg: true
    })
    .toBuffer();
}