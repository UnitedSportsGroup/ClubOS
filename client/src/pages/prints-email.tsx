import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Send, Mail, Clock, CheckCircle, Users } from "lucide-react";
import type { PrintEmail, PrintContact } from "@shared/schema";

export default function PrintsEmail() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [showCompose, setShowCompose] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const { data: emails = [], isLoading } = useQuery<PrintEmail[]>({
    queryKey: ["/api/admin/print-emails", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-emails?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: contacts = [] } = useQuery<PrintContact[]>({
    queryKey: ["/api/admin/print-contacts", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-contacts?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const r = await apiRequest("POST", "/api/admin/print-emails", data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-emails"] }); toast({ title: "Email saved as draft" }); closeCompose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("PATCH", `/api/admin/print-emails/${id}`, { status: "sent", sentAt: new Date().toISOString(), sentCount: contactsWithEmail.length, recipientCount: contactsWithEmail.length });
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-emails"] }); toast({ title: "Email marked as sent" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function closeCompose() { setShowCompose(false); setSubject(""); setBody(""); }

  function handleSaveDraft() {
    createMutation.mutate({ subject, body, organizationId: orgId, recipientCount: contactsWithEmail.length, status: "draft" });
  }

  function handleSendNow() {
    createMutation.mutate({ subject, body, organizationId: orgId, recipientCount: contactsWithEmail.length, sentCount: contactsWithEmail.length, status: "sent", sentAt: new Date().toISOString() });
  }

  const contactsWithEmail = contacts.filter(c => c.email);

  const statusIcons: Record<string, any> = { draft: Clock, sent: CheckCircle };
  const statusColors: Record<string, string> = { draft: "bg-amber-500/20 text-amber-400", sent: "bg-emerald-500/20 text-emerald-400" };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-email">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Send className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Email Sender</h1>
            <p className="text-sm text-white/40">{contactsWithEmail.length} contacts with email addresses</p>
          </div>
        </div>
        <Button onClick={() => setShowCompose(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2" data-testid="button-compose"><Plus className="w-4 h-4" /> Compose</Button>
      </div>

      <div className="premium-card border border-white/[0.06] rounded-2xl p-4">
        <div className="flex items-center gap-3 text-sm text-white/50">
          <Users className="w-4 h-4" />
          <span>{contactsWithEmail.length} recipients available</span>
          <span className="text-white/20">·</span>
          <span>{emails.filter(e => e.status === "sent").length} campaigns sent</span>
          <span className="text-white/20">·</span>
          <span>{emails.filter(e => e.status === "draft").length} drafts</span>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-white/30">Loading...</div>
        ) : emails.length === 0 ? (
          <div className="text-center py-12">
            <Mail className="w-12 h-12 mx-auto mb-3 text-white/10" />
            <p className="text-white/30">No emails yet</p>
            <p className="text-xs text-white/20 mt-1">Compose your first email to reach your contacts</p>
          </div>
        ) : emails.map(email => {
          const StatusIcon = statusIcons[email.status] || Clock;
          return (
            <div key={email.id} className="premium-card border border-white/[0.06] rounded-2xl p-4 hover:bg-white/[0.02] transition-colors" data-testid={`email-card-${email.id}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-white/90">{email.subject}</h3>
                    <Badge className={`text-[10px] capitalize ${statusColors[email.status] || "bg-white/10 text-white/40"}`}>
                      <StatusIcon className="w-3 h-3 mr-1" />{email.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-white/30 line-clamp-2">{email.body}</p>
                </div>
                <div className="text-right ml-4">
                  <p className="text-xs text-white/40">{email.recipientCount} recipients</p>
                  {email.sentAt && <p className="text-[10px] text-white/25">{new Date(email.sentAt).toLocaleDateString("en-NZ")}</p>}
                  {email.status === "draft" && (
                    <Button size="sm" onClick={() => { if (confirm("Mark this email as sent?")) sendMutation.mutate(email.id); }} className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs h-7 gap-1" data-testid={`button-send-${email.id}`}>
                      <Send className="w-3 h-3" /> Send
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeCompose}>
          <div className="w-full max-w-2xl premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-compose">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Compose Email</h2>
              <Button variant="ghost" size="icon" onClick={closeCompose} className="text-white/30 h-8 w-8"><X className="w-4 h-4" /></Button>
            </div>

            <div className="flex items-center gap-2 text-xs text-white/40 py-2 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Users className="w-3.5 h-3.5" />
              <span>To: All contacts with email ({contactsWithEmail.length} recipients)</span>
            </div>

            <Input placeholder="Subject *" value={subject} onChange={e => setSubject(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-email-subject" />
            <Textarea placeholder="Write your email content..." value={body} onChange={e => setBody(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[200px]" data-testid="input-email-body" />

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSendNow} disabled={!subject.trim() || !body.trim() || createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-2 flex-1" data-testid="button-send-email">
                <Send className="w-4 h-4" /> {createMutation.isPending ? "Sending..." : "Send Now"}
              </Button>
              <Button onClick={handleSaveDraft} disabled={!subject.trim() || !body.trim() || createMutation.isPending} variant="outline" className="border-white/10 text-white/60 rounded-xl gap-2" data-testid="button-save-draft">
                <Clock className="w-4 h-4" /> Save Draft
              </Button>
              <Button variant="outline" onClick={closeCompose} className="border-white/10 text-white/60 rounded-xl">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
