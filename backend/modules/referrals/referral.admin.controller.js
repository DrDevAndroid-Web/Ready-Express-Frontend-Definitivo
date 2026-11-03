import { sendError } from "../../utils/http-error.js";
import { createAdminReferralRule, getAdminReferralProgram, getAdminReferralStats, listAdminReferralRewards, listAdminReferrals, reverseAdminReferralReward, updateAdminReferralProgram, updateAdminReferralRule } from "./referral.admin.service.js";

export async function getAdminReferralProgramController(_req, res) { try { res.json(await getAdminReferralProgram()); } catch (error) { sendError(res, error); } }
export async function updateAdminReferralProgramController(req, res) { try { res.json(await updateAdminReferralProgram(req.body)); } catch (error) { sendError(res, error); } }
export async function createAdminReferralRuleController(req, res) { try { res.status(201).json(await createAdminReferralRule(req.body)); } catch (error) { sendError(res, error); } }
export async function updateAdminReferralRuleController(req, res) { try { res.json(await updateAdminReferralRule(req.params.id, req.body)); } catch (error) { sendError(res, error); } }
export async function listAdminReferralsController(req, res) { try { res.json(await listAdminReferrals(req.query)); } catch (error) { sendError(res, error); } }
export async function listAdminReferralRewardsController(req, res) { try { res.json(await listAdminReferralRewards(req.query)); } catch (error) { sendError(res, error); } }
export async function getAdminReferralStatsController(_req, res) { try { res.json(await getAdminReferralStats()); } catch (error) { sendError(res, error); } }
export async function reverseAdminReferralRewardController(req, res) { try { res.json(await reverseAdminReferralReward(req.params.id, req.user.id, req.body?.reason)); } catch (error) { sendError(res, error); } }
