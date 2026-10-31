# 10 — Tema lilás e vidro

> Substitui a Sage (`02-palette-sage.md`) como paleta padrão do produto. Os
> valores vivem em `app/globals.css` (`:root`, `[data-theme="light"]`,
> `[data-theme="dark"]`); este documento explica as escolhas, não repete os hex.

## Paleta

- **Accent lilás.** A rampa de 11 paradas foi gerada por `rampaDeSemente("#7351e3")`
  (`lib/branding/rampa.ts`), o mesmo gerador que deriva a rampa da marca de um
  revendedor. A catraca `tests/unit/branding-rampa.test.ts` garante que produto e
  marca própria saem da mesma régua.
- **Neutros lavanda** no claro e fundo quase preto arroxeado no escuro, desenhados
  separadamente (não invertidos).
- **Semânticas.** `info` passou de azul para ciano: o azul colidia com o lilás sob
  dicromacia e fazia a própria semente do produto disparar a reconciliação de
  `lib/branding/contraste.ts`. Com o ciano, o produto sem marca não desloca nada.
- **Contraste.** Todos os pares continuam acima dos pisos de
  `tests/unit/branding-contraste.test.ts`; a régua congelada
  (`lib/branding/regua-do-produto.ts`) foi regenerada a partir do CSS.

## Vidro, cantos e sombras

- `glass` e `glass-strong` (utilitários em `app/globals.css`) usam os tokens
  `--glass-bg`, `--glass-bg-strong`, `--glass-border` e `--glass-highlight`.
  A régua de contraste continua medindo contra os hex de superfície; o vidro só
  deixa ver o fundo.
- A luz de fundo (`--bg-glow-1..3`) é imagem no `body`, fixa na janela. A cor de
  fundo continua sendo `--color-bg`.
- Raios maiores (`--radius-sm` 8px → `--radius-xl` 24px) e sombras tingidas de
  lilás valem para o sistema inteiro, sem tocar componente por componente.
- Tema padrão: sem preferência salva, o claro (lilás). "Seguir o sistema" é uma
  escolha explícita no seletor.

## Casca e Dashboard

- A barra lateral é um painel de vidro; o item ativo é uma pílula em degradê do
  accent. O Dashboard fica fixo no alto (a porta vem do catálogo, filtrada por
  `destinosDaInterface`), a Ajuda virou ícone ao lado de Configurações e o
  cartão do usuário ocupa o rodapé. O menu continua cabendo sem rolar em
  1280×900 (`tests/e2e/navegacao.spec.ts`); a conta está no comentário do rodapé
  em `components/shell/Sidebar.tsx`.
- A barra do topo continua medindo `h-14`: Inbox, Casos e o quadro do pipeline
  descontam `3.5rem` na própria altura.
- O Dashboard (`app/app/dashboard`) lê com a sessão (RLS) e filtra
  `organization_id`; a conta é `lib/dashboard/resumo.ts`.

## Evidência

Capturas de uma página de prévia com a casca real e dados fictícios, em 31/10/2026:

- Claro, 1440px: `evidence/redesign-lilas/light-1440.png`
- Escuro, 1440px: `evidence/redesign-lilas/dark-1440.png`
- Celular, 390px: `evidence/redesign-lilas/celular-390.png`
