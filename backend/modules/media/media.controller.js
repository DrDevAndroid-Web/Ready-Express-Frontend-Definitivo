import { sendError } from "../../utils/http-error.js";
import { getDeliveryConfirmationUrl, getPaymentDeliveryConfirmationUrl, updateDeliveryConfirmationStatus, uploadDeliveryConfirmation } from "./media.service.js";
export async function uploadDeliveryConfirmationController(req, res) { try { res.status(201).json(await uploadDeliveryConfirmation(req.params.id, req.file, req.user?.id)); } catch (error) { sendError(res, error); } }
export async function getDeliveryConfirmationController(req, res) { try { res.json(await getDeliveryConfirmationUrl(req.params.id)); } catch (error) { sendError(res, error); } }
export async function getPaymentDeliveryConfirmationController(req, res) { try { res.json(await getPaymentDeliveryConfirmationUrl(req.params.id)); } catch (error) { sendError(res, error); } }
export async function updateDeliveryConfirmationController(req, res) { try { res.json(await updateDeliveryConfirmationStatus(req.params.id, req.body?.status, req.body?.notes)); } catch (error) { sendError(res, error); } }
