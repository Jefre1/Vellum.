-- manifest: canal Coexy — provider 'coexy' (relay da Cloud API conectado por API key), colunas do provider e vocabulário dos CHECKs
--
-- ─── O que entra ────────────────────────────────────────────────────────────
-- Um provedor de canal de mensagem novo. O Coexy é um relay transparente da
-- WhatsApp Cloud API: mesmos caminhos e corpos da Meta, com outro HOST
-- (`/functions/v1/meta-proxy`) e outro TOKEN (`channel_token` do canal). A
-- diferença para o outro parceiro Graph-compatível (`datafy`) é a CONEXÃO: aqui
-- a organização cola só a API key, e o CRM cria o canal e o webhook no Coexy.
--
-- Por isso a coluna de referência é o id do CANAL no Coexy (`coexy_channel_id`),
-- e não o `phone_number_id`: o canal existe (e precisa de uma linha, com o
-- webhook já apontado para ela) ANTES de o número ser conectado pelo link de
-- conexão. `coexy_phone_number_id`/`coexy_waba_id` nascem nulos e são
-- preenchidos quando o Coexy avisa (`channel_status_update`) que o canal ficou
-- ativo.
--
-- O canal é OPCIONAL DA INSTALAÇÃO e nasce desligado (`COEXY_ENABLED`), no
-- molde do `datafy`: colunas nullable, vazias em toda instalação que não liga.
--
-- ─── Segredos ───────────────────────────────────────────────────────────────
-- `coexy_api_key_encrypted` e `coexy_token_encrypted` são cifrados por
-- `fn_encrypt_oauth` (via lib/webhooks/secrets.ts), como os tokens dos outros
-- canais. O `hmac_secret` do webhook vai para a coluna genérica
-- `webhook_secret_encrypted`, que a rota de entrada já decifra.
--
-- ─── CHECKs recriados inteiros ──────────────────────────────────────────────
-- Mesma regra da 0387: o vocabulário fechado e o `_ref_check` são recriados com
-- drop+add, e `webhook_events_log_provider_check` ganha 'coexy' porque a rota
-- genérica arquiva o corpo cru com o provider da sessão antes da assinatura.
-- Alargamento puro nos três: não há linha que passava antes e deixe de passar.
-- O vocabulário de `webhook_events_log` é o vigente depois da 0601 (stripe,
-- asaas) mais 'coexy'.

alter table public.channel_sessions
  add column if not exists coexy_channel_id text,
  add column if not exists coexy_phone_number_id text,
  add column if not exists coexy_waba_id text,
  add column if not exists coexy_token_encrypted bytea,
  add column if not exists coexy_api_key_encrypted bytea,
  add column if not exists coexy_webhook_id text,
  add column if not exists coexy_connect_url text;

comment on column public.channel_sessions.coexy_channel_id is
  'Id do canal no Coexy (UUID do relay). É o sessionRef deste canal — existe desde a criação, antes do número ser conectado. Espelhado em lib/channels/session-ref.ts.';
comment on column public.channel_sessions.coexy_token_encrypted is
  'channel_token do Coexy (Bearer do meta-proxy), cifrado por fn_encrypt_oauth. Nunca volta à tela.';
comment on column public.channel_sessions.coexy_api_key_encrypted is
  'API key da organização no Coexy (Management API), cifrada por fn_encrypt_oauth. Usada para criar/consultar o canal e o webhook. Nunca volta à tela.';

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
    check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'datafy', 'coexy'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha' and waha_session_name is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls' and wacalls_session_id is not null) or
    (provider = 'datafy' and datafy_phone_number_id is not null) or
    (provider = 'coexy' and coexy_channel_id is not null)
  );

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;

alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy',
    'stripe', 'asaas', 'coexy'
  ));

-- O id do canal e o número são identificadores do PROVIDER: duas linhas ativas
-- com o mesmo valor fariam `maybeSingle()` devolver PGRST116. Dedup com sufixo
-- antes do índice, para a migration ser idempotente num banco com repetidos.
with ativos as (
  select id,
         row_number() over (
           partition by coexy_channel_id
           order by created_at desc nulls last, id desc
         ) as posicao
    from public.channel_sessions
   where archived_at is null
     and coexy_channel_id is not null
)
update public.channel_sessions s
   set coexy_channel_id = s.coexy_channel_id || '-conflito-' || s.id::text
  from ativos a
 where a.id = s.id
   and a.posicao > 1;

create unique index if not exists channel_sessions_coexy_channel_id_ativo_unique
  on public.channel_sessions (coexy_channel_id)
  where archived_at is null and coexy_channel_id is not null;

with ativos as (
  select id,
         row_number() over (
           partition by coexy_phone_number_id
           order by created_at desc nulls last, id desc
         ) as posicao
    from public.channel_sessions
   where archived_at is null
     and coexy_phone_number_id is not null
)
update public.channel_sessions s
   set coexy_phone_number_id = s.coexy_phone_number_id || '-conflito-' || s.id::text
  from ativos a
 where a.id = s.id
   and a.posicao > 1;

create unique index if not exists channel_sessions_coexy_phone_number_id_ativo_unique
  on public.channel_sessions (coexy_phone_number_id)
  where archived_at is null and coexy_phone_number_id is not null;

notify pgrst, 'reload schema';
