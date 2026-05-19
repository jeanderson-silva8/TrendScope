# ADR-003 — Rate limit in-memory por instância serverless + persistência de queries em claro

> **Status:** Aceito (dívida temporária, com gatilhos objetivos de revisita)
> **Data:** 2026-05-18
> **Relacionado:** [`ADR-002-sem-auth.md`](ADR-002-sem-auth.md), [`THREAT_MODEL.md`](../THREAT_MODEL.md).

## Contexto

Auditoria 2026-05-18 levantou dois problemas relacionados:

1. **Rate limit in-memory por instância:** `rateMap = new Map()` em `server/search.ts:39`. Vercel serverless escala horizontalmente (várias instâncias rodando em paralelo), cada uma com seu próprio `Map`. Atacante consegue N × limite × instâncias. Em cold start, contador zera — burst de N requests sucessivas zera o limite.

2. **Queries dos usuários persistidas em claro:** `searches.query` (TiDB) guarda a string exata digitada. Sem hash, sem TTL. Queries podem revelar intenção pessoal sensível ("ansiedade tratamento", "saída de relacionamento abusivo", "cnpj pessoa X").

## Decisão

**Aceitar ambos como dívida temporária, com gatilhos objetivos pra refactor:**

### Rate limit
- Manter `Map` in-memory **por enquanto** (Vercel free tier; tráfego baixo)
- Quando migrar: Redis (Upstash) ou Vercel KV → contador compartilhado entre instâncias com TTL nativo

### Persistência de queries
- Manter `searches.query` em claro **por enquanto** (uso atual é só ordenar por popularidade)
- Quando refatorar:
  - **Opção A (mais simples):** hash SHA-256 da query (suficiente pra deduplicação + contagem; query individual não é recuperável)
  - **Opção B (mais flexível):** TTL de 30 dias (jobs noturnos limpam `searches` antigos)
  - **Opção C (mais cara):** criptografia em nível de aplicação com chave em KMS

## Por que aceitar agora

1. **Tráfego é baixo.** Demo público com volume previsível de algumas dezenas/centenas de buscas por dia. Rate limit in-memory cobre 95% do abuso real.
2. **Cold start zera mas é raro.** Vercel mantém instância "quente" por ~5 minutos de inatividade. Atacante sério com botnet evita o problema de qualquer jeito — solução real é Cloudflare/WAF, não Redis.
3. **Queries sem auth = sem PII real.** Como não há `userId`, atacante que rouba dump não consegue ligar query a pessoa. Reduz drasticamente o impacto.
4. **Upstash Redis tem custo e setup.** Vale quando o tráfego justificar. Hoje, não justifica.

## Gatilhos pra revisitar

Esta decisão **expira** quando:

| Gatilho | Refactor necessário |
|---------|---------------------|
| Tráfego médio > 100 buscas/min agregado | Migrar rate limit pra Redis/Upstash |
| Implementar auth (ADR-002 expira) | Avaliar associação `userId + query` → vira PII real → hash/criptografia obrigatória |
| Aparecer incidente de abuso (créditos Serper estourados, scraping massivo) | Migração imediata |
| LGPD/auditoria externa exigir | Implementar Opção A (hash) imediatamente |

## Trade-offs assumidos

| O que se ganha | O que se perde |
|---|---|
| Setup simples (sem Redis na infra) | Rate limit pode ser driblado por atacante com IPs diversos OU por timing de cold start |
| Persistência simples de queries (debugging, popularidade) | Dump do banco vaza queries crus — sensível se for PII |
| Foco em entregar features de UX | Item 35 (rate limit por usuário) e item 49 (retenção LGPD) ficam em parcial |

## Alternativas consideradas

- **Implementar Redis agora:** rejeitado pelo custo (Upstash free tier tem limites; cobranças além disso). Tráfego não justifica.
- **Vercel KV:** considerado, mas é beta e add-on pago.
- **Cloudflare Workers KV:** exigiria migrar runtime — fora do escopo desta auditoria.
- **Hash da query no DB:** considerado, e deve ser próximo refactor (custo ~30min). Não bloqueia auditoria atual mas vai entrar em sessão futura quando tiver capacidade.

## Referências

- [`AUDIT_REPORT_2026-05-18.md`](../AUDIT_REPORT_2026-05-18.md) — achados C2, C4, adendo H
- [Upstash Redis](https://upstash.com/) — opção de migração
- Item 35, 36, 49 do `AUDIT_CHECKLIST.md`
