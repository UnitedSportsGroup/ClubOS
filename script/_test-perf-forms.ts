// Unit tests for shared/perf-forms.ts — the check-in form engine.
//   npx tsx script/_test-perf-forms.ts
import {
  AnswerError, BODY_REGIONS, SI_UNITED_CHECK_IN as F, answerSortKey, answerText, allQuestions, formFlag, formLoad,
  formProblem, formReport, isShown, liveQuestions, newQuestionId, regionLabel, validateAnswers,
} from "../shared/perf-forms";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`, detail ?? ""); }
};
const throwsOn = (fn: () => unknown, id: string) => { try { fn(); return false; } catch (e) { return e instanceof AnswerError && e.questionId === id; } };
const good = { am_well: "yes", ready: 7, sleep_job: "normal" };

// Rowan's form, as read off the Loom
const labels = allQuestions(F).map((q) => q.label);
for (const l of ["Am I well?", "What illness symptoms are you feeling?", "How ready am I to perform?", "Did sleep do its job?", "Anything to modify?",
  "Areas I'm managing", "Anything to explain?", "What did I do yesterday?", "Session RPE", "What rehab/prehab did I do?", "What did I do for rest/recovery?", "Session Minutes", "Football Load", "What would help the team?", "Other ideas"])
  ok(`template asks "${l}"`, labels.includes(l));
ok("template sections are Rowan's two", F.sections.map((s) => s.title).join("|") === "Professionalism, Team, Ambition|My Training, My Team");
ok("the template passes its own structure check", formProblem(F) === null, formProblem(F));

// required + showIf
ok("a minimal good check-in is accepted", JSON.stringify(validateAnswers(F, good)) === JSON.stringify(good));
ok("sleep is required (Rowan's Robu bug can't happen here)", throwsOn(() => validateAnswers(F, { am_well: "yes", ready: 7 }), "sleep_job"));
ok("an unknown option is refused", throwsOn(() => validateAnswers(F, { ...good, sleep_job: "amazing" }), "sleep_job"));
ok("ready above 10 is refused", throwsOn(() => validateAnswers(F, { ...good, ready: 11 }), "ready"));
ok("symptoms are dropped when the player is well", !("illness_symptoms" in validateAnswers(F, { ...good, illness_symptoms: "cough" })));
ok("symptoms are kept when the player is not well", validateAnswers(F, { ...good, am_well: "no", illness_symptoms: "cough" }).illness_symptoms === "cough");
ok("'Other ideas' only after 'Something else'", isShown(allQuestions(F).find((q) => q.id === "other_ideas")!, { help_others: "something_else" })
  && !isShown(allQuestions(F).find((q) => q.id === "other_ideas")!, { help_others: "all_set" }));
ok("unknown keys are dropped", !("hack" in validateAnswers(F, { ...good, hack: "x" })));
ok("a blank text answer is no answer", !("areas_note" in validateAnswers(F, { ...good, areas_note: "   " })));

// 25 Nov 2026 (Michael + Adria): what you did yesterday decides what is asked next
const foot = validateAnswers(F, { ...good, yesterday: ["football"], session_rpe: 8, rehab_detail: "ignored", session_minutes: 60, football_load: 9999 });
ok("football → Session RPE is asked and kept", foot.session_rpe === 8);
ok("football only → the rehab note is not kept", !("rehab_detail" in foot));
ok("session minutes and Football Load are no longer asked (hidden, never kept)", !("session_minutes" in foot) && !("football_load" in foot), foot);
const rehab = validateAnswers(F, { ...good, yesterday: ["rehab_prehab", "rest"], session_rpe: 7, rehab_detail: "Bike and Nordics", rest_detail: "Pool" });
ok("rehab + rest → both notes kept, no RPE", rehab.rehab_detail === "Bike and Nordics" && rehab.rest_detail === "Pool" && !("session_rpe" in rehab), rehab);
ok("Session RPE is 1 to 10: 0 is refused", throwsOn(() => validateAnswers(F, { ...good, yesterday: ["football"], session_rpe: 0 }), "session_rpe"));
ok("a poor sleep no longer asks 'anything to modify'", !liveQuestions(F).some((q) => q.id === "sleep_modification") && !("sleep_modification" in validateAnswers(F, { ...good, sleep_job: "below", sleep_modification: "noise" })));
ok("a note under the body chart is optional and kept", validateAnswers(F, { ...good, areas_note: "Tight calf" }).areas_note === "Tight calf" && !("areas_note" in validateAnswers(F, good)));
ok("the last question is about the team", liveQuestions(F).some((q) => q.id === "help_others" && q.label === "What would help the team?"));

// what staff are told about
ok("all well, nothing marked → nothing to report", formReport(F, validateAnswers(F, good)).length === 0);
ok("not well → reported", formReport(F, validateAnswers(F, { ...good, am_well: "no", illness_symptoms: "Sore throat" })).join("|") === "Not well");
const rep = validateAnswers(F, { ...good, areas: ["left_knee"], areas_note: "Swollen" });
ok("an area → reported by name; typed words left out of an alert", formReport(F, rep).join("|") === "Areas: Left Knee|Areas note: written in the app", formReport(F, rep));
ok("typed words included for the app and ClubOS", formReport(F, rep, { withText: true })[1] === "Areas note: Swollen");

ok("red beats amber", formFlag(F, { ...good, ready: 2, am_well: "no" }).level === "red");

// load into the ACWR engine
const l = formLoad(F, foot, "2026-11-01");
ok("the session belongs to YESTERDAY (crosses the month)", l?.date === "2026-10-31", l);
ok("football → training", l?.kind === "training");
ok("no minutes asked → the effort is kept, minutes 'not measured' (never RPE × 0)", l?.rpe === 8 && l?.minutes === null, l);
ok("rehab only → no RPE, no session", formLoad(F, rehab, "2026-11-14") === null);

// sorting + editing
const sleepQ = allQuestions(F).find((q) => q.id === "sleep_job")!;
ok("sleep sorts by option order, not alphabet", (answerSortKey(sleepQ, "well_below") as number) < (answerSortKey(sleepQ, "above") as number));
ok("a new id never collides", newQuestionId(F, "Session RPE") === "session_rpe_2");
ok("two questions with one id are refused", formProblem({ ...F, sections: [{ id: "a", title: "A", questions: [allQuestions(F)[0], allQuestions(F)[0]] }] }) !== null);
ok("a showIf pointing nowhere is refused", formProblem({ ...F, sections: [{ id: "a", title: "A", questions: [{ id: "x", label: "X", type: "text", showIf: { q: "gone", in: ["y"] } }] }] }) !== null);
ok("hidden questions are never asked or kept", !("ready" in validateAnswers({ ...F, sections: F.sections.map((s) => ({ ...s, questions: s.questions.map((q) => (q.id === "ready" ? { ...q, hidden: true } : q)) })) }, { ...good })));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
