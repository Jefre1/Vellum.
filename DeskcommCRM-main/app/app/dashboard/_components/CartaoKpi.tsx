import { useId } from "react";

import type { Kpi } from "@/lib/dashboard/resumo";
import { formatCents } from "@/lib/money";
import {
  ArrowDown,
  ArrowUp,
  CurrencyCircleDollar,
  Receipt,
  ShoppingCart,
  Users,
} from "@/lib/ui/icons";

const ICONES = {
  clientes: Users,
  vendas: ShoppingCart,
  receita: CurrencyCircleDollar,
  ticket: Receipt,
} as const;

/**
 * O TOM é a cor do card, e cada tom aponta para um TOKEN — nunca para hex. Assim
 * o card segue o tema (claro/escuro) e, no caso do accent, a marca do revendedor.
 */
const TONS = {
  accent: { cor: "var(--color-accent)", fundo: "var(--color-accent-soft)" },
  success: { cor: "var(--color-success)", fundo: "var(--color-success-bg)" },
  warning: { cor: "var(--color-warning)", fundo: "var(--color-warning-bg)" },
  info: { cor: "var(--color-info)", fundo: "var(--color-info-bg)" },
} as const;

const NUMERO = new Intl.NumberFormat("pt-BR");
const PERCENTUAL = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function CartaoKpi({
  titulo,
  icone,
  tom,
  kpi,
  formato,
  moeda,
  comparacao,
  semBase,
  indisponivel,
}: {
  titulo: string;
  icone: keyof typeof ICONES;
  tom: keyof typeof TONS;
  kpi: Kpi | null;
  formato: "numero" | "dinheiro";
  moeda: string;
  /** "vs. ontem", "vs. período anterior"… */
  comparacao: string;
  /** Texto para variação sem base de comparação. */
  semBase: string;
  /** Texto para quando a leitura falhou. */
  indisponivel: string;
}) {
  const Icone = ICONES[icone];
  const { cor, fundo } = TONS[tom];
  const valor =
    kpi === null
      ? "—"
      : formato === "dinheiro"
        ? formatCents(Math.round(kpi.valor), moeda)
        : NUMERO.format(kpi.valor);

  return (
    <article className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl glass p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: fundo, color: cor }}
          aria-hidden
        >
          <Icone size={22} weight="fill" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text-muted">{titulo}</h3>
          <p className="truncate text-2xl font-bold tracking-tight text-text tabular-nums">
            {valor}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <Variacao
          variacao={kpi?.variacao ?? null}
          comparacao={comparacao}
          semBase={kpi === null ? indisponivel : semBase}
        />
        {kpi && kpi.serie.length > 1 ? <Faisca serie={kpi.serie} cor={cor} /> : null}
      </div>
    </article>
  );
}

function Variacao({
  variacao,
  comparacao,
  semBase,
}: {
  variacao: number | null;
  comparacao: string;
  semBase: string;
}) {
  if (variacao === null) {
    return <span className="text-xs text-text-subtle">{semBase}</span>;
  }
  const sobe = variacao >= 0;
  const Seta = sobe ? ArrowUp : ArrowDown;
  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={
          sobe
            ? "inline-flex items-center gap-1 text-sm font-semibold text-success-fg"
            : "inline-flex items-center gap-1 text-sm font-semibold text-error-fg"
        }
      >
        <Seta size={14} weight="bold" aria-hidden />
        {sobe ? "+" : ""}
        {PERCENTUAL.format(variacao)}
      </span>
      <span className="truncate text-[11px] text-text-subtle">{comparacao}</span>
    </span>
  );
}

/**
 * A faísca: tendência, não leitura. Sem eixo e sem rótulo de propósito — o
 * número exato é o grande, em cima. SVG puro, desenhado no servidor.
 */
function Faisca({ serie, cor }: { serie: number[]; cor: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const L = 112;
  const A = 40;
  const max = Math.max(...serie);
  const min = Math.min(...serie);
  const faixa = max - min || 1;
  const pontos = serie.map((v, i) => {
    const x = (i / (serie.length - 1)) * L;
    const y = A - 3 - ((v - min) / faixa) * (A - 6);
    return [x, y] as const;
  });
  const linha = pontos
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${linha} L${L},${A} L0,${A} Z`;
  return (
    <svg
      width={L}
      height={A}
      viewBox={`0 0 ${L} ${A}`}
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={`faisca-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity={0.35} />
          <stop offset="100%" stopColor={cor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#faisca-${id})`} />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={pontos.at(-1)![0]} cy={pontos.at(-1)![1]} r={3} fill={cor} />
    </svg>
  );
}
