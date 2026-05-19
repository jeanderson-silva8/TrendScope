/**
 * Handler catchall do Vercel: delega TODO o tráfego `/api/*` ao app Hono
 * definido em `server/boot.ts`.
 *
 * Auditoria 2026-05-18 C2 (item 17 do checklist universal — "caminho de
 * produção é o mesmo que o caminho auditado?"):
 * versão anterior tinha `api/trpc/[...trpc].ts` (262 linhas) duplicando
 * `server/search.ts` SEM middleware (sem secureHeaders, sem cors estrito,
 * sem bodyLimit, sem rate limit confiável, sem fail-fast de envs). Era o
 * handler que efetivamente servia o tráfego em produção — `server/boot.ts`
 * só rodava em dev local.
 *
 * Agora este arquivo único delega para `app.fetch` do boot.ts. Significa
 * que TODA defesa configurada no Hono (headers, cors, body limit, tRPC
 * com env validado) roda em produção Vercel. Os 262 linhas duplicadas
 * foram deletadas.
 */
import app from "../server/boot";

export const config = {
  // Vercel: rodar como Edge ou Node? Mantemos Node por causa do tidb-serverless
  // que precisa de TLS nativo. Trocar para "edge" exigiria runtime compatível.
  runtime: "nodejs",
};

// Handler único: Vercel passa Request padrão da Fetch API, Hono devolve Response.
// `app.fetch(req)` aplica TODO o pipeline de middleware antes de chegar nos resolvers.
export default async function handler(req: Request): Promise<Response> {
  return app.fetch(req);
}
