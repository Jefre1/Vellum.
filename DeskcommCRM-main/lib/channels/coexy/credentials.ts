/**
 * Credencial de envio do canal Coexy — por SESSÃO, pelo id do canal no relay.
 *
 * A busca leva a ORGANIZAÇÃO junto (issue #236): o id do canal é identificador
 * do PROVIDER, e `maybeSingle()` com duas linhas devolve `PGRST116`.
 *
 * `null` = não há token gravado ou o número ainda não foi conectado (sem
 * `phone_number_id` não há para onde mandar). **LANÇA quando a consulta falha**.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";

export interface CoexyCredentials {
  channelSessionId: string;
  channelId: string;
  /** `null` enquanto o número não foi conectado pelo link de conexão. */
  phoneNumberId: string | null;
  wabaId: string | null;
  token: string;
}

export async function resolveCoexyCreds(
  admin: SupabaseClient,
  lookup: { organizationId: string; channelId: string },
): Promise<CoexyCredentials | null> {
  const { organizationId, channelId } = lookup;
  if (!organizationId || !channelId) return null;

  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, coexy_channel_id, coexy_phone_number_id, coexy_waba_id, coexy_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("coexy_channel_id", channelId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    throw new Error(
      `coexy_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const linha = data as {
    id: string;
    coexy_channel_id: string;
    coexy_phone_number_id?: string | null;
    coexy_waba_id?: string | null;
    coexy_token_encrypted?: unknown;
  } | null;
  if (!linha?.coexy_token_encrypted) return null;

  const token = await decryptWebhookSecret(admin, linha.coexy_token_encrypted as string);
  if (!token) return null;

  return {
    channelSessionId: linha.id,
    channelId: linha.coexy_channel_id,
    phoneNumberId: linha.coexy_phone_number_id ?? null,
    wabaId: linha.coexy_waba_id ?? null,
    token,
  };
}
