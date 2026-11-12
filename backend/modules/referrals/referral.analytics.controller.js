import { sendError } from "../../utils/http-error.js";
import { recordPublicReferralEvent } from "./referral.analytics.service.js";

export async function recordPublicReferralEventController(req, res) {
  try {
    res.status(202).json({ accepted: true, event: await recordPublicReferralEvent(req.body || {}) });
  } catch (error) {
    sendError(res, error);
  }
}
