import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save } from "lucide-react";

export default function AdminSettings() {
  const { data: settingsArr, isLoading } = useQuery<{ key: string; value: string }[]>({ queryKey: ["/api/admin/settings"] });
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settingsArr && !loaded) {
      const obj: Record<string, string> = {};
      settingsArr.forEach(s => { obj[s.key] = s.value; });
      setValues(obj);
      setLoaded(true);
    }
  }, [settingsArr, loaded]);

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
    <div className="p-8 space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">Club and system configuration</p>
      </div>

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
    </div>
  );
}
