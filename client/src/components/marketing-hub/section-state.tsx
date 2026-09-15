import { AlertCircle, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The four states every marketing-hub data block can be in. Never collapse
 * "unavailable" into a rendered zero — see revenue-widget.tsx's note on why.
 */

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" data-testid="marketing-hub-loading">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function LoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
      data-testid="marketing-hub-error"
    >
      <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Couldn't load this</p>
        <p className="text-xs text-muted-foreground mt-1 break-words">
          {(error as Error)?.message ?? "Something went wrong."}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium text-primary hover:underline mt-2"
          data-testid="button-retry-marketing-hub"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function Unavailable({ title, body }: { title: string; body?: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="marketing-hub-unavailable"
    >
      <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>}
      </div>
    </div>
  );
}
