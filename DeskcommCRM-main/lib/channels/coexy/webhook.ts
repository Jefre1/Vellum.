/**
 * Entrada do Coexy — módulo PURO: a assinatura e o evento próprio de status.
 *
 * ─── Assinatura ─────────────────────────────────────────────────────────────
 *
 * `X-Coexy-Signature: sha256=<hex>`, HMAC-SHA256 do CORPO CRU com o
 * `hmac_secret` que o Coexy devolve UMA vez, na criação do webhook (o CRM cria
 * o webhook e grava o segredo cifrado em `webhook_secret_encrypted`). Parsear
 * e reserializar o JSON muda os bytes e a assinatura nunca bate.
 *
 * ─── `channel_status_update` ────────────────────────────────────────────────
 *
 * Evento DO COEXY (não vem da Meta): o canal mudou de status. É ele que avisa
 * que o número foi conectado pelo link de conexão (`pending` → `active`), já
 * com `phone_number_id` e `waba_id` — a sessão do CRM nasce sem os dois.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_ASSINATURA_COEXY = "x-coexy-signature";

/** A assinatura confere? `false` para qualquer peça ausente ou malformada. */
export function verifyCoexySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null,
): boolean {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const hex = signatureHeader.slice(7);
  if (!/^[0-9a-f]+$/i.test(hex)) return false;

  const esperada = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(hex.toLowerCase(), "utf8");
  const b = Buffer.from(esperada, "utf8");
  // Tamanhos diferentes fariam `timingSafeEqual` LANÇAR: assinatura malformada
  // tem de virar 401, não 500.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface CoexyStatusEvent {
  channelId: string;
  status: "pending" | "active" | "disconnected" | "suspended";
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
}

const STATUS = new Set(["pending", "active", "disconnected", "suspended"]);

/**
 * O corpo é um `channel_status_update`? `null` para qualquer outro corpo —
 * inclusive o envelope da Meta, que segue para o parser do canal oficial.
 */
export function lerEventoDeStatus(rawBody: string): CoexyStatusEvent | null {
  let p: unknown;
  try {
    p = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (o.event !== "channel_status_update") return null;
  if (typeof o.channel_id !== "string" || typeof o.status !== "string" || !STATUS.has(o.status))
    return null;
  const texto = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    channelId: o.channel_id,
    status: o.status as CoexyStatusEvent["status"],
    phoneNumberId: texto(o.phone_number_id),
    wabaId: texto(o.waba_id),
    displayPhoneNumber: texto(o.display_phone_number),
  };
}

/** Status do relay → status da sessão no CRM (`channel_sessions_status_check`). */
export function statusDaSessao(
  status: CoexyStatusEvent["status"],
): "STARTING" | "WORKING" | "FAILED" | "STOPPED" {
  switch (status) {
    case "active":
      return "WORKING";
    case "pending":
      return "STARTING";
    case "disconnected":
      return "FAILED";
    case "suspended":
      return "STOPPED";
  }
}

/** "+55 11 99999-9999" → "+5511999999999"; `null` sem dígito. */
export function telefoneE164(display: string | null): string | null {
  const d = (display ?? "").replace(/\D/g, "");
  return d ? `+${d}` : null;
}
