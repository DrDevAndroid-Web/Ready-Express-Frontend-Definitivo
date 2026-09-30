import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sendError } from "../../utils/http-error.js";
import { applyStoreMarkup } from "../../utils/store-pricing.js";
import { getPricingSettings, updatePricingSettings } from "./pricing-settings.service.js";

const FEES_REPORT_PATH = fileURLToPath(new URL("../../docs/reporte-tarifas-tropipay.md", import.meta.url));

// Ejemplos para que la APK muestre el efecto antes de guardar
function withExamples(settings) {
  return { ...settings, ejemplos: [10, 40, 75.99, 100].map(base => ({ base, final: applyStoreMarkup(base, settings) })) };
}

export async function getPricingSettingsController(_req, res) {
  try {
    res.json(withExamples(await getPricingSettings()));
  } catch (err) {
    sendError(res, err);
  }
}

export async function updatePricingSettingsController(req, res) {
  try {
    res.json(withExamples(await updatePricingSettings(req.body, req.user?.id || null)));
  } catch (err) {
    sendError(res, err);
  }
}

// Informe de tarifas de TropiPay (solo administradores): se actualiza con el backend, sin nueva APK
export async function getFeesReportController(_req, res) {
  try {
    res.set("Cache-Control", "private, no-store");
    res.type("text/markdown; charset=utf-8").send(await readFile(FEES_REPORT_PATH, "utf8"));
  } catch (err) {
    sendError(res, err);
  }
}
