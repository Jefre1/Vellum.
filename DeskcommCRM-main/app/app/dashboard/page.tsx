import type { Metadata } from "next";
import { z } from "zod";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { carregarDashboard } from "@/lib/dashboard/carregar";

import { Painel } from "./_components/Painel";
import { SeletorDePeriodo } from "./_components/SeletorDePeriodo";
import { CartaoKpi } from "./_components/CartaoKpi";
import { GraficoDeVendas } from "./_components/GraficoDeVendas";
import { FunilDeVendas } from "./_components/FunilDeVendas";
import { AtividadesRecentes, ClientesEmDestaque, ProximasTarefas } from "./_components/Listas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

/** Janela da tela: só os três valores que o seletor oferece. Fora disso, 30. */
const periodoSchema = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]));

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { periodo } = await searchParams;
  const dias = periodoSchema.safeParse(periodo).data ?? 30;

  const primeiroNome = user.full_name?.trim().split(/\s+/)[0] ?? null;

  if (!org) {
    return <p className="text-sm text-text-muted">{t("Nenhuma organização ativa.")}</p>;
  }

  const dados = await carregarDashboard({ orgId: org.orgId, dias });
  const r = dados.resumo;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <header className="sobre-o-fundo flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">
            {primeiroNome ? `${t("Olá")}, ${primeiroNome}!` : `${t("Olá")}!`}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("Aqui está um resumo do seu negócio hoje.")}
          </p>
        </div>
        <SeletorDePeriodo dias={dias} />
      </header>

      {dados.truncado ? (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          {t("Volume grande: os números consideram os registros mais recentes do período.")}
        </p>
      ) : null}

      <section
        aria-label={t("Indicadores")}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <CartaoKpi
          titulo={t("Total de Clientes")}
          icone="clientes"
          tom="accent"
          kpi={r?.totalDeClientes ?? null}
          formato="numero"
          moeda={r?.moeda ?? "BRL"}
          semBase={t("sem base de comparação")}
          indisponivel={t("não foi possível carregar")}
          comparacao={t("crescimento no período")}
        />
        <CartaoKpi
          titulo={t("Vendas Hoje")}
          icone="vendas"
          tom="success"
          kpi={r?.vendasHoje ?? null}
          formato="dinheiro"
          moeda={r?.moeda ?? "BRL"}
          semBase={t("sem base de comparação")}
          indisponivel={t("não foi possível carregar")}
          comparacao={t("vs. ontem")}
        />
        <CartaoKpi
          titulo={t("Receita no Período")}
          icone="receita"
          tom="warning"
          kpi={r?.receitaDoPeriodo ?? null}
          formato="dinheiro"
          moeda={r?.moeda ?? "BRL"}
          semBase={t("sem base de comparação")}
          indisponivel={t("não foi possível carregar")}
          comparacao={t("vs. período anterior")}
        />
        <CartaoKpi
          titulo={t("Ticket Médio")}
          icone="ticket"
          tom="info"
          kpi={r?.ticketMedio ?? null}
          formato="dinheiro"
          moeda={r?.moeda ?? "BRL"}
          semBase={t("sem base de comparação")}
          indisponivel={t("não foi possível carregar")}
          comparacao={t("vs. período anterior")}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Painel
          className="xl:col-span-3"
          titulo={t("Vendas ao longo do tempo")}
          icone="grafico"
          acao={
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
              {t("Vendas")}
            </span>
          }
        >
          {r ? (
            <GraficoDeVendas serie={r.serieDeVendas} moeda={r.moeda} hoje={dados.hoje} />
          ) : (
            <SemDados texto={t("Não foi possível carregar as vendas.")} />
          )}
        </Painel>
        <Painel
          className="xl:col-span-2"
          titulo={t("Funil de Vendas")}
          icone="funil"
          acao={
            dados.funil ? (
              <span className="truncate text-xs text-text-muted" title={dados.funil.pipeline}>
                {dados.funil.pipeline}
              </span>
            ) : null
          }
        >
          {dados.funil && dados.funil.etapas.length > 0 ? (
            <FunilDeVendas etapas={dados.funil.etapas} />
          ) : (
            <SemDados texto={t("Nenhum funil configurado ainda.")} />
          )}
        </Painel>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Painel
          titulo={t("Atividades Recentes")}
          icone="atividade"
          verTodos={{ href: "/app/activities", rotulo: t("Ver todas") }}
        >
          <AtividadesRecentes itens={dados.atividades} agora={dados.agora} t={t} />
        </Painel>
        <Painel
          titulo={t("Próximas Tarefas")}
          icone="tarefa"
          verTodos={{ href: "/app/tasks", rotulo: t("Ver todas") }}
        >
          <ProximasTarefas
            itens={dados.tarefas}
            fuso={dados.fuso}
            hoje={dados.hoje}
            idioma={tagDeIdioma(user.idioma)}
            t={t}
          />
        </Painel>
        <Painel
          titulo={t("Clientes em Destaque")}
          icone="estrela"
          verTodos={{ href: "/app/contacts", rotulo: t("Ver todos") }}
        >
          <ClientesEmDestaque itens={dados.clientes} moeda={r?.moeda ?? "BRL"} t={t} />
        </Painel>
      </section>
    </div>
  );
}

function SemDados({ texto }: { texto: string }) {
  return (
    <div className="flex h-56 items-center justify-center text-sm text-text-muted">{texto}</div>
  );
}
