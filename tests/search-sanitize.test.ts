/**
 * Testes da sanitização de query — primeiro estágio de defesa.
 *
 * Auditoria 2026-05-18 (item 5 do checklist): input do usuário passa por
 * sanitize antes do Drizzle. Garante que tags HTML não trafegam, que
 * espaços excessivos viram um só, que limite de 200 chars é aplicado.
 */
import { describe, it, expect } from "vitest";
import { sanitizeQuery } from "../server/search";

describe("sanitizeQuery", () => {
  it("remove tags HTML básicas (< e >)", () => {
    expect(sanitizeQuery("<script>alert('xss')</script> AI tools")).toBe(
      "scriptalert('xss')/script AI tools"
    );
    expect(sanitizeQuery("hello <b>world</b>")).toBe("hello bworld/b");
  });

  it("normaliza espaços múltiplos pra um só", () => {
    expect(sanitizeQuery("hello    world\t\tagora")).toBe("hello world agora");
  });

  it("trima espaços nas pontas", () => {
    expect(sanitizeQuery("   query   ")).toBe("query");
  });

  it("trunca em 200 caracteres", () => {
    const long = "a".repeat(500);
    const result = sanitizeQuery(long);
    expect(result.length).toBe(200);
  });

  it("retorna string vazia se receber só espaços/tags", () => {
    expect(sanitizeQuery("   ")).toBe("");
    expect(sanitizeQuery("<<<>>>")).toBe("");
  });

  it("preserva caracteres unicode (acentos, emojis)", () => {
    expect(sanitizeQuery("inteligência artificial")).toBe("inteligência artificial");
    expect(sanitizeQuery("🚀 launch news")).toBe("🚀 launch news");
  });
});
