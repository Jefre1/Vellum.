"use client";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { CommandPalette } from "@/components/shell/CommandPalette";

export function SearchTrigger() {
  const t = useT();
  const [open, setOpen] = useState(false);

  // `enableOnFormTags`: o atalho precisa funcionar com o cursor dentro do
  // composer do inbox, que é onde o operador passa o dia.
  useHotkeys("mod+k", () => setOpen(true), { preventDefault: true, enableOnFormTags: true });

  return (
    <>
      {/*
        A pílula de busca do redesign lilás: ocupa a largura que o topo lhe dá
        e abre a mesma paleta (⌘K) de sempre. O rótulo segue na árvore de
        acessibilidade abaixo de `md` (`max-md:sr-only`, nunca `hidden`).
      */}
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-full min-w-0 justify-start gap-2 rounded-full border border-border bg-surface/70 px-4 text-text-subtle shadow-xs hover:bg-surface hover:text-text-muted max-md:w-10 max-md:justify-center max-md:px-0"
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlass size={16} aria-hidden className="shrink-0" />
        <span className="truncate max-md:sr-only">{t("Buscar...")}</span>
        <kbd className="ml-auto hidden shrink-0 rounded-md border bg-surface-elevated px-1.5 py-0.5 text-[10px] md:inline">
          ⌘K
        </kbd>
      </Button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
