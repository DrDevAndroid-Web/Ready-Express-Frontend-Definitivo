import { sendError } from "../../utils/http-error.js";
import { getAdminReferralRiskStats, listAdminReferralRiskEvents } from "./referral.fraud.service.js";

export async function listAdminReferralRiskEventsController(req, res) {
  try { res.json(await listAdminReferralRiskEvents(req.query)); } catch (error) { sendError(res, error); }
}

export async function getAdminReferralRiskStatsController(_req, res) {
  try { res.json(await getAdminReferralRiskStats()); } catch (error) { sendError(res, error); }
}
