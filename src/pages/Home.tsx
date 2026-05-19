import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import HeroSection from "@/sections/HeroSection";
import ResultsSection from "@/sections/ResultsSection";
import FeaturesSection from "@/sections/FeaturesSection";
import HowItWorksSection from "@/sections/HowItWorksSection";
import StatsSection from "@/sections/StatsSection";
import Footer from "@/sections/Footer";
import SearchBar from "@/components/SearchBar";
import ScrollProgress from "@/components/ScrollProgress";
import { Zap } from "lucide-react";

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [currentQuery, setCurrentQuery] = useState(initialQuery);
  const [hasSearched, setHasSearched] = useState(!!initialQuery);
  const resultsRef = useRef<HTMLDivElement>(null);

  const searchQuery = trpc.search.search.useQuery(
    { query: currentQuery },
    {
      enabled: !!currentQuery && hasSearched,
      retry: false,
    }
  );

  useEffect(() => {
    if (searchQuery.error) {
      // Auditoria 2026-05-18 C9: backend agora usa TRPCError com `code` padrão
      // em vez de `throw new Error("RATE_LIMITED")`. Detecta via `data.code` —
      // mais robusto que comparar mensagem por string.
      const code = (searchQuery.error as { data?: { code?: string } }).data?.code;
      if (code === "TOO_MANY_REQUESTS") {
        toast.error("Muitas buscas. Aguarde um minuto.", {
          icon: "⚠️",
          duration: 4000,
        });
      } else {
        toast.error("Erro na busca. Tente novamente.", {
          icon: "❌",
          duration: 3000,
        });
      }
    }
  }, [searchQuery.error]);

  useEffect(() => {
    if (searchQuery.isSuccess && hasSearched && searchQuery.data?.results.length > 0) {
      confetti({
        particleCount: 30,
        spread: 60,
        origin: { y: 0.7 },
        colors: ["#38BDF8", "#0EA5E9", "#7DD3FC", "#F0F9FF"],
        disableForReducedMotion: true,
      });
      if (searchQuery.data.source === "demo") {
        toast.info("Modo demonstração ativo", {
          description: "Em produção com acesso à internet, buscas reais serão retornadas.",
          duration: 5000,
        });
      }
    }
  }, [searchQuery.isSuccess, hasSearched]);

  const handleSearch = useCallback(
    (query: string) => {
      setCurrentQuery(query);
      setHasSearched(true);
      setSearchParams({ q: query });

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 150);
    },
    [setSearchParams]
  );

  const results = searchQuery.data?.results || [];
  const notice = searchQuery.data?.notice;
  const isLoading = searchQuery.isLoading;
  const error = searchQuery.error ? "Erro ao buscar resultados" : undefined;

  return (
    <div className="min-h-screen bg-[#070B14]" ref={resultsRef}>
      <ScrollProgress />

      <HeroSection onSearch={handleSearch} isLoading={isLoading} />

      {/* Sticky search bar */}
      {hasSearched && (
        <div
          className="sticky top-0 z-50 py-3 md:py-4 px-4 border-b border-[rgba(56,189,248,0.06)]"
          style={{
            background: "rgba(7, 11, 20, 0.9)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <div className="max-w-[680px] mx-auto">
            <SearchBar
              onSearch={handleSearch}
              isLoading={isLoading}
              initialValue={currentQuery}
            />
          </div>
        </div>
      )}

      <ResultsSection
        results={results}
        query={currentQuery}
        isLoading={isLoading}
        isVisible={hasSearched}
        error={error}
        notice={notice}
      />

      {/* Divider */}
      <div className="max-w-[1200px] mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-[rgba(56,189,248,0.08)] to-transparent" />
      </div>

      <FeaturesSection />

      {/* Divider */}
      <div className="max-w-[1200px] mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-[rgba(56,189,248,0.08)] to-transparent" />
      </div>

      <HowItWorksSection />

      {/* Divider */}
      <div className="max-w-[1200px] mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-[rgba(56,189,248,0.08)] to-transparent" />
      </div>

      <StatsSection />

      {/* CTA Section */}
      <section className="relative py-24 md:py-32 px-4 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(56, 189, 248, 0.1), transparent 70%)",
          }}
        />
        <motion.div
          className="relative max-w-[700px] mx-auto text-center"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
        >
          <div className="inline-flex p-3 rounded-2xl bg-[rgba(56,189,248,0.08)] border border-[rgba(56,189,248,0.15)] mb-6">
            <Zap className="w-6 h-6 text-[#38BDF8]" />
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-[#F0F9FF] mb-4 tracking-tight">
            Pronto para descobrir o que{" "}
            <span className="text-[#38BDF8]">importa?</span>
          </h2>
          <p className="text-[#94A3B8] text-lg mb-8 max-w-lg mx-auto">
            Use a busca acima e encontre os conteúdos mais relevantes sobre
            qualquer tema em segundos. Sem custo, sem cadastro.
          </p>
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="
              inline-flex items-center gap-2 px-8 py-4 rounded-full
              bg-[#38BDF8] hover:bg-[#0EA5E9]
              text-[#070B14] font-semibold text-lg
              transition-all duration-200
              hover:shadow-[0_0_30px_-5px_rgba(56,189,248,0.5)]
            "
          >
            <Zap className="w-5 h-5" />
            Começar agora
          </button>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}
