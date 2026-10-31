import { describe, expect, it } from "vitest";

import {
  diaNoFuso,
  diasDaJanela,
  montarFunil,
  montarResumo,
  moedaDominante,
  variacao,
  type VendaGanha,
} from "./resumo";

const FUSO = "America/Sao_Paulo";
// 2026-10-31 15:00 em São Paulo (UTC-3).
const AGORA = new Date("2026-10-31T18:00:00Z");

function venda(
  closed_at: string,
  reais: number,
  contact_id: string | null = null,
  currency = "BRL",
): VendaGanha {
  return { closed_at, value_cents: reais * 100, currency, contact_id };
}

describe("o dia é o do fuso da organização", () => {
  it("a venda das 23h30 de São Paulo fica no dia dela, e não no seguinte (UTC)", () => {
    expect(diaNoFuso("2026-10-31T02:30:00Z", FUSO)).toBe("2026-10-30");
    expect(diaNoFuso("2026-10-31T02:30:00Z", "UTC")).toBe("2026-10-31");
  });

  it("a janela termina hoje e tem exatamente N dias, sem repetir data", () => {
    const dias = diasDaJanela(AGORA, 7, FUSO);
    expect(dias).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(new Set(diasDaJanela(AGORA, 90, FUSO)).size).toBe(90);
  });
});

describe("variação", () => {
  it("sem base é null — nunca +100% nem infinito", () => {
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });
  it("com base, é a fração", () => {
    expect(variacao(112, 100)).toBeCloseTo(0.12, 6);
    expect(variacao(50, 100)).toBeCloseTo(-0.5, 6);
  });
});

describe("montarResumo", () => {
  const vendas: VendaGanha[] = [
    // janela atual (7 dias: 25..31)
    venda("2026-10-31T13:00:00Z", 300, "c1"), // hoje
    venda("2026-10-31T14:00:00Z", 100, "c2"), // hoje
    venda("2026-10-30T13:00:00Z", 200, "c1"), // ontem
    venda("2026-10-26T13:00:00Z", 400, "c3"),
    // janela anterior (18..24)
    venda("2026-10-20T13:00:00Z", 500, "c1"),
    // moeda minoritária: não entra na soma em BRL
    venda("2026-10-29T13:00:00Z", 9999, "c4", "USD"),
  ];

  const r = montarResumo({
    agora: AGORA,
    fuso: FUSO,
    dias: 7,
    totalDeContatos: 110,
    contatosCriados: [
      { created_at: "2026-10-31T12:00:00Z" },
      { created_at: "2026-10-27T12:00:00Z" },
      { created_at: "2026-10-20T12:00:00Z" },
    ],
    vendas,
  });

  it("soma só a moeda dominante do período", () => {
    expect(r.moeda).toBe("BRL");
    expect(r.receitaDoPeriodo.valor).toBe(100_000); // 300+100+200+400 = R$ 1.000
    expect(r.receitaDoPeriodo.variacao).toBeCloseTo((1000 - 500) / 500, 6);
  });

  it("vendas de hoje comparam com ontem", () => {
    expect(r.vendasHoje.valor).toBe(40_000);
    expect(r.vendasHoje.variacao).toBeCloseTo((400 - 200) / 200, 6);
  });

  it("ticket médio é receita / quantidade, nas duas janelas", () => {
    expect(r.ticketMedio.valor).toBe(25_000); // 1000 / 4
    expect(r.ticketMedio.variacao).toBeCloseTo((250 - 500) / 500, 6);
  });

  it("o total de clientes cresce pelos novos da janela, e a série termina no total de hoje", () => {
    expect(r.totalDeClientes.valor).toBe(110);
    expect(r.totalDeClientes.variacao).toBeCloseTo(2 / 108, 6);
    expect(r.totalDeClientes.serie).toHaveLength(7);
    expect(r.totalDeClientes.serie.at(-1)).toBe(110);
  });

  it("a série tem um ponto por dia, com zero nos dias sem venda", () => {
    expect(r.serieDeVendas.map((p) => p.dia)).toEqual(diasDaJanela(AGORA, 7, FUSO));
    expect(r.serieDeVendas.find((p) => p.dia === "2026-10-28")?.valorCents).toBe(0);
    expect(r.serieDeVendas.at(-1)).toMatchObject({ valorCents: 40_000, vendas: 2 });
  });

  it("clientes em destaque: quem mais comprou no período, com a variação de cada um", () => {
    expect(r.clientesEmDestaque.map((c) => c.contactId)).toEqual(["c1", "c3", "c2"]);
    expect(r.clientesEmDestaque[0]).toMatchObject({ valorCents: 50_000, vendas: 2 });
    expect(r.clientesEmDestaque[0]!.variacao).toBeCloseTo(0, 6); // 500 contra 500
    expect(r.clientesEmDestaque[1]!.variacao).toBeNull(); // sem compra antes: "novo"
  });

  it("sem venda nenhuma, tudo zera sem inventar variação", () => {
    const vazio = montarResumo({
      agora: AGORA,
      fuso: FUSO,
      dias: 30,
      totalDeContatos: 0,
      contatosCriados: [],
      vendas: [],
    });
    expect(vazio.moeda).toBe("BRL");
    expect(vazio.receitaDoPeriodo).toMatchObject({ valor: 0, variacao: null });
    expect(vazio.ticketMedio).toMatchObject({ valor: 0, variacao: null });
    expect(vazio.serieDeVendas).toHaveLength(30);
    expect(vazio.clientesEmDestaque).toEqual([]);
  });
});

describe("moedaDominante", () => {
  it("vence a que mais aparece; sem venda, o padrão", () => {
    expect(moedaDominante([])).toBe("BRL");
    expect(
      moedaDominante([
        venda("2026-10-01T00:00:00Z", 1, null, "usd"),
        venda("2026-10-01T00:00:00Z", 1, null, "USD"),
      ]),
    ).toBe("USD");
  });
});

describe("montarFunil", () => {
  const etapas = [
    { id: "s3", name: "Propostas", position: 3, is_lost: false },
    { id: "s1", name: "Leads", position: 1, is_lost: false },
    { id: "x", name: "Perdido", position: 9, is_lost: true },
    { id: "s2", name: "Interessados", position: 2, is_lost: false },
    { id: "s4", name: "Vendas", position: 4, is_lost: false },
  ];

  it("acumula de baixo para cima: cada degrau conta quem chegou até ele", () => {
    const f = montarFunil(
      etapas,
      new Map([
        ["s1", 10],
        ["s2", 30],
        ["s3", 5],
        ["s4", 5],
        ["x", 99],
      ]),
    );
    expect(f.map((e) => e.nome)).toEqual(["Leads", "Interessados", "Propostas", "Vendas"]);
    expect(f.map((e) => e.quantidade)).toEqual([50, 40, 10, 5]);
    expect(f.map((e) => e.proporcao)).toEqual([1, 0.8, 0.2, 0.1]);
    // Nunca passa de 100%, mesmo com a etapa do meio mais cheia que a primeira.
    expect(Math.max(...f.map((e) => e.proporcao))).toBeLessThanOrEqual(1);
  });

  it("funil vazio não divide por zero", () => {
    const f = montarFunil(etapas, new Map());
    expect(f.every((e) => e.quantidade === 0 && e.proporcao === 0)).toBe(true);
  });
});
