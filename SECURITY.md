# Política de Segurança — TrendScope

> Aplicável a este projeto. Última auditoria: **2026-05-18** (ver [`docs/AUDIT_REPORT_2026-05-18.md`](docs/AUDIT_REPORT_2026-05-18.md)).

## Versões suportadas

| Versão | Suporte |
|--------|---------|
| `main` | ✅ |
| Outros branches | ❌ Não suportados |

## Reportando uma vulnerabilidade

Se você encontrou um problema de segurança:

1. **NÃO abra issue pública.** Vulnerabilidades reportadas publicamente antes da correção ficam expostas para qualquer um.
2. **Use [GitHub Security Advisories](https://github.com/jeanderson-silva8/TrendScope/security/advisories/new)** (preferido) ou envie email para `silvajeanderson165@gmail.com`.
3. Inclua no relatório:
   - Descrição do problema
   - Passos para reproduzir (com PoC se possível)
   - Versão/commit afetado
   - Impacto estimado

## SLA de resposta

- **Resposta inicial:** até 7 dias úteis
- **Triagem completa:** até 14 dias
- **Correção:** depende da severidade — críticos em até 30 dias; outros conforme prioridade

## Escopo

**Dentro do escopo:**
- Backend (`server/`, `api/`)
- Frontend (`src/`)
- Configuração de deploy (`vercel.json`, `Dockerfile`)
- CI/CD (`.github/workflows/`)

**Fora do escopo:**
- Dependências de terceiros (reportar diretamente aos mantenedores)
- Infraestrutura do provedor (Vercel, TiDB Cloud, Serper.dev) — reportar ao provedor
- Bugs cosméticos sem implicação de segurança

## Histórico de auditorias

| Data | Tipo | Resultado |
|------|------|-----------|
| 2026-05-18 | Auditoria completa (2 passadas) via [Protocolo de Segurança](https://github.com/jeanderson-silva8/protocolo-de-seguranca) | 4 sólidos, 4 parciais, 11 críticos → plano de ação executado em sessões 1-10. Ver [relatório](docs/AUDIT_REPORT_2026-05-18.md). |
