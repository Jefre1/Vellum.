"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useT } from "@/hooks/i18n/useT";
import type { PontoDoDia } from "@/lib/dashboard/resumo";
import { formatCents } from "@/lib/money";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "2026-10-07" → "7 Out". A data já vem no fuso da organização. */
function rotuloDoDia(dia: string, t: (s: string) => string): string {
  const [, mes, d] = dia.split("-");
  return `${Number(d)} ${t(MESES[Number(mes) - 1] ?? "")}`;
}

/** Eixo compacto: 18.742 → "18,7 mil". O valor exato fica no tooltip. */
const COMPACTO = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function GraficoDeVendas({
  serie,
  moeda,
  hoje,
}: {
  serie: PontoDoDia[];
  moeda: string;
  hoje: string;
}) {
  const t = useT();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dados = serie.map((p) => ({ ...p, valor: p.valorCents / 100 }));
  const vazio = serie.every((p) => p.vendas === 0);

  return (
    <div className="relative h-64 w-full">
      {vazio ? (
        <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-text-muted">
          {t("Nenhuma venda ganha no período.")}
        </p>
      ) : null}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dados} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id={`vendas-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--color-border)" />
          <XAxis
            dataKey="dia"
            tickFormatter={(d: string) => rotuloDoDia(d, t)}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: "var(--color-text-subtle)", fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v: number) => COMPACTO.format(v)}
            tickLine={false}
            axisLine={false}
            width={60}
            tick={{ fill: "var(--color-text-subtle)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-accent)", strokeDasharray: "4 4" }}
            contentStyle={{
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg-strong)",
              backdropFilter: "blur(16px)",
              boxShadow: "var(--shadow-md)",
              color: "var(--color-text)",
              fontSize: 12,
            }}
            labelFormatter={(d) => (d === hoje ? t("Hoje") : rotuloDoDia(String(d), t))}
            formatter={(_v, _n, item) => {
              const p = item.payload as PontoDoDia;
              return [
                `${formatCents(p.valorCents, moeda)} · ${p.vendas} ${p.vendas === 1 ? t("venda") : t("vendas")}`,
                t("Vendas"),
              ];
            }}
          />
          <Area
            type="monotone"
            dataKey="valor"
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            fill={`url(#vendas-${id})`}
            activeDot={{
              r: 5,
              strokeWidth: 2,
              stroke: "var(--color-surface)",
              fill: "var(--color-accent)",
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
