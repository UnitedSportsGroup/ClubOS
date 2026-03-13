import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ClipboardCheck, Search, ChevronDown, ChevronUp, User, Phone, Mail,
  MapPin, Calendar, Clock, Baby, CreditCard, Pencil, X, Plus, Trash2, Check, Save,
} from "lucide-react";

type RegItem = {
  id: number;
  childId: number;
  campDateId: number;
  productType: string;
  child?: { id: number; firstName: string; lastName: string; dateOfBirth?: string; gender?: string };
  campDate?: { id: number; date: string; campId: number };
};

type RegChild = {
  id: number;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: string;
};

type Registration = {
  id: number;
  programId: number;
  contactId: number;
  status: string;
  subtotalCents: number | null;
  discountCents: number | null;
  totalCents: number | null;
  registeredAt: string;
  registrationLocation?: string | null;
  contact?: { firstName: string; lastName: string; email?: string; phone?: string; address?: string; emergencyContact?: string; emergencyPhone?: string };
  program?: { id: number; name: string };
  items?: RegItem[];
  children?: RegChild[];
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}

function formatProductType(pt: string) {
  if (pt === "FULL_DAY" || pt === "full_day") return "Full Day";
  if (pt === "MORNING" || pt === "morning") return "Morning";
  if (pt === "AFTERNOON" || pt === "afternoon") return "Afternoon";
  return pt;
}

function calcAge(dob: string | undefined | null) {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

type CampDateOption = { id: number; date: string };

type EditItem = { childId: number; campDateId: number; productType: string };

function EditRegistrationModal({
  reg,
  onClose,
}: {
  reg: Registration;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const grouped = reg.items ? itemsByChild(reg.items) : [];

  const { data: campDates, isLoading: datesLoading } = useQuery<CampDateOption[]>({
    queryKey: ["/api/admin/camps", reg.programId, "dates"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${reg.programId}/dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dates");
      return res.json();
    },
  });

  const [editItems, setEditItems] = useState<EditItem[]>(() =>
    (reg.items || []).map(i => ({ childId: i.childId, campDateId: i.campDateId, productType: i.productType }))
  );

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/admin/registrations/${reg.id}/items`, { items: editItems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
      toast({ title: "Registration updated" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const childIds = [...new Set(grouped.map(g => g.child?.id).filter(Boolean))] as number[];

  const addSession = (childId: number) => {
    if (!campDates || campDates.length === 0) return;
    setEditItems(prev => [...prev, { childId, campDateId: campDates[0].id, productType: "FULL_DAY" }]);
  };

  const removeSession = (index: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateSession = (index: number, field: keyof EditItem, value: any) => {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: field === "campDateId" ? parseInt(value) : value } : item));
  };

  const itemsByChildForEdit = (childId: number) => editItems
    .map((item, idx) => ({ ...item, idx }))
    .filter(item => item.childId === childId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0a0e1a] border border-blue-500/15 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="modal-edit-registration">
        <div className="flex items-center justify-between px-6 py-4 border-b border-blue-500/10">
          <h2 className="text-[15px] font-semibold text-white/80">Edit Sessions — #{reg.id}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer" data-testid="button-close-edit-modal">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {datesLoading ? (
            <Skeleton className="h-20 w-full rounded-xl bg-blue-500/[0.04]" />
          ) : (
            childIds.map(childId => {
              const childInfo = grouped.find(g => g.child?.id === childId)?.child;
              const childItems = itemsByChildForEdit(childId);
              return (
                <div key={childId} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <span className="text-[10px] text-blue-400 font-semibold">{childInfo?.firstName?.[0]}{childInfo?.lastName?.[0]}</span>
                      </div>
                      <span className="text-[13px] text-white/70 font-medium">{childInfo?.firstName} {childInfo?.lastName}</span>
                    </div>
                    <button
                      onClick={() => addSession(childId)}
                      className="flex items-center gap-1 text-[11px] text-blue-400/70 hover:text-blue-400 transition-colors cursor-pointer"
                      data-testid={`button-add-session-${childId}`}
                    >
                      <Plus className="w-3 h-3" /> Add Session
                    </button>
                  </div>

                  <div className="space-y-2 ml-8">
                    {childItems.map(item => (
                      <div key={item.idx} className="flex items-center gap-2" data-testid={`edit-item-${item.idx}`}>
                        <select
                          value={item.campDateId}
                          onChange={e => updateSession(item.idx, "campDateId", e.target.value)}
                          className="flex-1 h-8 px-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[12px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
                          data-testid={`select-date-${item.idx}`}
                        >
                          {campDates?.map(d => (
                            <option key={d.id} value={d.id}>{formatDate(d.date)}</option>
                          ))}
                        </select>
                        <select
                          value={item.productType}
                          onChange={e => updateSession(item.idx, "productType", e.target.value)}
                          className="w-32 h-8 px-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[12px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
                          data-testid={`select-type-${item.idx}`}
                        >
                          <option value="FULL_DAY">Full Day</option>
                          <option value="MORNING">Morning</option>
                          <option value="AFTERNOON">Afternoon</option>
                        </select>
                        <button
                          onClick={() => removeSession(item.idx)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer flex-shrink-0"
                          data-testid={`button-remove-session-${item.idx}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-white/20 hover:text-red-400" />
                        </button>
                      </div>
                    ))}
                    {childItems.length === 0 && (
                      <p className="text-[11px] text-white/20 italic">No sessions — click "Add Session" above</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-blue-500/10">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-9 text-[13px] border-white/10 text-white/50 hover:bg-white/5" data-testid="button-cancel-edit">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || editItems.length === 0}
            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn"
            data-testid="button-save-edit"
          >
            <Save className="w-4 h-4 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function itemsByChild(items: RegItem[]) {
  const map = new Map<number, { child: RegItem["child"]; sessions: { date: string; productType: string; campDateId: number }[] }>();
  items.forEach(item => {
    if (!map.has(item.childId)) {
      map.set(item.childId, { child: item.child, sessions: [] });
    }
    map.get(item.childId)!.sessions.push({
      date: item.campDate?.date || "",
      productType: item.productType,
      campDateId: item.campDateId,
    });
  });
  map.forEach(v => v.sessions.sort((a, b) => a.date.localeCompare(b.date)));
  return [...map.values()];
}

export default function AdminRegistrations() {
  const { toast } = useToast();
  const { data: camps } = useQuery<any[]>({ queryKey: ["/api/admin/camps"] });
  const [selectedCamp, setSelectedCamp] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterDay, setFilterDay] = useState<string>("");
  const [filterSession, setFilterSession] = useState<string>("");

  const { data: registrations, isLoading } = useQuery<Registration[]>({
    queryKey: ["/api/admin/registrations", selectedCamp],
    queryFn: async () => {
      const url = selectedCamp ? `/api/admin/registrations?campId=${selectedCamp}` : "/api/admin/registrations";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const allDates = useMemo(() => {
    if (!registrations) return [];
    const dateMap = new Map<number, { id: number; date: string }>();
    registrations.forEach(r => {
      r.items?.forEach(item => {
        if (item.campDate && !dateMap.has(item.campDate.id)) {
          dateMap.set(item.campDate.id, { id: item.campDate.id, date: item.campDate.date });
        }
      });
    });
    return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [registrations]);

  const filtered = useMemo(() => {
    if (!registrations) return [];
    let list = [...registrations];

    list.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(r =>
        r.contact?.firstName?.toLowerCase().includes(s) ||
        r.contact?.lastName?.toLowerCase().includes(s) ||
        r.contact?.email?.toLowerCase().includes(s) ||
        String(r.id).includes(s) ||
        r.children?.some(c => c.firstName.toLowerCase().includes(s) || c.lastName.toLowerCase().includes(s))
      );
    }

    if (filterDay) {
      const dayId = parseInt(filterDay);
      list = list.filter(r => r.items?.some(item => item.campDateId === dayId));
    }

    if (filterSession) {
      const ft = filterSession.toUpperCase();
      list = list.filter(r => r.items?.some(item => item.productType.toUpperCase() === ft));
    }

    return list;
  }, [registrations, searchTerm, filterDay, filterSession]);

  const statusColors: Record<string, string> = {
    pending: "text-amber-400/70 bg-amber-500/10 border-amber-500/15",
    confirmed: "text-emerald-400/70 bg-emerald-500/10 border-emerald-500/15",
    paid: "text-emerald-400/70 bg-emerald-500/10 border-emerald-500/15",
    cancelled: "text-red-400/70 bg-red-500/10 border-red-500/15",
    refunded: "text-purple-400/70 bg-purple-500/10 border-purple-500/15",
  };

  const [editingReg, setEditingReg] = useState<Registration | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const deleteRegMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/registrations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
      setDeleteConfirmId(null);
      setExpandedId(null);
      toast({ title: "Registration deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Registrations</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">View and manage bookings</p>
      </div>

      <div className="flex gap-3 flex-wrap animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        <select
          value={selectedCamp}
          onChange={e => { setSelectedCamp(e.target.value); setFilterDay(""); }}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          data-testid="select-camp-filter"
        >
          <option value="">All Camps</option>
          {camps?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select
          value={filterDay}
          onChange={e => setFilterDay(e.target.value)}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          data-testid="select-day-filter"
        >
          <option value="">All Days</option>
          {allDates.map(d => <option key={d.id} value={d.id}>{formatDate(d.date)}</option>)}
        </select>

        <select
          value={filterSession}
          onChange={e => setFilterSession(e.target.value)}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          data-testid="select-session-filter"
        >
          <option value="">All Sessions</option>
          <option value="MORNING">Morning</option>
          <option value="AFTERNOON">Afternoon</option>
          <option value="FULL_DAY">Full Day</option>
        </select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
          <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search by name or email..." className="pl-10 premium-input text-white/80 rounded-xl h-9" data-testid="input-search-registrations" />
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl bg-blue-500/[0.04]" />)}
          </div>
        ) : filtered && filtered.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {filtered.map((reg) => {
              const grouped = reg.items ? itemsByChild(reg.items) : [];
              return (
                <div key={reg.id}>
                  <div
                    className="flex items-center gap-4 px-5 py-3 row-hover cursor-pointer"
                    onClick={() => setExpandedId(expandedId === reg.id ? null : reg.id)}
                    data-testid={`row-registration-${reg.id}`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                      <ClipboardCheck className="w-4 h-4 text-blue-400/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white/75" data-testid={`text-reg-name-${reg.id}`}>
                        #{reg.id} — {reg.contact?.firstName} {reg.contact?.lastName}
                      </p>
                      <p className="text-[11px] text-white/25">
                        {reg.program?.name || `Camp #${reg.programId}`}
                        {reg.items?.length ? ` · ${reg.items.length} session${reg.items.length !== 1 ? "s" : ""}` : ""}
                        {" · "}
                        {new Date(reg.registeredAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-medium text-white/60" data-testid={`text-reg-total-${reg.id}`}>
                        ${((reg.totalCents || 0) / 100).toFixed(2)}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-md border uppercase tracking-wider ${statusColors[reg.status] || statusColors.pending}`} data-testid={`badge-reg-status-${reg.id}`}>
                        {reg.status}
                      </span>
                      {expandedId === reg.id ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
                    </div>
                  </div>

                  {expandedId === reg.id && (
                    <div className="px-5 pb-4 space-y-3 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-3">
                          <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Parent / Guardian</p>
                          <div className="flex items-center gap-3">
                            <User className="w-4 h-4 text-white/20 flex-shrink-0" />
                            <span className="text-[13px] text-white/60" data-testid={`text-reg-parent-${reg.id}`}>{reg.contact?.firstName} {reg.contact?.lastName}</span>
                          </div>
                          {reg.contact?.email && (
                            <div className="flex items-center gap-3">
                              <Mail className="w-4 h-4 text-white/20 flex-shrink-0" />
                              <a href={`mailto:${reg.contact.email}`} className="text-[13px] text-blue-400/60 hover:text-blue-400 truncate" data-testid={`text-reg-email-${reg.id}`}>{reg.contact.email}</a>
                            </div>
                          )}
                          {reg.contact?.phone && (
                            <div className="flex items-center gap-3">
                              <Phone className="w-4 h-4 text-white/20 flex-shrink-0" />
                              <a href={`tel:${reg.contact.phone}`} className="text-[13px] text-blue-400/60 hover:text-blue-400" data-testid={`text-reg-phone-${reg.id}`}>{reg.contact.phone}</a>
                            </div>
                          )}
                          {reg.contact?.emergencyContact && (
                            <div className="flex items-center gap-3 pt-1 border-t border-white/[0.04]">
                              <Phone className="w-4 h-4 text-amber-400/30 flex-shrink-0" />
                              <span className="text-[12px] text-white/40">Emergency: {reg.contact.emergencyContact} {reg.contact.emergencyPhone ? `(${reg.contact.emergencyPhone})` : ""}</span>
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-3">
                          <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                            <CreditCard className="w-3 h-3" /> Pricing
                          </p>
                          <div className="space-y-1">
                            <p className="text-[12px] text-white/40">Subtotal: ${((reg.subtotalCents || 0) / 100).toFixed(2)}</p>
                            {(reg.discountCents || 0) > 0 && <p className="text-[12px] text-emerald-400/60">Discount: -${((reg.discountCents || 0) / 100).toFixed(2)}</p>}
                            <p className="text-[13px] text-white/70 font-medium">Total: ${((reg.totalCents || 0) / 100).toFixed(2)}</p>
                          </div>
                          <div className="pt-1 border-t border-white/[0.04] flex items-center justify-between">
                            <p className="text-[11px] text-white/25">
                              Registered: {new Date(reg.registeredAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                            {reg.registrationLocation && (
                              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${
                                reg.registrationLocation === "cufc_office"
                                  ? "border-amber-500/25 text-amber-400/70 bg-amber-500/5"
                                  : "border-sky-500/25 text-sky-400/70 bg-sky-500/5"
                              }`} data-testid={`badge-source-${reg.id}`}>
                                {reg.registrationLocation === "cufc_office" ? "CUFC Office" : "Online"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {grouped.length > 0 && (
                        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                              <Baby className="w-3 h-3" /> Children & Sessions
                            </p>
                            <button
                              onClick={e => { e.stopPropagation(); setEditingReg(reg); }}
                              className="flex items-center gap-1 text-[11px] text-blue-400/60 hover:text-blue-400 transition-colors cursor-pointer"
                              data-testid={`button-edit-registration-${reg.id}`}
                            >
                              <Pencil className="w-3 h-3" /> Edit
                            </button>
                          </div>
                          {grouped.map((g, gi) => (
                            <div key={gi} className={gi > 0 ? "pt-3 border-t border-white/[0.04]" : ""}>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                  <span className="text-[10px] text-blue-400 font-semibold">{g.child?.firstName?.[0]}{g.child?.lastName?.[0]}</span>
                                </div>
                                <span className="text-[13px] text-white/70 font-medium" data-testid={`text-reg-child-${reg.id}-${gi}`}>
                                  {g.child?.firstName} {g.child?.lastName}
                                </span>
                                {g.child?.dateOfBirth && (
                                  <span className="text-[11px] text-white/25 ml-1">
                                    (Age {calcAge(g.child.dateOfBirth)})
                                  </span>
                                )}
                              </div>
                              <div className="ml-8 space-y-1">
                                {g.sessions.map((s, si) => (
                                  <div key={si} className="flex items-center gap-2 text-[12px]">
                                    <Calendar className="w-3 h-3 text-white/15" />
                                    <span className="text-white/35">{reg.program?.name}</span>
                                    <span className="text-white/15">—</span>
                                    <span className="text-white/45">{formatDate(s.date)}</span>
                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${
                                      s.productType.toUpperCase() === "FULL_DAY"
                                        ? "border-blue-500/20 text-blue-400/70 bg-blue-500/5"
                                        : s.productType.toUpperCase() === "MORNING"
                                        ? "border-amber-500/20 text-amber-400/70 bg-amber-500/5"
                                        : "border-purple-500/20 text-purple-400/70 bg-purple-500/5"
                                    }`} data-testid={`badge-session-${reg.id}-${gi}-${si}`}>
                                      {formatProductType(s.productType)}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {reg.children && reg.children.length > 0 && grouped.length === 0 && (
                        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2">
                          <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Children</p>
                          {reg.children.map(c => (
                            <div key={c.id} className="flex items-center gap-2 text-[13px] text-white/50">
                              <Baby className="w-3.5 h-3.5 text-white/20" />
                              {c.firstName} {c.lastName}
                              {c.dateOfBirth && <span className="text-[11px] text-white/25">(Age {calcAge(c.dateOfBirth)})</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex justify-end pt-1">
                        {deleteConfirmId === reg.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-red-400/70">Delete this registration and all session bookings?</span>
                            <Button
                              variant="outline"
                              onClick={e => { e.stopPropagation(); setDeleteConfirmId(null); }}
                              className="rounded-xl h-7 text-[11px] border-white/10 text-white/50 hover:bg-white/5 px-3"
                              data-testid={`button-cancel-delete-reg-${reg.id}`}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={e => { e.stopPropagation(); deleteRegMutation.mutate(reg.id); }}
                              disabled={deleteRegMutation.isPending}
                              className="rounded-xl h-7 text-[11px] bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 px-3"
                              data-testid={`button-confirm-delete-reg-${reg.id}`}
                            >
                              {deleteRegMutation.isPending ? "Deleting..." : "Yes, Delete"}
                            </Button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteConfirmId(reg.id); }}
                            className="flex items-center gap-1 text-[11px] text-red-400/50 hover:text-red-400 transition-colors cursor-pointer"
                            data-testid={`button-delete-reg-${reg.id}`}
                          >
                            <Trash2 className="w-3 h-3" /> Delete Registration
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardCheck className="w-12 h-12 text-blue-400/10 mb-4" />
            <h3 className="text-[15px] font-medium text-white/40 mb-1">No registrations</h3>
            <p className="text-[12px] text-white/20">Bookings will appear here once parents register</p>
          </div>
        )}
      </div>

      {filtered && filtered.length > 0 && (
        <p className="text-[11px] text-white/20 text-center">
          Showing {filtered.length} of {registrations?.length || 0} registration{(registrations?.length || 0) !== 1 ? "s" : ""}
        </p>
      )}

      {editingReg && (
        <EditRegistrationModal reg={editingReg} onClose={() => setEditingReg(null)} />
      )}
    </div>
  );
}
