/**
 * Modelos (templates) do canal Coexy — a PONTA do cliente Graph compartilhado.
 *
 * O relay expõe os endpoints de modelo da Meta (`/{waba_id}/message_templates`)
 * com o `channel_token`. O cliente (paginar, resolver variante, apagar por
 * `hsm_id`) é `lib/channels/templates-graph.ts`, o mesmo do canal oficial e do
 * outro parceiro: aqui fica só de onde vêm a credencial e a base.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { operacoesDeModelos, type CredencialDosModelos } from "../templates-graph";
import type { ChannelTenantScope } from "../types";
import { coexyProxyBase } from "./config";
import { resolveCoexyCreds } from "./credentials";

type Escopo = ChannelTenantScope & { sessionRef: string };

async function credencial(escopo: Escopo): Promise<CredencialDosModelos> {
  const c = await resolveCoexyCreds(createAdminClient(), {
    organizationId: escopo.organizationId,
    channelId: escopo.sessionRef,
  });
  if (!c) throw new Error("coexy_not_configured: sem token para esta conexão.");
  if (!c.wabaId)
    throw new Error("coexy_sem_waba: o número ainda não foi conectado pelo link de conexão.");
  return { wabaId: c.wabaId, token: c.token };
}

export const coexyTemplateOps = operacoesDeModelos({
  base: coexyProxyBase,
  credencial,
  rotulo: "coexy_template",
});
