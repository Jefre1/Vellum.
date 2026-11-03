/**
 * Persistência da sessão do canal Coexy — do lado de dentro do seam.
 *
 * A rota e a tela não nomeiam o provider nem as colunas dele (invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`, vigiado por `lint:channels`): falam em
 * "a chave", "o link de conexão", "o número". A leitura e a escrita moram aqui.
 *
 * Toda consulta leva `organization_id` À MÃO: o client é de service role e
 * ignora a RLS.
 *
 * ─── Ciclo de vida ──────────────────────────────────────────────────────────
 *
 *  1. `criarSessaoCoexy` — a linha nasce `STARTING`, com o id do canal, o token
 *     do canal e a API key cifrados, o link de conexão e o token do caminho do
 *     webhook. Número e conta ainda NULOS: o número não foi conectado.
 *  2. `gravarWebhookDaSessao` — o webhook criado no Coexy devolve o
 *     `hmac_secret` uma única vez; ele vai cifrado para `webhook_secret_encrypted`.
 *  3. `aplicarStatusDoCanal` — o Coexy avisa (`channel_status_update`) ou a tela
 *     consulta (`GET /channels/:id`) que o canal ficou ativo: grava número,
 *     conta e `WORKING`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import { CHANNEL_PROVIDER_COEXY } from "../capabilities";

export interface CoexySession {
  id: string;
  channelId: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  status: string | null;
  connectUrl: string | null;
  webhookId: string | null;
  webhookPathToken: string | null;
  apiKeyEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  archivedAt: string | null;
}

const COLUNAS =
  "id, coexy_channel_id, coexy_phone_number_id, coexy_waba_id, coexy_connect_url, coexy_webhook_id, coexy_api_key_encrypted, phone_number, display_name, status, webhook_path_token, webhook_secret_encrypted, archived_at";

function toSessao(row: Record<string, unknown> | null): CoexySession | null {
  if (!row) return null;
  const s = (k: string) => (row[k] as string | null | undefined) ?? null;
  return {
    id: row.id as string,
    channelId: row.coexy_channel_id as string,
    phoneNumberId: s("coexy_phone_number_id"),
    wabaId: s("coexy_waba_id"),
    displayName: s("display_name"),
    phoneNumber: s("phone_number"),
    status: s("status"),
    connectUrl: s("coexy_connect_url"),
    webhookId: s("coexy_webhook_id"),
    webhookPathToken: s("webhook_path_token"),
    apiKeyEncrypted: s("coexy_api_key_encrypted"),
    webhookSecretEncrypted: s("webhook_secret_encrypted"),
    archivedAt: s("archived_at"),
  };
}

/**
 * A sessão ATIVA deste canal na organização, ou `null`. LANÇA quando a consulta
 * falha: "não há sessão" e "não consegui perguntar" têm desfechos diferentes.
 */
export async function findCoexySession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<CoexySession | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("provider", CHANNEL_PROVIDER_COEXY)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`coexy_session_lookup_failed: ${error.message}`);
  return toSessao((data as Record<string, unknown>[] | null)?.[0] ?? null);
}

/** A sessão pelo id (a rota de entrada já tem o id; a guarda relê as refs dela). */
export async function coexySessionById(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<CoexySession | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .maybeSingle();
  if (error) throw new Error(`coexy_session_lookup_failed: ${error.message}`);
  return toSessao(data as Record<string, unknown> | null);
}

export async function criarSessaoCoexy(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelId: string;
    connectUrl: string;
    tokenEncrypted: string;
    apiKeyEncrypted: string;
    /** Provisório e aleatório até o webhook ser criado — a entrada recusa tudo antes. */
    segredoProvisorioCifrado: string;
    webhookPathToken: string;
    displayName: string;
    status: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    phoneNumber: string | null;
  },
): Promise<{ error: string | null; channelSessionId: string | null }> {
  const { data, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: input.organizationId,
      provider: CHANNEL_PROVIDER_COEXY,
      coexy_channel_id: input.channelId,
      coexy_connect_url: input.connectUrl,
      coexy_token_encrypted: input.tokenEncrypted,
      coexy_api_key_encrypted: input.apiKeyEncrypted,
      coexy_phone_number_id: input.phoneNumberId,
      coexy_waba_id: input.wabaId,
      phone_number: input.phoneNumber,
      display_name: input.displayName,
      status: input.status,
      webhook_path_token: input.webhookPathToken,
      webhook_secret_encrypted: input.segredoProvisorioCifrado,
      metadata: metadataInicialDoCanal(),
    })
    .select("id")
    .maybeSingle();
  return {
    error: error?.message ?? null,
    channelSessionId: (data as { id: string } | null)?.id ?? null,
  };
}

/** Grava o webhook criado no Coexy: o id (para apagar depois) e o segredo cifrado. */
export async function gravarWebhookDaSessao(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    webhookId: string;
    secretEncrypted: string;
  },
): Promise<{ error: string | null }> {
  const { error } = await admin
    .from("channel_sessions")
    .update({ coexy_webhook_id: input.webhookId, webhook_secret_encrypted: input.secretEncrypted })
    .eq("organization_id", input.organizationId)
    .eq("id", input.channelSessionId)
    .eq("provider", CHANNEL_PROVIDER_COEXY);
  return { error: error?.message ?? null };
}

/**
 * Aplica o status do canal no relay à sessão. Número e conta só são gravados
 * quando vêm preenchidos — um `disconnected` sem eles não apaga o que já havia.
 */
export async function aplicarStatusDoCanal(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    status: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    phoneNumber: string | null;
  },
): Promise<{ error: string | null }> {
  const mudanca: Record<string, unknown> = {
    status: input.status,
    last_status_change_at: new Date().toISOString(),
  };
  if (input.phoneNumberId) mudanca.coexy_phone_number_id = input.phoneNumberId;
  if (input.wabaId) mudanca.coexy_waba_id = input.wabaId;
  if (input.phoneNumber) mudanca.phone_number = input.phoneNumber;
  const { error } = await admin
    .from("channel_sessions")
    .update(mudanca)
    .eq("organization_id", input.organizationId)
    .eq("id", input.channelSessionId)
    .eq("provider", CHANNEL_PROVIDER_COEXY);
  return { error: error?.message ?? null };
}
