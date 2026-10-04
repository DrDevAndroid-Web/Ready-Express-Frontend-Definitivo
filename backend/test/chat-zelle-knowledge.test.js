import assert from "node:assert/strict";
import { after, it } from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCIsImlzcyI6InN1cGFiYXNlIn0",
  "test-signature"
].join(".");
process.env.SUPABASE_ANON_KEY ||= "anon-key";
process.env.CHAT_AI_API_KEY ||= "test-key";

const { callAI } = await import("../modules/chat/chat.service.js");
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

it("incluye el flujo seguro para dudas de Zelle", async () => {
  let prompt = "";
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };

  await callAI([{ role: "user", content: "Mi banco bloquea Zelle" }], "DATOS");

  assert.match(prompt, /no des ni sugieras numeros personales alternativos/i);
  assert.match(prompt, /llamar o escribir por WhatsApp al numero oficial \+53 56189395/i);
  assert.match(prompt, /dejar su propio numero de WhatsApp con codigo de pais/i);
  assert.match(prompt, /agente lo contacte manualmente/i);
  assert.match(prompt, /Pregunta cual opcion prefiere/i);
});
