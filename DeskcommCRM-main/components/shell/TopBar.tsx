"use client";
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

/**
 * A barra do topo do redesign lilás: uma pílula de vidro grudada no alto, com a
 * busca à esquerda e os controles redondos à direita (avisos, sino, idioma,
 * tema).
 *
 * ⚠️ A ALTURA TOTAL CONTINUA `h-14` (3,5rem). O Inbox, os Casos e o quadro do
 * pipeline descontam exatamente `3.5rem` no `calc()` da própria altura
 * (`components/inbox/InboxLayout.tsx`, `app/app/ai/cases/page.tsx`,
 * `app/app/pipelines/[id]/_client.tsx`). A pílula mora DENTRO dos 56px — o
 * respiro em volta dela é padding do `<header>`, não altura a mais.
 *
 * Quem a pessoa é aparece no CARTÃO do rodapé da barra lateral (`UserMenu
 * variante="cartao"`); aqui o avatar só existe abaixo de `md`, onde a barra
 * lateral vira gaveta e o cartão deixa de estar sempre à vista.
 */
export function TopBar() {
  return (
    <header className="sticky top-[var(--faixas-de-cima,0px)] z-20 flex h-14 items-center px-3 md:px-6">
      <div className="flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl glass-strong px-1.5 md:gap-4 md:px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MobileSidebar />
          <TenantSwitcher />
          <div className="flex min-w-0 flex-1 md:max-w-xl">
            <SearchTrigger />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <AvisoDePropostaEmDestaque />
          <AlertsBell />
          <UserMenu variante="controles" />
        </div>
      </div>
    </header>
  );
}
