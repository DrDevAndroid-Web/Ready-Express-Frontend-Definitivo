import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { compressImage } from "../utils/image.js";

// Genera un JPEG real usando Sharp (ya es dependencia del backend)
async function makeJpegBuffer(width = 100, height = 100, quality = 90) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 }
    }
  })
    .jpeg({ quality })
    .toBuffer();
}

describe("compressImage", () => {
  it("devuelve un Buffer con magic bytes JPEG (FF D8 FF)", async () => {
    const input = await makeJpegBuffer();
    const output = await compressImage(input);
    assert.ok(Buffer.isBuffer(output), "el resultado debe ser un Buffer");
    assert.ok(output.length > 0, "el Buffer no debe estar vacío");
    assert.equal(output[0], 0xff, "primer byte debe ser 0xFF");
    assert.equal(output[1], 0xd8, "segundo byte debe ser 0xD8");
    assert.equal(output[2], 0xff, "tercer byte debe ser 0xFF");
  });

  it("reduce el tamaño de una imagen grande (> 800px se redimensiona)", async () => {
    // 1200x900 a quality 90 → compressImage la reduce a 800px y quality 70
    const input = await makeJpegBuffer(1200, 900, 90);
    const output = await compressImage(input);
    assert.ok(
      output.length <= input.length,
      `output (${output.length} bytes) debería ser ≤ input (${input.length} bytes)`
    );
  });

  it("lanza un error para un buffer que no es imagen", async () => {
    const invalidBuffer = Buffer.from("esto no es una imagen valida - texto plano");
    await assert.rejects(
      () => compressImage(invalidBuffer),
      "debió lanzar un error para un buffer inválido"
    );
  });

  it("procesa correctamente un buffer PNG (convierte a JPEG)", async () => {
    const pngBuffer = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 128, b: 255 } }
    })
      .png()
      .toBuffer();

    const output = await compressImage(pngBuffer);
    assert.ok(Buffer.isBuffer(output));
    // El output debe ser JPEG aunque el input fue PNG
    assert.equal(output[0], 0xff);
    assert.equal(output[1], 0xd8);
  });
});
