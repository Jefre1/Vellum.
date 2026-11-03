import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Credenciais from "@/lib/channels/coexy/credentials";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/coexy/credentials", async (original) => ({
  ...(await original<typeof Credenciais>()),
  resolveCoexyCreds: vi.fn(),
}));
vi.mock("@/lib/channels/meta/send-template-for-session", () => ({
  sendTemplateForSession: vi.fn(),
}));

import { coexyAdapter } from "@/lib/channels/adapters/coexy";
import { criarWebhook, EVENTOS_DO_WEBHOOK, listarCanais } from "@/lib/channels/coexy/api";
import { canalCoexyLigado, coexyProxyBase } from "@/lib/channels/coexy/config";
import { resolveCoexyCreds } from "@/lib/channels/coexy/credentials";
import {
  lerEventoDeStatus,
  statusDaSessao,
  telefoneE164,
  verifyCoexySignature,
} from "@/lib/channels/coexy/webhook";
import { sendTemplateForSession } from "@/lib/channels/meta/send-template-for-session";
import { getAdapter } from "@/lib/channels";
import type { OutboundEnvelope } from "@/lib/channels/types";

/**
 * Canal Coexy: relay transparente da Cloud API. O adapter é o oficial com outro
 * host (`/functions/v1/meta-proxy`) e o `channel_token` do canal; a sessão é
 * endereçada pelo id do CANAL, porque existe antes do número.
 */
const CREDS = {
  channelSessionId: "sess-1",
  channelId: "canal-uuid-1",
  phoneNumberId: "1128059963726893",
  wabaId: "1517032953486921",
  token: "tok_canal_abc",
};

function envelope(over: Partial<OutboundEnvelope> = {}): OutboundEnvelope {
  return {
    organizationId: "org-1",
    sessionRef: "canal-uuid-1",
    to: "5511987654321",
    kind: "text",
    body: "olá",
    ...over,
  };
}

const ORIGINAL = { enabled: process.env.COEXY_ENABLED, base: process.env.COEXY_API_BASE_URL };
beforeEach(() => {
  process.env.COEXY_ENABLED = "true";
  delete process.env.COEXY_API_BASE_URL;
  vi.mocked(resolveCoexyCreds).mockReset();
  vi.mocked(resolveCoexyCreds).mockResolvedValue(CREDS);
  vi.mocked(sendTemplateForSession).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL.enabled === undefined) delete process.env.COEXY_ENABLED;
  else process.env.COEXY_ENABLED = ORIGINAL.enabled;
  if (ORIGINAL.base === undefined) delete process.env.COEXY_API_BASE_URL;
  else process.env.COEXY_API_BASE_URL = ORIGINAL.base;
});

describe("interruptor e endereços", () => {
  it("só `true` literal liga o canal", () => {
    expect(canalCoexyLigado("true")).toBe(true);
    expect(canalCoexyLigado(" TRUE ")).toBe(true);
    for (const v of ["", "1", "sim", "yes"]) expect(canalCoexyLigado(v)).toBe(false);
  });

  it("a base do relay é a do meta-proxy de produção, e a variável vazia não a apaga", () => {
    expect(coexyProxyBase()).toBe("https://api.coexy.com.br/functions/v1/meta-proxy");
    process.env.COEXY_API_BASE_URL = "  ";
    expect(coexyProxyBase()).toBe("https://api.coexy.com.br/functions/v1/meta-proxy");
  });

  it("o registro de adapters entrega o do relay pelo provider", () => {
    expect(getAdapter("coexy")).toBe(coexyAdapter);
  });
});

describe("adapter coexy", () => {
  it("envia texto pelo meta-proxy com o channel_token no header (nunca na URL)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }),
      );

    const r = await coexyAdapter.send(envelope());

    expect(r.externalId).toBe("wamid.X");
    expect(vi.mocked(resolveCoexyCreds).mock.calls[0]![1]).toEqual({
      organizationId: "org-1",
      channelId: "canal-uuid-1",
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.coexy.com.br/functions/v1/meta-proxy/1128059963726893/messages");
    expect(String(url)).not.toContain("tok_canal");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok_canal_abc");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511987654321",
      type: "text",
    });
    expect(body.text.body).toBe("olá");
  });

  it("número ainda não conectado desiste com notConfigured (vira queued), sem chamar a rede", async () => {
    vi.mocked(resolveCoexyCreds).mockResolvedValue({ ...CREDS, phoneNumberId: null, wabaId: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(coexyAdapter.send(envelope())).rejects.toThrow(/^coexy_not_configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canal desligado na instalação não envia nada", async () => {
    process.env.COEXY_ENABLED = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(coexyAdapter.send(envelope())).rejects.toThrow(/^coexy_not_configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveCoexyCreds).not.toHaveBeenCalled();
  });

  it("erro do relay no formato dele (string) e no da Meta viram coexy_<código>", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Channel is not active" }), { status: 403 }),
    );
    await expect(coexyAdapter.send(envelope())).rejects.toThrow("coexy_403: Channel is not active");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), {
        status: 400,
      }),
    );
    await expect(coexyAdapter.send(envelope())).rejects.toThrow(
      "coexy_131047: Re-engagement message",
    );
  });

  it("modelo sai pelo caminho da Cloud API com o host e o token do relay", async () => {
    vi.mocked(sendTemplateForSession).mockResolvedValue("wamid.T");
    const r = await coexyAdapter.sendTemplate!({
      organizationId: "org-1",
      sessionRef: "canal-uuid-1",
      to: "5511987654321",
      name: "boas_vindas",
      language: "pt_BR",
      values: {},
    });
    expect(r.externalId).toBe("wamid.T");
    const input = vi.mocked(sendTemplateForSession).mock.calls[0]![1];
    expect(input.channelSessionId).toBe("sess-1");
    expect(input.transport).toEqual({
      phoneNumberId: "1128059963726893",
      token: "tok_canal_abc",
      graphBase: "https://api.coexy.com.br/functions/v1/meta-proxy",
      errorPrefix: "coexy",
    });
  });
});

describe("assinatura do webhook (x-coexy-signature)", () => {
  const segredo = "hmac_segredo_de_teste_123";
  const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const assinar = (b: string, s = segredo) =>
    `sha256=${createHmac("sha256", s).update(b, "utf8").digest("hex")}`;

  it("aceita o HMAC-SHA256 do corpo cru", () => {
    expect(verifyCoexySignature(corpo, assinar(corpo), segredo)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, prefixo errado e peça ausente — sem lançar", () => {
    expect(verifyCoexySignature(`${corpo} `, assinar(corpo), segredo)).toBe(false);
    expect(verifyCoexySignature(corpo, assinar(corpo, "outro"), segredo)).toBe(false);
    expect(verifyCoexySignature(corpo, assinar(corpo).replace("sha256=", "sha1="), segredo)).toBe(
      false,
    );
    expect(verifyCoexySignature(corpo, "sha256=abc", segredo)).toBe(false);
    expect(verifyCoexySignature(corpo, "sha256=zz-nao-hex", segredo)).toBe(false);
    expect(verifyCoexySignature(corpo, null, segredo)).toBe(false);
    expect(verifyCoexySignature(corpo, assinar(corpo), null)).toBe(false);
  });
});

describe("evento channel_status_update", () => {
  it("lê o canal, o status e o número que o relay manda quando o número entra", () => {
    const e = lerEventoDeStatus(
      JSON.stringify({
        event: "channel_status_update",
        channel_id: "canal-uuid-1",
        previous_status: "pending",
        status: "active",
        phone_number_id: "1128059963726893",
        waba_id: "1517032953486921",
        display_phone_number: "+55 11 99999-9999",
      }),
    );
    expect(e).toEqual({
      channelId: "canal-uuid-1",
      status: "active",
      phoneNumberId: "1128059963726893",
      wabaId: "1517032953486921",
      displayPhoneNumber: "+55 11 99999-9999",
    });
    expect(telefoneE164(e!.displayPhoneNumber)).toBe("+5511999999999");
  });

  it("envelope da Meta, outro evento ou status desconhecido não são lidos como status", () => {
    expect(
      lerEventoDeStatus(JSON.stringify({ object: "whatsapp_business_account", entry: [] })),
    ).toBeNull();
    expect(
      lerEventoDeStatus(JSON.stringify({ event: "channel_health_update", channel_id: "x" })),
    ).toBeNull();
    expect(
      lerEventoDeStatus(
        JSON.stringify({ event: "channel_status_update", channel_id: "x", status: "zzz" }),
      ),
    ).toBeNull();
    expect(lerEventoDeStatus("não é json")).toBeNull();
  });

  it("status do relay vira o vocabulário do CHECK de channel_sessions", () => {
    expect(statusDaSessao("active")).toBe("WORKING");
    expect(statusDaSessao("pending")).toBe("STARTING");
    expect(statusDaSessao("disconnected")).toBe("FAILED");
    expect(statusDaSessao("suspended")).toBe("STOPPED");
  });
});

describe("Management API", () => {
  it("usa x-api-key (nunca Bearer) e aceita lista crua ou embrulhada", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "a" }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "b" }] }), { status: 200 }),
      );
    expect((await listarCanais("crt_pk_x")).map((c) => c.id)).toEqual(["a"]);
    expect((await listarCanais("crt_pk_x")).map((c) => c.id)).toEqual(["b"]);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.coexy.com.br/functions/v1/api/channels");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("crt_pk_x");
    expect(headers.Authorization).toBeUndefined();
  });

  it("chave recusada vira erro com o status do relay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid or revoked API key" }), { status: 401 }),
    );
    await expect(listarCanais("crt_pk_ruim")).rejects.toMatchObject({
      status: 401,
      message: "Invalid or revoked API key",
    });
  });

  it("o webhook nasce escopado ao CANAL, com os eventos de mensagem e de status", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "wh-1", hmac_secret: "s" }), { status: 201 }),
      );
    await criarWebhook("crt_pk_x", {
      name: "CRM",
      url: "https://crm.test/api/v1/webhooks/channel/abc",
      channelId: "canal-uuid-1",
    });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.channel_ids).toEqual(["canal-uuid-1"]);
    expect(body.events).toEqual([...EVENTOS_DO_WEBHOOK]);
    expect(body.events).toContain("channel_status_update");
  });
});
