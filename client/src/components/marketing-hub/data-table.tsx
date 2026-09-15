import type { ReactNode } from "react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Wraps shadcn's Table in an overflow-x-auto container, so a wide table
 *  scrolls inside itself rather than pushing the whole page wider than a
 *  phone screen. */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <Table>{children}</Table>
    </div>
  );
}

/** A numeric cell class: right-aligned, tabular figures. */
export const numCell = cn("text-right tabular-nums");
