/**
 * Logger estruturado simples.
 *
 * Auditoria 2026-05-18 C6 (itens 24 e 25 do checklist):
 * versão anterior usava `console.log`/`console.error` espalhados pelo backend
 * — sem formato consistente, difícil de filtrar em Vercel logs, sem level.
 *
 * Implementação atual é wrapper fino sobre console — mas centralizado:
 * - Em DEV: formato legível (`[INFO] mensagem { meta }`)
 * - Em PROD: JSON estruturado (uma linha por log → fácil parse no Vercel/Datadog)
 * - Levels: trace, debug, info, warn, error, fatal
 *
 * TODO (quando volume justificar): trocar internals por `pino` real. Interface
 * pública (logger.info, logger.error com meta) deve permanecer igual — só o
 * backend muda. Custo de migração será mínimo.
 *
 * REGRA: NUNCA log de PII crua. Use `redact` paths se for adicionar request body.
 */
import { env } from "./env";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// Threshold: em prod só info+; em dev mostra tudo.
const MIN_LEVEL: LogLevel = env.isProduction ? "info" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  if (env.isProduction) {
    // JSON estruturado — uma linha por log, parseável.
    return JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }
  // Dev: legível, meta opcional como JSON inline.
  const tag = `[${level.toUpperCase()}]`;
  return meta ? `${tag} ${message} ${JSON.stringify(meta)}` : `${tag} ${message}`;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const line = format(level, message, meta);
  // error/fatal vão pra stderr; resto pra stdout (Vercel separa os streams).
  if (level === "error" || level === "fatal") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  trace: (message: string, meta?: Record<string, unknown>) => emit("trace", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
  fatal: (message: string, meta?: Record<string, unknown>) => emit("fatal", message, meta),
};
