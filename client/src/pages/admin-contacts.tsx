import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Search, Download, Users, User, X, Filter, ChevronRight } from "lucide-react";

type ContactPerson = {
  id: number;
  personType: "parent" | "player";
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  parentName?: string | null;
  parentId?: number;
};

type ContactsData = {
  parents: ContactPerson[];
  players: ContactPerson[];
  programs: { id: number; name: string }[];
};

function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map(row => headers.map(h => `"${String(row[h] || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminContacts() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "player" | "parent">("all");

  const { data, isLoading } = useQuery<ContactsData>({
    queryKey: ["/api/admin/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/contacts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
  });

  const allPeople = useMemo(() => {
    if (!data) return [];
    let list: ContactPerson[] = [];
    if (typeFilter === "all" || typeFilter === "parent") {
      list = [...list, ...data.parents];
    }
    if (typeFilter === "all" || typeFilter === "player") {
      list = [...list, ...data.players];
    }
    list.sort((a, b) => {
      const firstCmp = a.firstName.localeCompare(b.firstName);
      if (firstCmp !== 0) return firstCmp;
      return a.lastName.localeCompare(b.lastName);
    });
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => {
        const full = `${p.firstName} ${p.lastName}`.toLowerCase();
        const email = (p.email || "").toLowerCase();
        const phone = (p.phone || "").toLowerCase();
        const parent = (p.parentName || "").toLowerCase();
        return full.includes(q) || email.includes(q) || phone.includes(q) || parent.includes(q);
      });
    }
    return list;
  }, [data, typeFilter, searchQuery]);

  const handleExport = () => {
    const rows = allPeople.map(p => ({
      Type: p.personType === "parent" ? "Parent" : "Player",
      FirstName: p.firstName,
      LastName: p.lastName,
      Email: p.email || "",
      Phone: p.phone || "",
      DateOfBirth: p.dateOfBirth || "",
      ...(p.personType === "player" ? { ParentName: p.parentName || "" } : {}),
    }));
    downloadCSV(rows, `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalParents = data?.parents.length || 0;
  const totalPlayers = data?.players.length || 0;

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Contacts</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">
            {totalParents} parent{totalParents !== 1 ? "s" : ""} · {totalPlayers} player{totalPlayers !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="relative">
          <button
            onClick={handleExport}
            disabled={allPeople.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-400/80 font-medium hover:bg-blue-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-export-csv"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-blue-500/[0.1] bg-blue-500/[0.03] text-[13px] text-white/80 placeholder-white/25 outline-none focus:border-blue-500/25 transition-colors"
            data-testid="input-search-contacts"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
              data-testid="button-clear-search"
            >
              <X className="w-3 h-3 text-white/40" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTypeFilter("all")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors cursor-pointer ${typeFilter === "all" ? "bg-blue-500/15 border-blue-500/25 text-blue-400/90" : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04]"}`}
            data-testid="button-filter-all"
          >
            <Filter className="w-3 h-3" /> All
          </button>
          <button
            onClick={() => setTypeFilter("player")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors cursor-pointer ${typeFilter === "player" ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400/90" : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04]"}`}
            data-testid="button-filter-players"
          >
            <User className="w-3 h-3" /> Players
          </button>
          <button
            onClick={() => setTypeFilter("parent")}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors cursor-pointer ${typeFilter === "parent" ? "bg-amber-500/15 border-amber-500/25 text-amber-400/90" : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04]"}`}
            data-testid="button-filter-parents"
          >
            <Users className="w-3 h-3" /> Parents
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl bg-blue-500/[0.04]" />
          ))}
        </div>
      ) : allPeople.length === 0 ? (
        <div className="rounded-xl border border-blue-500/[0.08] bg-blue-500/[0.02] p-8 text-center">
          <Users className="w-8 h-8 text-white/15 mx-auto mb-3" />
          <p className="text-[13px] text-white/25">
            {searchQuery ? `No contacts match "${searchQuery}"` : "No contacts found"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-500/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]" data-testid="table-contacts">
              <thead>
                <tr className="border-b border-blue-500/[0.06] bg-blue-500/[0.03]">
                  <th className="text-left px-4 py-3 text-[10px] text-blue-300/30 uppercase tracking-wider font-semibold">Name</th>
                  <th className="text-left px-4 py-3 text-[10px] text-blue-300/30 uppercase tracking-wider font-semibold hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-[10px] text-blue-300/30 uppercase tracking-wider font-semibold hidden md:table-cell">Email / Parent</th>
                  <th className="text-left px-4 py-3 text-[10px] text-blue-300/30 uppercase tracking-wider font-semibold hidden lg:table-cell">Phone</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {allPeople.map((person) => (
                  <tr
                    key={`${person.personType}-${person.id}`}
                    onClick={() => navigate(`/admin/contacts/${person.personType}/${person.id}`)}
                    className="border-b border-blue-500/[0.04] hover:bg-blue-500/[0.04] transition-colors cursor-pointer"
                    data-testid={`row-contact-${person.personType}-${person.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${person.personType === "player" ? "bg-emerald-500/10 border border-emerald-500/15" : "bg-amber-500/10 border border-amber-500/15"}`}>
                          <span className={`text-[11px] font-semibold ${person.personType === "player" ? "text-emerald-400/60" : "text-amber-400/60"}`}>
                            {person.firstName[0]}{person.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-white/80 truncate">{person.firstName} {person.lastName}</p>
                          <p className="text-[11px] text-white/25 truncate sm:hidden">
                            {person.personType === "player" ? "Player" : "Parent"}
                            {person.personType === "player" && person.parentName ? ` · ${person.parentName}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge variant="outline" className={`text-[9px] uppercase tracking-wider ${person.personType === "player" ? "text-emerald-400/70 border-emerald-500/20 bg-emerald-500/8" : "text-amber-400/70 border-amber-500/20 bg-amber-500/8"}`}>
                        {person.personType === "player" ? "Player" : "Parent"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-[12px] text-white/50 truncate block max-w-[200px]">
                        {person.personType === "parent" ? (person.email || "—") : (person.parentName || "—")}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[12px] text-white/45">{person.phone || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-3.5 h-3.5 text-white/15" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-blue-500/[0.03] border-t border-blue-500/[0.06]">
            <span className="text-[11px] text-white/30">
              Showing {allPeople.length} contact{allPeople.length !== 1 ? "s" : ""}
              {searchQuery || typeFilter !== "all" ? " (filtered)" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
