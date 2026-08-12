import helmet from "helmet";
import rateLimit from "express-rate-limit";

export const securityMiddleware = [
  helmet(),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000
  })
];