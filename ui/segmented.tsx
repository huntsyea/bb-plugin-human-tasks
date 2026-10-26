// One choice from a few, as a radio group, in two looks that don't read as the
// same control: quiet pills for a scope (To do / Finished, the phone Board's
// column), and an outlined icon toggle for the List | Board view.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  look = "pills",
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number; icon?: string }[];
  /** `pills` for a scope; `toggle` for the view, icons only on a phone. */
  look?: "pills" | "toggle";
  className?: string;
}) {
  const toggle = look === "toggle";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center", toggle ? "gap-0.5 rounded-lg border border-border p-0.5" : "gap-1", className)}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={toggle ? option.label : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:min-h-11",
              toggle ? "h-6 px-2 max-md:min-w-11" : "h-7 px-2.5",
              selected ? "bg-state-active font-medium text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
          >
            {option.icon ? <Icon name={option.icon} className="size-3.5 shrink-0" /> : null}
            <span className={toggle ? "max-md:sr-only" : undefined}>{option.label}</span>
            {option.count !== undefined ? " " : null}
            {option.count !== undefined ? <span className="tabular-nums font-normal text-subtle-foreground">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
