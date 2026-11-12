import { getInbound, getSent, listInbound, listSent, receiveInbound, replyInbound } from "./resend-inbound.service.js";

export async function resendWebhookController(req, res, next) {
  try {
    const result = await receiveInbound(req.body, {
      id: req.get("svix-id"), timestamp: req.get("svix-timestamp"), signature: req.get("svix-signature")
    });
    res.json(result);
  } catch (error) { next(error); }
}

export async function listInboundController(req, res, next) {
  try { res.json(await listInbound(req.query)); } catch (error) { next(error); }
}

export async function listSentController(req, res, next) {
  try { res.json(await listSent(req.query)); } catch (error) { next(error); }
}

export async function getSentController(req, res, next) {
  try { res.json(await getSent(req.params.id)); } catch (error) { next(error); }
}

export async function getInboundController(req, res, next) {
  try { res.json(await getInbound(req.params.id)); } catch (error) { next(error); }
}

export async function replyInboundController(req, res, next) {
  try { res.status(201).json(await replyInbound(req.params.id, req.body, req.user.id, { idempotencyKey: req.get("idempotency-key") })); } catch (error) { next(error); }
}
