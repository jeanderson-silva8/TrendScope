# ADR-004 — CSP com `'unsafe-inline'` em `script-src` (dívida temporária)

> **Status:** Aceito como dívida explícita — revisitar com plugin de nonces do Vite.
> **Data:** 2026-05-18
> **Contexto:** auditoria 2026-05-18, peer review 2026-05-18 (achado médio).
> **Relacionado:** [ADR-001](ADR-001-stack.md), [`vercel.json`](../../vercel.json), item 32 do `AUDIT_CHECKLIST.md`.

## Contexto

A CSP do frontend em `vercel.json` inclui `'unsafe-inline'` em `script-src`:

```json
"script-src 'self' 'unsafe-inline'"
```

Peer review 2026-05-18 classificou como **teatro de segurança parcial**: `'unsafe-inline'` em script-src anula a principal proteção da CSP contra XSS. Se atacante conseguir injetar `<script>` em qualquer parte do DOM (via XSS persistente, dependência comprometida no `node_modules`, ou poisoning de CDN), o browser executa.

Mesmo caso e mesmo trade-off do Lumina ADR-003 (CSP unsafe-inline) — registrado aqui pra TrendScope ter sua própria documentação rastreável.

## Por que está assim

O Vite, no build de produção, gera `<script type="module">` inline no `index.html` para bootstrap da aplicação. Sem `'unsafe-inline'`, esse script bloqueia e a aplicação não carrega.

As soluções "corretas" são:

1. **Nonces** — gerar nonce por request, injetar no header CSP E nos atributos `nonce=` dos scripts. Exige plugin de Vite + edge worker no Vercel (ou Vercel Functions middleware) que injeta o nonce no HTML servido.
2. **Hashes** — calcular SHA-256 de cada script inline no build, listar no header CSP. Exige plugin + manter hashes sincronizados.
3. **Eliminar scripts inline** — extrair tudo do `index.html` para arquivos externos. Mexe no template do Vite.

Nenhuma é trivial; todas adicionam complexidade ao build.

## Decisão

**Manter `'unsafe-inline'`. Migrar pra nonces via plugin Vite quando o projeto sair de demo público.**

## Por que aceitar o risco agora

1. **Sem auth, sem PII real.** Demo público sem dados de usuário persistidos com `userId`. Um XSS bem-sucedido daria acesso a queries sintéticas, não a contas de usuários.
2. **Sem feature de input renderizado como HTML.** Não há comentários, descrições, markdown — vetores comuns de XSS persistente. O vetor real exige feature que ainda não existe.
3. **Defesas em profundidade ativas** mesmo com `'unsafe-inline'`:
   - `frame-ancestors 'none'` — clickjacking bloqueado.
   - `object-src 'none'` — Flash/plugins bloqueados.
   - `base-uri 'self'` — base tag hijacking bloqueado.
   - `form-action 'self'` — submissão de formulário pra terceiros bloqueada.
   - HSTS + `nosniff` + `X-Frame-Options=DENY` — em camada de header.
   - `Permissions-Policy` bloqueia geo/mic/cam/payment.
   - `ProtectedRoute` (frontend) valida JWT — N/A aqui porque não tem ProtectedRoute, mas listado pra coerência com Lumina.

4. **Refactor não traz valor visível** comparado a, por exemplo, implementar Redis pra rate limit distribuído (ADR-003). Em ordem de impacto, este item fica abaixo dessas pendências.

## Quando revisitar

Esta decisão **expira** quando:

- [ ] Qualquer feature começar a renderizar input do usuário como HTML (comentários, descrições, markdown).
- [ ] Qualquer dado de PII real começar a fluir pelo frontend.
- [ ] Saída do estágio de demo público declarada no README.
- [ ] Adicionada dependência de UI nova → revisar impacto em supply chain.

Quando disparar, implementar via `vite-plugin-csp-guard` ou approach manual com edge function no Vercel.

## Trade-offs assumidos

| O que se ganha | O que se perde |
|---|---|
| Build Vite simples (zero plugin extra) | XSS em qualquer das 50+ deps de UI (`@radix-ui/*`, `recharts`, `embla-carousel`, etc.) executa script no contexto da página |
| Não atrasa entrega de outros itens do plano de ação | Item 32 do checklist permanece em "parcial" — CSP existe mas é frouxa em `script-src` |

## Defesas em profundidade que substituem parcialmente

Como `'unsafe-inline'` em script-src é fraqueza, intensificamos outras camadas:

- **CSP `default-src 'self'`** força allowlist explícita em todas as outras diretivas.
- **`object-src 'none'`** + **`base-uri 'self'`** + **`frame-ancestors 'none'`** fecham vetores não-script.
- **`Referrer-Policy: strict-origin-when-cross-origin`** limita info que vaza.
- **`Permissions-Policy`** bloqueia APIs sensíveis (geo/mic/cam/payment) mesmo com XSS.
- **Backend CSP `default-src 'none'`** (server/boot.ts) — API só retorna JSON; sem vetor de XSS no backend.

## Alternativas consideradas

- **Implementar nonces agora via plugin Vite:** rejeitado por custo/benefício neste estágio. ~3-5h de configuração + risco de quebrar build em prod.
- **Eliminar scripts inline do `index.html`:** rejeitado por mexer no template do Vite — frágil entre versões.
- **Remover CSP por completo:** descartado — mesmo com `unsafe-inline` em script-src, as outras diretivas cobrem ~70% dos vetores comuns.

## Referências

- `vercel.json` — onde a CSP atual mora.
- `AUDIT_REPORT_2026-05-18.md` — peer review que motivou este ADR.
- Item 32 do `AUDIT_CHECKLIST.md` ("CSP estrita sem unsafe-inline em script-src").
- [Lumina ADR-003 — CSP unsafe-inline](https://github.com/jeanderson-silva8/Lumina-Booking-SaaS/blob/main/docs/adr/ADR-003-csp-unsafe-inline.md) — mesma classe de dívida, mesma justificativa.
