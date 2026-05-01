import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Plus, Search, Shield, Pencil, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function VenuePeople() {
  const [search, setSearch] = useState("");

  const { data: user } = useQuery<{ id: number; firstName: string; lastName: string; role: string; email: string }>({ queryKey: ["/api/auth/me"] });
  const { data: allUsers = [] } = useQuery<any[]>({ queryKey: ["/api/admin/users"] });

  const filtered = allUsers.filter(u => {
    const q = search.toLowerCase();
    return !q || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const totalUsers = allUsers.length;
  const activeUsers = allUsers.filter(u => u.active !== false).length;
  const admins = allUsers.filter(u => u.role === "admin" || u.role === "super_admin").length;
  const staff = allUsers.filter(u => u.role !== "admin" && u.role !== "super_admin").length;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-white/40" />
            <div>
              <h1 className="text-2xl font-bold text-white" data-testid="text-venue-people-title">People & Access</h1>
              <p className="text-sm text-white/40">Manage staff users and access roles</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-white/50 border border-white/10" data-testid="button-role-guide">
            <Shield className="w-4 h-4 mr-1" /> Role Guide
          </Button>
          <Button className="bg-white/10 hover:bg-white/15 text-white border border-white/10" data-testid="button-add-user">
            <Plus className="w-4 h-4 mr-1" /> Add User
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: totalUsers, color: "" },
          { label: "Active", value: activeUsers, color: "text-green-400" },
          { label: "Admins", value: admins, color: "" },
          { label: "Staff", value: staff, color: "" },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-4">
            <p className="text-xs text-white/40">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color || "text-white"}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, username, or role..."
          className="bg-white/5 border-white/10 text-white pl-10"
          data-testid="input-search-people"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((u: any) => (
          <div key={u.id} className="rounded-xl border border-blue-500/10 bg-white/[0.02] p-4 flex items-center justify-between" data-testid={`people-row-${u.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white/30" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{u.firstName} {u.lastName}</p>
                <p className="text-xs text-white/30">@{u.email.split("@")[0]}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/40 capitalize">{u.role.replace(/_/g, " ")}</span>
              <button className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5">
                <Link2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-white/20 text-sm">No users found</div>
        )}
      </div>
    </div>
  );
}
