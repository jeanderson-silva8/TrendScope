import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorId?: string;
}

/**
 * ErrorBoundary global da aplicação.
 *
 * Auditoria 2026-05-18 C18 (item 40 do checklist):
 * versão anterior exibia `error.message` cru ao usuário em produção, o que
 * pode vazar nomes de tabela, paths, queries SQL, stack traces parciais.
 * Agora o erro é logado no console (devtools) com um correlation ID curto, e
 * o usuário vê apenas o ID — para reportar ao suporte sem expor internals.
 *
 * Em produção real, `componentDidCatch` deve mandar `error` + `errorId` pra
 * Sentry/Datadog/etc. (TODO quando houver observabilidade — item 45).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    // Gera correlation ID curto (8 chars) para o usuário citar ao suporte.
    const errorId = Math.random().toString(36).slice(2, 10).toUpperCase();
    return { hasError: true, errorId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Erro completo só no console (devtools) — não vai pra UI.
    // TODO (item 45): mandar pra Sentry/Datadog com { errorId, error, errorInfo }.
    console.error(`ErrorBoundary [${this.state.errorId}]:`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorId: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#070B14] px-4">
          <div className="text-center max-w-md">
            <div className="inline-flex p-4 rounded-2xl bg-[rgba(56,189,248,0.08)] border border-[rgba(56,189,248,0.15)] mb-6">
              <AlertTriangle className="w-10 h-10 text-[#38BDF8]" />
            </div>
            <h1 className="text-2xl font-bold text-[#F0F9FF] mb-2">
              Algo deu errado
            </h1>
            <p className="text-[#94A3B8] mb-6 text-sm">
              Ocorreu um erro inesperado. Tente recarregar a página. Se o
              problema persistir, contate o suporte com o código abaixo.
            </p>
            {this.state.errorId && (
              <div className="mb-6 p-3 rounded-lg bg-[#0D1520] border border-[rgba(56,189,248,0.06)]">
                <p className="text-[#94A3B8] text-xs mb-1">
                  Código de referência:
                </p>
                <p className="text-[#38BDF8] text-sm font-mono">
                  {this.state.errorId}
                </p>
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#38BDF8] hover:bg-[#0EA5E9] text-[#070B14] font-medium transition-colors duration-200"
            >
              <RotateCcw className="w-4 h-4" />
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
