import "dotenv/config";
import { z } from "zod";

/**
 * Validação fail-fast das envs no boot.
 *
 * Auditoria 2026-05-18 C3 (item 6 do checklist):
 * versão anterior usava `process.env.X ?? ""` — app subia silencioso em
 * produção sem credenciais, quebrava no primeiro request com erro confuso.
 * Agora schema Zod valida no import: se faltar env obrigatória, `process.exit(1)`
 * imediato com mensagem clara apontando qual env e onde definir.
 *
 * Ver também:
 * - .env.example (template de envs)
 * - AUDIT_REPORT_2026-05-18.md C3 (justificativa)
 */
const envSchema = z.object({
  // ── Runtime ────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  // ── Banco (TiDB Cloud) — obrigatório ───────────────────────────
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL é obrigatória — formato: mysql://user:pass@host:port/db?sslaccept=strict"),

  // ── Busca externa (serper.dev) — obrigatório ──────────────────
  SERPER_API_KEY: z
    .string()
    .min(1, "SERPER_API_KEY é obrigatória — obtenha em https://serper.dev/dashboard"),

  // ── Identidade da aplicação (JWT signing) ─────────────────────
  // APP_ID é identificador (pode ser público); APP_SECRET assina tokens.
  APP_ID: z.string().min(1, "APP_ID é obrigatório (identificador da aplicação)"),
  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET deve ter ao menos 32 caracteres (gere via `node -e \"console.log(require('crypto').randomBytes(64).toString('base64url'))\"`)"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail-fast: listar TODOS os erros de uma vez, não só o primeiro.
  console.error("\n❌ Configuração inválida — envs obrigatórias ausentes ou inválidas:\n");
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    console.error(`  • ${path}: ${issue.message}`);
  }
  console.error("\nDefina as envs no arquivo .env (local) ou no painel de envs do provedor (Vercel/Docker/etc).");
  console.error("Template em .env.example.\n");
  process.exit(1);
}

const validated = parsed.data;

export const env = {
  isProduction: validated.NODE_ENV === "production",
  isDevelopment: validated.NODE_ENV === "development",
  isTest: validated.NODE_ENV === "test",
  port: validated.PORT,
  databaseUrl: validated.DATABASE_URL,
  serperApiKey: validated.SERPER_API_KEY,
  appId: validated.APP_ID,
  appSecret: validated.APP_SECRET,
};
