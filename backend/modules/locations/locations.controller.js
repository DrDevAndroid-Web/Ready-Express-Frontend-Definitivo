import * as service from "./locations.service.js";
import { sendError } from "../../utils/http-error.js";
import { getCached, invalidateCache, PUBLIC_CACHE_KEYS, sendPublicJson } from "../../utils/public-cache.js";

export async function getLocationsController(req, res) {
  try {
    const includeInactive = req.query.includeInactive === "true" || Boolean(req.user && req.path.endsWith("/admin"));
    const locations = includeInactive
      ? await service.listLocations({ includeInactive: true })
      : await getCached(PUBLIC_CACHE_KEYS.locations, () => service.listLocations({ includeInactive: false }), 300_000);
    if (includeInactive) return res.json(locations);
    sendPublicJson(req, res, locations, { maxAge: 300, staleWhileRevalidate: 600 });
  } catch (err) {
    sendError(res, err);
  }
}

export async function createLocationController(req, res) {
  try {
    const result = await service.createLocation(req.body);
    invalidateCache(PUBLIC_CACHE_KEYS.locations);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function updateLocationController(req, res) {
  try {
    const result = await service.updateLocation(req.params.id, req.body);
    invalidateCache(PUBLIC_CACHE_KEYS.locations);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

export async function deleteLocationController(req, res) {
  try {
    const result = await service.deleteLocation(req.params.id);
    invalidateCache(PUBLIC_CACHE_KEYS.locations);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}
