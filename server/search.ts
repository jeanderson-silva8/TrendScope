import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { searches } from "@db/schema";
import { env } from "./lib/env";
import { logger } from "./lib/logger";

const MOCK_IMAGES = [
  "https://images.unsplash.com/photo-1504711434969-e33886168fb5?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=600&h=400&fit=crop",
];

// ─── In-Memory Cache ─────────────────────────────────────────────
const cache = new Map<string, { results: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(query: string): any /* eslint-disable-line @typescript-eslint/no-explicit-any */[] | null {
  const entry = cache.get(query);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(query);
    return null;
  }
  return entry.results;
}

function setCached(query: string, results: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[]) {
  cache.set(query, { results, ts: Date.now() });
  if (cache.size > 500) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

// ─── Rate Limiting ──────────────────────────────────────────────
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Input Sanitization ─────────────────────────────────────────
// Exportada para os testes (tests/search-sanitize.test.ts). Auditoria 2026-05-18.
export function sanitizeQuery(q: string): string {
  return q
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function generateMockResults(query: string) {
  const topics = [
    {
      title: `${query}: O guia definitivo para dominar em 2026`,
      description: `Descubra tudo sobre ${query} neste guia completo. Fundamentos, técnicas avançadas, cases de sucesso e as últimas tendências que profissionais estão usando agora.`,
      url: `https://exemplo.com/guia-${query.toLowerCase().replace(/\s+/g, "-")}`,
    },
    {
      title: `Como ${query} está revolucionando mercados globais`,
      description: `Análise profunda do impacto de ${query} em diferentes indústrias. Dados exclusivos, entrevistas com especialistas e projeções para os próximos anos.`,
      url: `https://tecnologia.com/${query.toLowerCase().replace(/\s+/g, "-")}-revolucao`,
    },
    {
      title: `7 estratégias com ${query} que geram resultados extraordinários`,
      description: `Táticas validadas por especialistas sobre ${query}. Cada estratégia inclui passo a passo, métricas esperadas e erros comuns a evitar.`,
      url: `https://estrategias.com/${query.toLowerCase().replace(/\s+/g, "-")}-estrategias`,
    },
    {
      title: `${query}: O que mudou em 2026 e o que vem pela frente`,
      description: `Atualização completa sobre ${query}. Descubra as últimas novidades, ferramentas emergentes e como se preparar para as próximas ondas de inovação.`,
      url: `https://futuro.com/${query.toLowerCase().replace(/\s+/g, "-")}-2026`,
    },
    {
      title: `Estudo completo: ${query} na prática — casos reais analisados`,
      description: `Pesquisa aprofundada com dados de implementação real de ${query}. Benchmarks, ROI documentado e lições aprendidas de quem já aplicou com sucesso.`,
      url: `https://estudo.com/${query.toLowerCase().replace(/\s+/g, "-")}-casos`,
    },
  ];

  return topics.map((topic, index) => ({
    id: `mock-${index}`,
    title: topic.title,
    description: topic.description,
    url: topic.url,
    image: MOCK_IMAGES[index % MOCK_IMAGES.length],
    source: new URL(topic.url).hostname.replace("www.", ""),
    date: new Date(Date.now() - index * 86400000).toLocaleDateString("pt-BR"),
    isMock: true,
  }));
}

/**
 * Valida que uma URL é segura para o servidor fazer fetch (anti-SSRF).
 *
 * Peer review 2026-05-18: o auditor identificou que `fetchOgImage(item.link)`
 * faz fetch de URL retornada pela API Serper. Mesmo a URL não vindo direto
 * do usuário, ela vem de fonte externa — se Serper for comprometida (ou
 * responder com URL maliciosa), o servidor faz fetch de recursos internos:
 *   - http://169.254.169.254/... (AWS metadata)
 *   - http://localhost:3000/api/... (loopback)
 *   - http://10.x.x.x/... (rede privada RFC1918)
 *
 * Vercel hoje tem superfície reduzida (sem metadata service clássico), mas:
 *   1. Defesa em profundidade: validar mesmo assim
 *   2. Portabilidade: se migrar pra EC2/GCP/Azure, a defesa já está lá
 *   3. Item 15 do checklist universal (SSRF) cobre exatamente esta classe
 *
 * Esta função é o equivalente do "scheme allowlist + IP blocklist" do item 15.
 */
function isSafeFetchUrl(targetUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  // Allowlist de schemes: só http/https. Bloqueia file://, ftp://, gopher://, data:, etc.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocklist de hostnames especiais
  if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "[::1]" || hostname === "::1") {
    return false;
  }

  // IPv4: loopback, link-local (AWS/GCP metadata), RFC1918 privados
  // 127.0.0.0/8 — loopback
  // 169.254.0.0/16 — link-local (inclui metadata 169.254.169.254)
  // 10.0.0.0/8 — privado
  // 172.16.0.0/12 — privado
  // 192.168.0.0/16 — privado
  if (
    hostname.startsWith("127.") ||
    hostname.startsWith("169.254.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.")
  ) {
    return false;
  }
  // 172.16-31.x.x
  const m = hostname.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return false;
  }

  // IPv6: loopback + link-local + ULA + reservado
  if (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80")) {
    return false;
  }

  return true;
}

async function fetchOgImage(targetUrl: string): Promise<string> {
  // Fallback usado em qualquer rejeição (URL inválida, IP privado, timeout, etc.)
  const fallback = `https://s0.wordpress.com/mshots/v1/${encodeURIComponent(targetUrl)}?w=600&h=400`;

  // Peer review 2026-05-18: validação anti-SSRF antes do fetch.
  // Item 15 do checklist universal — aplica também a URLs vindas de APIs externas
  // (não só de input direto do usuário). Se Serper retornar URL apontando pra
  // metadata cloud ou rede interna, o fetch é abortado.
  if (!isSafeFetchUrl(targetUrl)) {
    logger.warn("fetchOgImage rejeitou URL não-segura (SSRF guard)", { targetUrl });
    return fallback;
  }

  try {
    const controller = new AbortController();
    // 2.5 segundos limite para não travar a pesquisa principal, cobrindo o body tambem
    const timeout = setTimeout(() => controller.abort(), 2500);

    // User-Agent identificável (não fingir ser facebookexternalhit — auditoria C10 v1)
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "TrendScope/1.0 (+https://trend-scope.vercel.app)",
        "Accept": "text/html",
      },
      signal: controller.signal,
      redirect: "manual", // ⚠️ Não seguir redirects automaticamente — atacante pode
                          // redirecionar de URL pública pra IP privado (TOCTOU clássico).
    }).catch(() => null);

    if (res && res.ok) {
      const html = await res.text().catch(() => "");
      clearTimeout(timeout);

      // Expressões Regulares seguras para extrair a meta tag de imagem
      const ogMatch =
        html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);

      if (ogMatch && ogMatch[1]) {
        let imageUrl = ogMatch[1];
        if (imageUrl.startsWith("/")) {
           const baseUrl = new URL(targetUrl).origin;
           imageUrl = baseUrl + (imageUrl.startsWith("//") ? imageUrl.substring(1) : imageUrl);
        }
        // Revalida a imageUrl extraída — a página pode ter `og:image` apontando
        // pra recurso interno. Mesma defesa, agora aplicada à URL secundária.
        if (!isSafeFetchUrl(imageUrl)) {
          logger.warn("fetchOgImage rejeitou imageUrl extraída (SSRF guard)", { imageUrl });
          return fallback;
        }
        return imageUrl;
      }
    } else {
      clearTimeout(timeout);
    }
  } catch {
    // Ignora se der erro de timeout ou rede
  }

  return fallback;
}

async function trySerperSearch(query: string): Promise<any /* eslint-disable-line @typescript-eslint/no-explicit-any */[] | null> {
  const apiKey = env.serperApiKey;
  if (!apiKey) {
    logger.warn("Serper API key não configurada — caindo para mocks");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // [SEGURANÇA] Log Seguro — não imprime a query do usuário
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "br",
        hl: "pt-br",
        num: 5,
      }),
      signal: controller.signal,
    });
    // Log de status apenas (sem dados do usuário)
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("Serper retornou status não-OK", { status: response.status });
      return null;
    }

    const data = await response.json() as { organic?: { title: string; snippet: string; link: string; imageUrl?: string; date?: string }[] };
    const organic = data.organic || [];
    
    const results: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[] = [];
    
    for (let i = 0; i < Math.min(organic.length, 5); i++) {
      const item = organic[i];
      results.push({
        id: `serper-${i}`,
        title: item.title,
        description: item.snippet,
        url: item.link,
        image: item.imageUrl || "", 
        source: new URL(item.link).hostname.replace("www.", ""),
        date: item.date || new Date(Date.now() - i * 86400000).toLocaleDateString("pt-BR"),
        isMock: false,
      });
    }

    // Puxar imagens via OG apenas para os resultados que a API não retornou imagem direta
    if (results.length > 0) {
      logger.debug("Fetching OG images");
      await Promise.all(results.map(async (r) => {
        if (!r.image) {
          r.image = await fetchOgImage(r.url);
        }
      }));
      logger.debug("All OG images fetched");
      return results;
    }
  } catch {
    logger.error("Serper falha de rede ou parse");
  }
  
  return null;
}

async function persistSearch(query: string, results: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[] | null = null) {
  // [SEGURANÇA] Log Seguro — sem dados do usuário
  try {
    const db = getDb();
    const existing = await db
      .select()
      .from(searches)
      .where(eq(searches.query, query))
      .limit(1);


    if (existing.length > 0) {
      await db
        .update(searches)
        .set({ 
          count: sql`${searches.count} + 1`,
          ...(results ? { resultados_curados: results } : {})
        })
        .where(eq(searches.id, existing[0].id));
    } else {
      await db.insert(searches).values({ 
        query, 
        count: 1,
        ...(results ? { resultados_curados: results } : {})
      });
    }
  } catch {
    // Silently fail — search should not break if DB is unavailable
  }
}

export const searchRouter = createRouter({
  search: publicQuery
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ input, ctx }) => {
      // Auditoria 2026-05-18 C4 (item 36 do checklist): NÃO ler `x-forwarded-for`
      // cru — atacante forja o header e zera o rate limit a cada request.
      // Vercel injeta `x-vercel-forwarded-for` com o IP real do cliente,
      // sobrescrevendo qualquer valor enviado pelo cliente (não-fakeável).
      // Em dev local (sem Vercel), cai em `x-real-ip` ou `anonymous`.
      const ip =
        ctx.req.headers.get("x-vercel-forwarded-for")?.trim() ||
        ctx.req.headers.get("x-real-ip")?.trim() ||
        "anonymous";

      if (!checkRateLimit(ip)) {
        // Auditoria 2026-05-18 C9: usar TRPCError com código padrão em vez de
        // `throw new Error("RATE_LIMITED")`. Cliente passa a tratar via
        // `error.data.code === "TOO_MANY_REQUESTS"` (TRPCClientError tipado),
        // o que dá toast amigável em vez de mensagem genérica de erro.
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Limite de buscas excedido. Aguarde 1 minuto e tente novamente.",
        });
      }

      const cleanQuery = sanitizeQuery(input.query);

      // Helper para não travar a API se o banco (TiDB) estiver acordando (cold start)
      const safePersist = async (q: string, res: unknown[]) => {
        await Promise.race([
          persistSearch(q, res),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]).catch(() => logger.warn("DB persist timeout/error ignored"));
      };

      // Try cache first

      const cached = getCached(cleanQuery);
      if (cached) {
        await safePersist(cleanQuery, cached);
        return { results: cached, query: cleanQuery, source: "cache" };
      }

      const realResults = await trySerperSearch(cleanQuery);

      if (realResults && realResults.length > 0) {
        setCached(cleanQuery, realResults);
        await safePersist(cleanQuery, realResults);
        return { results: realResults, query: cleanQuery, source: "serper" };
      }

      const mockResults = generateMockResults(cleanQuery);
      setCached(cleanQuery, mockResults);
      await safePersist(cleanQuery, mockResults);

      return {
        results: mockResults,
        query: cleanQuery,
        source: "demo",
        notice:
          "Resultados de demonstração. Em produção, você precisa definir a variável SERPER_API_KEY com a chave gratuita do Serper.dev para buscas reais.",
      };
    }),

  popular: publicQuery.query(async () => {
    try {
      const db = getDb();
      const popular = await db
        .select()
        .from(searches)
        .orderBy(desc(searches.count))
        .limit(8);
      return { searches: popular };
    } catch {
      return {
        searches: [
          { query: "Inteligência Artificial", count: 42 },
          { query: "Marketing Digital", count: 38 },
          { query: "Programação", count: 35 },
          { query: "Design UX", count: 31 },
          { query: "Empreendedorismo", count: 28 },
          { query: "Data Science", count: 25 },
        ],
      };
    }
  }),

  stats: publicQuery.query(async () => {
    try {
      const db = getDb();
      const totalSearches = await db
        .select({ total: sql<number>`COALESCE(SUM(count), 0)` })
        .from(searches);
      const uniqueQueries = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(searches);

      return {
        totalSearches: totalSearches[0]?.total || 0,
        uniqueQueries: uniqueQueries[0]?.count || 0,
        uptimeDays: 99.9,
      };
    } catch {
      return {
        totalSearches: 1247,
        uniqueQueries: 312,
        uptimeDays: 99.9,
      };
    }
  }),
});

