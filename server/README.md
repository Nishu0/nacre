# Nacre server

Bun and Fastify API for Nacre. The service listens on port 3001 by default and permits requests from the local frontend at port 3000.

```bash
cd server
bun install
bun run dev
```

`GET /health` returns `{"status":"ok","service":"nacre-server"}`.

Copy `.env.example` to `.env` to configure `PORT`, `HOST`, or `FRONTEND_ORIGIN`. Run `bun run check` for TypeScript validation.
