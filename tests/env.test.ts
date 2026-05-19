/**
 * Testes do schema Zod de envs (fail-fast).
 *
 * Auditoria 2026-05-18 (item 6 do checklist): garantir que envs ausentes
 * abortam o app no boot — não silenciosamente subir com defaults inseguros.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replica o schema de server/lib/env.ts (sem o `process.exit` — testa só validação).
// Quando o schema evoluir, replicar aqui também (ou refatorar pra exportar do env.ts).
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SERPER_API_KEY: z.string().min(1),
  APP_ID: z.string().min(1),
  APP_SECRET: z.string().min(32),
});

describe("env schema (fail-fast)", () => {
  it("aceita configuração válida completa", () => {
    const result = envSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://u:p@host:4000/db",
      SERPER_API_KEY: "key123",
      APP_ID: "my-app",
      APP_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(true);
  });

  it("rejeita se DATABASE_URL estiver vazia", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: "",
      SERPER_API_KEY: "key",
      APP_ID: "my-app",
      APP_SECRET: "a".repeat(32),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
    }
  });

  it("rejeita APP_SECRET curto (< 32 chars)", () => {
    const result = envSchema.safeParse({
      DATABASE_URL: "mysql://u:p@host:4000/db",
      SERPER_API_KEY: "key",
      APP_ID: "my-app",
      APP_SECRET: "curto",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("APP_SECRET");
    }
  });

  it("rejeita se múltiplas envs faltarem (lista todas, não para na primeira)", () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      // Esperamos 4 erros: DATABASE_URL, SERPER_API_KEY, APP_ID, APP_SECRET
      expect(result.error.issues.length).toBeGreaterThanOrEqual(4);
    }
  });
});
