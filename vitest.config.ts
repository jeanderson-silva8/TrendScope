import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    // Auditoria 2026-05-18 (item 18 do checklist): cobertura de testes
    // expandida pra server/ e tests/ — antes só rodava em api/.
    include: [
      "api/**/*.{test,spec}.ts",
      "server/**/*.{test,spec}.ts",
      "tests/**/*.{test,spec}.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
