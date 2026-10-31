import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRight, ChartBar, CheckSquare, Funnel, Lightning, Star } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const ICONES = {
  grafico: ChartBar,
  funil: Funnel,
  atividade: Lightning,
  tarefa: CheckSquare,
  estrela: Star,
} as const;

/**
 * O painel de vidro do Dashboard: cabeçalho com ícone, título e uma ação
 * opcional à direita ("Ver todas →" ou um rótulo). Componente de servidor — só
 * desenha; quem tem estado são os filhos.
 */
export function Painel({
  titulo,
  icone,
  acao,
  verTodos,
  className,
  children,
}: {
  titulo: string;
  icone: keyof typeof ICONES;
  acao?: ReactNode;
  verTodos?: { href: string; rotulo: string };
  className?: string;
  children: ReactNode;
}) {
  const Icone = ICONES[icone];
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl glass p-5", className)}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-text">
          <Icone size={20} weight="duotone" className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">{titulo}</span>
        </h2>
        {verTodos ? (
          <Link
            href={verTodos.href}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-accent-soft hover:text-accent"
          >
            {verTodos.rotulo}
            <ArrowRight size={12} aria-hidden />
          </Link>
        ) : (
          acao
        )}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}
