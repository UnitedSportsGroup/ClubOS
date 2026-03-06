import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Users, ClipboardCheck, Calendar } from "lucide-react";

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

export default function AdminCRM() {
  const { data: camps } = useQuery<any[]>({ queryKey: ["/api/admin/camps"] });
  const [selectedCamp, setSelectedCamp] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [exportType, setExportType] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const campId = selectedCamp ? parseInt(selectedCamp) : null;
  const { data: dates } = useQuery<any[]>({
    queryKey: ["/api/admin/camps", campId, "dates"],
    queryFn: async () => {
      if (!campId) return [];
      const res = await fetch(`/api/admin/camps/${campId}/dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dates");
      return res.json();
    },
    enabled: !!campId,
  });

  const handleExport = async (type: string) => {
    setLoading(true);
    try {
      let url = `/api/admin/crm/export?type=${type}`;
      if (type === "emails-by-day" && campId && selectedDate) {
        url += `&campId=${campId}&campDateId=${selectedDate}`;
      }
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      downloadCSV(data, `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const exportOptions = [
    {
      id: "emails-by-day",
      title: "Emails by Camp Day",
      description: "Export parent contact details for children registered on a specific camp date",
      icon: Calendar,
      needsDateSelect: true,
    },
    {
      id: "all-parents",
      title: "All Parents",
      description: "Export all parent/guardian contacts in the system",
      icon: Users,
      needsDateSelect: false,
    },
    {
      id: "all-registrations",
      title: "All Registrations",
      description: "Export all registration records with status and pricing",
      icon: ClipboardCheck,
      needsDateSelect: false,
    },
  ];

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">CRM Export</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">Download contact data and registration records</p>
      </div>

      <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {exportOptions.map((opt) => (
          <div key={opt.id} className="rounded-2xl glass-card p-5" data-testid={`card-export-${opt.id}`}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <opt.icon className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h3 className="text-[14px] font-medium text-white/80">{opt.title}</h3>
                  <p className="text-[12px] text-white/30 mt-0.5">{opt.description}</p>
                </div>
                {opt.needsDateSelect && (
                  <div className="flex gap-3 flex-wrap">
                    <select
                      value={selectedCamp}
                      onChange={e => { setSelectedCamp(e.target.value); setSelectedDate(""); }}
                      className="h-8 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
                      data-testid="select-export-camp"
                    >
                      <option value="">Select Camp</option>
                      {camps?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select
                      value={selectedDate}
                      onChange={e => setSelectedDate(e.target.value)}
                      className="h-8 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
                      disabled={!dates}
                      data-testid="select-export-date"
                    >
                      <option value="">Select Date</option>
                      {dates?.map(d => <option key={d.id} value={d.id}>{d.date}</option>)}
                    </select>
                  </div>
                )}
                <Button
                  onClick={() => handleExport(opt.id)}
                  disabled={loading || (opt.needsDateSelect && (!selectedCamp || !selectedDate))}
                  className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-8 text-[12px] glow-btn"
                  data-testid={`button-export-${opt.id}`}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
