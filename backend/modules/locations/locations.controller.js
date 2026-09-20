import * as service from "./locations.service.js";
import { sendError } from "../../utils/http-error.js";

export async function getLocationsController(req, res) {
  try {
    res.json(await service.listLocations({ includeInactive: req.query.includeInactive === "true" || Boolean(req.user && req.path.endsWith("/admin")) }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function createLocationController(req, res) {
  try {
    res.status(201).json(await service.createLocation(req.body));
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateLocationController(req, res) {
  try {
    res.json(await service.updateLocation(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteLocationController(req, res) {
  try {
    res.json(await service.deleteLocation(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
}
