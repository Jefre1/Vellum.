import "server-only";

import { activityLabel } from "@/lib/leads/activity-vocabulary";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createClient } from "@/lib/supabase/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { logger } from "@/lib/logger";

import {
  diaNoFuso,
  montarFunil,
  montarResumo,
  type ContatoCriado,
  type EtapaDoFunil,
  type ResumoDoDashboard,
  type VendaGanha,
} from "./resumo";

/**
 * O DASHBOARD LÊ COM A SESSÃO, NUNCA COM A SERVICE KEY.
 *
 * Cada leitura usa o client de sessão (`createClient`), então a RLS decide o
 * escopo: atendente vê os próprios negócios, gestor vê a organização — a mesma
 * régua das rotas de `/api/v1/metrics/*` (spec 13, decisão G1-06e). Mesmo
 * assim, TODA consulta filtra `organization_id` explicitamente (doutrina de
 * multi-tenancy): quem tem mais de uma organização não pode ver a soma delas.
 *
 * Read-only ⇒ sem audit. Nenhuma tabela nova, nenhuma RPC: tudo sai de dados
 * que já existem.
 *
 * Falha PARCIAL não derruba a tela: cada bloco que não leu volta com `erro`
 * preenchido e o card mostra "não foi possível carregar", em vez de um zero
 * que mentiria.
 */

const PAGINA = 1000;
const PAGINAS_MAXIMAS = 5;

export interface AtividadeRecente {
  id: string;
  rotulo: string;
  tipo: string;
  negocio: string | null;
  leadId: string;
  quando: string;
}

export interface TarefaProxima {
  id: string;
  titulo: string;
  prazo: string | null;
  prioridade: string;
}

export interface ClienteDestacado {
  contactId: string;
  nome: string;
  valorCents: number;
  vendas: number;
  variacao: number | null;
}

export interface DadosDoDashboard {
  fuso: string;
  /** O instante da leitura (ISO). As listas medem "há quanto tempo" contra ele. */
  agora: string;
  hoje: string;
  resumo: ResumoDoDashboard | null;
  funil: { pipeline: string; etapas: EtapaDoFunil[] } | null;
  atividades: AtividadeRecente[] | null;
  tarefas: TarefaProxima[] | null;
  clientes: ClienteDestacado[] | null;
  /** Alguma leitura bateu no teto de páginas: os números são do pedaço mais recente. */
  truncado: boolean;
}

type Cliente = Awaited<ReturnType<typeof createClient>>;
type Resultado<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

/** Lê paginando até o fim (provado por `count` ou página vazia) ou até o teto. */
async function lerTudo<T>(
  pagina: (inicio: number, fim: number, contar: boolean) => PromiseLike<Resultado<T>>,
): Promise<{ linhas: T[]; truncado: boolean; erro: string | null }> {
  const linhas: T[] = [];
  let total: number | null = null;
  for (let i = 0; i < PAGINAS_MAXIMAS; i++) {
    const { data, error, count } = await pagina(linhas.length, linhas.length + PAGINA - 1, i === 0);
    if (error) return { linhas, truncado: false, erro: error.message };
    if (i === 0) total = count ?? null;
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length === 0 || (total !== null && linhas.length >= total)) {
      return { linhas, truncado: false, erro: null };
    }
  }
  return { linhas, truncado: true, erro: null };
}

export async function carregarDashboard(opts: {
  orgId: string;
  dias: number;
  agora?: Date;
}): Promise<DadosDoDashboard> {
  const { orgId, dias } = opts;
  const agora = opts.agora ?? new Date();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();
  const fuso = fusoUtilizavel((org as { timezone?: string | null } | null)?.timezone);

  // Duas janelas (atual + anterior) com um dia de folga para o fuso: a conta
  // fina de "que dia é" é feita em `montarResumo`, no fuso da organização.
  const desde = new Date(agora.getTime() - (2 * dias + 1) * 24 * 60 * 60 * 1000).toISOString();

  const [total, criados, vendas, funil, atividades, tarefas] = await Promise.all([
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("is_merged_into", null)
      .neq("kind", "whatsapp_group"),
    lerTudo<ContatoCriado>((de, ate, contar) =>
      supabase
        .from("contacts")
        .select("created_at", contar ? { count: "exact" } : undefined)
        .eq("organization_id", orgId)
        .is("is_merged_into", null)
        .neq("kind", "whatsapp_group")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    ),
    lerTudo<VendaGanha>((de, ate, contar) =>
      supabase
        .from("crm_leads")
        .select(
          "closed_at, value_cents, currency, contact_id",
          contar ? { count: "exact" } : undefined,
        )
        .eq("organization_id", orgId)
        .eq("status", "won")
        .gte("closed_at", desde)
        .order("closed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    ),
    lerFunil(supabase, orgId, agora, dias),
    supabase
      .from("crm_lead_activities")
      .select("id, type, lead_id, performed_at, crm_leads!crm_lead_activities_lead_id_fkey(title)")
      .eq("organization_id", orgId)
      .order("performed_at", { ascending: false })
      .limit(4),
    supabase
      .from("crm_tasks")
      .select("id, title, due_date, priority")
      .eq("organization_id", orgId)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(4),
  ]);

  const erros = [
    total.error && `contatos: ${total.error.message}`,
    criados.erro && `contatos criados: ${criados.erro}`,
    vendas.erro && `vendas: ${vendas.erro}`,
    atividades.error && `atividades: ${atividades.error.message}`,
    tarefas.error && `tarefas: ${tarefas.error.message}`,
  ].filter(Boolean);
  if (erros.length > 0) {
    logger.warn("dashboard: leitura parcial", { organization_id: orgId, erros });
  }

  const resumo =
    total.error || criados.erro || vendas.erro
      ? null
      : montarResumo({
          agora,
          fuso,
          dias,
          totalDeContatos: total.count ?? 0,
          contatosCriados: criados.linhas,
          vendas: vendas.linhas.filter((v) => v.closed_at),
        });

  let clientes: ClienteDestacado[] | null = null;
  if (resumo) {
    const ids = resumo.clientesEmDestaque.map((c) => c.contactId);
    const nomes = new Map<string, string>();
    if (ids.length > 0) {
      const { data } = await supabase
        .from("contacts")
        .select("id, display_name, name, phone_number")
        .eq("organization_id", orgId)
        .in("id", ids);
      for (const c of data ?? []) nomes.set(c.id, rotuloDoContato(c));
    }
    clientes = resumo.clientesEmDestaque.map((c) => ({
      ...c,
      nome: nomes.get(c.contactId) ?? rotuloDoContato(null),
    }));
  }

  return {
    fuso,
    agora: agora.toISOString(),
    hoje: diaNoFuso(agora, fuso),
    resumo,
    funil,
    atividades: atividades.error
      ? null
      : (atividades.data ?? []).map((a) => {
          const lead = (a as { crm_leads?: { title?: string | null } | null }).crm_leads;
          return {
            id: a.id,
            tipo: a.type,
            rotulo: activityLabel(a.type),
            negocio: lead?.title ?? null,
            leadId: a.lead_id,
            quando: a.performed_at,
          };
        }),
    tarefas: tarefas.error
      ? null
      : (tarefas.data ?? []).map((t) => ({
          id: t.id,
          titulo: t.title,
          prazo: t.due_date,
          prioridade: t.priority,
        })),
    clientes,
    truncado: criados.truncado || vendas.truncado,
  };
}

/**
 * O funil do pipeline PADRÃO (ou o primeiro, se nenhum é padrão): quantos
 * negócios abertos estão em cada etapa, mais os ganhos do período na etapa de
 * ganho. `montarFunil` acumula de baixo para cima.
 */
async function lerFunil(
  supabase: Cliente,
  orgId: string,
  agora: Date,
  dias: number,
): Promise<DadosDoDashboard["funil"]> {
  const { data: pipelines, error } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default, position")
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1);
  if (error || !pipelines || pipelines.length === 0) return null;
  const pipeline = pipelines[0]!;

  const { data: etapas, error: erroEtapas } = await supabase
    .from("crm_stages")
    .select("id, name, position, is_lost, is_won")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .eq("is_archived", false);
  if (erroEtapas || !etapas) return null;

  const desde = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();
  const contagens = await Promise.all(
    etapas
      .filter((e) => !e.is_lost)
      .map(async (e) => {
        let consulta = supabase
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("pipeline_id", pipeline.id)
          .eq("stage_id", e.id);
        consulta = e.is_won
          ? consulta.eq("status", "won").gte("closed_at", desde)
          : consulta.eq("status", "open");
        const { count } = await consulta;
        return [e.id, count ?? 0] as const;
      }),
  );

  return { pipeline: pipeline.name, etapas: montarFunil(etapas, new Map(contagens)) };
}
