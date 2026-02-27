import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import {
  Building2,
  ClipboardCheck,
  DollarSign,
  Mail,
  Plug,
  CreditCard,
  BarChart3,
  Target,
  ShoppingBag,
  Globe,
  Save,
  ExternalLink,
  Shield,
  Bell,
  FileText,
  Pencil,
  Check,
} from "lucide-react";

type SettingsMap = Record<string, string>;

function SettingField({
  label,
  settingKey,
  value,
  onChange,
  type = "text",
  hint,
  placeholder,
}: {
  label: string;
  settingKey: string;
  value: string;
  onChange: (key: string, val: string) => void;
  type?: "text" | "textarea" | "select";
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-6 py-3.5 border-b border-white/[0.03] last:border-0">
      <label className="text-[13px] text-white/55 font-medium sm:w-48 sm:flex-shrink-0 sm:pt-2">
        {label}
      </label>
      <div className="flex-1 space-y-1">
        {type === "textarea" ? (
          <textarea
            value={value}
            onChange={(e) => onChange(settingKey, e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 px-3.5 py-2.5 placeholder:text-white/15 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 resize-none transition-all"
            data-testid={`input-${settingKey}`}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(settingKey, e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 px-3.5 py-2.5 placeholder:text-white/15 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 transition-all"
            data-testid={`input-${settingKey}`}
          />
        )}
        {hint && <p className="text-[10px] text-white/20">{hint}</p>}
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  settingKey,
  value,
  onChange,
  hint,
}: {
  label: string;
  settingKey: string;
  value: string;
  onChange: (key: string, val: string) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/[0.03] last:border-0">
      <div className="flex-1">
        <p className="text-[13px] text-white/55 font-medium">{label}</p>
        {hint && <p className="text-[10px] text-white/20 mt-0.5">{hint}</p>}
      </div>
      <Switch
        checked={value === "true"}
        onCheckedChange={(checked) => onChange(settingKey, checked ? "true" : "false")}
        data-testid={`toggle-${settingKey}`}
      />
    </div>
  );
}

function SettingSelect({
  label,
  settingKey,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  settingKey: string;
  value: string;
  onChange: (key: string, val: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-6 py-3.5 border-b border-white/[0.03] last:border-0">
      <label className="text-[13px] text-white/55 font-medium sm:w-48 sm:flex-shrink-0 sm:pt-2">
        {label}
      </label>
      <div className="flex-1 space-y-1">
        <select
          value={value}
          onChange={(e) => onChange(settingKey, e.target.value)}
          className="w-full rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 px-3.5 py-2.5 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer"
          data-testid={`select-${settingKey}`}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#0a1628] text-white">
              {opt.label}
            </option>
          ))}
        </select>
        {hint && <p className="text-[10px] text-white/20">{hint}</p>}
      </div>
    </div>
  );
}

const TABS = [
  { key: "club", label: "Club Info", icon: Building2 },
  { key: "registration", label: "Registration", icon: ClipboardCheck },
  { key: "financial", label: "Financial", icon: DollarSign },
  { key: "emails", label: "Emails", icon: Mail },
  { key: "integrations", label: "Integrations", icon: Plug },
] as const;

type TabKey = typeof TABS[number]["key"];

const integrationsList = [
  { name: "Stripe", description: "Payment processing for registrations and invoices", status: "Not configured", icon: CreditCard, color: "from-violet-500/15" },
  { name: "Xero", description: "Accounting sync for invoices and contacts", status: "Not configured", icon: BarChart3, color: "from-blue-500/15" },
  { name: "Klaviyo", description: "Email marketing and contact sync", status: "Not configured", icon: Mail, color: "from-emerald-500/15" },
  { name: "Meta CAPI", description: "Server-side conversion tracking", status: "Not configured", icon: Target, color: "from-sky-500/15" },
  { name: "Shopify", description: "Merchandise store customer matching", status: "Not configured", icon: ShoppingBag, color: "from-green-500/15" },
  { name: "COMET (NZF)", description: "New Zealand Football registration system", status: "Stub ready", icon: Globe, color: "from-amber-500/15" },
];

const emailTemplates = [
  { key: "email_new_registration", label: "New Registration", description: "Sent when a new user registers for a programme for the first time." },
  { key: "email_re_registration", label: "Re-registration", description: "Sent when an existing user registers for a new programme." },
  { key: "email_fee_applied", label: "Fee Applied", description: "Sent when a fee is applied to a user's account." },
  { key: "email_reg_invitation", label: "Registration Invitation", description: "Sent to existing members when priority registration opens for a new term." },
  { key: "email_holiday_program", label: "Holiday Programme", description: "Sent when a user registers for a holiday programme." },
];

function ClubInfoTab({ data, onChange }: { data: SettingsMap; onChange: (key: string, val: string) => void }) {
  return (
    <div className="space-y-1 px-5 py-2">
      <SettingField label="Club Name" settingKey="club_name" value={data.club_name ?? ""} onChange={onChange} placeholder="Your club name" />
      <SettingField label="Short Name" settingKey="club_short_name" value={data.club_short_name ?? ""} onChange={onChange} placeholder="e.g. CUFC" hint="Used in compact views and notifications" />
      <SettingField label="Email" settingKey="club_email" value={data.club_email ?? ""} onChange={onChange} placeholder="info@yourclub.co.nz" hint="Primary contact email shown publicly" />
      <SettingField label="Phone" settingKey="club_phone" value={data.club_phone ?? ""} onChange={onChange} placeholder="021 000 0000" />
      <SettingField label="Website" settingKey="club_website" value={data.club_website ?? ""} onChange={onChange} placeholder="https://yourclub.co.nz" />
      <SettingField label="Address" settingKey="club_address" value={data.club_address ?? ""} onChange={onChange} type="textarea" placeholder="Full club address" hint="Used on invoices and email headers" />
      <SettingSelect
        label="Timezone"
        settingKey="club_timezone"
        value={data.club_timezone ?? "Pacific/Auckland"}
        onChange={onChange}
        options={[
          { value: "Pacific/Auckland", label: "New Zealand (NZST/NZDT)" },
          { value: "Australia/Sydney", label: "Australia Eastern (AEST/AEDT)" },
          { value: "Australia/Melbourne", label: "Australia Melbourne (AEST/AEDT)" },
          { value: "Pacific/Fiji", label: "Fiji (FJT)" },
        ]}
      />
    </div>
  );
}

function RegistrationTab({ data, onChange }: { data: SettingsMap; onChange: (key: string, val: string) => void }) {
  return (
    <div className="px-5 py-2">
      <div className="mb-4">
        <h4 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium mb-1">Registration Options</h4>
      </div>
      <SettingToggle label="Public Registration" settingKey="reg_public_enabled" value={data.reg_public_enabled ?? "false"} onChange={onChange} hint="Allow public self-registration via your website" />
      <SettingSelect
        label="Terms & Conditions"
        settingKey="reg_terms_mode"
        value={data.reg_terms_mode ?? "pdf_email"}
        onChange={onChange}
        options={[
          { value: "pdf_email", label: "Attach PDF to email" },
          { value: "inline", label: "Show inline during registration" },
          { value: "link", label: "Link to external page" },
          { value: "disabled", label: "Disabled" },
        ]}
        hint="How terms & conditions are presented to registrants"
      />
      <SettingToggle label="Waitlist" settingKey="reg_waitlist_enabled" value={data.reg_waitlist_enabled ?? "false"} onChange={onChange} hint="Place registrants on waitlist when programme is full" />
      <SettingToggle label="Comments" settingKey="reg_comments_enabled" value={data.reg_comments_enabled ?? "true"} onChange={onChange} hint="Allow comments on registration summary, shown in notification email" />
      <SettingSelect
        label="Notification"
        settingKey="reg_notification_to"
        value={data.reg_notification_to ?? "club_email"}
        onChange={onChange}
        options={[
          { value: "club_email", label: "Club Email" },
          { value: "registrar", label: "Registrar" },
          { value: "admin", label: "Admin Only" },
        ]}
        hint="Who receives email notification of new registrations"
      />
      <SettingField label="Notification CC" settingKey="reg_notification_cc" value={data.reg_notification_cc ?? ""} onChange={onChange} placeholder="accounts@yourclub.co.nz" hint="CC notification emails to these addresses (one per line)" />
      <SettingField label="Vaccine Statement" settingKey="reg_vaccine_statement" value={data.reg_vaccine_statement ?? ""} onChange={onChange} type="textarea" placeholder="Leave blank to disable" hint="If present, users will be required to confirm/agree to this statement" />
      <SettingToggle label="Priority Registration" settingKey="reg_priority_enabled" value={data.reg_priority_enabled ?? "false"} onChange={onChange} hint="Restrict priority registration to current programme members only" />
    </div>
  );
}

function FinancialTab({ data, onChange }: { data: SettingsMap; onChange: (key: string, val: string) => void }) {
  return (
    <div className="px-5 py-2">
      <div className="mb-4">
        <h4 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium mb-1">Financial Settings</h4>
      </div>
      <SettingField label="Bank Account Name" settingKey="fin_bank_name" value={data.fin_bank_name ?? ""} onChange={onChange} placeholder="Club account name" hint="Shown on invoices and statements" />
      <SettingField label="Bank Account #" settingKey="fin_bank_account" value={data.fin_bank_account ?? ""} onChange={onChange} placeholder="XX-XXXX-XXXXXXX-XX" hint="Shown on invoices and statements" />
      <SettingField label="GST #" settingKey="fin_gst_number" value={data.fin_gst_number ?? ""} onChange={onChange} placeholder="XX-XXX-XXX" hint="Shown on invoices" />
      <SettingToggle label="Show Address" settingKey="fin_show_address" value={data.fin_show_address ?? "true"} onChange={onChange} hint="Show club address in email/pdf headers when no custom banner is set" />
      <SettingField label="Payment Terms" settingKey="fin_payment_terms" value={data.fin_payment_terms ?? ""} onChange={onChange} placeholder="Payment terms text" hint="Shown on invoices and statements" />
      <SettingField label="Fees Email" settingKey="fin_fees_email" value={data.fin_fees_email ?? ""} onChange={onChange} placeholder="fees@yourclub.co.nz" hint="If provided, fees and statements will be sent from this address instead of club email" />
      <SettingField label="Default Due Days" settingKey="fin_due_days" value={data.fin_due_days ?? "0"} onChange={onChange} placeholder="0" hint="Default number of days to pay a fee after billing" />

      <div className="mt-6 mb-4">
        <h4 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium mb-1">Payment Requirements</h4>
      </div>
      <SettingToggle label="User Payments" settingKey="fin_user_payments" value={data.fin_user_payments ?? "true"} onChange={onChange} hint="Allow logged-in users to make payments against outstanding fees" />
      <SettingSelect
        label="Registration Payments"
        settingKey="fin_reg_payments"
        value={data.fin_reg_payments ?? "required"}
        onChange={onChange}
        options={[
          { value: "required", label: "Required" },
          { value: "optional", label: "Optional" },
          { value: "disabled", label: "Disabled" },
        ]}
        hint="Allow users to make payments during registration"
      />
      <SettingSelect
        label="Holiday Programme Payments"
        settingKey="fin_holiday_payments"
        value={data.fin_holiday_payments ?? "required"}
        onChange={onChange}
        options={[
          { value: "required", label: "Required" },
          { value: "optional", label: "Optional" },
          { value: "disabled", label: "Disabled" },
        ]}
        hint="Allow users to make payments during holiday programme registration"
      />
    </div>
  );
}

function EmailsTab({ data, onChange, editingTemplate, setEditingTemplate }: {
  data: SettingsMap;
  onChange: (key: string, val: string) => void;
  editingTemplate: string | null;
  setEditingTemplate: (key: string | null) => void;
}) {
  return (
    <div className="px-5 py-2">
      <div className="mb-4">
        <h4 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium mb-1">Email Customisation</h4>
        <p className="text-[10px] text-white/20">Customise the messages sent in automated emails</p>
      </div>
      <div className="space-y-1">
        {emailTemplates.map((tmpl) => (
          <div key={tmpl.key} className="py-3.5 border-b border-white/[0.03] last:border-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-500/8 border border-blue-500/12 flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5 text-blue-400/50" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-white/65">{tmpl.label}</p>
                  <p className="text-[10px] text-white/20">{tmpl.description}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingTemplate(editingTemplate === tmpl.key ? null : tmpl.key)}
                className="text-blue-400/50 hover:text-blue-400 text-[11px] h-7 px-2.5 transition-colors"
                data-testid={`button-edit-${tmpl.key}`}
              >
                {editingTemplate === tmpl.key ? (
                  <><Check className="w-3 h-3 mr-1" /> Done</>
                ) : (
                  <><Pencil className="w-3 h-3 mr-1" /> Edit</>
                )}
              </Button>
            </div>
            {editingTemplate === tmpl.key && (
              <div className="mt-3 animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
                <textarea
                  value={data[tmpl.key] ?? ""}
                  onChange={(e) => onChange(tmpl.key, e.target.value)}
                  rows={4}
                  className="w-full rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/70 px-3.5 py-2.5 placeholder:text-white/15 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 resize-none transition-all leading-relaxed"
                  data-testid={`textarea-${tmpl.key}`}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationsTab() {
  return (
    <div className="px-5 py-2">
      <div className="mb-4">
        <h4 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium mb-1">Connected Services</h4>
        <p className="text-[10px] text-white/20">Manage external integrations and API connections</p>
      </div>
      <div className="space-y-2">
        {integrationsList.map((integration) => (
          <div
            key={integration.name}
            className="flex items-center gap-4 py-3.5 border-b border-white/[0.03] last:border-0"
            data-testid={`integration-${integration.name.toLowerCase().replace(/[^a-z]/g, "-")}`}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${integration.color} to-transparent border border-blue-500/[0.08] flex items-center justify-center`}>
              <integration.icon className="w-4 h-4 text-white/45" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white/65">{integration.name}</p>
              <p className="text-[10px] text-white/20">{integration.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2.5 py-1 rounded-lg border ${
                integration.status === "Stub ready"
                  ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  : "text-white/25 bg-blue-500/[0.04] border-blue-500/[0.08]"
              }`}>
                {integration.status}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-blue-400/40 hover:text-blue-400 text-[11px] h-7 px-2 transition-colors"
                data-testid={`button-configure-${integration.name.toLowerCase().replace(/[^a-z]/g, "-")}`}
              >
                Configure
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("club");
  const [localSettings, setLocalSettings] = useState<SettingsMap>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: serverSettings, isLoading } = useQuery<SettingsMap>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (serverSettings) {
      setLocalSettings(serverSettings);
      setHasChanges(false);
    }
  }, [serverSettings]);

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsMap) => {
      const res = await apiRequest("PUT", "/api/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setHasChanges(false);
      toast({ title: "Settings saved", description: "Your changes have been saved successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error saving settings", description: err.message, variant: "destructive" });
    },
  });

  const handleChange = (key: string, value: string) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(localSettings);
  };

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Settings</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">Club configuration, registrations, finances and integrations</p>
        </div>
        {activeTab !== "integrations" && (
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            className={`rounded-xl h-9 text-[13px] font-medium transition-all duration-300 ${
              hasChanges
                ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 glow-btn"
                : "bg-white/[0.04] text-white/25 border border-white/[0.06] cursor-not-allowed"
            }`}
            data-testid="button-save-settings"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: "50ms", opacity: 0 }}>
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "bg-blue-500/12 text-blue-400 border border-blue-500/20"
                    : "text-white/35 hover:text-white/55 hover:bg-white/[0.03] border border-transparent"
                }`}
                data-testid={`tab-${tab.key}`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: "100ms", opacity: 0 }}>
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-6">
                <Skeleton className="h-5 w-40 bg-blue-500/[0.04]" />
                <Skeleton className="h-9 flex-1 bg-blue-500/[0.04]" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {activeTab === "club" && <ClubInfoTab data={localSettings} onChange={handleChange} />}
            {activeTab === "registration" && <RegistrationTab data={localSettings} onChange={handleChange} />}
            {activeTab === "financial" && <FinancialTab data={localSettings} onChange={handleChange} />}
            {activeTab === "emails" && <EmailsTab data={localSettings} onChange={handleChange} editingTemplate={editingTemplate} setEditingTemplate={setEditingTemplate} />}
            {activeTab === "integrations" && <IntegrationsTab />}
          </>
        )}
      </div>

      {hasChanges && activeTab !== "integrations" && (
        <div className="fixed bottom-6 right-6 z-40 animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-10 px-5 text-[13px] font-medium glow-btn shadow-xl shadow-blue-500/20"
            data-testid="button-save-settings-floating"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
