import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-contact-type">
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
                <FormLabel>First Name *</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="input-first-name" />
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
                <FormLabel>Last Name *</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="input-last-name" />
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
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="email" data-testid="input-email" />
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
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} data-testid="input-phone" />
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
                    <FormLabel>Gender</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-gender">
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
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} type="date" data-testid="input-dob" />
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
                    <FormLabel>School</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-school" />
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
                    <FormLabel>School Year</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-school-year" />
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
                  <FormLabel>Medical Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} data-testid="input-medical" />
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
                    <FormLabel>Emergency Contact</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-emergency-contact" />
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
                    <FormLabel>Emergency Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-emergency-phone" />
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
                    <FormLabel className="!mt-0 text-sm">Photo/Video consent</FormLabel>
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
                    <FormLabel className="!mt-0 text-sm">Medical treatment consent</FormLabel>
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
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} data-testid="input-address" />
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
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-notes" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-contact">
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
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Contact not found</p>
      </div>
    );
  }

  const age = contact.dateOfBirth
    ? Math.floor((Date.now() - new Date(contact.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/contacts")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold" data-testid="text-contact-name">
            {contact.firstName} {contact.lastName}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="capitalize">{contact.type}</Badge>
            {contact.gender && (
              <Badge variant="outline" className="capitalize">{contact.gender}</Badge>
            )}
            {age !== null && (
              <span className="text-sm text-muted-foreground">Age: {age}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm" data-testid="text-contact-email">{contact.email}</span>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm" data-testid="text-contact-phone">{contact.phone}</span>
              </div>
            )}
            {contact.alternatePhone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{contact.alternatePhone}</span>
              </div>
            )}
            {contact.address && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">Address</span>
                <p>{contact.address}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contact.dateOfBirth && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">Date of Birth</span>
                <p>{contact.dateOfBirth}</p>
              </div>
            )}
            {contact.nationality && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">Nationality</span>
                <p>{contact.nationality}</p>
              </div>
            )}
            {contact.school && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">School</span>
                <p>{contact.school} {contact.schoolYear && `(Year ${contact.schoolYear})`}</p>
              </div>
            )}
            {contact.teamName && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">Team</span>
                <p>{contact.teamName}</p>
              </div>
            )}
            {contact.previousClub && (
              <div className="text-sm">
                <span className="text-muted-foreground text-xs">Previous Club</span>
                <p>{contact.previousClub}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {contact.type === "player" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Medical & Consent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contact.medicalNotes && (
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs">Medical Notes</span>
                  <p>{contact.medicalNotes}</p>
                </div>
              )}
              {contact.allergies && (
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs">Allergies</span>
                  <p>{contact.allergies}</p>
                </div>
              )}
              <div className="flex gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${contact.photoConsent ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                  <span className="text-xs">Photo consent</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${contact.medicalConsent ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                  <span className="text-xs">Medical consent</span>
                </div>
              </div>
              {contact.emergencyContact && (
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs">Emergency Contact</span>
                  <p>{contact.emergencyContact} {contact.emergencyPhone && `— ${contact.emergencyPhone}`}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {relationships && relationships.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <LinkIcon className="w-4 h-4" />
                {contact.type === "player" ? "Parents / Guardians" : "Linked Players"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {relationships.map((rel) => {
                const linked = contact.type === "player" ? rel.guardian : rel.player;
                if (!linked) return null;
                return (
                  <Link key={rel.id} href={`/contacts/${linked.id}`}>
                    <div
                      className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                      data-testid={`link-relationship-${rel.id}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
                        <span className="text-xs font-medium text-gold-foreground">
                          {linked.firstName[0]}{linked.lastName[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{linked.firstName} {linked.lastName}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {rel.relationship}
                          {rel.isPrimaryContact && " · Primary Contact"}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}

        {contact.notes && (
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
            </CardContent>
          </Card>
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

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">People</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage players, guardians, staff, and contacts
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} data-testid="button-new-contact">
          <UserPlus className="w-4 h-4 mr-2" />
          New Contact
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-contacts"
          />
        </div>
        <Tabs value={typeFilter} onValueChange={setTypeFilter}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            <TabsTrigger value="player" data-testid="tab-players">Players</TabsTrigger>
            <TabsTrigger value="guardian" data-testid="tab-guardians">Guardians</TabsTrigger>
            <TabsTrigger value="staff" data-testid="tab-staff">Staff</TabsTrigger>
            <TabsTrigger value="volunteer" data-testid="tab-other">Other</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-0 divide-y">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-5 py-3">
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : filteredContacts && filteredContacts.length > 0 ? (
            <div className="divide-y">
              <div className="grid grid-cols-[1fr_150px_150px_100px] gap-3 px-5 py-2 text-xs font-medium text-muted-foreground border-b">
                <span>Name</span>
                <span>Phone</span>
                <span>Email</span>
                <span>Type</span>
              </div>
              {filteredContacts.map((contact) => (
                <Link key={contact.id} href={`/contacts/${contact.id}`}>
                  <div
                    className="grid grid-cols-[1fr_150px_150px_100px] gap-3 px-5 py-3 items-center hover-elevate cursor-pointer"
                    data-testid={`row-contact-${contact.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary text-xs font-semibold">
                          {contact.firstName[0]}{contact.lastName[0]}
                        </span>
                      </div>
                      <span className="text-sm font-medium truncate">
                        {contact.firstName} {contact.lastName}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground truncate">{contact.phone || "—"}</span>
                    <span className="text-sm text-muted-foreground truncate">{contact.email || "—"}</span>
                    <Badge variant="secondary" className="w-fit text-[10px] capitalize">{contact.type}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">
                {searchQuery ? "No contacts match your search" : "No contacts yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                {searchQuery ? "Try adjusting your search or filters" : "Add your first contact to get started"}
              </p>
              {!searchQuery && (
                <Button size="sm" onClick={() => setShowNewDialog(true)}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Contact
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {filteredContacts && (
        <p className="text-xs text-muted-foreground" data-testid="text-contact-count">
          Showing {filteredContacts.length} of {contacts?.length ?? 0} contacts
        </p>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Contact</DialogTitle>
          </DialogHeader>
          <ContactForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
