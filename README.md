# 🔍 TrendScope
**Motor full-stack de curadoria de tendências com tipagem ponta a ponta (tRPC) e banco distribuído (TiDB Serverless).**

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white) ![tRPC](https://img.shields.io/badge/tRPC-11-2596BE?style=for-the-badge&logo=trpc&logoColor=white) ![Hono](https://img.shields.io/badge/Hono-4-E36002?style=for-the-badge&logo=hono&logoColor=white) ![TiDB](https://img.shields.io/badge/TiDB-Serverless-FF4500?style=for-the-badge) ![Drizzle](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=for-the-badge)

🟢 **LIVE DEMO:** [Acesse o TrendScope Ao Vivo Aqui](https://trend-scope.vercel.app)
🛡️ **Auditoria de Segurança Aplicada:** [Veja a Auditoria 2026-05-18 e o plano de ação executado](docs/AUDIT_REPORT_2026-05-18.md)

---

## 🛑 O Problema
Profissionais que precisam se manter atualizados — marketeiros, criadores de conteúdo, pesquisadores, founders — perdem tempo absurdo navegando entre dezenas de abas, feeds de redes sociais, newsletters e agregadores de notícias para encontrar o que realmente importa sobre um tema. Ferramentas de busca tradicionais retornam centenas de links irrelevantes, sem curadoria, sem imagens contextuais e sem nenhum tipo de inteligência na apresentação dos resultados.

## ✅ A Solução (TrendScope)
TrendScope é um motor de curadoria que transforma uma simples pesquisa em um painel visual com os **5 resultados mais relevantes** sobre qualquer tema, enriquecidos com imagens OG extraídas automaticamente dos sites de origem.

Resolve o problema do "excesso de ruído" usando a API Google via Serper.dev como fonte primária, combinada com cache em memória + persistência em TiDB Serverless para respostas instantâneas em buscas recorrentes. Arquitetura inteiramente tipada de ponta a ponta — do schema do banco (Drizzle ORM) até o frontend (tRPC + React Query) — eliminando desincronização entre API e interface.

---

## ⚠️ Escopo desta versão

**Demo público sem autenticação.** Decisões de escopo conscientes, documentadas em ADRs:

- **Sem autenticação** ([ADR-002](docs/adr/ADR-002-sem-auth.md)) — qualquer visitante usa sem cadastro. Implementar auth exigiria custo desproporcional pra demo que não monetiza. Auth virá com modelo de negócio (paywall, créditos, etc.).
- **Rate limit in-memory por instância serverless** ([ADR-003](docs/adr/ADR-003-rate-limit-in-memory.md)) — cobre abuso oportunista; quebra em escala horizontal real. Migração para Redis/Upstash quando o tráfego justificar.
- **Queries dos usuários persistidas em claro** ([ADR-003](docs/adr/ADR-003-rate-limit-in-memory.md)) — usadas só pra contar popularidade. Hash/TTL planejados como refactor quando houver volume real ou quando ADR-002 expirar (auth = queries viram PII real).
- **Sem testes Vitest abrangentes** — suíte mínima planejada ([CI](.github/workflows/ci.yml) já roda lint + typecheck + npm audit + gitleaks).
- **Stack confirmada:** [ADR-001](docs/adr/ADR-001-stack.md).

---

## 🧠 Maior Desafio Técnico Superado
**Garantir que buscas em tempo real via API externa não degradassem a experiência do usuário, mesmo sob latência de rede, cold starts do banco serverless ou exaustão de créditos da API.**

Implementei uma **arquitetura de resiliência em 3 camadas de fallback**:

1. **Camada 1 — In-memory cache (TTL 5 min):** Antes de qualquer chamada externa, o sistema verifica um `Map` em memória com TTL controlado. Se a query já foi pesquisada nos últimos 5 minutos, os resultados são devolvidos em **< 1ms**, sem tocar rede, API ou banco.
2. **Camada 2 — Serper.dev API + OG image extraction:** Se o cache não tem a query, o motor dispara uma chamada à API Google (via Serper.dev) com timeout de 4 segundos. Para cada resultado, um scraper paralelo extrai meta tags `og:image` dos sites em até 2.5s cada — nenhuma imagem trava a resposta principal.
3. **Camada 3 — Mock engine contextual:** Se a API estiver indisponível (sem créditos, offline ou timeout), o sistema gera resultados de demonstração contextualizados com a query real — nunca tela vazia ou erro bruto.

Adicionalmente, a persistência no banco (TiDB) opera com **`Promise.race` de 2 segundos** — se o banco serverless estiver em cold start e não responder a tempo, a API retorna os resultados normalmente e ignora silenciosamente o salvamento. Usuário nunca percebe.

---

## 🔒 Segurança

Defesas configuradas e **rodando em produção** (auditoria 2026-05-18 confirmou paridade dev/prod após unificação do backend):

| Camada | Implementação | Status |
|---|---|---|
| Headers HTTP | `secureHeaders()` do Hono — CSP estrita (`default-src 'none'` para JSON), HSTS preload, nosniff, XFO=DENY, Referrer-Policy, Permissions-Policy ([`server/boot.ts:19`](server/boot.ts)) | ✅ |
| CSP frontend | `vercel.json` com CSP completa, HSTS, X-Frame-Options, Permissions-Policy aplicada ao SPA | ✅ |
| CORS | Allowlist explícita (`trend-scope.vercel.app` + localhost dev), não wildcard ([`server/boot.ts:22-31`](server/boot.ts)) | ✅ |
| Body limit | 1MB no Hono (anti payload bomb) ([`server/boot.ts:34`](server/boot.ts)) | ✅ |
| Validação de input | Zod (`min(1).max(200)`) em tRPC ([`server/search.ts:252`](server/search.ts)) | ✅ |
| Rate limit | Por IP (10 req/min); usa `x-vercel-forwarded-for` (não-fakeável) ([`server/search.ts:254`](server/search.ts)) | ✅ |
| Erros tRPC | `TRPCError({ code: "TOO_MANY_REQUESTS" })` em vez de `throw new Error(...)` — cliente trata via `data.code` ([`server/search.ts:266`](server/search.ts)) | ✅ |
| Fail-fast envs | Zod no boot — app aborta com mensagem clara se faltar `DATABASE_URL`/`SERPER_API_KEY`/`APP_SECRET` ([`server/lib/env.ts`](server/lib/env.ts)) | ✅ |
| Paridade dev/prod | Vercel routing → `api/[...route].ts` → mesmo `app.fetch` do dev — antes havia handler duplicado sem middleware ([ver C2 da auditoria](docs/AUDIT_REPORT_2026-05-18.md)) | ✅ |
| ErrorBoundary | Não vaza `error.message` cru — exibe correlation ID curto, log completo só em devtools ([`src/components/ErrorBoundary.tsx`](src/components/ErrorBoundary.tsx)) | ✅ |
| Container | Dockerfile multi-stage, `USER app` não-root, sem `.env` na imagem, sem proxy/mirror inseguro, HEALTHCHECK ([`Dockerfile`](Dockerfile)) | ✅ |
| Dependências | Dependabot semanal + `npm audit --audit-level=high` no CI ([`.github/dependabot.yml`](.github/dependabot.yml)) | ✅ |
| Logger | Estruturado (JSON em prod, legível em dev) — sem `console.*` espalhado ([`server/lib/logger.ts`](server/lib/logger.ts)) | ✅ |
| CI | Lint + typecheck + tests + build + npm audit + gitleaks a cada push/PR ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) | ✅ |
| Governança | `SECURITY.md` + `docs/THREAT_MODEL.md` + 3 ADRs | ✅ |

**O que NÃO está implementado** (e por quê):

- **Autenticação** — ADR-002. Demo público; auth virá com modelo de negócio.
- **Rate limit distribuído (Redis/Upstash)** — ADR-003. Migração quando tráfego justificar.
- **Hash/TTL nas queries persistidas** — ADR-003. Refactor planejado.
- **Audit log de acesso a dados** — sem usuários autenticados, sem `userId` pra logar.
- **Encryption at rest em nível de aplicação** — TiDB Cloud já faz TDE; sem PII real pra justificar criptografia adicional.
- **MFA / 2FA** — N/A (sem auth).
- **Política de retenção LGPD formal** — pendente quando queries virarem PII (após auth).

Para reportar vulnerabilidades, veja [`SECURITY.md`](SECURITY.md). Modelagem completa em [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

---

## 📐 Decisões Arquiteturais

Documentadas em [`docs/adr/`](docs/adr/):

- **[ADR-001 — Stack](docs/adr/ADR-001-stack.md)** — Por que Hono + tRPC + Drizzle + TiDB Serverless via Vercel (e não Express/Next/Prisma)
- **[ADR-002 — Sem autenticação](docs/adr/ADR-002-sem-auth.md)** — Demo público; gatilhos pra implementar auth
- **[ADR-003 — Rate limit in-memory + queries em claro](docs/adr/ADR-003-rate-limit-in-memory.md)** — Dívida temporária com gatilhos objetivos de refactor

---

## ✨ Principais Funcionalidades

- **Busca em tempo real (Google via Serper.dev):** 5 resultados mais relevantes com título, descrição, link, data.
- **OG image extraction automática:** Scraper de meta tags `og:image`/`twitter:image`, com fallback para screenshots via mShots.
- **Histórico com ranking:** Buscas persistidas no banco com contador incremental; "Tendências Populares" ordenadas por frequência.
- **Estatísticas em tempo real:** Total de buscas, queries únicas, uptime — via queries SQL agregadas.
- **Cache inteligente (TTL 5 min):** `Map` com eviction (limite 500 entries).
- **UI premium:** Glassmorphism, skeleton loading, micro-interações, confetti, dark mode.

---

## 🛠️ Stack Tecnológico & Arquitetura

### 1. Frontend (SPA — CDN Vercel)
- React 19 + TypeScript + Vite 7
- tRPC Client (`@trpc/react-query`) + TanStack React Query — cache, invalidação, loading states automáticos
- Tailwind CSS + shadcn/ui (Radix Primitives), animações com Framer Motion

### 2. Backend (Hono — Vercel Serverless Functions)
- Hono v4 (framework leve, ~14KB) rodando sobre Node.js runtime do Vercel
- tRPC v11 com SuperJSON transformer — tipagem compartilhada server↔client sem codegen
- **Procedures:** `search.search`, `search.popular`, `search.stats`, `ping`
- **Pipeline único:** `api/[...route].ts` → `server/boot.ts` → `secureHeaders` + `cors` + `bodyLimit` → `appRouter` (igualdade dev/prod garantida — ver C2 da auditoria)
- Integração Serper.dev com `AbortController` (timeout 4s) + OG image scraper paralelo

### 3. Banco de Dados
- **TiDB Serverless** — MySQL distribuído, HTAP, billing per-request
- **Drizzle ORM** — schema tipado, migrações versionadas (`drizzle-kit generate/migrate/push`), queries type-safe
- **Schema:** tabela `searches` (`id`, `query`, `count`, `resultados_curados`, timestamps)

---

## 📂 Visão Geral da Estrutura

```text
├── api/
│   ├── [...route].ts      # Catchall Vercel — delega TUDO pro app Hono (server/boot.ts)
│   └── index.ts           # Health check raiz
├── server/
│   ├── boot.ts            # Hono app com pipeline de segurança completo
│   ├── router.ts          # tRPC router principal (merge de sub-routers)
│   ├── search.ts          # Motor de busca: Serper + cache + rate limit + OG scraper
│   ├── middleware.ts      # initTRPC + SuperJSON
│   ├── context.ts         # Contexto tRPC (req, headers)
│   └── lib/
│       ├── env.ts         # Validação Zod das envs (fail-fast)
│       ├── logger.ts      # Logger estruturado
│       └── http.ts        # Helpers HTTP
├── db/
│   ├── schema.ts          # Drizzle schema
│   └── migrations/        # SQL migrations versionadas
├── src/
│   ├── pages/             # Home.tsx (página principal)
│   ├── sections/          # Hero, Features, HowItWorks, Results, Stats, Footer
│   ├── components/        # UI (shadcn/ui + custom + ErrorBoundary)
│   ├── providers/         # tRPC Provider + React Query
│   └── lib/               # Utilitários frontend
├── docs/
│   ├── AUDIT_REPORT_2026-05-18.md   # Auditoria de segurança
│   ├── THREAT_MODEL.md
│   └── adr/                          # 3 ADRs
├── .github/
│   ├── workflows/ci.yml              # CI: lint + typecheck + tests + audit + gitleaks
│   └── dependabot.yml                # Atualizações semanais
├── Dockerfile             # Multi-stage, não-root, sem .env na imagem
├── vercel.json            # Headers de segurança aplicados ao frontend
└── SECURITY.md            # Política de disclosure
```

---

## 👑 Autor

**Jeanderson Silva** 🤓✍️

*Desenvolvedor Full-Stack | Engenheiro Frontend | Arquiteto de Software*

Construído desde a modelagem de dados com Drizzle ORM + TiDB Serverless até a integração de APIs de busca em tempo real, passando por tipagem ponta a ponta com tRPC, hardening de segurança em produção (Dockerfile, CSP, fail-fast, paridade dev/prod) e UI de curadoria visualmente premium.
