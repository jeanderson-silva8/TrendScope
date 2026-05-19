# Threat Model — TrendScope

> **Status:** atualizado em 2026-05-18 após auditoria.
> **Relacionado:** [`AUDIT_REPORT_2026-05-18.md`](AUDIT_REPORT_2026-05-18.md), [`adr/`](adr/).

---

## Ativos protegidos

| Ativo | Onde vive | Sensibilidade |
|-------|-----------|---------------|
| Queries de busca dos usuários | `searches` (TiDB) | **Média** — pode revelar intenção pessoal ("ansiedade tratamento", "saída de relacionamento abusivo") |
| Cache de resultados curados | `searches.resultados_curados` (TiDB) | Baixa — dados públicos (links + títulos) |
| `SERPER_API_KEY` | env var Vercel | **Alta** — créditos pagos por uso |
| `APP_SECRET` (JWT signing) | env var Vercel | **Crítica** — assina tokens internos |
| Credenciais TiDB (`DATABASE_URL`) | env var Vercel | **Crítica** — acesso direto ao banco |
| Disponibilidade do serviço | infra Vercel + TiDB | Média — downtime de demo é OK |

## Atores de ameaça

| Ator | Motivação | Capacidade | Probabilidade |
|------|-----------|-----------|---------------|
| **Script kiddie / bot** | Scan oportunista | Baixa | Alta (qualquer endpoint público é varrido) |
| **Visitante curioso** | Explorar demo, testar limites | Baixa | Alta |
| **Atacante de custo** | Drenar créditos da Serper.dev | Média | Média (rate limit teatral antes da auditoria) |
| **Adversário direcionado** | Comprometer projeto, deface | Alta | Baixa (alvo de baixo valor) |

## Superfícies de ataque

| Superfície | Status (após auditoria 2026-05-18) |
|-----------|-------------------------------------|
| `/api/trpc/search.search` (público, sem auth) | ✅ Validação Zod, rate limit IP confiável (`x-vercel-forwarded-for`), TRPCError padrão |
| `/api/health` | ✅ Endpoint mínimo, mesmo pipeline (`secureHeaders`) que `/api/trpc` |
| Headers HTTP | ✅ `secureHeaders()` no Hono (CSP, HSTS, XFO) + headers Vercel pro frontend |
| CORS | ✅ Allowlist explícita (`trend-scope.vercel.app` + localhosts dev) |
| Body limit | ✅ 1MB no Hono (anti payload bomb) |
| Validação de input | ✅ Zod (`min(1).max(200)`) em `searchRouter` |
| Frontend (`src/`) | ✅ CSP estrita em `vercel.json`; ErrorBoundary não vaza `error.message` |
| Dockerfile | ✅ Multi-stage, USER não-root, sem `.env` na imagem, sem proxy/mirror inseguro |
| Dependências | ✅ Dependabot semanal + `npm audit` no CI |
| `.env` no histórico git | ✅ Nunca commitado (verificado em 2026-05-18) |

## STRIDE aplicado

### S — Spoofing
- Único caminho de "identidade" é o IP do cliente (rate limit). Vercel injeta `x-vercel-forwarded-for` não-fakeável. ✅
- Sem login/auth no projeto — ver ADR-002.

### T — Tampering
- Inputs sanitizados via Zod antes de chegar nos resolvers tRPC. ✅
- Drizzle ORM com tagged templates — sem concatenação de SQL. ✅

### R — Repudiation
- Sem audit log de buscas (não-necessário hoje, sem auth nem PII).
- Logs do Vercel registram requests; suficiente pra forense em incidente.

### I — Information disclosure
- ErrorBoundary não exibe `error.message` cru ao usuário em prod. ✅
- CSP impede exfiltração via XSS. ✅
- `secureHeaders` impede sniffing/clickjacking. ✅
- **Risco residual:** queries dos usuários persistidas crú em `searches.query` — sem hash, sem TTL. Ver ADR-003.

### D — Denial of service
- Rate limit por IP (10 req/min) via `checkRateLimit`. Mitiga atacante ingênuo.
- **Risco residual:** rate limit in-memory por instância serverless — cold start zera contador. Ver ADR-003. Migração para Redis/Upstash planejada quando houver tráfego que justifique.
- bodyLimit 1MB impede payload bomb. ✅

### E — Elevation of privilege
- Sem multi-tier de privilégio (não há admin nem user — só endpoint público). N/A.

## Riscos residuais conhecidos (documentados, não-bloqueantes)

1. **Rate limit in-memory** (ADR-003) — quebra em escala horizontal (cold start zera). OK enquanto tráfego é baixo.
2. **Queries persistidas em claro** (ADR-003) — TTL/hash planejados quando houver volume real.
3. **Sem auth** (ADR-002) — projeto é demo público por design; auth viria com modelo de negócio (paywall, quotas por user, etc.).
4. **CSP com `'unsafe-inline'` em `script-src`** do frontend — limitação de Vite sem plugin de nonces. Aceitável por enquanto (mesmo trade-off do Lumina ADR-003).

## Quando revisitar este threat model

- Quando o projeto sair do estágio de demo público
- Quando coletar qualquer dado pessoal real
- Quando integrar pagamento
- A cada nova auditoria via [Protocolo de Segurança](https://github.com/jeanderson-silva8/protocolo-de-seguranca)
- Quando adicionar nova feature de superfície externa (upload, webhooks, OAuth)
