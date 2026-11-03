/**
 * A FACHADA do canal "relay" — o que as rotas e a tela podem importar.
 *
 * Fora de `lib/channels/` nenhuma feature nomeia provider (invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`, vigiado por `lint:channels`), e isso
 * inclui o caminho do import e o nome da função. Este arquivo reexporta o que a
 * conexão precisa com nomes NEUTROS: a rota fala em "relay", e quem é o relay
 * (hoje o Coexy, ver `./coexy/`) fica aqui dentro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import {
  apagarWebhook,
  buscarCanal,
  CoexyApiError,
  criarCanal,
  criarWebhook,
  listarCanais,
  type CoexyChannel,
} from "./coexy/api";
import { canalCoexyLigado, COEXY_LABEL } from "./coexy/config";
import {
  aplicarStatusDoCanal,
  criarSessaoCoexy,
  findCoexySession,
  gravarWebhookDaSessao,
  type CoexySession,
} from "./coexy/session";
import { statusDaSessao, telefoneE164 } from "./coexy/webhook";

export type RelaySession = CoexySession;
export type RelayChannel = CoexyChannel;
export { CoexyApiError as RelayApiError };

export const canalRelayLigado = canalCoexyLigado;
export const RELAY_LABEL = COEXY_LABEL;
export const findRelaySession = findCoexySession;

/** A chave é aceita pelo relay? Lança `RelayApiError` (401 = chave errada). */
export async function validarChaveDoRelay(apiKey: string): Promise<void> {
  await listarCanais(apiKey);
}

export const criarCanalNoRelay = criarCanal;
export const criarSessaoDoRelay = criarSessaoCoexy;

/**
 * Cria o webhook do canal no relay apontando para a URL desta sessão e grava o
 * segredo devolvido (uma vez só) cifrado. Devolve a frase do erro, ou `null`.
 */
export async function registrarWebhookDoRelay(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    apiKey: string;
    channelId: string;
    url: string;
    nome: string;
    /** O webhook que este substitui — apagado no relay DEPOIS de o novo valer. */
    anterior?: string | null;
  },
): Promise<string | null> {
  try {
    const webhook = await criarWebhook(input.apiKey, {
      name: input.nome,
      url: input.url,
      channelId: input.channelId,
    });
    const cifrado = await encryptWebhookSecret(admin, webhook.hmac_secret);
    if (!cifrado) {
      // Sem como guardar o segredo, o webhook não serve: apaga para não deixar
      // o relay entregando para uma sessão que vai recusar tudo.
      await apagarWebhook(input.apiKey, webhook.id).catch(() => undefined);
      return "cifra indisponível nesta instalação — o segredo do webhook não foi gravado";
    }
    const { error } = await gravarWebhookDaSessao(admin, {
      organizationId: input.organizationId,
      channelSessionId: input.channelSessionId,
      webhookId: webhook.id,
      secretEncrypted: cifrado,
    });
    if (!error && input.anterior && input.anterior !== webhook.id) {
      // Sem apagar, o relay entregaria cada evento duas vezes (os dois webhooks
      // apontam para a mesma sessão, e o antigo com um segredo que não vale mais).
      await apagarWebhook(input.apiKey, input.anterior).catch(() => undefined);
    }
    return error;
  } catch (err) {
    return err instanceof Error ? err.message : "erro_desconhecido";
  }
}

/** A API key gravada na sessão, decifrada — só no servidor. */
export async function chaveDaSessao(
  admin: SupabaseClient,
  sessao: RelaySession,
): Promise<string | null> {
  if (!sessao.apiKeyEncrypted) return null;
  return decryptWebhookSecret(admin, sessao.apiKeyEncrypted);
}

/**
 * Pergunta ao relay o estado do canal e aplica à sessão. É o caminho que
 * funciona SEM webhook — a instalação local (`http://localhost`) não recebe
 * entrega nenhuma, e é só por aqui que ela descobre que o número foi conectado.
 */
export async function atualizarSessaoPeloRelay(
  admin: SupabaseClient,
  input: { organizationId: string; sessao: RelaySession; apiKey: string },
): Promise<RelaySession> {
  const canal = await buscarCanal(input.apiKey, input.sessao.channelId);
  const status = statusDaSessao(canal.status);
  const phoneNumber = telefoneE164(canal.display_phone_number);
  const mudou =
    status !== input.sessao.status ||
    (canal.phone_number_id ?? null) !== input.sessao.phoneNumberId ||
    (canal.waba_id ?? null) !== input.sessao.wabaId;
  if (mudou) {
    const { error } = await aplicarStatusDoCanal(admin, {
      organizationId: input.organizationId,
      channelSessionId: input.sessao.id,
      status,
      phoneNumberId: canal.phone_number_id,
      wabaId: canal.waba_id,
      phoneNumber,
    });
    if (error) throw new Error(`relay_status_update_failed: ${error}`);
  }
  return {
    ...input.sessao,
    status,
    phoneNumberId: canal.phone_number_id ?? input.sessao.phoneNumberId,
    wabaId: canal.waba_id ?? input.sessao.wabaId,
    phoneNumber: phoneNumber ?? input.sessao.phoneNumber,
    connectUrl: canal.connect_url || input.sessao.connectUrl,
  };
}

export { statusDaSessao as statusDaSessaoDoRelay, telefoneE164 };
