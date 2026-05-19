# ADR-001 — Stack: Hono + tRPC + Drizzle + TiDB Serverless via Vercel

> **Status:** Aceito
> **Data:** 2026-05-18 (formalizado durante auditoria; decisão original anterior)
> **Relacionado:** [`THREAT_MODEL.md`](../THREAT_MODEL.md), [`AUDIT_REPORT_2026-05-18.md`](../AUDIT_REPORT_2026-05-18.md).

## Contexto

TrendScope é demo público de search/trending sem auth, sem dados sensíveis, deploy serverless. Precisava de stack que:
- Suportasse deploy zero-config na Vercel (gratuito)
- Tivesse type-safety end-to-end (frontend pede shape exato do que backend devolve)
- Não cobrasse infraestrutura idle (sem servidor sempre ligado)
- Fosse JavaScript/TypeScript (consistência com frontend React)

## Decisão

**Stack final:**
- **Frontend:** React 19 + Vite + TailwindCSS + shadcn/ui (Radix)
- **API layer:** tRPC v11 (type-safety end-to-end, sem schema duplicado)
- **HTTP runtime:** Hono (web framework do tRPC, performático, deno/bun/node compatível)
- **ORM:** Drizzle (queries tipadas, sem ActiveRecord, SQL-first)
- **Banco:** TiDB Serverless (compatível com MySQL, billing per-request, sem cold start visível ao usuário)
- **Hospedagem:** Vercel (serverless functions + CDN do frontend)
- **Busca externa:** Serper.dev (proxy do Google Search com API simples)

## Por que essa combinação (vs alternativas óbvias)

| Alternativa | Por que rejeitada |
|-------------|---------------------|
| Express + Mongoose | Mais verboso; sem type-safety no client; Mongo não cobre relacional |
| Next.js + Prisma + Postgres | Excesso de funcionalidade pra demo; Prisma + Postgres serverless = cold start agressivo |
| FastAPI (Python) + SQLAlchemy | Stack heterogênea (Python no back, JS no front); deploy Vercel exige Python serverless (suporte limitado) |
| Cloudflare Workers + D1 | D1 ainda em beta; Workers tem limites de runtime que complicariam o crawler Serper |
| Supabase | Bom mas amarra a auth + storage + edge functions; aqui não precisa de auth |

## Trade-offs aceitos

| Ganho | Custo |
|-------|-------|
| tRPC type-safety end-to-end | Acoplamento client↔server tipado — refactor de schema impacta os dois lados |
| TiDB Serverless billing por request | Latência ~50-100ms primeira query (cold), aceitável pra search |
| Vercel zero-config | Limitações: timeout 10s no plano gratuito; cold start serverless function ~200ms |
| Hono mais leve que Express | Menos ecosystem (mas suficiente — bodyLimit, secureHeaders, cors estão lá) |
| Drizzle SQL-first | Migrações precisam ser geradas explicitamente (`drizzle-kit generate`) |
| Sem ORM "mágico" | Queries mais verbosas que Mongoose, mas mais explícitas |

## Quando revisitar

- Se o produto evoluir pra ter auth + multi-user → reavaliar (Supabase, Clerk + Postgres, etc.)
- Se latência da Serper.dev virar gargalo → considerar self-host com Searxng (mas mais infra pra manter)
- Se Vercel ficar caro com tráfego → migrar pra Cloudflare Workers ou self-host

## Referências

- [Hono](https://hono.dev/) — web framework
- [tRPC](https://trpc.io/) — RPC type-safe
- [Drizzle](https://orm.drizzle.team/) — ORM TypeScript
- [TiDB Serverless](https://tidbcloud.com/) — MySQL-compatible serverless
- [Serper.dev](https://serper.dev/) — Google Search API proxy
