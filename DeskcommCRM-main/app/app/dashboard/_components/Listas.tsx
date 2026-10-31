import Link from "next/link";

import type { AtividadeRecente, ClienteDestacado, TarefaProxima } from "@/lib/dashboard/carregar";
import { diaNoFuso } from "@/lib/dashboard/resumo";
import { formatCents } from "@/lib/money";
import { ArrowDown, ArrowUp, Circle, Lightning } from "@/lib/ui/icons";

/**
 * As três listas de baixo do Dashboard. Componentes de SERVIDOR: o "há 2
 * minutos" depende do relógio, e calculado no cliente divergiria do HTML do
 * servidor na hidratação. Os textos chegam traduzidos por quem chama (`t`).
 */

type T = (texto: string) => string;

const PERCENTUAL = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function haQuanto(iso: string, agora: number, t: T): string {
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return t("agora");
  const m = Math.round(s / 60);
  if (m < 60) return `${t("há")} ${m} ${m === 1 ? t("minuto") : t("minutos")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${t("há")} ${h} ${h === 1 ? t("hora") : t("horas")}`;
  const d = Math.round(h / 24);
  return `${t("há")} ${d} ${d === 1 ? t("dia") : t("dias")}`;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return (
    partes
      .slice(0, 2)
      .map((p) => [...p][0] ?? "")
      .join("") || "?"
  ).toUpperCase();
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-text-muted">{texto}</p>;
}

const LINHA =
  "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent-soft/60";

export function AtividadesRecentes({
  itens,
  agora: agoraIso,
  t,
}: {
  itens: AtividadeRecente[] | null;
  /** O instante da leitura, vindo do carregador — o render não lê o relógio. */
  agora: string;
  t: T;
}) {
  if (itens === null) return <Vazio texto={t("Não foi possível carregar as atividades.")} />;
  if (itens.length === 0) return <Vazio texto={t("Nenhuma atividade ainda.")} />;
  const agora = Date.parse(agoraIso);
  return (
    <ul className="flex flex-col gap-1">
      {itens.map((a, i) => (
        <li key={a.id}>
          <Link href={`/app/leads/${a.leadId}`} className={LINHA}>
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
            >
              <Lightning size={16} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">{t(a.rotulo)}</span>
              <span className="block truncate text-xs text-text-muted">
                {a.negocio ? `${a.negocio} — ` : ""}
                {haQuanto(a.quando, agora, t)}
              </span>
            </span>
            {i === 0 ? (
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProximasTarefas({
  itens,
  fuso,
  hoje,
  idioma,
  t,
}: {
  itens: TarefaProxima[] | null;
  fuso: string;
  hoje: string;
  /** Tag BCP 47 do idioma da pessoa (`tagDeIdioma`) — a data segue o idioma. */
  idioma: string;
  t: T;
}) {
  if (itens === null) return <Vazio texto={t("Não foi possível carregar as tarefas.")} />;
  if (itens.length === 0) return <Vazio texto={t("Nenhuma tarefa em aberto.")} />;
  const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const hora = new Intl.DateTimeFormat(idioma, {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
  });
  const data = new Intl.DateTimeFormat(idioma, {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <ul className="flex flex-col gap-1">
      {itens.map((tarefa) => {
        let prazo = t("Sem prazo");
        let tom = "text-text-subtle";
        if (tarefa.prazo) {
          const dia = diaNoFuso(tarefa.prazo, fuso);
          const quando = new Date(tarefa.prazo);
          if (dia < hoje) {
            prazo = `${t("Venceu")} ${data.format(quando)}`;
            tom = "text-error-fg";
          } else if (dia === hoje) {
            prazo = `${t("Hoje")}, ${hora.format(quando)}`;
            tom = "text-accent";
          } else if (dia === amanha) {
            prazo = `${t("Amanhã")}, ${hora.format(quando)}`;
            tom = "text-text-muted";
          } else {
            prazo = data.format(quando);
            tom = "text-text-muted";
          }
        }
        return (
          <li key={tarefa.id}>
            <Link href="/app/tasks" className={LINHA}>
              <Circle size={18} className="shrink-0 text-border-strong" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{tarefa.titulo}</span>
              <span className={`shrink-0 text-xs font-medium ${tom}`}>{prazo}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ClientesEmDestaque({
  itens,
  moeda,
  t,
}: {
  itens: ClienteDestacado[] | null;
  moeda: string;
  t: T;
}) {
  if (itens === null) return <Vazio texto={t("Não foi possível carregar os clientes.")} />;
  if (itens.length === 0) return <Vazio texto={t("Nenhuma venda com cliente no período.")} />;
  return (
    <ul className="flex flex-col gap-1">
      {itens.map((c) => {
        const sobe = c.variacao !== null && c.variacao >= 0;
        return (
          <li key={c.contactId}>
            <Link href={`/app/contacts/${c.contactId}`} className={LINHA}>
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
              >
                {iniciais(c.nome)}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-text"
                title={c.nome}
              >
                {c.nome}
              </span>
              <span className="shrink-0 text-sm font-semibold text-text tabular-nums">
                {formatCents(c.valorCents, moeda)}
              </span>
              <span
                className={`flex w-14 shrink-0 items-center justify-end gap-0.5 text-xs font-semibold tabular-nums ${
                  c.variacao === null
                    ? "text-text-subtle"
                    : sobe
                      ? "text-success-fg"
                      : "text-error-fg"
                }`}
              >
                {c.variacao === null ? (
                  t("novo")
                ) : (
                  <>
                    {sobe ? (
                      <ArrowUp size={11} weight="bold" aria-hidden />
                    ) : (
                      <ArrowDown size={11} weight="bold" aria-hidden />
                    )}
                    {PERCENTUAL.format(Math.abs(c.variacao))}
                  </>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
