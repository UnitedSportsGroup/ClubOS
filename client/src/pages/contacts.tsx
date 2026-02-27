import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Users,
  UserPlus,
  Search,
  Phone,
  Mail,
  ChevronRight,
  ArrowLeft,
  Link as LinkIcon,
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertContactSchema, insertRelationshipSchema } from "@shared/schema";
import type { Contact, ContactRelationship } from "@shared/schema";
import { z } from "zod";

const contactFormSchema = insertContactSchema.extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  type: z.enum(["player", "guardian", "staff", "volunteer", "sponsor"]),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

function ContactForm({
  onClose,
  defaultType,
}: {
  onClose: () => void;
  defaultType?: string;
}) {
  const { toast } = useToast();
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      type: (defaultType as any) || "player",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      alternatePhone: "",
      gender: undefined,
      dateOfBirth: "",
      address: "",
      nationality: "",
      school: "",
      schoolYear: "",
      medicalNotes: "",
      allergies: "",
      emergencyContact: "",
      emergencyPhone: "",
      photoConsent: false,
      medicalConsent: false,
      newsletterConsent: true,
      previousClub: "",
      teamName: "",
      tags: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormValues) => {
      const cleaned = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v === "" ? null : v])
      );
      const res = await apiRequest("POST", "/api/contacts", cleaned);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Contact created successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error creating contact", description: error.message, variant: "destructive" });
    },
  });

  const selectedType = form.watch("type");

  const inputClass = "bg-white/[0.04] border-white/[0.08] text-white/80 placeholder:text-white/25 focus:border-blue-500/40 focus:bg-white/[0.06] rounded-lg text-[13px]";
  const labelClass = "text-[12px] text-white/50 font-medium";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Contact Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-contact-type" className={inputClass}>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="player">Player</SelectItem>
                  <SelectItem value="guardian">Parent/Guardian</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="volunteer">Volunteer</SelectItem>
                  <SelectItem value="sponsor">Sponsor</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>First Name *</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="input-first-name" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Last Name *</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="input-last-name" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Email</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="email" data-testid="input-email" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Phone</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} data-testid="input-phone" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {selectedType === "player" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>Gender</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-gender" className={inputClass}>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>Date of Birth</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} type="date" data-testid="input-dob" className={inputClass} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="school"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>School</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-school" className={inputClass} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="schoolYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>School Year</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-school-year" className={inputClass} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="medicalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={labelClass}>Medical Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} data-testid="input-medical" className={inputClass} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="emergencyContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>Emergency Contact</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-emergency-contact" className={inputClass} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="emergencyPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={labelClass}>Emergency Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-emergency-phone" className={inputClass} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex gap-6 flex-wrap">
              <FormField
                control={form.control}
                name="photoConsent"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-photo-consent"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0 text-[12px] text-white/50">Photo/Video consent</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="medicalConsent"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-medical-consent"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0 text-[12px] text-white/50">Medical treatment consent</FormLabel>
                  </FormItem>
                )}
              />
            </div>
          </>
        )}

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Address</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} data-testid="input-address" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Notes</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-notes" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel" className="text-white/50">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending}
            data-testid="button-save-contact"
            className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg shadow-lg shadow-blue-500/20"
          >
            {createMutation.isPending ? "Saving..." : "Save Contact"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ContactDetail({ id }: { id: string }) {
  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", id],
  });

  const { data: relationships } = useQuery<(ContactRelationship & { guardian?: Contact; player?: Contact })[]>({
    queryKey: ["/api/contacts", id, "relationships"],
  });

  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="p-8 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48 bg-white/[0.04]" />
        <Skeleton className="h-64 w-full bg-white/[0.04]" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-8 text-center">
        <p className="text-white/40">Contact not found</p>
      </div>
    );
  }

  const age = contact.dateOfBirth
    ? Math.floor((Date.now() - new Date(contact.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/contacts")} data-testid="button-back" className="text-white/40 hover:text-white/60">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-white" data-testid="text-contact-name">
            {contact.firstName} {contact.lastName}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-blue-400 capitalize px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20">
              {contact.type}
            </span>
            {contact.gender && (
              <span className="text-[10px] text-white/40 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                {contact.gender}
              </span>
            )}
            {age !== null && (
              <span className="text-[13px] text-white/40">Age {age}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-[13px] font-semibold text-white/70">Contact Information</h3>
          </div>
          <div className="p-5 space-y-3">
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-white/25" />
                <span className="text-[13px] text-white/70" data-testid="text-contact-email">{contact.email}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-white/25" />
                <span className="text-[13px] text-white/70" data-testid="text-contact-phone">{contact.phone}</span>
              </div>
            )}
            {contact.alternatePhone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-white/25" />
                <span className="text-[13px] text-white/70">{contact.alternatePhone}</span>
              </div>
            )}
            {contact.address && (
              <div>
                <span className="text-[11px] text-white/30">Address</span>
                <p className="text-[13px] text-white/70">{contact.address}</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-[13px] font-semibold text-white/70">Personal Details</h3>
          </div>
          <div className="p-5 space-y-3">
            {contact.dateOfBirth && (
              <div>
                <span className="text-[11px] text-white/30">Date of Birth</span>
                <p className="text-[13px] text-white/70">{contact.dateOfBirth}</p>
              </div>
            )}
            {contact.nationality && (
              <div>
                <span className="text-[11px] text-white/30">Nationality</span>
                <p className="text-[13px] text-white/70">{contact.nationality}</p>
              </div>
            )}
            {contact.school && (
              <div>
                <span className="text-[11px] text-white/30">School</span>
                <p className="text-[13px] text-white/70">{contact.school} {contact.schoolYear && `(Year ${contact.schoolYear})`}</p>
              </div>
            )}
            {contact.teamName && (
              <div>
                <span className="text-[11px] text-white/30">Team</span>
                <p className="text-[13px] text-white/70">{contact.teamName}</p>
              </div>
            )}
            {contact.previousClub && (
              <div>
                <span className="text-[11px] text-white/30">Previous Club</span>
                <p className="text-[13px] text-white/70">{contact.previousClub}</p>
              </div>
            )}
          </div>
        </div>

        {contact.type === "player" && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <h3 className="text-[13px] font-semibold text-white/70">Medical & Consent</h3>
            </div>
            <div className="p-5 space-y-3">
              {contact.medicalNotes && (
                <div>
                  <span className="text-[11px] text-white/30">Medical Notes</span>
                  <p className="text-[13px] text-white/70">{contact.medicalNotes}</p>
                </div>
              )}
              {contact.allergies && (
                <div>
                  <span className="text-[11px] text-white/30">Allergies</span>
                  <p className="text-[13px] text-white/70">{contact.allergies}</p>
                </div>
              )}
              <div className="flex gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${contact.photoConsent ? "bg-emerald-400" : "bg-white/15"}`} />
                  <span className="text-[12px] text-white/50">Photo consent</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${contact.medicalConsent ? "bg-emerald-400" : "bg-white/15"}`} />
                  <span className="text-[12px] text-white/50">Medical consent</span>
                </div>
              </div>
              {contact.emergencyContact && (
                <div>
                  <span className="text-[11px] text-white/30">Emergency Contact</span>
                  <p className="text-[13px] text-white/70">{contact.emergencyContact} {contact.emergencyPhone && `— ${contact.emergencyPhone}`}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {relationships && relationships.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <h3 className="text-[13px] font-semibold text-white/70 flex items-center gap-2">
                <LinkIcon className="w-3.5 h-3.5" />
                {contact.type === "player" ? "Parents / Guardians" : "Linked Players"}
              </h3>
            </div>
            <div className="p-3 space-y-1">
              {relationships.map((rel) => {
                const linked = contact.type === "player" ? rel.guardian : rel.player;
                if (!linked) return null;
                return (
                  <Link key={rel.id} href={`/contacts/${linked.id}`}>
                    <div
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors"
                      data-testid={`link-relationship-${rel.id}`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <span className="text-[11px] font-medium text-amber-400">
                          {linked.firstName[0]}{linked.lastName[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white/70">{linked.firstName} {linked.lastName}</p>
                        <p className="text-[11px] text-white/30 capitalize">
                          {rel.relationship}
                          {rel.isPrimaryContact && " · Primary Contact"}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/15" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {contact.notes && (
          <div className="md:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <h3 className="text-[13px] font-semibold text-white/70">Notes</h3>
            </div>
            <div className="p-5">
              <p className="text-[13px] text-white/60 whitespace-pre-wrap">{contact.notes}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [, params] = useRoute("/contacts/:id");

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  if (params?.id) {
    return <ContactDetail id={params.id} />;
  }

  const filteredContacts = contacts?.filter((c) => {
    const matchesSearch =
      !searchQuery ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone?.includes(searchQuery);
    const matchesType = typeFilter === "all" || c.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const tabs = [
    { value: "all", label: "All" },
    { value: "player", label: "Players" },
    { value: "guardian", label: "Guardians" },
    { value: "staff", label: "Staff" },
    { value: "volunteer", label: "Other" },
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">People</h1>
          <p className="text-white/40 text-[13px] mt-1">
            Manage players, guardians, staff, and contacts
          </p>
        </div>
        <Button
          onClick={() => setShowNewDialog(true)}
          data-testid="button-new-contact"
          className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg h-9 text-[13px] font-medium shadow-lg shadow-blue-500/20"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          New Contact
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-[13px] bg-white/[0.04] border-white/[0.08] text-white/80 placeholder:text-white/25 focus:border-blue-500/40 rounded-lg"
            data-testid="input-search-contacts"
          />
        </div>
        <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTypeFilter(tab.value)}
              data-testid={`tab-${tab.value === "all" ? "all" : tab.value === "player" ? "players" : tab.value === "guardian" ? "guardians" : tab.value}`}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                typeFilter === tab.value
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                  : "text-white/40 border border-transparent hover:text-white/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-white/[0.04]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-5 py-3">
                <Skeleton className="h-10 w-full bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : filteredContacts && filteredContacts.length > 0 ? (
          <div>
            <div className="grid grid-cols-[1fr_150px_150px_100px] gap-3 px-5 py-3 text-[11px] font-medium text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
              <span>Name</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Type</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {filteredContacts.map((contact) => (
                <Link key={contact.id} href={`/contacts/${contact.id}`}>
                  <div
                    className="grid grid-cols-[1fr_150px_150px_100px] gap-3 px-5 py-3 items-center hover:bg-white/[0.03] cursor-pointer transition-colors"
                    data-testid={`row-contact-${contact.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-400 text-[11px] font-semibold">
                          {contact.firstName[0]}{contact.lastName[0]}
                        </span>
                      </div>
                      <span className="text-[13px] font-medium text-white/80 truncate">
                        {contact.firstName} {contact.lastName}
                      </span>
                    </div>
                    <span className="text-[13px] text-white/40 truncate">{contact.phone || "—"}</span>
                    <span className="text-[13px] text-white/40 truncate">{contact.email || "—"}</span>
                    <span className="text-[10px] text-white/30 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] w-fit">{contact.type}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5">
              <Users className="w-6 h-6 text-white/20" />
            </div>
            <p className="text-[14px] font-medium text-white/50">
              {searchQuery ? "No contacts match your search" : "No contacts yet"}
            </p>
            <p className="text-[12px] text-white/25 mt-1.5 mb-5">
              {searchQuery ? "Try adjusting your search or filters" : "Add your first contact to get started"}
            </p>
            {!searchQuery && (
              <Button
                size="sm"
                onClick={() => setShowNewDialog(true)}
                className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add Contact
              </Button>
            )}
          </div>
        )}
      </div>

      {filteredContacts && (
        <p className="text-[11px] text-white/25" data-testid="text-contact-count">
          Showing {filteredContacts.length} of {contacts?.length ?? 0} contacts
        </p>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-[hsl(225,14%,9%)] border-white/[0.08]">
          <DialogHeader>
            <DialogTitle className="text-white/90">New Contact</DialogTitle>
          </DialogHeader>
          <ContactForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
