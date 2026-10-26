// The words of a piece as a list of boxes. Change any one, press Save: no
// re-prompt, no wait (Daniel, 2026-10-27: "the person can actually edit the
// text themselves easily, especially for small changes").
import { Input } from "@/components/ui/input";
import type { TextField } from "@shared/studio";

export function FieldList({ fields, values, onChange, disabled }: {
  fields: TextField[];
  values: Record<string, string>;
  onChange: (path: string, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="studio-fields">
      {fields.map((f) => {
        const v = values[f.path] ?? f.value;
        return (
          <label key={f.path} className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{f.label}</span>
            {f.multiline ? (
              <textarea
                value={v}
                onChange={(e) => onChange(f.path, e.target.value)}
                disabled={disabled}
                rows={Math.min(8, Math.max(2, Math.ceil(v.length / 60)))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[14px] leading-relaxed text-foreground disabled:opacity-60"
                data-testid={`studio-field-${f.path}`}
              />
            ) : (
              <Input
                value={v}
                onChange={(e) => onChange(f.path, e.target.value)}
                disabled={disabled}
                className={`h-11 md:h-10 text-[14px] ${f.href ? "font-mono text-[12px]" : ""}`}
                data-testid={`studio-field-${f.path}`}
              />
            )}
          </label>
        );
      })}
      {fields.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing to edit here yet.</p>}
    </div>
  );
}
