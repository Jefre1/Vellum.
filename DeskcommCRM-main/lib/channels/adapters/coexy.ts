/**
 * Adapter do canal Coexy — o transporte do relay da Cloud API.
 *
 * Burro de propósito, como os irmãos: traduz formato e nada mais. Janela,
 * limite e horário vivem na cadeia `before_send`.
 *
 * ─── É o adapter oficial com outro endereço ─────────────────────────────────
 *
 * Mesmos caminhos e corpos da Cloud API, com duas trocas:
 *
 *  1. **Host.** `coexyProxyBase()` (`…/functions/v1/meta-proxy`) no lugar da Graph.
 *  2. **Token.** O `channel_token` do canal, SEMPRE no header `Authorization`.
 *
 * O corpo (E.164 em dígitos, `voice: true`, áudio ogg/opus) vem das MESMAS
 * funções do adapter oficial — duas cópias garantiriam que a primeira correção
 * de mídia faltasse num lado.
 *
 * ─── O sessionRef é o id do CANAL, não o número ─────────────────────────────
 *
 * A sessão existe antes do número ser conectado (ver a migration 9059). Por isso
 * a credencial é resolvida pelo id do canal, e o `phone_number_id` sai dela —
 * sem ele (número ainda não conectado) o envio desiste com `notConfigured`, que
 * o handler traduz para `queued`, e não com um erro que ninguém entende.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { canalCoexyLigado, coexyProxyBase } from "../coexy/config";
import { resolveCoexyCreds, type CoexyCredentials } from "../coexy/credentials";
import { coexyTemplateOps } from "../coexy/templates";
import { sendTemplateForSession } from "../meta/send-template-for-session";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";
import { contactPayload, mediaPayload, toE164Digits } from "./meta-cloud";

const NAO_CONFIGURADO = "coexy_not_configured";

/** A credencial com número — ou o erro `notConfigured` que vira `queued`. */
async function credencialDeEnvio(
  organizationId: string,
  channelId: string,
): Promise<CoexyCredentials & { phoneNumberId: string }> {
  if (!canalCoexyLigado()) {
    throw new Error(`${NAO_CONFIGURADO}: o canal está desligado nesta instalação (COEXY_ENABLED).`);
  }
  const creds = await resolveCoexyCreds(createAdminClient(), { organizationId, channelId });
  if (!creds) throw new Error(`${NAO_CONFIGURADO}: nenhuma credencial gravada para esta sessão.`);
  if (!creds.phoneNumberId) {
    throw new Error(`${NAO_CONFIGURADO}: o número ainda não foi conectado pelo link de conexão.`);
  }
  return { ...creds, phoneNumberId: creds.phoneNumberId };
}

export const coexyAdapter: ChannelAdapter = {
  provider: "coexy",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;
    if (!input.phoneNumber) return null;
    const digits = toE164Digits(input.phoneNumber);
    return digits.length > 0 ? digits : null;
  },

  /** `true` sempre, como o canal oficial: quem desiste é o `send`, com `notConfigured`. */
  isConfigured(): boolean {
    return true;
  },

  /** `GET /{phone_number_id}` pelo relay — o mesmo caminho da saúde do canal oficial. */
  async checkHealth(input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    if (!canalCoexyLigado()) {
      return { reachable: false, status: null, detail: "canal_desligado_na_instalacao" };
    }
    const creds = await resolveCoexyCreds(createAdminClient(), {
      organizationId: input.organizationId,
      channelId: input.sessionRef,
    });
    if (!creds) return { reachable: false, status: null, detail: "sem_credencial_para_a_sessao" };
    if (!creds.phoneNumberId)
      return { reachable: true, status: "STARTING", detail: "numero_nao_conectado" };

    try {
      const res = await fetch(
        `${coexyProxyBase()}/${encodeURIComponent(creds.phoneNumberId)}?fields=display_phone_number,quality_rating`,
        {
          headers: { Authorization: `Bearer ${creds.token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      // 503 `CHANNEL_DISCONNECTED`: a Meta revogou o acesso — reconectar pelo link.
      if (res.status === 401 || res.status === 403 || res.status === 503) {
        return { reachable: true, status: "FAILED", detail: `http_${res.status}` };
      }
      if (!res.ok || body.error) {
        const e = body.error as { message?: string } | string | undefined;
        const msg = typeof e === "string" ? e : (e?.message ?? "");
        return { reachable: true, status: "FAILED", detail: msg.slice(0, 200) || null };
      }
      return { reachable: true, status: "WORKING", detail: null };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro_desconhecido";
      return { reachable: false, status: null, detail: detail.slice(0, 200) };
    }
  },

  codes: {
    notConfigured: NAO_CONFIGURADO,
    sendFailed: "coexy_error",
    unknownError: "coexy_unknown",
  },

  templates: coexyTemplateOps,

  /** Envia uma definição aprovada — o mesmo caminho da Cloud API, com host e token do relay. */
  async sendTemplate(input): Promise<{ externalId: string | null }> {
    const creds = await credencialDeEnvio(input.organizationId, input.sessionRef);
    const externalId = await sendTemplateForSession(createAdminClient(), {
      ...(input.beforeSend ? { beforeSend: input.beforeSend } : {}),
      organizationId: input.organizationId,
      sessionRef: input.sessionRef,
      to: input.to,
      name: input.name,
      language: input.language,
      values: input.values,
      channelSessionId: creds.channelSessionId,
      transport: {
        phoneNumberId: creds.phoneNumberId,
        token: creds.token,
        graphBase: coexyProxyBase(),
        errorPrefix: "coexy",
      },
    });
    return { externalId };
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const creds = await credencialDeEnvio(envelope.organizationId, envelope.sessionRef);

    const corpo = contactPayload(envelope) ??
      mediaPayload(envelope) ?? { type: "text", text: { body: envelope.body ?? "" } };

    await envelope.beforeSend?.();
    const res = await fetch(
      `${coexyProxyBase()}/${encodeURIComponent(creds.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: envelope.to,
          ...corpo,
        }),
      },
    );

    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string; error_data?: { details?: string } } | string;
    };

    if (!res.ok || body.error) {
      // O relay devolve dois formatos: o da Meta (`{error:{code,message}}`) e o
      // dele (`{error:"Channel is not active"}`, 401/403/429/503).
      const e = body.error;
      const codigo = typeof e === "object" && e?.code ? e.code : res.status;
      const detalhe =
        typeof e === "string" ? e : (e?.error_data?.details ?? e?.message ?? `http_${res.status}`);
      throw new Error(`coexy_${codigo}: ${detalhe}`);
    }

    return { externalId: body.messages?.[0]?.id ?? null };
  },
};
