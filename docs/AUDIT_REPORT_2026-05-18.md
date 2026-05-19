# Auditoria de Segurança — TrendScope

- **Data:** 2026-05-18
- **Método:** AUDIT_CHECKLIST.md v1.4.0 (itens 1-56) + adendos F (APIs públicas) e H (dados sensíveis), com cross-check em D (multi-tenant) e E (LLM)
- **Escopo declarado pelo autor:** produção real, **sem decisões conscientes de escopo** ("produção de verdade, sem placeholders") — toda discrepância entre README e código é tratada como achado, não como ADR
- **URL ao vivo:** https://trend-scope.vercel.app
- **Resultado em uma frase:** o README anuncia "Protocolo de Segurança Enterprise", mas o projeto **expõe segredos reais de produção no `.env` que entra na imagem Docker, não tem fail-fast em variáveis críticas, executa rate limit teatral (in-memory por serverless function + IP forjável), mantém duas implementações divergentes do backend (`server/` e `api/trpc/[...trpc].ts`) e não possui CSP, testes, CI nem documentação de segurança**.

---

## Como ler este relatório

Cada item do checklist universal foi verificado contra o código (não contra o README). Para cada ✅, há `arquivo:linha` que prova a mitigação. Quando o item é parcial ou violado, o relatório descreve o que existe e o que falta — com PoC textual quando aplicável.

Os achados estão agrupados em quatro blocos:

1. **Confirmado e excelente** — mitigação existe e está provada no código.
2. **Parcial** — algo começou mas não termina o trabalho.
3. **Críticos / violações** — bug real ou risco em produção.
4. **Polimentos** — baixa criticidade, ruído ou inconsistência cosmética.

---

## Nota sobre escopo

O autor declarou explicitamente que o projeto está em **produção, sem placeholders e sem decisões conscientes de escopo**. Esse é o ponto de partida da régua: **toda promessa do README que não tem prova no código é discrepância**, não trade-off. Em particular, o bloco "🔒 Protocolo de Segurança Enterprise" do README descreve seis camadas (headers, CORS, rate limit, sanitização, body limit, validação Zod) — cinco existem com ressalvas, uma é defesa parcial, e três aspectos ausentes (CSP estrita, fail-fast, segredos fora do repo de build) não são mencionados como ausentes.

---

## Bloco 1 — Confirmado e excelente

| # | Item do checklist | Arquivo:linha |
|---|---|---|
| 5 | Validação de input com Zod (`min(1).max(200)`) antes do controller | `server/search.ts:252`, `api/trpc/[...trpc].ts:168` |
| 14 | Queries parametrizadas via Drizzle ORM (`eq`, `sql` tagged template) — sem concatenação | `server/search.ts:226-244`, `db/schema.ts:10-17` |
| 16 | Sem `eval`, sem desserialização insegura, sem render de template com input do usuário | revisão completa de `server/` e `src/` |
| 41 | CORS com allowlist explícita (`trend-scope.vercel.app` + dois localhosts), não `*` | `server/boot.ts:22-31` |

São quatro itens sólidos. O resto da seção 🔴 Bloqueadores tem ressalvas — ver blocos 2 e 3.

---

## Bloco 2 — Parcial

### Item 31 — Headers de segurança (Helmet/equivalente)

**Existe:** `app.use(secureHeaders())` em `server/boot.ts:19`.

**Falta:** o `secureHeaders()` do Hono, por padrão, **não emite `Content-Security-Policy`** — ele só ativa CSP se for passado o objeto `contentSecurityPolicy`. O código chama com argumentos vazios. Resultado: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` e `Referrer-Policy` estão ativos com defaults, mas **CSP está ausente em todas as respostas da API** — apesar do README declarar "configura CSP automaticamente" (`README.md:36`).

**Correção:** passar configuração explícita:
```ts
app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
  },
}))
```

### Item 35 — Rate limit por usuário

**Existe:** rate limit de 30 req/min em `server/search.ts:39-53`.

**Falta:** é **por IP** (não por usuário — sem auth) **e in-memory por instância**. Em Vercel serverless, cada cold start tem seu próprio `Map`, e funções concorrentes têm `Map` independentes — o limite efetivo é "30 req/min por (IP, instância serverless)" e zera a cada novo container. Mesmo problema documentado no item E6 do adendo LLM (BrieflyAI).

### Item 30 — README honesto

**Existe:** o README explica corretamente a arquitetura geral, stack e fluxo de busca.

**Falta:** o bloco "🔒 Protocolo de Segurança Enterprise" promete coisas que o código não entrega:
- "CSP automaticamente" → CSP não é emitida (item 31 acima)
- "Rate Limiting por IP com janela deslizante" → janela é fixa (`resetAt = now + 60s`), não deslizante (`server/search.ts:47`)
- "Defesas em múltiplas camadas, seguindo o mesmo rigor de projetos corporativos" → não há fail-fast, nem teste, nem CI, nem audit log, nem SECURITY.md

### Item 38 — Health live + ready

**Existe:** `api/health.ts` retorna `{ ok: true }` sempre.

**Falta:** não é separado em `live` vs `ready`; não testa conexão ao banco antes de responder OK. Em cold start com `DATABASE_URL` quebrado, o handler responde 200 mascarando o problema.

---

## Bloco 3 — Críticos / violações

### 🔴 C1 — Segredos reais de produção embutidos na imagem Docker

**Arquivos:** `.env`, `Dockerfile:26`, `.dockerignore:1-5`

O arquivo `.env` na raiz contém credencial real do TiDB e a chave Serper:
```
DATABASE_URL="mysql://4T5bdLwHFd7kqXY.root:w0BjJ5X2RwKmLZN5@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/trendscope?sslaccept=strict"
SERPER_API_KEY="373134dfa5f84e4ac1dcce2c9f0115330aedaecb"
```

Embora `.env` esteja em `.gitignore` (`.gitignore:26`), o Dockerfile faz **explicitamente** `COPY package.json .env ./` em `Dockerfile:26`, e `.dockerignore` **não exclui `.env`** (`.dockerignore:1-5` só lista `node_modules`, `dist`, `.git`, `*.swp`, `*.log`).

**PoC textual:**
1. `docker build -t trendscope .`
2. `docker run --entrypoint cat trendscope /app/.env`
3. As credenciais TiDB e a chave Serper aparecem em claro em qualquer layer da imagem publicada.
4. Qualquer registry mirror, cache de build, ou desenvolvedor com acesso à imagem extrai o segredo.

Pior: como o repositório é público no GitHub (declarado no README, `git clone https://github.com/jeanderson-silva8/TrendScope.git`), a senha do banco e a API key **já devem ser consideradas comprometidas** independentemente do Docker — qualquer commit antigo do `.env` no histórico, qualquer log de CI vazado, qualquer compartilhamento da pasta resolve o segredo.

**Correção imediata:**
1. **Rotacionar AGORA** a senha do usuário TiDB `4T5bdLwHFd7kqXY.root` e a chave Serper `373134dfa5f84e4ac1dcce2c9f0115330aedaecb`.
2. Remover `.env` do disco (mover para `~/.env` ou gerenciador de segredos).
3. Adicionar `.env` ao `.dockerignore`.
4. Remover a linha `.env` do `COPY` no `Dockerfile`.
5. Em Vercel, configurar via Project Settings → Environment Variables.
6. Rodar `gitleaks detect --source . -v` no histórico Git para confirmar se o `.env` foi commitado em alguma versão.

### 🔴 C2 — Duas implementações divergentes do backend (drift de segurança)

**Arquivos:** `server/boot.ts`, `server/search.ts`, `api/trpc/[...trpc].ts:1-262`

O projeto contém **duas implementações completas e independentes** do backend tRPC:
- `server/` — usado por `npm run dev` (vite-dev-server) e pelo `start` standalone Node.
- `api/trpc/[...trpc].ts` — handler Vercel Node.js que **duplica** schema, cache, rate limit, sanitização, lógica Serper, persistência, mocks (262 linhas inline) e é o que efetivamente roda em produção via `https://trend-scope.vercel.app/api/trpc/*`.

Divergências relevantes encontradas:
| Aspecto | `server/search.ts` | `api/trpc/[...trpc].ts` |
|---|---|---|
| Timeout Serper | 4000 ms (linha 157) | **8000 ms** (linha 106) |
| Rate limit threshold | constante `RATE_LIMIT_MAX = 30` | número mágico `30` inline (linha 68) |
| `secureHeaders()`, CORS, bodyLimit | sim, em `boot.ts` | **ausentes** — handler Vercel não passa por `boot.ts` |
| Resposta de erro | `console.log` antes do throw | `console.error("[TRPC_HANDLER_ERROR]", err)` + 500 genérico |

**Impacto:** o que está em produção (`api/trpc/[...trpc].ts`) **não tem `secureHeaders`, não tem CORS configurado, não tem `bodyLimit`** — todas as "defesas perimetrais" do README, que vivem em `server/boot.ts`, **não se aplicam ao caminho de produção**. O `vercel.json` está praticamente vazio (`{"framework": "vite"}`) e não roteia para `boot.ts`.

**PoC textual:** `curl -H "Origin: http://attacker.example" https://trend-scope.vercel.app/api/trpc/search.search?batch=1&input=...` — a resposta provavelmente não conterá `Access-Control-Allow-Origin` restrito ao domínio próprio (porque o handler Vercel não monta o middleware CORS do Hono).

**Correção:** unificar. Ou:
- Apagar `api/trpc/[...trpc].ts` e roteamento Vercel `api/index.ts` (que importa `boot.ts`) — passa todo o tráfego pelo `boot.ts` (que já tem CORS + headers + bodyLimit).
- Ou aplicar as mesmas defesas dentro do handler `api/trpc/[...trpc].ts` (e remover `server/` da árvore de produção).

### 🔴 C3 — Sem fail-fast em variáveis críticas (itens 6 e 7)

**Arquivo:** `server/lib/env.ts:1-7`

```ts
export const env = {
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  serperApiKey: process.env.SERPER_API_KEY ?? "",
};
```

O `?? ""` silencia ausência. Se `DATABASE_URL` não estiver definido em produção, o boot sobe normalmente; a primeira chamada `connect({ url: "" })` falha em runtime — não em deploy. `SERPER_API_KEY` ausente faz o serviço cair silenciosamente nos mocks (linha 150-153 de `search.ts`), e o usuário em produção recebe "Modo demonstração ativo" sem que ninguém perceba que a chave expirou.

**Correção:** validar com Zod no boot:
```ts
const Env = z.object({
  DATABASE_URL: z.string().url(),
  SERPER_API_KEY: z.string().min(1),
});
export const env = Env.parse(process.env);
```

E para item 7 (dependências runtime): em produção, no boot, ping ao TiDB e exit 1 se falhar.

### 🔴 C4 — Rate limit por IP forjável (item 36)

**Arquivo:** `server/search.ts:254-257` e `api/trpc/[...trpc].ts:170`

```ts
const rawIp = ctx.req.headers.get("x-forwarded-for") ||
  ctx.req.headers.get("x-real-ip") || "anonymous";
const ip = rawIp.split(",")[0].trim();
```

Lê `X-Forwarded-For` **cru, pegando o primeiro elemento** — exatamente o padrão vulnerável documentado no item 36 (lição Lumina v2). Em Vercel, o IP real do cliente vem em `x-vercel-forwarded-for` ou no último elemento de `x-forwarded-for` confiável; o primeiro elemento é o que o cliente injetou.

**PoC textual:**
```bash
for i in $(seq 1 100); do
  curl -H "X-Forwarded-For: $RANDOM.$RANDOM.$RANDOM.$RANDOM" \
    "https://trend-scope.vercel.app/api/trpc/search.search?..."
done
```
Cada request conta como IP diferente; rate limit nunca dispara.

Combine com C2 (rate limit in-memory por instância serverless) e o resultado é: **na prática, não há rate limit em produção**.

### 🔴 C5 — Ruído de raiz e leak de processo interno

**Arquivos versionados** (`git ls-files`):
- `findings.md`, `progress.md`, `task_plan.md`, `arquetetura.md`, `info.md`, `gemini.md` — notas de processo internas, inclusive jargão "V.L.A.E.G." e descrição de "ERRO CRÍTICO DE INFRAESTRUTURA" da máquina do autor.
- `test-boot.mjs`, `test-db.mjs`, `test-search.mjs`, `test-search.ts`, `test-serper.mjs` — scripts ad-hoc na raiz (não testes Vitest).
- `tools/auto_ingestion.py`, `tools/daemon_worker.py`, `tools/init_db.py`, `tools/ping_mysql.py`, `tools/ping_searxng.py` — **stack Python paralela versionada** que o README não menciona (contradiz "Hono + Node.js"), com referência a SearXNG (componente externo não documentado).
- `tools/__pycache__/auto_ingestion.cpython-311.pyc` — bytecode compilado commitado.
- `fullpage.png` (570 KB) e `screenshot-features.png` (1.2 MB) — assets binários grandes na raiz.

`gemini.md` e `arquetetura.md` documentam o processo interno do desenvolvedor (incluindo notas sobre como o LLM Gemini foi usado) — leak de informação operacional + sinal forte para recrutador de que o projeto não passou por housekeeping antes de ser exposto como "produção".

**Correção:** mover notas internas para fora do repo (ou para `notes/` no `.gitignore`); deletar scripts `test-*.mjs` da raiz; mover screenshots para `docs/assets/`; decidir se `tools/` Python faz parte do projeto (e documentar) ou removê-lo.

### 🟠 C6 — `console.log` espalhado, sem logger estruturado (item 24)

**Arquivos:** `server/search.ts:151, 178, 203, 209, 213, 270`, `server/boot.ts:55`, `api/trpc/[...trpc].ts:259`.

Mistura de `console.log` e `console.error`. Sem `pino`/`winston`. Logs não estruturados, sem `requestId`, sem nível, sem timestamp padronizado. Item 25 (logs limpos de PII) é mitigado **só por sorte** — os comentários "[SEGURANÇA] Log Seguro — não imprime a query do usuário" mostram que o autor sabe da regra, mas a primeira regressão (alguém adicionar `console.log(query)` para debug) vaza a query do usuário.

### 🟠 C7 — Sem testes, sem CI, sem SECURITY.md, sem THREAT_MODEL.md (itens 18, 19, 20, 27, 29)

- Vitest está em `devDependencies` (`package.json:106`) e há `vitest.config.ts`, mas **nenhum arquivo `*.test.ts`** em `server/` ou `src/`. Os `test-*.mjs` da raiz são scripts manuais.
- Não há `.github/workflows/` (CI ausente).
- Não há `SECURITY.md` nem `THREAT_MODEL.md`.

### 🟠 C8 — Erro genérico expõe `Error: RATE_LIMITED` em vez de código HTTP semântico (itens 21, 22, 40)

**Arquivo:** `server/search.ts:260`, `api/trpc/[...trpc].ts:171`

`throw new Error("RATE_LIMITED")` vira `TRPCError` com code padrão `INTERNAL_SERVER_ERROR` → HTTP 500. O cliente em `src/pages/Home.tsx:36` faz `if (msg === "RATE_LIMITED")` — string match sobre `error.message`. Quebra se a mensagem mudar; semanticamente errado (rate limit é 429, não 500). Deveria ser `throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "..." })`.

Não há error handler centralizado.

### 🟡 C9 — Sanitização cosmética dá falsa sensação de defesa XSS (item 5/54)

**Arquivo:** `server/search.ts:56-62`

```ts
function sanitizeQuery(q: string): string {
  return q.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}
```

Remover `<` e `>` **não é sanitização XSS** — XSS no frontend depende do *renderer*, não de stripping de caracteres no backend. O frontend usa React (`{query}` em `ResultsSection.tsx:55`) que **escapa por padrão**, então XSS via query não é exploitable hoje. Mas o README chama isso de "Input Sanitization (Zero Trust)" — overclaim. Pior: a sanitização **muda a query antes de salvar no banco** (linha 263), então `"foo > bar"` vira `"foo  bar"`; um usuário legítimo que pesquisa por sintaxe de comparação tem a query corrompida silenciosamente.

### 🟡 C10 — SSRF parcialmente aberto via `fetchOgImage` (item 15)

**Arquivo:** `server/search.ts:105-146`

O servidor faz `fetch(targetUrl)` onde `targetUrl` vem de `item.link` da resposta da Serper API. Em tese, Serper só devolve links públicos do Google. Mas:
1. Não há validação de IP (sem blocklist de `127.0.0.0/8`, `169.254.0.0/16`, RFC1918).
2. Não há limite de tamanho da resposta (`html` pode ser arbitrariamente grande).
3. `User-Agent: facebookexternalhit/1.1` (linha 114) é declarado no README como técnica para "bypass de captchas" — **isso é abuso deliberado de identidade** de um bot do Facebook, eticamente questionável e potencialmente em violação dos ToS dos sites alvo.
4. Redirects automáticos não são bloqueados — atacante que controla um domínio devolvido pelo Google pode redirecionar `302 → http://169.254.169.254/latest/meta-data/` (AWS IMDSv1 metadata endpoint). Em ambiente Vercel a superfície é menor, mas a defesa não existe.

### 🟡 C11 — `JSON.parse` sem `try/catch` em `api/trpc/[...trpc].ts:115`

`(await res.json()) as any` — se Serper devolver HTML em erro 5xx, `json()` rejeita e o `catch {}` engole silenciosamente, retornando `null` e caindo nos mocks. Falha aceitável, mas o log é inexistente — administrador não sabe que a API quebrou.

### 🟡 C12 — `vercel.json` essencialmente vazio (item 55)

`vercel.json` contém apenas `{"framework": "vite"}`. Sem `headers`, sem rotas, sem CSP no edge, sem rewrites — **nenhum dos headers de segurança que o README promete chega ao HTML estático do frontend**. Acesse https://trend-scope.vercel.app e cheque headers da resposta `/` — não terá CSP, terá apenas os defaults do Vercel.

### 🟡 C13 — `credentials: "include"` no cliente tRPC sem cookie de autenticação (item 17/42)

**Arquivo:** `src/providers/trpc.tsx:19`

```ts
fetch(input, { ...(init ?? {}), credentials: "include" })
```

Aplicação não tem autenticação (não há cookie de sessão a enviar). `credentials: "include"` no fetch combinado com `cors({ credentials: true })` no Hono (`boot.ts:30`) é configuração herdada de template, sem propósito real, e **força o navegador a rejeitar `Access-Control-Allow-Origin: *`** — o que já não é o caso, mas configurações inúteis em segurança envelhecem mal.

---

## Bloco 4 — Polimentos

- **Schema duplicado:** `db/schema.ts` é redeclarado inline em `api/trpc/[...trpc].ts:18-26` — drift garantido (cf. C2).
- **`APP_ID` e `APP_SECRET` no `.env.example`** com comentário "usado para assinar JWT" — mas o código não tem JWT em lugar nenhum. Variáveis fantasma que sugerem auth onde não há.
- **`dist/` versionado:** o `.gitignore` lista `dist/` mas a pasta existe no disco (Apr 25); convém confirmar que não foi commitada.
- **`db/migrations/` vazia:** apesar do README descrever `db:generate/db:push`, não há migrations versionadas — schema vive só em `db/schema.ts` + `db:push` direto.
- **Cache size eviction FIFO arbitrário:** `cache.size > 500 → delete first` (`search.ts:33`) — não é LRU; entries quentes são despejadas se chegaram primeiro.
- **`uptimeDays: 99.9` hardcoded** em `search.ts:338` — é um número de marketing, não medição real.
- **`stats` faz duas queries separadas** (`SUM(count)` + `COUNT(*)`) que poderiam ser uma só (`SELECT SUM(count), COUNT(*) FROM searches`) — N+1 simbólico (item 39).
- **Pasta `.tmp/` no projeto** sem propósito documentado.
- **`fullpage.png` e `screenshot-features.png` na raiz** somam ~1.8 MB no clone.

---

## Itens N/A com justificativa

| # | Item | Justificativa |
|---|---|---|
| 1, 2, 3, 4 | Auth, authz, IDs da sessão, identidade em handlers async | Aplicação **não tem autenticação** — todos os endpoints são públicos. Não há conceito de "recurso pertencente a alguém". |
| 9, 10, 12 | Hash de senha, JWT, brute force em login | Sem auth, sem login. (Mas `.env.example` insinua JWT — ver Polimentos.) |
| 11 | Timing-safe compare | Não há comparação de token/HMAC/API key. A `SERPER_API_KEY` é usada como header outbound, nunca comparada. |
| 17, 42 | Cookies httpOnly/secure, CSRF | Sem cookies de sessão. `credentials: "include"` no cliente é cargo cult — ver C13. |
| 23, 28 | Race conditions, cota atômica | Não há transações sensíveis nem quotas com limite. O `UPDATE count = count + 1` em `searches` é idempotente o suficiente para uso analítico. |
| 33 | Formato estrito de ID | Não há ID de recurso no path. |
| 34 | Paginação | `popular` tem `.limit(8)` fixo; `stats` retorna agregados; `search` retorna 5 itens fixos. OK por escopo. |
| 37 | Política de senha | Sem auth. |
| 44, 45, 46, 47, 48, 49 | Correlation ID, métricas, soft delete, audit log, backup, retenção | Sem dados pessoais persistidos por usuário. As únicas linhas no banco são `(query, count, resultados)` agregados — ver ressalva no adendo H. |
| Adendo D | Multi-tenant | Sem tenant. |
| Adendo E | LLM | Sem LLM (só search externa). |

---

## Adendo F — APIs públicas / Webhooks (aplicável)

A tRPC route `/api/trpc/search.search` é **API pública sem autenticação**, exposta na internet. Itens relevantes:
- **F1 (rate limit distribuído)** — violado, ver C2/C4.
- **F2 (versionamento de API)** — N/A para tRPC interno, mas seria relevante se a tRPC virasse contrato externo.
- **F3 (HMAC em webhooks)** — N/A, não há webhook.
- **F4 (idempotência)** — N/A para read-only search.

## Adendo H — Dados sensíveis (parcialmente aplicável)

As queries de busca dos usuários **são PII por proxy** — "ansiedade tratamento", "como sair de relacionamento abusivo", "cnpj fulano da silva" são searches que revelam intenção pessoal. O projeto:
- **Persiste a query crua** no TiDB indefinidamente (`searches.query`), sem associação a usuário, mas com `count` e `created_at`.
- **Não tem política de retenção** documentada (item 49).
- **Não declara LGPD** no README nem tem `PRIVACY.md`.
- **Persiste também os resultados curados** (`resultados_curados` JSON), o que aumenta a janela de exposição se o banco vazar.

Recomendação mínima: hash da query antes de persistir (se o objetivo é só contar popularidade, hash basta para deduplicar) — ou TTL de 30 dias.

---

## Resumo executivo

| Status | Quantidade |
|---|---:|
| ✅ Confirmado e excelente | 4 |
| 🟠 Parcial | 4 (itens 30, 31, 35, 38) |
| 🔴 Crítico / violação | 5 (C1–C5) |
| 🟠 Alto fora do checklist | 3 (C6–C8) |
| 🟡 Médio fora do checklist | 5 (C9–C13) |
| 🚫 N/A por escopo | 18 |
| Itens 🟠 Essenciais ausentes (testes, CI, SECURITY, THREAT_MODEL, error handler centralizado, IP confiável, logger estruturado) | 7 |

**Régua aplicada:** "produção sem placeholders". Com essa régua, o projeto está **abaixo do que o README declara**. A distância entre marketing e entrega é grande o suficiente para que recrutador técnico, lendo README + código em sequência, perca confiança no autor.

---

## Plano de ação ordenado por severidade

### 🔥 Hoje (próximas horas)
1. **Rotacionar credenciais TiDB e Serper** — assumir que já estão comprometidas (C1).
2. **Remover `.env` do disco** (mover para gerenciador de segredos da OS ou Vercel env vars).
3. **Adicionar `.env` ao `.dockerignore`** e remover do `COPY` do `Dockerfile`.
4. **Verificar histórico Git** com `gitleaks` — se houver commit do `.env`, considerar reescrever histórico (`git filter-repo`).

### 🟥 Esta semana
5. **Unificar backend:** apagar `api/trpc/[...trpc].ts` e rotear tudo via `api/index.ts` → `boot.ts` (resolve C2 e leva CORS+headers+bodyLimit para produção).
6. **Fail-fast com Zod** em `server/lib/env.ts` (C3) — variáveis ausentes = `process.exit(1)`.
7. **Configurar IP confiável** no Vercel (`x-vercel-forwarded-for`) ou usar o último elemento confiável de `x-forwarded-for` (C4).
8. **Configurar CSP estrita** em `secureHeaders({ contentSecurityPolicy: {...} })` (item 31) **e** em `vercel.json` `headers` para o frontend (C12).
9. **Migrar `throw new Error("RATE_LIMITED")` para `TRPCError({ code: "TOO_MANY_REQUESTS" })`** (C8); cliente passa a tratar via `error.data.code`.

### 🟧 Próximas duas semanas
10. **Housekeeping do repo:** remover `findings.md`, `progress.md`, `task_plan.md`, `arquetetura.md`, `info.md`, `gemini.md`, `test-*.mjs`, `__pycache__`, screenshots binários (C5). Decidir destino de `tools/` Python.
11. **README honesto:** reescrever o bloco "Protocolo de Segurança Enterprise" para refletir o que existe de fato; ou implementar as defesas declaradas e deixar a prosa intocada.
12. **Vitest + CI:** ao menos 5 testes (search com query válida, query vazia, rate limit dispara após 30 req, cache hit retorna mesmo resultado, Serper fail cai em mock). `.github/workflows/ci.yml` mínimo com `lint + test + tsc`.
13. **`SECURITY.md` e `THREAT_MODEL.md`** mínimos.
14. **Logger estruturado** (pino) + remover `console.*` (C6).

### 🟨 Backlog
15. Rate limit distribuído (Redis Upstash, Vercel KV) — substituir `Map` in-memory (C2).
16. Retenção LGPD para `searches.query` — hash ou TTL (adendo H).
17. ADRs para decisões: por que TiDB Serverless, por que Hono+tRPC em Vercel, por que sem auth.
18. Substituir User-Agent `facebookexternalhit` por UA próprio (`TrendScope/1.0 (+https://trend-scope.vercel.app)`) — C10.

---

## Evolução dos checklists

Esta auditoria gera **uma pergunta nova** que não está coberta e tem rastro de origem:

### Proposta — Item novo em 🔴 Bloqueadores: **Caminho de produção é o mesmo que o caminho auditado?**

> *Pergunta-teste: "Quando o time audita `server/boot.ts` e confirma que tem CORS, headers, bodyLimit — esse arquivo é de fato o que processa as requisições em produção? Ou existe um segundo handler (Vercel function, Netlify function, edge worker, Lambda separada) que duplica a lógica e bypassa as defesas?"*
>
> Bug clássico: o desenvolvedor mantém um `api/handler.ts` "simplificado" para a plataforma serverless e um `server/boot.ts` "completo" para dev local. As defesas perimetrais (CORS, headers, body limit, rate limit) vivem só no `boot.ts`. Em produção, o tráfego entra pelo handler simplificado e não toca nenhuma defesa. Auditor que lê só `boot.ts` confirma tudo verde — e está errado.
>
> **Como verificar:** localizar o entrypoint de produção (`vercel.json`, `netlify.toml`, `serverless.yml`, `Procfile`); seguir o handler até o ponto onde middleware é aplicado; confirmar que é o mesmo módulo do dev. Se houver fork (`api/*.ts` independente de `server/*.ts`), exigir consolidação ou aplicar middleware no fork.
>
> **Origem:** TrendScope 2026-05-18 — `api/trpc/[...trpc].ts` (262 linhas) duplica `server/search.ts` sem CORS, sem `secureHeaders()`, sem `bodyLimit`, sem usar o `boot.ts` que o README descreve como camada de segurança.

Propus essa entrada como **item 17B** (ou novo número em bump MINOR para v1.5.0) — categoria 🔴 Bloqueadores, pois afeta toda a régua de itens 31, 32, 41 quando há duplicação.

Os achados C4 (IP forjável) e C5 (ruído de raiz) já estão cobertos pelos itens 36 e 30 atuais — não geram pergunta nova.

---

## Reflexão final

O TrendScope é um projeto onde a **estética do README** e a **realidade do código** estão em pontos distintos do espectro de maturidade. O frontend tem cuidado real (glassmorphism, skeleton loading, error boundary, toast com feedback de rate limit); o backend funciona; a integração tRPC + Drizzle está limpa. Mas a "infraestrutura de segurança" descrita como Enterprise é, na prática: um middleware Hono que não é executado em produção, um rate limit que não persiste entre cold starts e que conta por IP forjado, um `.env` que vai dentro da imagem Docker, e duas implementações divergentes do mesmo backend, sendo a "errada" a que efetivamente serve o tráfego.

A lição meta desta auditoria é diferente das anteriores: **em projetos serverless, "auditar `boot.ts`" não basta — é preciso seguir o fio do `vercel.json` (ou equivalente) até o handler que de fato processa a requisição.** O bug de "duas implementações" é insidioso porque cada uma, isolada, parece razoável; é só quando se compara que a divergência aparece. Vai virar item novo no checklist (proposta acima). E reforça uma intuição que já estava nas auditorias anteriores: README otimista + arquivo de auditoria interno do próprio autor versionado (`findings.md` aqui, `info.md` no Lumina) é um sinal precoce de que alguém está mais focado em parecer pronto do que em estar pronto. Honestidade primeiro, sempre — inclusive com a própria arquitetura.

---

# Passada 2 — Cobertura completa (2026-05-18)

> **Esta seção é um adendo à auditoria v1 acima.** Não é uma nova auditoria, é uma 2ª passada de cobertura sobre os ~19 itens que ficaram em zona ambígua. Os achados aqui complementam (não substituem) os blocos 1–4. Quando um achado já estava coberto, a matriz aponta para o ID original (C1–C13). Quando novo, recebe ID novo (C14+).

## Achados novos (não cobertos na v1)

### C14 — Dockerfile expõe proxy corporativo interno e desabilita TLS strict (CRÍTICO)
**Arquivo:** `Dockerfile:6-13`

```dockerfile
ENV HTTP_PROXY=http://172.23.0.4:2003
ENV HTTPS_PROXY=http://172.23.0.4:2003
RUN npm config set registry https://npm.mirrors.msh.team \
    && npm config set proxy $HTTP_PROXY \
    && npm config set https-proxy $HTTPS_PROXY \
    && npm config set strict-ssl false
```

Três problemas distintos:
1. **Leak de infraestrutura interna**: IP `172.23.0.4` é RFC1918 — revela topologia de rede privada do desenvolvedor (ou de um ambiente CI corporativo). Em repositório público, é OSINT para atacante mapear rede interna.
2. **Registry npm não-oficial hardcoded**: `npm.mirrors.msh.team` (mirror chinês msh.team) é o resolvedor de pacotes do build. Qualquer comprometimento desse mirror = supply chain attack instantâneo.
3. **`strict-ssl false`**: aceita certificados TLS inválidos durante `npm ci`. MITM trivial no build.

Esse Dockerfile **não foi escrito para produção** — é um Dockerfile de dev em ambiente restrito. Em Vercel (que de fato serve a aplicação) ele nem é usado, o que torna ainda mais grave: é código morto enganoso, que sugere preparo para containerização que na verdade injeta vulnerabilidade de supply chain.

### C15 — Dockerfile roda como root e estágio de runtime não é mínimo (item 50, CRÍTICO)
**Arquivo:** `Dockerfile:23-29`

- **Sem `USER node`** — o processo roda como `root` dentro do container. Container escape via vuln Node + root = compromise do host.
- **`node_modules` completo** copiado (incluindo `devDependencies`) — área de ataque enorme em vez de só prod deps.
- **`npm start`** como entrypoint em vez de `node dist/boot.js` direto — mantém npm no path, expande ataque.
- Multi-stage existe (deps → build → production), mas o estágio final **não usa `npm prune --production`**, então a separação é cosmética.

### C16 — Sem Dependabot / Renovate / equivalente (item 43, CRÍTICO)
**Arquivo:** `.github/` **não existe**

Não há `.github/dependabot.yml`, não há `renovate.json`, não há `.github/workflows/`. Zero automação de atualização de dependências. Em um projeto com 80+ deps runtime e React 19 (versão recente com churn de RCs), isso é dívida de manutenção que vira CVE em 6 meses.

### C17 — Sem ADRs versionadas (item 51, CRÍTICO)
**Arquivo:** `docs/` (só contém `AUDIT_REPORT_2026-05-18.md`)

Não existe `docs/adr/` nem nada equivalente. As decisões arquiteturais (por que TiDB Serverless? por que Hono em vez de Express? por que duas implementações do backend? por que sem auth?) **não estão documentadas**. Item 51 do checklist fica em violação explícita.

### C18 — Frontend vaza `error.message` sem sanitização (itens 40 + 57)
**Arquivo:** `src/components/ErrorBoundary.tsx:46-52`

Mostra `error.message` cru ao usuário final em produção, sem distinguir `NODE_ENV`. Se um erro do tRPC vier com detalhe técnico (ex.: `Failed to fetch http://internal-host/...`, ou um stack trace serializado), o usuário vê. Combina mal com C8 (não há error handler centralizado no backend que normalize mensagens antes de devolver).

**Correção:** em prod, mostrar mensagem genérica fixa; em dev, mostrar `error.message`. E reformatar o backend para nunca devolver mensagem técnica via tRPC (`TRPCError` com `message` curado).

### C19 — `dangerouslySetInnerHTML` em componente shadcn não usado (item 55)
**Arquivo:** `src/components/ui/chart.tsx:83`

O componente `chart.tsx` da pasta `ui/` (gerada pelo `shadcn/ui`) usa `dangerouslySetInnerHTML` para injetar CSS de cores do tema. O conteúdo injetado é derivado de `config` passado pelo desenvolvedor (não input do usuário), então **não é XSS hoje**. Porém o componente parece não ser usado em `src/pages/` ou `src/sections/`. Código morto com `dangerouslySetInnerHTML` é vetor latente.

**Correção:** remover `src/components/ui/chart.tsx` se não é usado, ou marcar comentário explícito de threat model nele.

### Reanálise do item 15 (SSRF) — não crítico nesta superfície

Análise: a query do usuário **nunca vira URL diretamente** no servidor. Em `server/search.ts:160` e `api/trpc/[...trpc].ts:107`, a query é enviada como **body JSON** (`q: query`) pra URL fixa `https://google.serper.dev/search`. Não há `fetch(\`${userInput}\`)` no código.

A superfície de SSRF que existe é a indireta: `fetchOgImage(item.link)` em `server/search.ts:105-146` recebe URL do **payload da Serper** (que reflete a query do usuário via resultados do Google). Atacante que controla domínio retornável pelo Google pode usar redirect para alcançar IPs internos. **Esse risco já está documentado como C10** e não é elevado a crítico porque (a) Vercel Functions têm superfície interna pequena, (b) timeout de 2.5s reduz exploit window, (c) Serper só retorna links indexados pelo Google.

**Mantém como parcial (C10 da v1).**

---

## Matriz de cobertura completa (itens 1–57 + adendos)

Legenda: OK = mitigado com prova | P = parcial / médio | X = violação / crítico | NA = N/A com justificativa

| # | Item | Status | Ref / arquivo:linha |
|---|------|:---:|---|
| 1 | Auth em rotas privadas | NA | Sem auth — N/A v1 |
| 2 | Authz em recursos | NA | Sem auth — N/A v1 |
| 3 | IDs vindos da sessão | NA | Sem auth — N/A v1 |
| 4 | Identidade em handlers async | NA | Sem auth — N/A v1 |
| 5 | Validação Zod no input | OK | `server/search.ts:252`, `api/trpc/[...trpc].ts:168` (Bloco 1) |
| 6 | Envs validadas no boot (fail-fast) | X | C3 — `server/lib/env.ts:1-7` |
| 7 | Fail-fast para dependências runtime | X | C3 |
| 8 | Fail-fast preservado em orquestração | X | C3 + Dockerfile não roda check |
| 9 | Hash de senha | NA | Sem auth |
| 10 | JWT seguro | NA | Sem JWT (`APP_SECRET` órfão — Polimentos v1) |
| 11 | Comparação tempo-constante | NA | Sem comparação de secret |
| 12 | Brute force protection | NA | Sem auth |
| 13 | Segredos fora do código | X | C1 — `.env` na imagem Docker, repo público |
| 14 | Queries parametrizadas | OK | Bloco 1 — Drizzle |
| 15 | SSRF | P | C10 + reanálise acima — query não vira URL direta, mas `fetchOgImage` é vetor indireto |
| 16 | Sem desserialização/SSTI | OK | Bloco 1 |
| 17 | Cookies httpOnly/secure | NA | Sem cookies (C13 — `credentials:"include"` órfão) |
| 18 | Testes para caminhos críticos | X | C7 — zero `*.test.ts` |
| 19 | Testes adversariais p/ THREAT_MODEL | X | C7 — sem THREAT_MODEL |
| 20 | CI/CD com checks por PR | X | C7 + C16 — sem `.github/workflows/` |
| 21 | Error handler centralizado | X | C8 — sem `app.onError`, `throw new Error` raw |
| 22 | Controllers usam `throw` (não `res.status`) | P | C8 — usam `throw new Error("RATE_LIMITED")` em vez de `TRPCError` semântico |
| 23 | Race conditions / lock | NA | N/A v1 |
| 24 | Logging estruturado | P | C6 — `console.*` espalhado |
| 25 | Logs limpos de PII | P | C6 — protegido por convenção, não por código |
| 26 | THREAT_MODEL.md | X | C7 — ausente |
| 27 | SECURITY.md | X | C7 — ausente |
| 28 | Cota atômica | NA | N/A v1 |
| 29 | Documentação operacional mínima | P | README existe mas overclaim — Bloco 2 item 30 |
| 30 | README honesto | P | Bloco 2 — overclaim "Enterprise" |
| 31 | Headers de segurança (Helmet) | P | Bloco 2 — `secureHeaders()` sem CSP **e** não plugado em `api/trpc/[...trpc].ts` (C2) |
| 32 | HTTPS forçado | OK | Vercel termina TLS automaticamente |
| 33 | Formato estrito de ID | NA | N/A v1 |
| 34 | Paginação | NA | N/A v1 (limites fixos) |
| 35 | Rate limit por usuário | P | Bloco 2 + C2 + C4 — in-memory, por IP forjável, por instância |
| 36 | IP de cliente confiável | X | C4 — `x-forwarded-for[0]` cru |
| 37 | Política de senha | NA | Sem auth |
| 38 | Health live + ready separados | P | Bloco 2 — `api/health.ts` retorna `{ok:true}` fixo, não testa DB |
| 39 | N+1 e queries | P | Polimentos v1 — `stats` faz 2 queries que poderiam ser 1 |
| 40 | Erros sem vazar stack em prod | X | C18 (novo) — ErrorBoundary mostra `error.message`; backend não normaliza (C8) |
| 41 | CORS allowlist | OK | Bloco 1 (mas só vale em `boot.ts`, não em produção — C2) |
| 42 | CSRF protection | NA | N/A v1 (sem cookie de sessão) |
| 43 | Dependabot / Renovate | X | C16 (novo) — `.github/` inexistente |
| 44 | Correlation ID | NA | N/A v1 |
| 45 | Métricas | NA | N/A v1 |
| 46 | Soft delete | NA | N/A v1 |
| 47 | Audit log | NA | N/A v1 |
| 48 | Backup | NA | N/A v1 (TiDB gerenciado) |
| 49 | Retenção de dados | P | Adendo H v1 — sem TTL para `searches.query` |
| 50 | Dockerfile multi-stage + non-root | X | C15 (novo) — roda como root, `node_modules` inflado, `npm start` no CMD |
| 51 | ADRs documentando decisões | X | C17 (novo) — `docs/adr/` inexistente |
| 52 | OpenAPI / contrato versionado | NA | tRPC dispensa OpenAPI; sem versionamento explícito (aceitável) |
| 53 | Frontend: token storage seguro | NA | Sem auth — N/A |
| 54 | Frontend: route guard | NA | Aplicação tem 1 rota pública (`Home`) — N/A |
| 55 | Frontend: sanitização de HTML | P | C19 (novo) — `dangerouslySetInnerHTML` em `chart.tsx:83` (componente morto) |
| 56 | Frontend: CSP no Vercel | X | C12 — `vercel.json` vazio |
| 57 | Frontend: error handling | P | C18 (novo) — `ErrorBoundary` existe mas vaza `error.message` |

### Adendos

| Adendo | Status | Justificativa |
|---|:---:|---|
| A — WebSocket | NA | Projeto não usa WebSocket; só tRPC HTTP. |
| B — Upload | NA | Não há endpoint de upload. `bodyLimit(1MB)` cobre payloads JSON. |
| C — Pagamento | NA | Não há fluxo de pagamento nem integração Stripe/PayPal. |
| D — Multi-tenant | NA | Sem conceito de tenant (já em v1). |
| E — LLM | NA | Sem LLM (já em v1). |
| F — APIs públicas | P | Aplicável — coberto em v1 (rate limit violado). |
| G — Mobile | NA | Apenas web SPA (React). Sem app mobile, sem deep link, sem `WebView`. |
| H — Dados sensíveis | P | Aplicável — coberto em v1 (queries são PII por proxy). |
| I — Filas/Workers | NA | Não há `bullmq`, `agenda`, Redis queue ou worker em `package.json`. Toda execução é request-response síncrono. |
| J — GraphQL | NA | Stack é tRPC, não GraphQL. Sem `apollo-server`, `graphql-yoga`, schema `.graphql`. |

---

## Resumo executivo atualizado (após passada 2)

| Status | Quantidade |
|---|---:|
| OK — Confirmado e excelente | 5 (itens 5, 14, 16, 32, 41) |
| P — Parcial / Médio | 13 (itens 15, 22, 24, 25, 29, 30, 31, 35, 38, 39, 49, 55, 57) |
| X — Crítico / violação | 14 (itens 6, 7, 8, 13, 18, 19, 20, 21, 26, 27, 36, 40, 43, 50, 51, 56) |
| NA — N/A por escopo | 25 |

**Delta da passada 2:** +6 achados novos (C14 proxy/SSL Dockerfile, C15 Docker root, C16 sem Dependabot, C17 sem ADR, C18 ErrorBoundary leak, C19 `dangerouslySetInnerHTML` morto). Nenhum dos novos achados muda a régua geral, mas **C14 (proxy + `strict-ssl false`) é crítico de supply chain** e deve entrar no plano de ação "Hoje" junto com C1.

## Adição ao Plano de ação

### Hoje (adicionar aos itens 1–4 da v1)
- **Remover proxy hardcoded e `strict-ssl false` do Dockerfile (C14)** — ou apagar o Dockerfile inteiro se ele não é usado em produção (Vercel não consome).

### Esta semana (adicionar aos itens 5–9 da v1)
- **`USER node` + `npm prune --production` no Dockerfile (C15)** se Docker continuar parte do projeto.
- **Adicionar `.github/dependabot.yml` (C16)** com `package-ecosystem: npm`, `schedule: weekly`.
- **`ErrorBoundary` condicional por `import.meta.env.DEV` (C18)** — em produção, esconder `error.message`.
- **Remover `src/components/ui/chart.tsx` se não usado (C19)**.

### Próximas duas semanas (adicionar)
- **Criar `docs/adr/0001-stack-tidb-hono-vercel.md`, `0002-dual-backend-implementations.md` etc. (C17)** — documentar as decisões que a v1 já levantou como ambíguas.

---

## Notas de método

Esta passada 2 NÃO releu o projeto inteiro. Focou nos arquivos explicitamente apontados pelo prompt do orquestrador: `Dockerfile`, `.github/` (inexistente), `server/boot.ts`, `api/health.ts`, `src/components/`, `src/providers/`, `package.json`, `.dockerignore`, `vercel.json`. Para itens cobertos pela v1 (C1–C13), apenas se confirmou status e classificou na matriz — não se re-investigou. Total de tempo investido: ~10 min.
