// The page's filters (project, bot, kind) behind one Filter button. It is bb's
// own menu, so a desktop gets a popover and a phone gets a bottom sheet. On a
// desktop, the filters that are on also sit beside the button as chips that
// clear with one click.
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface FilterGroup {
  /** "Project", "Bot", "Kind". */
  label: string;
  /** The chosen item's id, or `all`. */
  value: string;
  all: string;
  onChange: (value: string) => void;
  items: { id: string; name: string; count: number }[];
}

export function FilterMenu({ groups, onClear }: { groups: FilterGroup[]; onClear: () => void }) {
  const active = groups.filter((group) => group.value !== group.all).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1.5 px-2 text-sm font-normal max-md:h-11 max-md:px-3", active > 0 ? "text-foreground" : "text-muted-foreground")}
          aria-label={active > 0 ? `Filter, ${active} on` : "Filter"}
        >
          <Icon name="human-tasks/filter" className="size-4" />
          Filter
          {active > 0 ? <span className="rounded bg-state-active px-1 text-xs tabular-nums">{active}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle="Filters" className="w-60 md:max-h-[min(28rem,70vh)] md:overflow-y-auto">
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.label} aria-label={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.id}
                checked={group.value === item.id}
                onCheckedChange={() => group.onChange(group.value === item.id ? group.all : item.id)}
                className="max-md:min-h-11"
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.count > 0 ? <span className="pl-3 tabular-nums text-subtle-foreground">{item.count}</span> : null}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        ))}
        {active > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear} className="max-md:min-h-11">
              <Icon name="human-tasks/x" className="size-4" />
              Clear filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The filters that are on, as chips beside the button. A phone shows only the count on the button. */
export function ActiveFilters({ groups }: { groups: FilterGroup[] }) {
  const compact = useIsCompactViewport();
  if (compact) return null;
  return groups
    .filter((group) => group.value !== group.all)
    .map((group) => {
      const name = group.items.find((item) => item.id === group.value)?.name ?? group.value;
      return (
        <button
          key={group.label}
          type="button"
          aria-label={`Clear the ${group.label.toLowerCase()} filter: ${name}`}
          onClick={() => group.onChange(group.all)}
          className="inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md border border-border pl-2 pr-1.5 text-xs transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="shrink-0 text-subtle-foreground">{group.label}</span>
          <span className="truncate text-foreground">{name}</span>
          <Icon name="human-tasks/x" className="size-3 shrink-0 text-subtle-foreground" />
        </button>
      );
    });
}
