import { sendError } from "../../utils/http-error.js";
import {
  attachReferralClaim,
  claimReferralCode,
  getMyReferralSummary,
  getOrCreateReferralCode,
  getReferralProgram
} from "./referral.service.js";

export async function getPublicReferralProgramController(_req, res) {
  try {
    res.json(await getReferralProgram());
  } catch (error) {
    sendError(res, error);
  }
}

export async function claimReferralCodeController(req, res) {
  try {
    const result = await claimReferralCode(req.body?.code, req.user?.id || null, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
      deviceId: req.body?.device_id,
      sessionId: req.body?.session_id
    });
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMyReferralCodeController(req, res) {
  try {
    res.json(await getOrCreateReferralCode(req.user.id));
  } catch (error) {
    sendError(res, error);
  }
}

export async function attachReferralClaimController(req, res) {
  try {
    res.json(await attachReferralClaim(req.body?.token, req.user.id, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
      deviceId: req.body?.device_id,
      sessionId: req.body?.session_id
    }));
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMyReferralSummaryController(req, res) {
  try {
    res.json(await getMyReferralSummary(req.user.id));
  } catch (error) {
    sendError(res, error);
  }
}
