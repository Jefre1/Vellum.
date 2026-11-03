"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { nomeDoCanal } from "@/lib/channels/estado";
import { useT } from "@/hooks/i18n/useT";
import { ChannelAiAccess } from "./ChannelAiAccess";

/**
 * Conectar um número pelo "relay" — o provedor que espelha a Cloud API e se
 * conecta com UMA API key. Só aparece quando a instalação liga o canal (ver
 * `ConexoesShell`). A marca vem do servidor (`label`): a tela não nomeia
 * provider (`lint:channels`).
 *
 * ─── Três passos, e só o primeiro é digitado ────────────────────────────────
 *
 * 1. A API key: o servidor valida, cria o canal e o webhook no provedor.
 * 2. O link de conexão: o dono do número abre e autoriza pelo fluxo da Meta.
 *    Enquanto isso a tela pergunta o estado a cada 5 s — o webhook não é
 *    necessário para descobrir que o número entrou.
 * 3. Receber: com o webhook criado, as respostas entram no Inbox. Sem URL
 *    pública (instalação local) a tela diz que o CRM envia mas não recebe.
 */

const ROTA = "/api/v1/channels/relay";

interface Estado {
  label: string;
  connected: boolean;
  channel_session_id: string | null;
  status: string | null;
  number_connected: boolean;
  phone_number: string | null;
  display_name: string | null;
  connect_url: string | null;
  webhook_ok: boolean;
  webhook_url: string | null;
}

export function CanalRelayClient() {
  const t = useT();
  const qc = useQueryClient();
  const { data: estado = null } = useQuery({
    queryKey: ["canal-relay"],
    queryFn: async () => (await apiClient.get<{ data: Estado }>(ROTA)).data,
    // Pendente: pergunta de novo até o número entrar. Conectado: para.
    refetchInterval: (q) => {
      const e = q.state.data as Estado | undefined;
      return e?.connected && !e.number_connected ? 5_000 : false;
    },
  });
  const [apiKey, setApiKey] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState<"conectar" | "webhook" | null>(null);

  const carregar = () => qc.invalidateQueries({ queryKey: ["canal-relay"] });

  const conectar = async () => {
    setSalvando("conectar");
    try {
      const r = await apiClient.post<{ data: Estado & { webhook_error: string | null } }>(ROTA, {
        api_key: apiKey,
        ...(nome.trim() ? { nome: nome.trim() } : {}),
      });
      // A chave sai da memória da tela assim que é gravada: ela não volta num GET.
      setApiKey("");
      toast.success(t("Canal criado. Agora conecte o número pelo link."));
      if (r.data.webhook_error) {
        toast.warning(t("O webhook não pôde ser criado — o CRM envia, mas ainda não recebe."));
      }
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível conectar."));
    } finally {
      setSalvando(null);
    }
  };

  const refazerWebhook = async () => {
    setSalvando("webhook");
    try {
      await apiClient.patch(ROTA, {});
      toast.success(t("Webhook criado. O canal passa a receber mensagens."));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível criar o webhook."));
    } finally {
      setSalvando(null);
    }
  };

  const rotulo = estado?.label ?? t("provedor parceiro");
  const conectado = estado?.connected ?? false;
  const numeroConectado = estado?.number_connected ?? false;

  return (
    <div className="flex flex-col gap-4" data-testid="canal-relay">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t("Conectar por")} {rotulo}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                "Um número oficial (WhatsApp Business) pela API da Meta, por um provedor parceiro. Você cola só a API key do painel do provedor: o CRM cria o canal, o link de conexão e o webhook sozinho.",
              )}
            </p>
          </div>
          {numeroConectado ? (
            <Badge variant="secondary">{t("Conectado")}</Badge>
          ) : conectado ? (
            <Badge variant="outline">{t("Aguardando o número")}</Badge>
          ) : (
            <Badge variant="outline">{t("Não conectado")}</Badge>
          )}
        </div>

        {conectado && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{nomeDoCanal(estado ?? {}, t)}</p>
            <p className="text-xs text-muted-foreground">
              {estado?.phone_number ?? t("número ainda não conectado")} · {estado?.status ?? "—"}
            </p>
          </div>
        )}

        {estado?.channel_session_id && numeroConectado && (
          <ChannelAiAccess channelId={estado.channel_session_id} />
        )}

        {!conectado && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="relay-api-key">{t("API key")}</Label>
              <Input
                id="relay-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="crt_pk_…"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "No painel do provedor: Configurações → API Keys. Guardada cifrada e nunca mostrada de novo.",
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="relay-nome">{t("Nome da conexão (opcional)")}</Label>
              <Input
                id="relay-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={t("Ex.: Suporte Principal")}
                maxLength={80}
              />
            </div>
            <div>
              <Button onClick={conectar} disabled={salvando !== null || apiKey.trim().length < 10}>
                {salvando === "conectar" ? t("Criando o canal…") : t("Conectar")}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("A chave é testada contra o provedor antes de qualquer coisa ser criada.")}
              </p>
            </div>
          </>
        )}
      </Card>

      {/* Passo 2: só enquanto o número não entrou. O link é do provedor, e quem
          abre é o DONO do número (pode não ser quem está nesta tela). */}
      {conectado && !numeroConectado && estado?.connect_url && (
        <Card className="flex flex-col gap-3 border-accent/40 p-4">
          <h3 className="text-sm font-semibold">{t("Conecte o número do WhatsApp")}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "Abra o link abaixo (ou envie para o dono do número) e autorize pelo fluxo da Meta. Esta tela atualiza sozinha quando o número entrar.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={estado.connect_url} target="_blank" rel="noopener noreferrer">
                {t("Abrir link de conexão")}
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await copyToClipboard(estado.connect_url ?? "");
                toast.success(t("Copiado."));
              }}
            >
              {t("Copiar link")}
            </Button>
          </div>
        </Card>
      )}

      {/* Passo 3: receber. Só depois de o canal existir. */}
      {conectado && (
        <Card
          className={
            estado?.webhook_ok
              ? "flex flex-col gap-3 p-4"
              : "flex flex-col gap-3 border-warning/40 bg-warning-bg p-4"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t("Receber as respostas")}</h3>
              <p className="text-xs text-muted-foreground">
                {estado?.webhook_ok
                  ? t(
                      "O webhook foi criado no provedor: as mensagens dos clientes entram no Inbox.",
                    )
                  : t(
                      "O provedor só entrega em endereço HTTPS público. Sem ele o CRM envia, mas não recebe as respostas. Com o domínio configurado, clique em Criar webhook.",
                    )}
              </p>
            </div>
            {estado?.webhook_ok ? (
              <Badge variant="secondary">{t("Recebendo")}</Badge>
            ) : (
              <Badge variant="outline">{t("Não recebe")}</Badge>
            )}
          </div>
          {!estado?.webhook_ok && (
            <div>
              <Button variant="outline" onClick={refazerWebhook} disabled={salvando !== null}>
                {salvando === "webhook" ? t("Criando…") : t("Criar webhook")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
