// Skills Challenge tab — CIC workspace. Manages the four side-competition
// categories ({U10, U11} × {90s Juggling, Dribble Pass & Finish}): see
// registrations as they come in from join.cicyouth.com, enter/edit scores,
// add walk-ups, and watch the live leaderboards the mobile app shows.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Zap, Plus, Search, Trash2, X, Trophy, Users, ClipboardCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ChallengeKey = "juggling" | "dribble_pass_finish";
type AgeGroup = "U10" | "U11";

interface SkillsEntry {
  id: number;
  playerName: string;
  clubName: string;
  ageGroup: AgeGroup;
  challenge: ChallengeKey;
  score: number | null;
  scoredAt: string | null;
  source: string;
  createdAt: string;
}

interface LeaderboardCategory {
  challenge: ChallengeKey;
  ageGroup: AgeGroup;
  entries: { id: number; playerName: string; clubName: string; score: number; rank: number }[];
  registeredCount: number;
  scoredCount: number;
}

const CHALLENGE_LABELS: Record<ChallengeKey, string> = {
  juggling: "90s Juggling",
  dribble_pass_finish: "Dribble, Pass & Finish",
};

const CHALLENGE_SCORE_UNIT: Record<ChallengeKey, string> = {
  juggling: "juggles",
  dribble_pass_finish: "seconds",
};

function formatScore(challenge: ChallengeKey, score: number | null): string {
  if (score == null) return "—";
  return challenge === "juggling" ? `${Math.round(score)}` : `${score.toFixed(2)}s`;
}

function AddEntryModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    playerName: "",
    clubName: "",
    ageGroup: "U10",
    challenge: "juggling",
    score: "",
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/skills-challenge/entries", data),
    onSuccess: async (res) => {
      const body = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/leaderboard"] });
      toast({ title: body.alreadyRegistered ? "Player already registered in this category" : "Entry added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0a0e1a] border border-blue-500/15 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">Add Entry</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Player full name</label>
            <Input value={form.playerName} onChange={(e) => setForm({ ...form, playerName: e.target.value })} placeholder="e.g. Charlie Smith" />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Club name</label>
            <Input value={form.clubName} onChange={(e) => setForm({ ...form, clubName: e.target.value })} placeholder="e.g. Christchurch United" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Age group</label>
              <Select value={form.ageGroup} onValueChange={(v) => setForm({ ...form, ageGroup: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="U10">U10</SelectItem>
                  <SelectItem value="U11">U11</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Challenge</label>
              <Select value={form.challenge} onValueChange={(v) => setForm({ ...form, challenge: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="juggling">90s Juggling</SelectItem>
                  <SelectItem value="dribble_pass_finish">Dribble, Pass & Finish</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">
              Score ({CHALLENGE_SCORE_UNIT[form.challenge as ChallengeKey]}) — optional
            </label>
            <Input
              value={form.score}
              onChange={(e) => setForm({ ...form, score: e.target.value })}
              placeholder={form.challenge === "juggling" ? "e.g. 42" : "e.g. 34.52"}
              inputMode="decimal"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/5">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMut.mutate({ ...form, score: form.score.trim() === "" ? null : form.score })}
            disabled={!form.playerName.trim() || !form.clubName.trim() || createMut.isPending}
          >
            {createMut.isPending ? "Adding..." : "Add Entry"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScoreCell({ entry }: { entry: SkillsEntry }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const scoreMut = useMutation({
    mutationFn: (score: string | null) => apiRequest("PATCH", `/api/admin/skills-challenge/entries/${entry.id}`, { score }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/leaderboard"] });
      setEditing(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!editing) {
    return (
      <button
        onClick={() => {
          setValue(entry.score == null ? "" : String(entry.score));
          setEditing(true);
        }}
        className={`px-2.5 py-1 rounded-lg text-sm font-semibold transition-colors ${
          entry.score == null
            ? "text-white/30 border border-dashed border-white/15 hover:border-blue-400/40 hover:text-blue-300"
            : "text-white bg-white/5 hover:bg-white/10"
        }`}
        title="Click to edit score"
      >
        {entry.score == null ? "Enter score" : formatScore(entry.challenge, entry.score)}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") scoreMut.mutate(value.trim() === "" ? null : value.trim());
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder={entry.challenge === "juggling" ? "juggles" : "seconds"}
        inputMode="decimal"
        className="h-8 w-24 text-sm"
      />
      <Button size="sm" className="h-8" disabled={scoreMut.isPending} onClick={() => scoreMut.mutate(value.trim() === "" ? null : value.trim())}>
        Save
      </Button>
      <button onClick={() => setEditing(false)} className="text-white/30 hover:text-white/60"><X className="w-4 h-4" /></button>
    </div>
  );
}

export default function TournamentSkillsChallenge() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [challengeFilter, setChallengeFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  const { data: entries = [], isLoading } = useQuery<SkillsEntry[]>({
    queryKey: ["/api/admin/skills-challenge/entries"],
  });

  const { data: leaderboard } = useQuery<{ categories: LeaderboardCategory[] }>({
    queryKey: ["/api/admin/skills-challenge/leaderboard"],
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/skills-challenge/entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/skills-challenge/leaderboard"] });
      toast({ title: "Entry deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (challengeFilter !== "all" && e.challenge !== challengeFilter) return false;
      if (ageFilter !== "all" && e.ageGroup !== ageFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!e.playerName.toLowerCase().includes(q) && !e.clubName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [entries, challengeFilter, ageFilter, search]);

  const scoredCount = entries.filter((e) => e.score != null).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Zap className="w-6 h-6 text-amber-400" />
            Skills Challenge
          </h1>
          <p className="text-sm text-white/40 mt-1">
            90s Juggling + Dribble, Pass &amp; Finish — U10 &amp; U11. Registrations land here from join.cicyouth.com.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Entry
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Registered", value: entries.length, icon: Users },
          { label: "Scored", value: scoredCount, icon: ClipboardCheck },
          { label: "Juggling entries", value: entries.filter((e) => e.challenge === "juggling").length, icon: Trophy },
          { label: "Dribble, Pass & Finish entries", value: entries.filter((e) => e.challenge === "dribble_pass_finish").length, icon: Timer },
        ].map((s) => (
          <div key={s.label} className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
              <s.icon className="w-3.5 h-3.5" /> {s.label}
            </div>
            <div className="text-2xl font-bold text-white">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Leaderboards — the four categories, exactly what the app shows */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(leaderboard?.categories ?? []).map((cat) => (
          <div key={`${cat.challenge}-${cat.ageGroup}`} className="bg-white/[0.03] border border-white/5 rounded-2xl p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-white">{CHALLENGE_LABELS[cat.challenge]}</div>
                <div className="text-xs text-amber-400/80 font-semibold mt-0.5">{cat.ageGroup}</div>
              </div>
              <div className="text-[11px] text-white/30">{cat.scoredCount}/{cat.registeredCount} scored</div>
            </div>
            {cat.entries.length === 0 ? (
              <div className="text-xs text-white/25 py-3">No scores yet</div>
            ) : (
              <div className="space-y-1.5">
                {cat.entries.slice(0, 5).map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-sm">
                    <span className={`w-5 text-center font-bold ${e.rank === 1 ? "text-amber-400" : "text-white/40"}`}>{e.rank}</span>
                    <span className="flex-1 text-white/80 truncate">{e.playerName}</span>
                    <span className="text-white font-semibold">{formatScore(cat.challenge, e.score)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search player or club..." className="pl-9" />
        </div>
        <Select value={challengeFilter} onValueChange={setChallengeFilter}>
          <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All challenges</SelectItem>
            <SelectItem value="juggling">90s Juggling</SelectItem>
            <SelectItem value="dribble_pass_finish">Dribble, Pass &amp; Finish</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ageFilter} onValueChange={setAgeFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ages</SelectItem>
            <SelectItem value="U10">U10</SelectItem>
            <SelectItem value="U11">U11</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Entries table */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-white/35 border-b border-white/5">
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 font-medium">Club</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Challenge</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium w-12"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-white/30">Loading entries...</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/30">
                  {entries.length === 0 ? "No registrations yet — they'll appear here as players sign up." : "No entries match the filters."}
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-medium">{e.playerName}</td>
                  <td className="px-4 py-3 text-white/60">{e.clubName}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-md bg-white/5 text-white/70 text-xs font-semibold">{e.ageGroup}</span></td>
                  <td className="px-4 py-3 text-white/60 text-xs">{CHALLENGE_LABELS[e.challenge]}</td>
                  <td className="px-4 py-3"><ScoreCell entry={e} /></td>
                  <td className="px-4 py-3 text-white/30 text-xs">{e.source === "public" ? "Online" : "Admin"}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm(`Delete ${e.playerName}'s entry?`)) deleteMut.mutate(e.id); }}
                      className="text-white/20 hover:text-red-400 transition-colors"
                      title="Delete entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddEntryModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
