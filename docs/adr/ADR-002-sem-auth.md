# ADR-002 — Sem autenticação (demo público por design)

> **Status:** Aceito (versão de portfólio/demo)
> **Data:** 2026-05-18
> **Relacionado:** [`ADR-001-stack.md`](ADR-001-stack.md), [`THREAT_MODEL.md`](../THREAT_MODEL.md).

## Contexto

TrendScope é showcase de search + curadoria de tendências. A pergunta natural numa auditoria é: "por que `/api/trpc/search.search` é público sem rate limit por usuário?"

## Decisão

**Não implementar autenticação nesta versão.** TrendScope é demo público — visitante acessa, busca, vê resultados. Sem cadastro, sem conta, sem perfil.

## Por que aceitar essa lacuna agora

1. **Não há diferença de privilégio.** Sem admin, sem dono de recurso, sem "tenant" — todos os visitantes têm a mesma capacidade.
2. **Não há dado pessoal do usuário pra proteger.** As queries de busca são persistidas no `searches` mas sem associação a userId (sem userId no banco). Ver ADR-003 para limitações desse modelo.
3. **Custo operacional desproporcional.** Implementar auth exigiria:
   - Provedor (Clerk, Supabase Auth, Auth0) ou implementação caseira (bcrypt + JWT + revogação)
   - UI de signup/login/forgot password
   - Política de senha + rate limit em endpoints de auth (item 12 do checklist)
   - Email transacional pra reset (Resend, SendGrid)
   - Política de retenção e direito ao esquecimento (LGPD)
   - **Tudo isso pra demo que não monetiza** — escopo errado.
4. **Defesas existentes substituem 80% do que auth daria:**
   - Rate limit por IP (corrigido na auditoria — IP confiável via `x-vercel-forwarded-for`)
   - bodyLimit 1MB (anti payload bomb)
   - CORS allowlist (só `trend-scope.vercel.app` + localhost dev)
   - CSP estrita (sem `unsafe-inline` no backend, frontend documentado)

## Quando revisitar

Esta decisão **expira** quando qualquer dos seguintes acontecer:
- Implementar paywall, créditos, ou qualquer cobrança recorrente
- Coletar email/telefone/nome do usuário pra qualquer propósito
- Adicionar feature que cria "recurso pertencente a alguém" (favoritos, histórico personalizado, alertas)
- Sair do estágio de demo público declarado no README

Quando disparar:
1. Implementar auth via provider (Clerk recomendado — menos código boilerplate que Auth0)
2. Reabrir auditoria — itens 1, 2, 3, 9, 10, 12 do checklist viram aplicáveis
3. Modelar `tenant_id` se houver mais de um nível de privilégio

## Trade-offs assumidos

| O que se ganha | O que se perde |
|---|---|
| Demo simples, sem fricção de signup | Não dá pra usar TrendScope como "produto" — só como demo |
| Sem complexidade de auth (login, refresh, revogação, reset) | Atacante de custo pode forçar rate limit ao máximo sem accountability |
| Rate limit por IP cobre a maior parte do abuso oportunista | Atacante com botnet (IPs diversos) eventualmente passa |

## Alternativas consideradas

- **Auth obrigatória desde o início:** rejeitada pelo custo (item 3 acima)
- **Auth opcional (anonymous + logged-in):** rejeitada — duplica caminhos de código sem ganho real
- **Captcha pra rate limit:** considerada, mas adiciona fricção pra demo sem benefício enquanto não há abuso real
