import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { logger } from "./lib/logger";

// ═══════════════════════════════════════════════════════
// Pipeline HTTP do TrendScope (defesas perimetrais + tRPC)
//
// Auditoria 2026-05-18 C2: este `app` é AGORA o único handler em produção.
// Antes, o Vercel rotava /api/trpc/* para api/trpc/[...trpc].ts (262 linhas
// duplicadas SEM middleware nenhum). Agora api/[...route].ts delega para
// `app.fetch`, garantindo que secureHeaders + cors + bodyLimit rodam em prod.
// ═══════════════════════════════════════════════════════

const app = new Hono<{ Bindings: HttpBindings }>();

// [SEGURANÇA] Headers HTTP de proteção (auditoria 2026-05-18 C8, item 31 do checklist).
// secureHeaders default já cobre nosniff, XFO, HSTS. Aqui sobrescrevemos com CSP
// estrita aplicada às respostas da API (texto JSON, sem necessidade de script-src).
// CSP do frontend (HTML/JS/CSS) é configurada no vercel.json (Vercel serve estáticos).
app.use(secureHeaders({
  contentSecurityPolicy: {
    // API só retorna JSON — nenhum vetor de XSS pelo backend. CSP super-restrita.
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
  strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
  referrerPolicy: "strict-origin-when-cross-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: {
    geolocation: [],
    microphone: [],
    camera: [],
    payment: [],
    usb: [],
  },
  // Cross-Origin-Resource-Policy: same-site (default) — protege contra speculative attacks.
  crossOriginResourcePolicy: "same-site",
}));

// [SEGURANÇA] CORS Restrito — Aceita APENAS o frontend autorizado
app.use(cors({
  origin: [
    'https://trend-scope.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: true,
}));

// [SEGURANÇA] Limite de body (anti payload bomb)
app.use(bodyLimit({ maxSize: 1 * 1024 * 1024 })); // 1MB (reduzido de 50MB)

// Health check — usado por Docker HEALTHCHECK e monitoring externo.
// Roda DEPOIS dos middlewares de segurança para que health seja consistente
// com o resto da API (sem bypass de defesas).
// TODO (item 38): split em /api/health/live (sempre 200) vs /api/health/ready
// (verifica conexão TiDB + Serper).
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction && !process.env.VERCEL) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    logger.info("Server running", { url: `http://localhost:${port}/`, port });
  });
}
