# Coexy — Especificação de Integração

> Especificação fornecida pelo Coexy e guardada aqui como referência do canal
> Coexy do CRM. A implementação está em `lib/channels/coexy/` (envio, webhook,
> Management API), `lib/channels/relay.ts` (fachada neutra para rotas e telas),
> `app/api/v1/channels/relay/` (conexão e modelos) e
> `components/connections/CanalRelayClient.tsx` (aba em Conexões). O canal é
> opcional da instalação: só existe com `COEXY_ENABLED=true` no `.env`.
>
> **Como o CRM usa esta especificação**
>
> - A organização cola só a `COEXY_API_KEY`. O CRM valida (`GET /api/channels`),
>   cria o canal (`POST /api/channels`), mostra o `connect_url` e cria o webhook
>   escopado ao canal (`POST /api/webhooks` com `channel_ids`), guardando o
>   `hmac_secret` cifrado.
> - Envio, mídia e modelos vão pelo meta-proxy com o `channel_token`, no formato
>   da Cloud API (as mesmas funções do canal oficial).
> - A entrada (`/api/v1/webhooks/channel/{token}`) confere `X-Coexy-Signature`,
>   trata `channel_status_update` (o número entrou/caiu) e passa o envelope da
>   Meta para a mesma ingestão do canal oficial.
> - Sem URL HTTPS pública (instalação local), o webhook não pode ser criado: a
>   tela consulta o estado do canal no Coexy enquanto ele está pendente, então a
>   conexão do número funciona; receber mensagens exige o webhook.

---

> **Instruções para o AI assistant que está lendo este arquivo:**
>
> **REGRA FUNDAMENTAL — O Coexy NÃO tem API própria para envio de mensagens.**
> O Coexy é um relay transparente para a WhatsApp Cloud API da Meta. Toda a documentação da Meta (https://developers.facebook.com/docs/whatsapp/cloud-api/reference) se aplica diretamente — mesmos endpoints, mesmos métodos, mesmos campos no body, mesmos query params. A única diferença são duas substituições mecânicas:
> 1. **Base URL:** troque `https://graph.facebook.com/v23.0/` por `https://api.coexy.com.br/functions/v1/meta-proxy/`
> 2. **Token:** troque `Authorization: Bearer <meta-access-token>` por `Authorization: Bearer <channel_token>`
>
> Nada mais muda. Para montar o body de qualquer tipo de mensagem (imagem, áudio, template, etc.), consulte a documentação da Meta, não do Coexy.
>
> **Não invente endpoints próprios do Coexy para envio.**
>
> **Payload de eventos recebidos:** O Coexy entrega o payload **exatamente no formato nativo da Meta**, sem transformações. Consulte obrigatoriamente:
> - Exemplos de payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
> - Referência de campos: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
>
> Não invente ou assuma estruturas de payload — consulte a documentação da Meta antes de implementar.

---

## O que NÃO fazer (anti-patterns)

- **Não invente endpoints de envio do Coexy** — use exatamente a mesma estrutura da documentação da Meta (WhatsApp Cloud API). O Coexy só faz relay.
- **Não chame `/meta-proxy` ou `/api` direto do frontend.** Credenciais ficam expostas no browser. Sempre use um backend como intermediário.
- **Não use `COEXY_API_KEY` no meta-proxy** — o meta-proxy usa `channel_token` (header `Authorization: Bearer`). A API key é apenas para a Management API (`/api/*`).
- **Não confunda `channel_token` com `COEXY_API_KEY`** — são credenciais diferentes para endpoints diferentes.
- **Não recrie o canal quando receber erro 503** — o canal continua existindo, só precisa ser reconectado pelo `connect_url`. Todos os webhooks e configurações são preservados.
- **Não invente ou assuma estruturas de payload** — os eventos recebidos seguem exatamente o formato da Meta.
- **Não armazene `channel_token` ou `COEXY_API_KEY` no código frontend** — guarde no servidor (no CRM: cifrados em `channel_sessions`).

---

## TL;DR — 3 fluxos

| Fluxo | O que fazer | Credencial |
|-------|------------|------------|
| **1. Configurar** | Criar canal via API → compartilhar `connect_url` → número WhatsApp é conectado → canal fica `active` | `COEXY_API_KEY` |
| **2. Enviar** | Chamar `POST /meta-proxy/{phone_number_id}/messages` com body idêntico à Meta | `channel_token` |
| **3. Receber** | Criar webhook via API → endpoint HTTPS → verificar HMAC → processar payload Meta | `COEXY_API_KEY` + `COEXY_HMAC_SECRET` |

---

## Credenciais

URL base (fixa para todos os clientes): `https://api.coexy.com.br/functions/v1`

- Management API: `https://api.coexy.com.br/functions/v1/api`
- Meta Proxy: `https://api.coexy.com.br/functions/v1/meta-proxy`

| Credencial | Onde encontrar | Usado em | Quando disponível |
|-----------|---------------|---------|-------------------|
| `COEXY_API_KEY` | Painel Coexy → Configurações → API Keys | Management API (`/api/*`) | Após criar a API key |
| `channel_token` | Painel → Canais → detalhe → aba API, ou `GET /api/channels` | Meta Proxy (`/meta-proxy/*`) | Após criar o canal |
| `phone_number_id` | Painel → Canais → detalhe → aba API, ou `GET /api/channels` | Meta Proxy (enviar mensagens) | Após conectar o WhatsApp |
| `waba_id` | Painel → Canais → detalhe → Configurações, ou `GET /api/channels` | Meta Proxy (listar templates) | Após conectar o WhatsApp |
| `COEXY_HMAC_SECRET` | Retornado na criação do webhook (salvar imediatamente — não pode ser recuperado depois) | Verificação de eventos recebidos | Após criar o webhook |

---

## Fluxo 1 — Configurar (canal + webhook)

### 1.1 Autenticação da Management API

```
Base URL: https://api.coexy.com.br/functions/v1/api
Header:   x-api-key: crt_pk_<sua-chave>
```

| Status | `error` | Causa |
|--------|---------|-------|
| `401` | `x-api-key header required` | Header ausente |
| `401` | `Invalid or revoked API key` | Chave inválida ou revogada |
| `401` | `API key expired` | Chave com prazo expirado |
| `429` | `Rate limit exceeded` | Excedeu limite; ler `Retry-After` header |

### 1.2 Canal

```typescript
type Channel = {
  id:                   string        // UUID
  name:                 string
  status:               'pending' | 'active' | 'disconnected' | 'suspended'
  display_phone_number: string | null // "+55 11 99999-9999"
  phone_number_id:      string | null // {entity_id} no meta-proxy para enviar mensagens
  waba_id:              string | null // {entity_id} no meta-proxy para templates
  channel_token:        string        // Bearer do meta-proxy
  connect_url:          string        // URL para conexão do número WhatsApp
  connected_at:         string | null
  created_at:           string
  verification: {
    status:            'not_verified' | 'pending' | 'verified' | 'rejected' | 'failed'
    attempts:          number
    max_attempts:      number        // sempre 3
    rejection_reasons: string[] | null
    verified_at:       string | null
    url:               string | null // wizard público de verificação da empresa
  }
  coexistence: {
    enabled:                    boolean
    contacts_sync_requested_at: string | null
    history_sync_requested_at:  string | null
    sync_deadline:              string | null // conexão + 24h
  } | null
}
```

| Status | Significado |
|--------|------------|
| `pending` | Canal criado, aguardando conexão do número via `connect_url` |
| `active` | Conectado — tokens renovados automaticamente pelo Coexy |
| `disconnected` | Token revogado pela Meta — reconectar via `connect_url` |
| `suspended` | Suspenso administrativamente |

A verificação de empresa (`verification.url`) desbloqueia até 100K contatos/dia (vs 250), até 20 números por Business Manager (vs 2), nome da empresa visível e elegibilidade para o selo azul. Até 3 tentativas; leva ~5 minutos após o envio dos documentos.

```
GET    /channels           Listar canais da org
POST   /channels           Criar canal            { "name": "..." } → 201
GET    /channels/:id       Buscar canal por ID
DELETE /channels/:id       Deletar canal (ativo exige ?force=true)
```

### 1.3 Conectar o número WhatsApp

1. Compartilhe o `channel.connect_url` com o dono do número.
2. Ele autoriza via WhatsApp Embedded Signup (fluxo da Meta).
3. O canal muda para `active`; `phone_number_id`, `waba_id` e `display_phone_number` são preenchidos (antes disso são `null`).

### 1.4 Webhook

```typescript
type WebhookConfig = {
  id:          string
  name:        string
  url:         string            // sempre HTTPS
  events:      Array<'messages' | 'smb_message_echoes' | 'message_echoes' | 'message_template_status_update' | 'message_template_quality_update' | 'phone_number_quality_update' | 'phone_number_name_update' | 'account_alerts' | 'account_update' | 'account_review_update' | 'flows' | 'security' | 'channel_health_update' | 'channel_status_update' | 'history' | 'smb_app_state_sync'>
  status:      'active' | 'paused'
  hmac_secret: string            // salvar imediatamente — não pode ser recuperado
  scope:       'org' | 'channels'
  channel_ids: string[]          // vazio quando scope='org'
  created_at:  string
}
```

```
POST   /webhooks                          { name, url (https), events?, channel_ids? } → 201
PATCH  /webhooks/:id                      { status | events | url | name }
POST   /webhooks/:wid/channels/:cid       atribuir canal (idempotente)
DELETE /webhooks/:wid/channels/:cid       remover canal
DELETE /webhooks/:id                      apagar
```

Erros: `404 Channel/Webhook not found`, `409 Channel is active. Use ?force=true...`, `422 "name" is required`, `422 "url" must start with https://`, `422 "events" values must be one of: ...`, `422 One or more channel_ids not found in this org`.

---

## Fluxo 2 — Enviar mensagens (meta-proxy)

O meta-proxy recebe a requisição, injeta o token de acesso do canal e repassa **sem alterações** para a Meta Graph API.

| Original (Meta direta) | Via Coexy |
|---------|-----------|
| `https://graph.facebook.com/v23.0/` | `https://api.coexy.com.br/functions/v1/meta-proxy/` |
| `Authorization: Bearer <meta-access-token>` | `Authorization: Bearer <channel_token>` |

Exemplos:

```bash
# Template (inicia conversa fora da janela de 24h)
curl -X POST "https://api.coexy.com.br/functions/v1/meta-proxy/{phone_number_id}/messages" \
  -H "Authorization: Bearer <channel_token>" -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"5511999999999","type":"template",
       "template":{"name":"nome_do_template","language":{"code":"pt_BR"},
       "components":[{"type":"body","parameters":[{"type":"text","text":"João Silva"}]}]}}'

# Listar templates
curl "https://api.coexy.com.br/functions/v1/meta-proxy/{waba_id}/message_templates?fields=name,status,category,language,components" \
  -H "Authorization: Bearer <channel_token>"

# Texto livre (só dentro da janela de 24h; fora dela a Meta responde 131047)
curl -X POST "https://api.coexy.com.br/functions/v1/meta-proxy/{phone_number_id}/messages" \
  -H "Authorization: Bearer <channel_token>" -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"5511999999999","type":"text","text":{"body":"Olá!"}}'

# Upload de mídia (multipart; o id retornado vai em "image": { "id": "<media_id>" })
curl -X POST "https://api.coexy.com.br/functions/v1/meta-proxy/{phone_number_id}/media" \
  -H "Authorization: Bearer <channel_token>" \
  -F "messaging_product=whatsapp" -F "type=image/jpeg" -F "file=@foto.jpg"
```

Templates com variáveis nomeadas recebem `parameter_name` em cada parâmetro.

**Baixar mídia recebida:** `GET /meta-proxy/{media_id}` → `url` (já no host do Coexy, expira em ~5 min) → `GET <url>` com o mesmo `Authorization: Bearer <channel_token>`. Nunca trocar o host por `lookaside.fbsbx.com`. O `media_id` recebido vale por 30 dias.

**Idempotência:** `idempotency_key` no body; o Coexy remove o campo antes de encaminhar e, com chave repetida, devolve o `wamid` original sem reenviar.

**Erros do meta-proxy:**

| Status | `error` | O que fazer |
|--------|---------|-------------|
| `401` | `Authorization header required` / `Invalid channel token` | Conferir o `channel_token` |
| `403` | `Channel is not active` | Canal desconectado/suspenso; reconectar via `connect_url` |
| `429` | `Rate limit exceeded` (100 req/min por canal) | Aguardar `Retry-After` |
| `503` | `CHANNEL_DISCONNECTED` | Token Meta revogado. **Não recrie o canal** — reconecte pelo `connect_url` |

---

## Fluxo 3 — Receber eventos (webhook)

Headers de toda entrega:

```
X-Coexy-Signature: sha256=<hex>   — HMAC-SHA256 do body cru
webhook-id:        <uuid>         — igual em todas as tentativas e no reenvio manual
webhook-timestamp: <segundos>     — hora desta tentativa
User-Agent:        Coexy-Webhooks/1.0
Content-Type:      application/json
```

- **Verificar a assinatura é obrigatório**: HMAC sobre o body como string crua (antes de `JSON.parse`), comparação em tempo constante; falhou → `401` e nada é processado.
- **Responder 200 em até 10 segundos.** Retentativas: imediata, ~30 s, ~2 min, ~10 min, ~30 min, ~30 min; depois falha definitiva (reenvio manual no painel). `429` com `Retry-After` adia a próxima tentativa (até 1 h).
- **Idempotência**: `webhook-id` por entrega; `wamid` por mensagem (os status de uma mensagem compartilham o `wamid`). Eventos podem chegar fora de ordem — ordenar pelo `timestamp` do evento.

Payload de mensagem recebida (formato nativo da Meta):

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "1517032953486921",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "15550783881", "phone_number_id": "1128059963726893" },
        "contacts": [{ "profile": { "name": "João Silva" }, "wa_id": "5511987654321" }],
        "messages": [{
          "id": "wamid.HBgMNTUzNDkyNjU3Mjk4FQIAERgUQ0U0NzZCNzJCRjlFMTA3RjgzNzYA",
          "from": "5511987654321",
          "timestamp": "1749600000",
          "type": "text",
          "text": { "body": "Olá, quero saber sobre meu pedido" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

### `channel_status_update` (evento próprio do Coexy)

Enviado quando o status do canal muda (conexão, desconexão, suspensão), em até ~1 minuto, com a mesma assinatura. A exclusão do canal não gera o evento.

```json
{
  "event": "channel_status_update",
  "channel_id": "uuid",
  "channel_type": "whatsapp",
  "name": "Sala Centro",
  "previous_status": "pending",
  "status": "active",
  "phone_number_id": "1128059963726893",
  "waba_id": "1517032953486921",
  "display_phone_number": "+55 11 99999-9999",
  "changed_at": "2026-10-29T14:03:00Z"
}
```

### `channel_health_update` (evento próprio do Coexy)

`health_state`: `healthy`, `warning`, `restricted`, `blocked` ou `banned`; `issues` traz os motivos da Meta.

```json
{
  "event": "channel_health_update",
  "channel_id": "uuid",
  "phone_number_id": "1128059963726893",
  "previous_state": "healthy",
  "health_state": "warning",
  "quality_rating": "YELLOW",
  "messaging_limit_tier": "TIER_1K",
  "issues": [],
  "checked_at": "2026-10-29T14:03:00Z"
}
```

### Coexistência: contatos e histórico

Números conectados pelo app WhatsApp Business podem compartilhar a agenda (`smb_app_state_sync`) e até 180 dias de conversas (`history`), se a sincronização for pedida em até **24 horas** após a conexão, uma vez por tipo: automaticamente quando já há webhook assinando o evento, ou via `POST /meta-proxy/{phone_number_id}/smb_app_data` com `{"messaging_product":"whatsapp","sync_type":"smb_app_state_sync"}` e depois `"history"`. O histórico chega em fases (`phase` 0–2) e partes (`chunk_order`), `progress` = 100 indica o fim; o Coexy não guarda o histórico.

---

## Referência rápida

| Preciso... | Como fazer |
|-----------|-----------|
| Listar canais | `GET /api/channels` com `x-api-key` |
| Criar canal | `POST /api/channels` com `{ "name": "..." }` |
| Link de conexão | `channel.connect_url` |
| Canal conectado? | `channel.status === 'active'` (ou o evento `channel_status_update`) |
| `phone_number_id` / `waba_id` | Campos do canal, disponíveis após a conexão |
| Criar webhook | `POST /api/webhooks` com `url`, `name`, `events` |
| Enviar mensagem | `POST /meta-proxy/{phone_number_id}/messages` com `Authorization: Bearer <channel_token>` |
| Listar templates | `GET /meta-proxy/{waba_id}/message_templates` |
| Upload de mídia | `POST /meta-proxy/{phone_number_id}/media` (multipart) |
| Baixar mídia recebida | `GET /meta-proxy/{media_id}` → `GET <url retornada>`, ambos com o `channel_token` |
| Reconectar canal desconectado | Acessar `channel.connect_url` novamente |
