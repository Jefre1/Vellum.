import type { EtapaDoFunil } from "@/lib/dashboard/resumo";

const NUMERO = new Intl.NumberFormat("pt-BR");
const PERCENTUAL = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

/**
 * O funil desenhado: um degrau por etapa, com a largura proporcional a quantos
 * CHEGARAM até ela (`montarFunil` acumula). O degrau nunca some de todo — fica
 * com um piso de 18% de largura — para a etapa vazia continuar legível como
 * degrau, e não como um buraco no desenho.
 *
 * A cor desce pela rampa do accent (mais escura em cima, mais clara embaixo),
 * então segue o tema e a marca do revendedor.
 */
const DEGRAUS = [
  "var(--color-accent-600)",
  "var(--color-accent-500)",
  "var(--color-accent-400)",
  "var(--color-accent-300)",
  "var(--color-accent-200)",
];

export function FunilDeVendas({ etapas }: { etapas: EtapaDoFunil[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {etapas.map((e, i) => {
        const largura = Math.max(0.18, e.proporcao);
        const proxima = etapas[i + 1];
        const larguraDeBaixo = proxima ? Math.max(0.18, proxima.proporcao) : largura * 0.8;
        // Trapézio: o lado de baixo encosta na largura do próximo degrau.
        const recuo = ((largura - larguraDeBaixo) / largura) * 50;
        const cor = DEGRAUS[Math.min(i, DEGRAUS.length - 1)];
        return (
          <li
            key={e.id}
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4"
          >
            <div className="flex h-11 justify-center">
              <div
                className="h-full shadow-sm"
                style={{
                  width: `${largura * 100}%`,
                  background: `linear-gradient(180deg, ${cor}, color-mix(in oklab, ${cor} 82%, white))`,
                  clipPath: `polygon(0 0, 100% 0, ${100 - Math.max(0, recuo)}% 100%, ${Math.max(0, recuo)}% 100%)`,
                  borderRadius: "6px",
                }}
                aria-hidden
              />
            </div>
            <div className="flex min-w-0 items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-text" title={e.nome}>
                {e.nome}
              </span>
              <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                <span className="font-semibold text-text">{NUMERO.format(e.quantidade)}</span>
                <span className="w-9 text-right text-xs text-text-muted">
                  {PERCENTUAL.format(e.proporcao)}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
