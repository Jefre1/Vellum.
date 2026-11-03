---
impacto: capacidade_nova
secao: adicionado
titulo: Novo canal de WhatsApp oficial pelo Coexy, conectado só com a API key
---

Instalações com `COEXY_ENABLED=true` no `.env` ganham a aba **Coexy** em Conexões. A empresa cola a API key do painel do Coexy e o CRM faz o resto: cria o canal no Coexy, mostra o link para o dono do número autorizar pela Meta e registra o webhook de recebimento. A tela se atualiza sozinha quando o número entra.

As mensagens saem pela API oficial da Meta através do Coexy (texto, mídia, contato e modelos aprovados), e as respostas dos clientes, os status de entrega e as respostas dadas pelo app WhatsApp Business entram no Inbox como no canal oficial. Os modelos são gerenciados na sub-aba Modelos.

O Coexy só entrega webhook em endereço HTTPS público. Numa instalação sem domínio o número conecta normalmente e o CRM envia, mas não recebe as respostas até o webhook ser criado. A tela avisa, e o botão Criar webhook refaz o registro quando o domínio estiver configurado.

Quem não liga a variável não vê nada: o canal nasce desligado. A atualização acrescenta as colunas do novo canal no banco e não muda nenhum canal existente.
