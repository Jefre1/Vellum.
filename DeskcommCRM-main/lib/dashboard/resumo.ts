/**
 * O RESUMO DO DASHBOARD — a conta, sem banco.
 *
 * `lib/dashboard/carregar.ts` lê as linhas (com o client de SESSÃO, então a RLS
 * decide o que cada papel enxerga) e este módulo só agrega. Separado para ser
 * testado sem Postgres: `lib/dashboard/resumo.test.ts`.
 *
 * Regras que valem para todos os números da tela:
 *
 *  - O DIA é o do fuso da organização. Em UTC, a venda das 23h30 de São Paulo
 *    cairia no dia seguinte — mesma régua de `lib/metrics/serie-temporal.ts`.
 *  - Toda variação compara a janela atual com a janela IMEDIATAMENTE anterior,
 *    de mesmo tamanho. Sem base (anterior = 0), a variação é `null` — nunca
 *    "+100%" nem "∞": a tela mostra "sem base", que é o que aconteceu.
 *  - Dinheiro é somado SÓ na moeda dominante do período. Somar BRL com USD
 *    daria um número que não existe; a moeda escolhida vai junto no payload.
 */

export interface VendaGanha {
  closed_at: string;
  value_cents: number | null;
  currency: string | null;
  contact_id: string | null;
}

export interface ContatoCriado {
  created_at: string;
}

export interface Kpi {
  valor: number;
  /** Variação contra a janela anterior, em fração (0,12 = +12%). `null` = sem base. */
  variacao: number | null;
  /** Um ponto por dia da janela atual, do mais antigo ao mais recente. */
  serie: number[];
}

export interface PontoDoDia {
  /** `YYYY-MM-DD` no fuso da organização. */
  dia: string;
  valorCents: number;
  vendas: number;
}

export interface ClienteEmDestaque {
  contactId: string;
  valorCents: number;
  vendas: number;
  /** Variação do valor contra a janela anterior. `null` = cliente novo no período. */
  variacao: number | null;
}

export interface ResumoDoDashboard {
  moeda: string;
  dias: number;
  totalDeClientes: Kpi;
  vendasHoje: Kpi;
  receitaDoPeriodo: Kpi;
  ticketMedio: Kpi;
  serieDeVendas: PontoDoDia[];
  clientesEmDestaque: ClienteEmDestaque[];
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` de um instante, no fuso pedido. `en-CA` já formata nessa ordem. */
export function diaNoFuso(instante: Date | string, fuso: string): string {
  const data = typeof instante === "string" ? new Date(instante) : instante;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

/**
 * Os `dias` dias que terminam HOJE (no fuso), do mais antigo ao mais recente.
 *
 * Anda de meio-dia em meio-dia UTC a partir do dia local de hoje, e não de
 * `agora - n×24h`: horário de verão encurta ou alonga um dia, e a subtração
 * pura repetiria ou pularia uma data perto da meia-noite.
 */
export function diasDaJanela(agora: Date, dias: number, fuso: string): string[] {
  const hoje = diaNoFuso(agora, fuso);
  const ancora = Date.parse(`${hoje}T12:00:00Z`);
  const lista: string[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    lista.push(new Date(ancora - i * UM_DIA_MS).toISOString().slice(0, 10));
  }
  return lista;
}

/** Variação relativa; `null` quando não há base para comparar. */
export function variacao(atual: number, anterior: number): number | null {
  if (!Number.isFinite(anterior) || anterior <= 0) return null;
  return (atual - anterior) / anterior;
}

/** A moeda que mais aparece nas vendas; o padrão do produto quando não há venda. */
export function moedaDominante(vendas: VendaGanha[], padrao = "BRL"): string {
  const contagem = new Map<string, number>();
  for (const v of vendas) {
    const m = (v.currency ?? padrao).toUpperCase();
    contagem.set(m, (contagem.get(m) ?? 0) + 1);
  }
  let melhor = padrao;
  let maior = 0;
  for (const [m, n] of contagem) {
    if (n > maior) {
      melhor = m;
      maior = n;
    }
  }
  return melhor;
}

export interface EntradaDoResumo {
  agora: Date;
  fuso: string;
  /** Tamanho da janela, em dias (7, 30 ou 90 na tela). */
  dias: number;
  /** Total de contatos visíveis HOJE (contagem exata do banco). */
  totalDeContatos: number;
  /** Contatos criados nas DUAS janelas (atual + anterior). */
  contatosCriados: ContatoCriado[];
  /** Vendas ganhas nas DUAS janelas (atual + anterior). */
  vendas: VendaGanha[];
  /** Quantos clientes listar no destaque. */
  limiteDeDestaque?: number;
}

export function montarResumo(e: EntradaDoResumo): ResumoDoDashboard {
  const dias = diasDaJanela(e.agora, e.dias, e.fuso);
  const diasAnteriores = diasDaJanela(
    new Date(e.agora.getTime() - e.dias * UM_DIA_MS),
    e.dias,
    e.fuso,
  );
  const atual = new Set(dias);
  const anterior = new Set(diasAnteriores);
  const hoje = dias[dias.length - 1]!;
  const ontem = dias[dias.length - 2] ?? diasAnteriores[diasAnteriores.length - 1]!;

  const moeda = moedaDominante(e.vendas.filter((v) => atual.has(diaNoFuso(v.closed_at, e.fuso))));
  const naMoeda = e.vendas.filter((v) => (v.currency ?? "BRL").toUpperCase() === moeda);

  // ── vendas por dia (valor e quantidade), nas duas janelas ──────────────────
  const valorPorDia = new Map<string, number>();
  const vendasPorDia = new Map<string, number>();
  for (const v of naMoeda) {
    const dia = diaNoFuso(v.closed_at, e.fuso);
    valorPorDia.set(dia, (valorPorDia.get(dia) ?? 0) + (v.value_cents ?? 0));
    vendasPorDia.set(dia, (vendasPorDia.get(dia) ?? 0) + 1);
  }
  const soma = (lista: string[], mapa: Map<string, number>) =>
    lista.reduce((acc, d) => acc + (mapa.get(d) ?? 0), 0);

  const serieDeVendas: PontoDoDia[] = dias.map((dia) => ({
    dia,
    valorCents: valorPorDia.get(dia) ?? 0,
    vendas: vendasPorDia.get(dia) ?? 0,
  }));

  // ── receita e ticket ───────────────────────────────────────────────────────
  const receitaAtual = soma(dias, valorPorDia);
  const receitaAnterior = soma(diasAnteriores, valorPorDia);
  const qtdAtual = soma(dias, vendasPorDia);
  const qtdAnterior = soma(diasAnteriores, vendasPorDia);
  const ticketAtual = qtdAtual > 0 ? receitaAtual / qtdAtual : 0;
  const ticketAnterior = qtdAnterior > 0 ? receitaAnterior / qtdAnterior : 0;

  // Ticket acumulado dia a dia: a curva mostra para onde a média está indo,
  // sem os picos de um dia com uma venda só.
  let acumValor = 0;
  let acumQtd = 0;
  const serieDoTicket = dias.map((d) => {
    acumValor += valorPorDia.get(d) ?? 0;
    acumQtd += vendasPorDia.get(d) ?? 0;
    return acumQtd > 0 ? acumValor / acumQtd : 0;
  });

  // ── clientes: total de hoje, série de novos por dia ────────────────────────
  const novosPorDia = new Map<string, number>();
  for (const c of e.contatosCriados) {
    const dia = diaNoFuso(c.created_at, e.fuso);
    novosPorDia.set(dia, (novosPorDia.get(dia) ?? 0) + 1);
  }
  const novosAtual = soma(dias, novosPorDia);
  // A base do total no início da janela: quem existe hoje menos quem chegou nela.
  // A variação do card é o crescimento da base no período.
  const baseNoInicio = e.totalDeContatos - novosAtual;
  let corrente = baseNoInicio;
  const serieDoTotal = dias.map((d) => (corrente += novosPorDia.get(d) ?? 0));

  // ── clientes em destaque: quem mais comprou no período ─────────────────────
  const porContato = new Map<string, { atual: number; anterior: number; vendas: number }>();
  for (const v of naMoeda) {
    if (!v.contact_id) continue;
    const dia = diaNoFuso(v.closed_at, e.fuso);
    const linha = porContato.get(v.contact_id) ?? { atual: 0, anterior: 0, vendas: 0 };
    if (atual.has(dia)) {
      linha.atual += v.value_cents ?? 0;
      linha.vendas += 1;
    } else if (anterior.has(dia)) {
      linha.anterior += v.value_cents ?? 0;
    }
    porContato.set(v.contact_id, linha);
  }
  const clientesEmDestaque = [...porContato.entries()]
    .filter(([, l]) => l.vendas > 0)
    .sort((a, b) => b[1].atual - a[1].atual || b[1].vendas - a[1].vendas)
    .slice(0, e.limiteDeDestaque ?? 3)
    .map(([contactId, l]) => ({
      contactId,
      valorCents: l.atual,
      vendas: l.vendas,
      variacao: variacao(l.atual, l.anterior),
    }));

  return {
    moeda,
    dias: e.dias,
    totalDeClientes: {
      valor: e.totalDeContatos,
      variacao: variacao(e.totalDeContatos, baseNoInicio),
      serie: serieDoTotal,
    },
    vendasHoje: {
      valor: valorPorDia.get(hoje) ?? 0,
      variacao: variacao(valorPorDia.get(hoje) ?? 0, valorPorDia.get(ontem) ?? 0),
      // Os últimos 14 dias bastam para a faísca do card "hoje".
      serie: serieDeVendas.slice(-14).map((p) => p.valorCents),
    },
    receitaDoPeriodo: {
      valor: receitaAtual,
      variacao: variacao(receitaAtual, receitaAnterior),
      serie: serieDeVendas.map((p) => p.valorCents),
    },
    ticketMedio: {
      valor: ticketAtual,
      variacao: variacao(ticketAtual, ticketAnterior),
      serie: serieDoTicket,
    },
    serieDeVendas,
    clientesEmDestaque,
  };
}

// ── funil ────────────────────────────────────────────────────────────────────

export interface EtapaDoFunil {
  id: string;
  nome: string;
  /** Quantos CHEGARAM até esta etapa: os que estão nela e os que estão adiante. */
  quantidade: number;
  /** Fração da primeira etapa (0..1). A primeira é sempre 1 quando tem gente. */
  proporcao: number;
}

/**
 * As etapas na ordem do funil, CUMULATIVAS: cada degrau conta quem está nele
 * mais quem já passou dele. É o que torna o desenho um funil de verdade — com a
 * contagem crua, uma etapa do meio cheia ficaria maior que a primeira e a
 * proporção passaria de 100%.
 *
 * Etapa de perda fica de fora: ela não é um degrau, é a saída lateral do funil.
 */
export function montarFunil(
  etapas: { id: string; name: string; position: number; is_lost: boolean }[],
  contagem: Map<string, number>,
): EtapaDoFunil[] {
  const ordenadas = etapas.filter((e) => !e.is_lost).sort((a, b) => a.position - b.position);
  const acumulado: number[] = new Array(ordenadas.length).fill(0);
  let corrente = 0;
  for (let i = ordenadas.length - 1; i >= 0; i--) {
    corrente += contagem.get(ordenadas[i]!.id) ?? 0;
    acumulado[i] = corrente;
  }
  const topo = acumulado[0] ?? 0;
  return ordenadas.map((e, i) => ({
    id: e.id,
    nome: e.name,
    quantidade: acumulado[i]!,
    proporcao: topo > 0 ? acumulado[i]! / topo : 0,
  }));
}
