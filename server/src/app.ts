import cors from "@fastify/cors";
import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "nacre-server",
  }));

  return app;
}
