import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessao = {
  id: "sess-1",
  channelId: "canal-uuid-1",
  phoneNumberId: "1128059963726893" as string | null,
  wabaId: "1517032953486921" as string | null,
};

vi.mock("@/lib/channels/coexy/session", () => ({
  coexySessionById: vi.fn(async () => ({ ...sessao })),
  aplicarStatusDoCanal: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/channels/meta/ingest", () => ({
  ingestMetaInbound: vi.fn(async () => ({ status: "ingerida" })),
  ingestMetaEcho: vi.fn(async () => ({ status: "eco" })),
  ingestMetaAppContactSync: vi.fn(async () => ({ status: "contato" })),
}));

import { aplicarStatusDoCanal } from "@/lib/channels/coexy/session";
import { acceptsInboundWebhook, handleInboundWebhook } from "@/lib/channels/inbound";
import { ingestMetaInbound } from "@/lib/channels/meta/ingest";

/**
 * Entrada do canal Coexy pela rota genérica de canal: assinatura do corpo cru,
 * o evento próprio `channel_status_update` (é por ele que a sessão ganha o
 * número) e o envelope da Meta, aceito só se for do número DESTA sessão.
 */
const SEGREDO = "hmac_segredo_de_teste_123";

function entrada(corpo: unknown, segredo = SEGREDO) {
  const rawBody = JSON.stringify(corpo);
  const headers = new Headers({
    "x-coexy-signature": `sha256=${createHmac("sha256", segredo).update(rawBody, "utf8").digest("hex")}`,
  });
  return {
    session: { id: "sess-1", organization_id: "org-1", provider: "coexy" },
    rawBody,
    headers,
    secret: SEGREDO,
  } as unknown as Parameters<typeof handleInboundWebhook>[1];
}

function mensagemMeta(phoneNumberId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1517032953486921",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "João Silva" }, wa_id: "5511987654321" }],
              messages: [
                {
                  id: "wamid.HBgM",
                  from: "5511987654321",
                  timestamp: "1749600000",
                  type: "text",
                  text: { body: "Olá, quero saber sobre meu pedido" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const ORIGINAL = process.env.COEXY_ENABLED;
beforeEach(() => {
  process.env.COEXY_ENABLED = "true";
  vi.mocked(aplicarStatusDoCanal).mockClear();
  vi.mocked(ingestMetaInbound).mockClear();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.COEXY_ENABLED;
  else process.env.COEXY_ENABLED = ORIGINAL;
});

describe("entrada do canal coexy", () => {
  it("desligado na instalação, a entrada não existe", () => {
    expect(acceptsInboundWebhook("coexy")).toBe(true);
    process.env.COEXY_ENABLED = "";
    expect(acceptsInboundWebhook("coexy")).toBe(false);
  });

  it("assinatura com outro segredo é recusada antes de ler o corpo", async () => {
    const r = await handleInboundWebhook(
      {} as never,
      entrada(mensagemMeta("1128059963726893"), "outro"),
    );
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(ingestMetaInbound).not.toHaveBeenCalled();
  });

  it("channel_status_update do canal desta sessão grava número, conta e WORKING", async () => {
    const r = await handleInboundWebhook(
      {} as never,
      entrada({
        event: "channel_status_update",
        channel_id: "canal-uuid-1",
        status: "active",
        phone_number_id: "999",
        waba_id: "888",
        display_phone_number: "+55 11 99999-9999",
      }),
    );
    expect(r).toEqual({ ok: true, body: { received: 1, outcomes: ["status:active"] } });
    expect(vi.mocked(aplicarStatusDoCanal).mock.calls[0]![1]).toEqual({
      organizationId: "org-1",
      channelSessionId: "sess-1",
      status: "WORKING",
      phoneNumberId: "999",
      wabaId: "888",
      phoneNumber: "+5511999999999",
    });
  });

  it("status de OUTRO canal não mexe na sessão", async () => {
    const r = await handleInboundWebhook(
      {} as never,
      entrada({
        event: "channel_status_update",
        channel_id: "outro-canal",
        status: "disconnected",
      }),
    );
    expect(r).toEqual({ ok: true, body: { received: 1, outcomes: ["outro_canal"] } });
    expect(aplicarStatusDoCanal).not.toHaveBeenCalled();
  });

  it("mensagem da Meta do número desta sessão é ingerida; de outro número, não", async () => {
    const minha = await handleInboundWebhook(
      {} as never,
      entrada(mensagemMeta("1128059963726893")),
    );
    expect(minha).toMatchObject({ ok: true, body: { outcomes: ["ingerida"] } });
    expect(ingestMetaInbound).toHaveBeenCalledTimes(1);

    const outra = await handleInboundWebhook({} as never, entrada(mensagemMeta("000000")));
    expect(outra).toMatchObject({ ok: true, body: { outcomes: ["outro_numero"] } });
    expect(ingestMetaInbound).toHaveBeenCalledTimes(1);
  });

  it("evento próprio do relay que não tratamos responde 200 e é ignorado (sem reenvio)", async () => {
    const r = await handleInboundWebhook(
      {} as never,
      entrada({
        event: "channel_health_update",
        channel_id: "canal-uuid-1",
        health_state: "warning",
      }),
    );
    expect(r).toEqual({ ok: true, body: { received: 0, outcomes: [] } });
    expect(aplicarStatusDoCanal).not.toHaveBeenCalled();
  });
});
