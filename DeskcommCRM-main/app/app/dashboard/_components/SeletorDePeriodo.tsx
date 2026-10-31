"use client";

import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { CalendarBlank, CaretDown, Check } from "@/lib/ui/icons";

const OPCOES = [7, 30, 90] as const;

/**
 * A janela do Dashboard mora na URL (`?periodo=30`): recarregar, compartilhar o
 * link ou voltar no histórico mantém o que a pessoa escolheu. A página valida o
 * valor com Zod — qualquer coisa fora de 7/30/90 vira 30.
 */
export function SeletorDePeriodo({ dias }: { dias: number }) {
  const t = useT();
  const rotulo = (n: number) => `${t("Últimos")} ${n} ${t("dias")}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full glass px-4 text-sm font-medium text-text transition-colors hover:text-accent"
        >
          <CalendarBlank size={16} aria-hidden />
          {rotulo(dias)}
          <CaretDown size={12} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {OPCOES.map((n) => (
          <DropdownMenuItem key={n} asChild>
            <Link
              href={`/app/dashboard?periodo=${n}`}
              aria-current={n === dias ? "true" : undefined}
            >
              <span className="flex-1">{rotulo(n)}</span>
              {n === dias ? <Check size={14} aria-hidden /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
