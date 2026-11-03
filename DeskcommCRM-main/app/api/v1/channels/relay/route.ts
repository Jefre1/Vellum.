import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET   /api/v1/channels/relay — estado da conexão (e consulta o relay se pendente).
 * POST  /api/v1/channels/relay — valida a API key, cria o canal e o webhook no relay.
 * PATCH /api/v1/channels/relay — refaz o webhook (ex.: a URL pública mudou).
 *
 * O canal "relay" é um provedor que espelha a WhatsApp Cloud API e se conecta
 * só com uma API key: o CRM cria o canal lá, devolve o LINK DE CONEXÃO para o
 * dono do número autorizar pelo fluxo da Meta, e registra o webhook com a URL
 * desta conexão. Quem é o relay e como se chamam as colunas ficam em
 * `lib/channels/relay.ts` (`lint:channels`).
 *
 * ─── Desligado por padrão ───────────────────────────────────────────────────
 *
 * Canal opcional da INSTALAÇÃO: com o interruptor desligado as três respondem
 * 404 antes de qualquer outra coisa.
 *
 * ─── Sem webhook também funciona ────────────────────────────────────────────
 *
 * O relay só entrega em URL HTTPS pública. Numa instalação local o webhook não
 * pode ser criado — e mesmo assim a conexão sai: enquanto o canal está
 * pendente, o GET pergunta o estado ao relay e grava número e conta quando ele
 * fica ativo. O que fica de fora sem webhook é RECEBER mensagem, e a resposta
 * diz isso (`webhook_ok: false` com o motivo).
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  atualizarSessaoPeloRelay,
  canalRelayLigado,
  chaveDaSessao,
  criarCanalNoRelay,
  criarSessaoDoRelay,
  findRelaySession,
  RELAY_LABEL,
  RelayApiError,
  registrarWebhookDoRelay,
  statusDaSessaoDoRelay,
  telefoneE164,
  validarChaveDoRelay,
  type RelaySession,
} from "@/lib/channels/relay";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const conectarSchema = z.object({
  api_key: z.string().trim().min(10).max(500),
  nome: z.string().trim().min(1).max(80).optional(),
});

function naoExiste(requestId: string): NextResponse {
  return fail("not_found", "not found", 404, { requestId });
}

function urlDoWebhook(req: NextRequest, pathToken: string): string {
  return `${basePublicaDaInstalacao(req)}/api/v1/webhooks/channel/${pathToken}`;
}

/** O segredo gravado é o do webhook (e não o provisório)? Só SIM ou NÃO sai daqui. */
async function temWebhook(
  admin: ReturnType<typeof createAdminClient>,
  s: RelaySession,
): Promise<boolean> {
  if (!s.webhookId || !s.webhookSecretEncrypted) return false;
  return Boolean(await decryptWebhookSecret(admin, s.webhookSecretEncrypted));
}

/** A frase do relay traduzida no que o operador pode fazer. */
function motivoDoRelay(err: unknown, t: (s: string) => string): string {
  if (err instanceof RelayApiError) {
    if (err.status === 401)
      return t(
        "A API key foi recusada pelo provedor. Confira se copiou a chave inteira e se ela não foi revogada.",
      );
    if (err.status === 429)
      return t("O provedor pediu para esperar um pouco. Tente de novo em instantes.");
    return `${t("O provedor recusou o pedido")}: ${err.message}`;
  }
  return t("Não foi possível falar com o provedor agora. Tente de novo em instantes.");
}

function respostaDaSessao(req: NextRequest, s: RelaySession | null, webhook: boolean) {
  return {
    label: RELAY_LABEL,
    connected: Boolean(s),
    channel_session_id: s?.id ?? null,
    status: s?.status ?? null,
    // O número só existe depois que o dono autoriza pelo link de conexão.
    number_connected: Boolean(s?.phoneNumberId),
    phone_number: s?.phoneNumber ?? null,
    display_name: s?.displayName ?? null,
    connect_url: s && !s.phoneNumberId ? s.connectUrl : null,
    webhook_ok: webhook,
    webhook_url: s?.webhookPathToken ? urlDoWebhook(req, s.webhookPathToken) : null,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  if (!canalRelayLigado()) return naoExiste(requestId);
  // Conectar um canal move dinheiro e expõe a conta da empresa: decisão de dono.
  const authz = await requireRole("admin", { requestId, resource: "channels_relay" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  let sessao = await findRelaySession(admin, authz.org.orgId);

  // Pendente: pergunta ao relay. Falha aqui não derruba a tela — ela mostra o
  // estado gravado e o operador tenta de novo.
  if (sessao && sessao.status !== "WORKING") {
    const apiKey = await chaveDaSessao(admin, sessao);
    if (apiKey) {
      try {
        sessao = await atualizarSessaoPeloRelay(admin, {
          organizationId: authz.org.orgId,
          sessao,
          apiKey,
        });
      } catch (err) {
        logger.warn("relay: consulta do estado do canal falhou", {
          organization_id: authz.org.orgId,
          motivo: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return ok(respostaDaSessao(req, sessao, sessao ? await temWebhook(admin, sessao) : false), {
    requestId,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  if (!canalRelayLigado()) return naoExiste(requestId);
  const authz = await requireRole("admin", { requestId, resource: "channels_relay" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const parsed = conectarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("invalid_request", t("Cole a API key do provedor."), 422, { requestId });
  const { api_key: apiKey } = parsed.data;
  const nome = parsed.data.nome ?? RELAY_LABEL;

  const admin = createAdminClient();
  const existente = await findRelaySession(admin, orgId);
  if (existente) {
    return fail(
      "state_conflict",
      t("Esta organização já tem um número conectado por este provedor."),
      409,
      {
        requestId,
      },
    );
  }

  // Valida ANTES de criar qualquer coisa no provedor.
  try {
    await validarChaveDoRelay(apiKey);
  } catch (err) {
    return fail("invalid_request", motivoDoRelay(err, t), 422, { requestId });
  }

  const [chaveCifrada, provisorioCifrado] = await Promise.all([
    encryptWebhookSecret(admin, apiKey),
    encryptWebhookSecret(admin, randomBytes(32).toString("hex")),
  ]);
  if (!chaveCifrada || !provisorioCifrado) {
    // Sem a cifra, gravar a chave em claro seria pior que recusar.
    return fail(
      "invalid_request",
      t("cifra indisponível nesta instalação — a chave não foi gravada"),
      422,
      {
        requestId,
      },
    );
  }

  let canal;
  try {
    canal = await criarCanalNoRelay(apiKey, nome);
  } catch (err) {
    return fail("invalid_request", motivoDoRelay(err, t), 422, { requestId });
  }
  const tokenCifrado = await encryptWebhookSecret(admin, canal.channel_token);
  if (!tokenCifrado) {
    return fail(
      "invalid_request",
      t("cifra indisponível nesta instalação — a chave não foi gravada"),
      422,
      {
        requestId,
      },
    );
  }

  const pathToken = randomBytes(24).toString("hex");
  const { error, channelSessionId } = await criarSessaoDoRelay(admin, {
    organizationId: orgId,
    channelId: canal.id,
    connectUrl: canal.connect_url,
    tokenEncrypted: tokenCifrado,
    apiKeyEncrypted: chaveCifrada,
    segredoProvisorioCifrado: provisorioCifrado,
    webhookPathToken: pathToken,
    displayName: nome,
    status: statusDaSessaoDoRelay(canal.status),
    phoneNumberId: canal.phone_number_id,
    wabaId: canal.waba_id,
    phoneNumber: telefoneE164(canal.display_phone_number),
  });
  if (error || !channelSessionId) {
    const limite = error ? traduzirLimiteDoPlano(error, authz.user.idioma) : null;
    if (limite)
      return fail(limite.code, limite.message, 409, { requestId, details: limite.details });
    return fail("internal_error", error ?? "channel_session_not_created", 500, { requestId });
  }

  const erroDoWebhook = await registrarWebhookDoRelay(admin, {
    organizationId: orgId,
    channelSessionId,
    apiKey,
    channelId: canal.id,
    url: urlDoWebhook(req, pathToken),
    nome: `CRM — ${nome}`,
  });

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: channelSessionId,
    requestId,
    metadata: { canal: "relay", etapa: "canal_criado", webhook: erroDoWebhook ? "falhou" : "ok" },
  });

  const sessao = await findRelaySession(admin, orgId);
  return ok(
    {
      ...respostaDaSessao(req, sessao, !erroDoWebhook),
      webhook_error: erroDoWebhook,
    },
    { requestId },
  );
}

/** Refaz o webhook — o caminho para quem conectou antes de ter URL pública. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  if (!canalRelayLigado()) return naoExiste(requestId);
  const authz = await requireRole("admin", { requestId, resource: "channels_relay" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const sessao = await findRelaySession(admin, orgId);
  if (!sessao || !sessao.webhookPathToken) {
    return fail("state_conflict", t("Conecte o provedor antes de criar o webhook."), 409, {
      requestId,
    });
  }
  const apiKey = await chaveDaSessao(admin, sessao);
  if (!apiKey)
    return fail("state_conflict", t("A API key desta conexão não pôde ser lida."), 409, {
      requestId,
    });

  const erro = await registrarWebhookDoRelay(admin, {
    organizationId: orgId,
    channelSessionId: sessao.id,
    apiKey,
    channelId: sessao.channelId,
    url: urlDoWebhook(req, sessao.webhookPathToken),
    nome: `CRM — ${sessao.displayName ?? RELAY_LABEL}`,
    anterior: sessao.webhookId,
  });
  if (erro)
    return fail("invalid_request", `${t("O provedor recusou o webhook")}: ${erro}`, 422, {
      requestId,
    });

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: sessao.id,
    requestId,
    metadata: { canal: "relay", etapa: "webhook_refeito" },
  });
  return ok({ webhook_ok: true }, { requestId });
}
