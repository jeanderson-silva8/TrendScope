/**
 * Setup global do Vitest — roda ANTES de qualquer import nos arquivos de teste.
 *
 * Sem essas envs, `server/lib/env.ts` aborta o processo (fail-fast intencional).
 * Os valores aqui são fake e não tocam serviço externo nos testes unitários.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "mysql://test:test@localhost:4000/test?sslaccept=strict";
process.env.SERPER_API_KEY = "test-key-not-used-in-unit";
process.env.APP_ID = "test-app-id";
process.env.APP_SECRET = "test-app-secret-min-32-chars-padded-padded";
