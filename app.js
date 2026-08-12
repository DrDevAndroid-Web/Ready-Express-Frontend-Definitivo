import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { securityMiddleware } from "./middlewares/security.js";
import { sendError, createBadRequest, clientClosedRequest } from "./utils/http-error.js";

const app = express();

app.set("trust proxy", 1);

const corsOrigins = process.env.CORS_ORIGINS
  ?.split(',')
  .map(url => url.trim())
  .filter(url => url.length > 0) || ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5500'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(securityMiddleware);

app.use("/api", routes);

app.use((err, _req, res, _next) => {
  if (err?.message === "Request aborted" || err?.code === "ECONNABORTED" || err?.code === "ECONNRESET") {
    return sendError(res, clientClosedRequest("Cliente cerro la conexion durante la subida"));
  }

  if (err?.type === "entity.parse.failed") {
    return sendError(res, createBadRequest("JSON invalido"));
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return sendError(res, createBadRequest("El archivo excede el tamaño maximo permitido"));
  }

  if (err?.message === "Solo se permiten imÃ¡genes" || err?.message === "Solo se permiten imágenes") {
    return sendError(res, createBadRequest("Solo se permiten imagenes"));
  }

  sendError(res, err);
});

export default app;
