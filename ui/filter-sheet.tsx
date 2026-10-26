// The page's filters (project, bot, kind). Inline on a desktop; on a phone they
// sit behind one Filter button that opens a bottom sheet.
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { ResponsiveDrawerShell } from "@/components/ui/responsive-overlay";

export function Filters({ active, onClear, children }: { active: number; onClear: () => void; children: ReactNode }) {
  const compact = useIsCompactViewport();
  const [open, setOpen] = useState(false);
  if (!compact) return <>{children}</>;
  return (
    <>
      <Button
        variant={active > 0 ? "secondary" : "outline"}
        className="h-11"
        aria-label={active > 0 ? `Filter, ${active} on` : "Filter"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="human-tasks/filter" className="size-4" />
        Filter
        {active > 0 ? <span className="tabular-nums text-muted-foreground">{active}</span> : null}
      </Button>
      <ResponsiveDrawerShell open={open} onOpenChange={setOpen} srLabel="Filters">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-sm font-medium">Filters</p>
          {children}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="h-11 flex-1" disabled={active === 0} onClick={onClear}>
              Clear filters
            </Button>
            <Button className="h-11 flex-1" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </ResponsiveDrawerShell>
    </>
  );
}
