/**
 * Teste de integração HTTP — `/api/health` via app Hono.
 *
 * Auditoria 2026-05-18 C2 (item 17 do checklist): valida que o pipeline
 * unificado (catchall → boot.ts → secureHeaders → handler) responde
 * corretamente. Se este teste passa, qualquer regressão no middleware
 * chain ou no roteamento Hono quebra o build.
 */
import { describe, it, expect } from "vitest";
import app from "../server/boot";

describe("GET /api/health", () => {
  it("retorna 200 com payload ok=true", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("number");
  });

  it("inclui headers de segurança (CSP, XFO, nosniff)", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("retorna 404 em rota /api/* inexistente", async () => {
    const res = await app.fetch(new Request("http://localhost/api/does-not-exist"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not Found");
  });
});

describe("CORS — Origin allowlist", () => {
  it("aceita origem autorizada (localhost dev)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { Origin: "http://localhost:5173" },
      })
    );
    // CORS allowlist passa → header Access-Control-Allow-Origin presente
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("rejeita origem não-autorizada (não retorna ACAO)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { Origin: "https://atacante-malicioso.com" },
      })
    );
    // Sem ACAO ou com valor diferente da origem do atacante → browser bloqueia
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao).not.toBe("https://atacante-malicioso.com");
  });
});
