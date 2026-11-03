/**
 * Cliente da Management API do Coexy (`x-api-key`) — só o que a conexão usa:
 * listar/criar/consultar canal e criar/apagar webhook.
 *
 * Mensagem NÃO passa por aqui: envio, mídia e modelos vão pelo meta-proxy, com
 * o `channel_token` do canal (ver `adapters/coexy.ts`). Misturar as duas
 * credenciais é o primeiro anti-padrão da especificação.
 *
 * Erro vira `CoexyApiError` com o status e a frase do Coexy, para a rota
 * traduzir sem adivinhar (`401` = chave errada, `429` = limite).
 */
import { coexyManagementBase } from "./config";

export type CoexyChannelStatus = "pending" | "active" | "disconnected" | "suspended";

export interface CoexyChannel {
  id: string;
  name: string;
  status: CoexyChannelStatus;
  display_phone_number: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  channel_token: string;
  connect_url: string;
  connected_at: string | null;
  created_at: string;
}

export interface CoexyWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: "active" | "paused";
  hmac_secret: string;
  scope: "org" | "channels";
  channel_ids: string[];
}

/** Os eventos que este canal assina: mensagem, eco do app, modelo e status do canal. */
export const EVENTOS_DO_WEBHOOK = [
  "messages",
  "smb_message_echoes",
  "message_template_status_update",
  "channel_status_update",
] as const;

export class CoexyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "CoexyApiError";
  }
}

const TIMEOUT_MS = 15_000;

async function chamar<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${coexyManagementBase()}${path}`, {
    method,
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const frase = typeof json?.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new CoexyApiError(res.status, frase, res.headers.get("Retry-After"));
  }
  return json as T;
}

/** A resposta de lista pode vir crua (`[...]`) ou embrulhada (`{ data: [...] }`). */
function lista<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const d =
    (r as { data?: unknown; channels?: unknown } | null)?.data ??
    (r as { channels?: unknown } | null)?.channels;
  return Array.isArray(d) ? (d as T[]) : [];
}

/** A chave é válida? `GET /channels` responde 200 só com chave ativa. */
export async function listarCanais(apiKey: string): Promise<CoexyChannel[]> {
  return lista<CoexyChannel>(await chamar<unknown>(apiKey, "GET", "/channels"));
}

export async function criarCanal(apiKey: string, name: string): Promise<CoexyChannel> {
  return chamar<CoexyChannel>(apiKey, "POST", "/channels", { name });
}

export async function buscarCanal(apiKey: string, id: string): Promise<CoexyChannel> {
  return chamar<CoexyChannel>(apiKey, "GET", `/channels/${encodeURIComponent(id)}`);
}

export async function criarWebhook(
  apiKey: string,
  input: { name: string; url: string; channelId: string },
): Promise<CoexyWebhook> {
  return chamar<CoexyWebhook>(apiKey, "POST", "/webhooks", {
    name: input.name,
    url: input.url,
    events: [...EVENTOS_DO_WEBHOOK],
    // Escopo pelo CANAL: um webhook de organização receberia os eventos de
    // todos os números da conta Coexy nesta mesma sessão do CRM.
    channel_ids: [input.channelId],
  });
}

export async function apagarWebhook(apiKey: string, id: string): Promise<void> {
  await chamar<void>(apiKey, "DELETE", `/webhooks/${encodeURIComponent(id)}`);
}
