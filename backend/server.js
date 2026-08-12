import "./config/env.js";
import app from "./app.js";

const PORT = process.env.PORT || 3000;

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.message || err);
});

const server = app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya esta en uso. Cierra el otro proceso o cambia PORT en .env.`);
    process.exitCode = 1;
    return;
  }

  console.error("[server:error]", err?.message || err);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`${signal} recibido, cerrando servidor...`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
