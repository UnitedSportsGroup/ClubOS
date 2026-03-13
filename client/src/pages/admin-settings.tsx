import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, Users, Settings, Plus, Trash2, X, Shield, ShieldCheck, UserCog } from "lucide-react";

type UserAccount = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  team_member: "Team Member",
  manager: "Manager",
  coach: "Coach",
  finance: "Finance",
  marketing: "Marketing",
  registrar: "Registrar",
};

const ROLE_OPTIONS = ["super_admin", "admin", "team_member"];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "border-amber-500/25 text-amber-400/80 bg-amber-500/10",
  admin: "border-blue-500/25 text-blue-400/80 bg-blue-500/10",
  team_member: "border-white/15 text-white/50 bg-white/5",
  manager: "border-purple-500/25 text-purple-400/80 bg-purple-500/10",
  coach: "border-green-500/25 text-green-400/80 bg-green-500/10",
  finance: "border-emerald-500/25 text-emerald-400/80 bg-emerald-500/10",
  marketing: "border-pink-500/25 text-pink-400/80 bg-pink-500/10",
  registrar: "border-cyan-500/25 text-cyan-400/80 bg-cyan-500/10",
};

function GeneralTab() {
  const { data: settingsData, isLoading } = useQuery<Record<string, string>>({ queryKey: ["/api/admin/settings"] });
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settingsData && !loaded) {
      setValues(settingsData);
      setLoaded(true);
    }
  }, [settingsData, loaded]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/settings", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fields = [
    { key: "club_name", label: "Club Name" },
    { key: "club_short_name", label: "Short Name" },
    { key: "club_email", label: "Club Email" },
    { key: "club_phone", label: "Club Phone" },
    { key: "club_website", label: "Website" },
    { key: "club_address", label: "Address" },
    { key: "club_timezone", label: "Timezone" },
  ];

  return (
    <div className="rounded-2xl glass-card p-6 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl bg-blue-500/[0.04]" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">{f.label}</label>
              <Input
                value={values[f.key] || ""}
                onChange={e => setValues({ ...values, [f.key]: e.target.value })}
                className="premium-input text-white/80 rounded-xl"
                data-testid={`input-${f.key}`}
              />
            </div>
          ))}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-save-settings">
            <Save className="w-4 h-4 mr-1.5" /> Save Settings
          </Button>
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const { data: currentUser } = useQuery<{ id: number; role: string }>({ queryKey: ["/api/auth/me"] });
  const { data: allUsers, isLoading } = useQuery<UserAccount[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) throw new Error("Super Admin access required");
        throw new Error("Failed to load users");
      }
      return res.json();
    },
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => apiRequest("PATCH", `/api/admin/users/${id}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteConfirm(null);
      toast({ title: "User deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (currentUser?.role !== "super_admin") {
    return (
      <div className="rounded-2xl glass-card p-8 text-center animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        <Shield className="w-10 h-10 text-white/10 mx-auto mb-3" />
        <p className="text-[13px] text-white/40">Super Admin access required to manage users</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-white/40">{allUsers?.length || 0} staff account{(allUsers?.length || 0) !== 1 ? "s" : ""}</p>
        <Button
          onClick={() => setShowAddModal(true)}
          className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn"
          data-testid="button-add-user"
        >
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl bg-blue-500/[0.04]" />)}
          </div>
        ) : allUsers && allUsers.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {allUsers.map(user => (
              <div key={user.id} className="flex items-center gap-4 px-5 py-3.5" data-testid={`row-user-${user.id}`}>
                <div className="w-9 h-9 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                  {user.role === "super_admin" ? (
                    <ShieldCheck className="w-4 h-4 text-amber-400/70" />
                  ) : user.role === "admin" ? (
                    <UserCog className="w-4 h-4 text-blue-400/70" />
                  ) : (
                    <Users className="w-4 h-4 text-white/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/75 truncate" data-testid={`text-user-name-${user.id}`}>
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-[11px] text-white/25 truncate">{user.email}</p>
                </div>
                <select
                  value={user.role}
                  onChange={e => updateRoleMutation.mutate({ id: user.id, role: e.target.value })}
                  disabled={user.id === currentUser?.id}
                  className="h-8 px-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[12px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid={`select-role-${user.id}`}
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0.5 ${ROLE_COLORS[user.role] || ROLE_COLORS.team_member}`} data-testid={`badge-role-${user.id}`}>
                  {ROLE_LABELS[user.role] || user.role}
                </Badge>
                {user.id !== currentUser?.id ? (
                  deleteConfirm === user.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(user.id)}
                        className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                        data-testid={`button-confirm-delete-user-${user.id}`}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                        data-testid={`button-cancel-delete-user-${user.id}`}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(user.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer"
                      data-testid={`button-delete-user-${user.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-white/20 hover:text-red-400" />
                    </button>
                  )
                ) : (
                  <span className="text-[10px] text-white/15 italic w-7 text-center">You</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-white/25 text-center py-8">No users found</p>
        )}
      </div>

      {showAddModal && <AddUserModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", role: "team_member" });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/users", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = form.firstName && form.lastName && form.email && form.password;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0a0e1a] border border-blue-500/15 rounded-2xl w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="modal-add-user">
        <div className="flex items-center justify-between px-6 py-4 border-b border-blue-500/10">
          <h2 className="text-[15px] font-semibold text-white/80">Add New User</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer" data-testid="button-close-add-user">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">First Name</label>
              <Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} className="premium-input text-white/80 rounded-xl" data-testid="input-new-first-name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Last Name</label>
              <Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className="premium-input text-white/80 rounded-xl" data-testid="input-new-last-name" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Email</label>
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="premium-input text-white/80 rounded-xl" data-testid="input-new-email" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Password</label>
            <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="premium-input text-white/80 rounded-xl" data-testid="input-new-password" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Role</label>
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
              data-testid="select-new-role"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-blue-500/10">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-9 text-[13px] border-white/10 text-white/50 hover:bg-white/5" data-testid="button-cancel-add-user">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn"
            data-testid="button-save-new-user"
          >
            {createMutation.isPending ? "Creating..." : "Create User"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSettings() {
  const [tab, setTab] = useState<"general" | "users">("general");
  const { data: currentUser } = useQuery<{ id: number; role: string }>({ queryKey: ["/api/auth/me"] });

  const tabs = [
    { key: "general" as const, label: "General", icon: Settings },
    ...(currentUser?.role === "super_admin" ? [{ key: "users" as const, label: "Users", icon: Users }] : []),
  ];

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">Club and system configuration</p>
      </div>

      <div className="flex gap-1 bg-white/[0.02] rounded-xl p-1 w-fit animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
              tab === t.key
                ? "bg-blue-500/15 text-blue-400 border border-blue-500/25 shadow-[0_0_12px_rgba(3,86,197,0.1)]"
                : "text-white/35 hover:text-white/50 border border-transparent"
            }`}
            data-testid={`tab-${t.key}`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && <GeneralTab />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}
