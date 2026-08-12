/**
 * Analiza comprobantes de pago (Wells Fargo/Zelle o Tocopay) usando Gemini 1.5 Flash
 * y extrae datos normalizados en formato JSON estricto.
 * * @param {string} base64Image La imagen del comprobante en formato base64 (sin prefijo de datos).
 * @returns {Promise<Object>} Un objeto JSON con los datos de la transacción.
 */
export async function analyzeWithGemini(base64Image) {
  // ELIMINADO: Ya no necesitamos el prompt ternario basado en 'method'.
  // Gemini 1.5 detectará automáticamente la fuente basándose en los ejemplos de abajo.

  const promptFinal = `
# Rol y Tarea
Actúa como un experto en extracción de datos financieros automatizados (OCR avanzado). Tu tarea es analizar la imagen proporcionada, clasificar su origen y extraer los detalles clave de la transacción en un formato JSON estricto y normalizado.

# Instrucciones de Análisis por Tipo
La imagen puede ser una de las siguientes dos variantes. Analízala basándote en la lógica de la variante que detectes:

## Variante 1: Wells Fargo / Zelle (Captura de pantalla, fondo claro)
- **Identificadores Visuales:** Checkmark verde grande arriba, texto "¡Listo!" o similar, referencia a "Globalcash".
- **Lógica de Extracción:**
    - **Platform:** "WellsFargoZelle"
    - **Amount:** El número grande ($34.00). Normalizar a número puro (34.00).
    - **Currency:** Inferir "USD" de la plataforma.
    - **Recipient:** El nombre tras "Dinero enviado a" (ej. "Globalcash").
    - **Reference:** El valor tras "Confirmación" (ej. "WFCT0ZYY6B8B").
    - **Status:** "COMPLETED" (por el checkmark verde y "¡Listo!").

## Variante 2: Tocopay (Correo electrónico, fondo oscuro)
- **Identificadores Visuales:** Logo amarillo de Tocopay arriba, texto "Notificación de Depósito", fondo oscuro.
- **Lógica de Extracción:**
    - **Platform:** "Tocopay"
    - **Amount:** El valor tras "Total depositado:" (ej. "100 USD"). Normalizar a número puro (100.00).
    - **Currency:** El valor tras "Total depositado:" (ej. "100 USD"). Extraer código de moneda (ej. "USD").
    - **Recipient:** El valor tras "Beneficiario:" (ej. "ERNESTO MARIANO BBUENO").
    - **Reference:** Usar "No. Transacción:" como referencia principal (ej. "260326203814").
    - **Status:** "COMPLETED" (implícito en "depositado").

# Formato de Salida Requerido (JSON Estricto)
Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura. No incluyas backticks de markdown ni texto adicional.

\`\`\`json
{
  "platform": "String ('WellsFargoZelle' or 'Tocopay')",
  "transaction_type": "String ('Transfer' or 'Deposit')",
  "amount_normalized": "Number (normalized to float, no symbols)",
  "currency": "String (ISO code, e.g., 'USD')",
  "recipient_name": "String (normalized full name)",
  "sender_name": "String (Optional, if visible)",
  "reference_code": "String (normalized transaction or confirmation ID)",
  "status_normalized": "String ('COMPLETED', 'PENDING', or 'FAILED')",
  "source_account_info": "String (Optional, e.g., 'Savings...8217')",
  "destination_account_info": "String (Optional, e.g., 'Card ...5732')"
}
\`\`\`
`;

  // Cambiado el modelo a gemini-1.5-flash-latest
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptFinal },
            { inline_data: { mime_type: "image/jpeg", data: base64Image } }
          ]
        }],
        // MEJORA CLAVE: Fuerza la respuesta a JSON estricto para evitar errores de parseo.
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(`Gemini API Error: ${res.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await res.json();
    
    // Con generationConfig, el texto devuelto ya es JSON puro, sin markdown.
    const cleanJsonString = data.candidates[0].content.parts[0].text.trim();
    return JSON.parse(cleanJsonString);

  } catch (error) {
    console.error("Error analizando comprobante con Gemini:", error);
    // Retornar un objeto de error estructurado o lanzar el error
    throw error; 
  }
}