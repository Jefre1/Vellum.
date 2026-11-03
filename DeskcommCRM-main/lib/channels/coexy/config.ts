/**
 * Canal Coexy — o interruptor da instalação e os endereços.
 *
 * O Coexy é um relay transparente da WhatsApp Cloud API: toda chamada de
 * mensagem, mídia e modelo é a MESMA da Meta, com duas trocas mecânicas — a
 * base (`/functions/v1/meta-proxy` no lugar de `graph.facebook.com/vXX`) e o
 * token (`channel_token` do canal no lugar do token da Meta). A especificação
 * completa mora em `docs/integracao/coexy-spec.md`.
 *
 * ─── Desligado por padrão ───────────────────────────────────────────────────
 *
 * No molde do outro parceiro Graph-compatível (`graph-parceiro/credentials.ts`):
 * sem `COEXY_ENABLED=true` no `.env`, quem instala não vê aba, as rotas
 * respondem 404, o webhook não aceita entrega e o envio não sai. Pôr o nome de
 * um fornecedor na tela de todo cliente seria propaganda que o dono não
 * escolheu.
 */

/**
 * A instalação liga este canal? Só `true` literal (sem diferenciar caixa, com
 * `trim`): um `.env` com `1`, `sim` ou espaço sobrando não liga por acidente.
 */
export function canalCoexyLigado(valor: string | undefined = process.env.COEXY_ENABLED): boolean {
  return (valor ?? "").trim().toLowerCase() === "true";
}

/** Como o canal se chama PARA O USUÁRIO — a tela não pode escrever a marca. */
export const COEXY_LABEL = "Coexy";

/** Raiz das funções do Coexy. `||` + `trim()`: chave vazia no `.env` = produção. */
export function coexyRootUrl(): string {
  return (
    process.env.COEXY_API_BASE_URL?.trim() || "https://api.coexy.com.br/functions/v1"
  ).replace(/\/+$/, "");
}

/** Management API (`x-api-key`): canais e webhooks. */
export function coexyManagementBase(): string {
  return `${coexyRootUrl()}/api`;
}

/**
 * Base Graph-compatível do relay (`Authorization: Bearer <channel_token>`). É
 * passada como `graphBase` às funções do canal oficial: o caminho depois dela
 * (`/{phone_number_id}/messages`, `/{waba_id}/message_templates`) é o da Meta.
 */
export function coexyProxyBase(): string {
  return `${coexyRootUrl()}/meta-proxy`;
}
