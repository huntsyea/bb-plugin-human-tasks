// A small segmented control: one choice from a few, as a radio group. Used for
// the List | Board toggle and the Board's column switcher on a phone.
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg bg-muted p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md px-3 py-1 text-sm transition-colors max-md:min-h-11",
            value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          {option.count !== undefined ? " " : null}
          {option.count !== undefined ? <span className="ml-1.5 tabular-nums text-muted-foreground">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
