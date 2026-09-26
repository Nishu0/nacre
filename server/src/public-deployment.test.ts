import { expect, test } from "bun:test";
import { buildApp } from "./app";

test("public deployment blocks sandbox writes but leaves verified registration and reads available", async () => {
  const previous = process.env.NACRE_PUBLIC_DEPLOYMENT;
  process.env.NACRE_PUBLIC_DEPLOYMENT = "1";
  const app = buildApp(":memory:");
  if (previous === undefined) delete process.env.NACRE_PUBLIC_DEPLOYMENT;
  else process.env.NACRE_PUBLIC_DEPLOYMENT = previous;
  try {
    for (const [method, url] of [["POST", "/api/markets"], ["PATCH", "/api/markets/test/price"], ["POST", "/api/markets/test/positions"]] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/open-pools", payload: {} })).statusCode).toBe(400);
    const position = await app.inject({ method: "POST", url: "/api/markets/00000000-0000-0000-0000-000000000000/chain-positions", payload: {} });
    expect(position.statusCode).not.toBe(403);
  } finally { await app.close(); }
});
