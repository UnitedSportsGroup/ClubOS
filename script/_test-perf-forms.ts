// Unit tests for shared/perf-forms.ts — the check-in form engine.
//   npx tsx script/_test-perf-forms.ts
import {
  AnswerError, BODY_REGIONS, SI_UNITED_CHECK_IN as F, answerSortKey, answerText, allQuestions, formFlag, formLoad,
  formProblem, isShown, newQuestionId, regionLabel, validateAnswers,
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
  "Areas I'm managing", "What did I do yesterday?", "Session RPE", "Session Minutes", "Football Load", "Anything that would help others this week?", "Other ideas"])
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
ok("a blank text answer is no answer", !("sleep_modification" in validateAnswers(F, { ...good, sleep_job: "below", sleep_modification: "   " })));

// calc
const withLoad = validateAnswers(F, { ...good, session_rpe: 8, session_minutes: 60 });
ok("Football Load = RPE × minutes (Rowan's 8 × 60 = 480)", withLoad.football_load === 480, withLoad);
ok("a load sent by the phone is ignored and worked out here", validateAnswers(F, { ...good, session_rpe: 2, session_minutes: 30, football_load: 9999 }).football_load === 60);
ok("no minutes, no load", !("football_load" in validateAnswers(F, { ...good, session_rpe: 6 })));

// body map
ok("Smartabase region names: 'Right Posterior Lower Leg / Foot'", regionLabel("right_posterior_lower_leg_foot") === "Right Posterior Lower Leg / Foot");
ok("'Right Pelvis' exists", BODY_REGIONS.some((r) => r.label === "Right Pelvis"));
ok("every region key is unique", new Set(BODY_REGIONS.map((r) => r.key)).size === BODY_REGIONS.length);
ok("a made-up area is refused", throwsOn(() => validateAnswers(F, { ...good, areas: ["left_wing"] }), "areas"));
ok("areas print as words", answerText(allQuestions(F).find((q) => q.id === "areas")!, ["right_pelvis", "left_upper_leg"]) === "Right Pelvis, Left Upper Leg");

// flags
ok("a well, ready, normal-sleep player is not flagged", formFlag(F, good).level === null);
ok("not well → take care", formFlag(F, { ...good, am_well: "no" }).level === "amber");
ok("ready 3 → concern", formFlag(F, { ...good, ready: 3 }).level === "red");
ok("ready 5 → take care, with the number", (() => { const f = formFlag(F, { ...good, ready: 5 }); return f.level === "amber" && f.reasons.includes("Ready 5/10"); })());
ok("sleep well below normal → take care", formFlag(F, { ...good, sleep_job: "well_below" }).reasons.includes("Sleep well below normal"));
ok("three areas → take care", formFlag(F, { ...good, areas: ["head", "neck", "right_pelvis"] }).reasons.includes("Managing 3 areas"));
ok("red beats amber", formFlag(F, { ...good, ready: 2, am_well: "no" }).level === "red");

// load into the ACWR engine
const l = formLoad(F, withLoad, "2026-11-01");
ok("the session belongs to YESTERDAY (crosses the month)", l?.date === "2026-10-31", l);
ok("football → training", l?.kind === "training");
ok("rehab only → other", formLoad(F, { ...withLoad, yesterday: ["rehab_prehab"] }, "2026-11-14")?.kind === "other");
ok("rest with 0 minutes → no session", formLoad(F, { ...good, session_rpe: 0, session_minutes: 0 }, "2026-11-14") === null);

// sorting + editing
const sleepQ = allQuestions(F).find((q) => q.id === "sleep_job")!;
ok("sleep sorts by option order, not alphabet", (answerSortKey(sleepQ, "well_below") as number) < (answerSortKey(sleepQ, "above") as number));
ok("a new id never collides", newQuestionId(F, "Session RPE") === "session_rpe_2");
ok("two questions with one id are refused", formProblem({ ...F, sections: [{ id: "a", title: "A", questions: [allQuestions(F)[0], allQuestions(F)[0]] }] }) !== null);
ok("a showIf pointing nowhere is refused", formProblem({ ...F, sections: [{ id: "a", title: "A", questions: [{ id: "x", label: "X", type: "text", showIf: { q: "gone", in: ["y"] } }] }] }) !== null);
ok("hidden questions are never asked or kept", !("ready" in validateAnswers({ ...F, sections: F.sections.map((s) => ({ ...s, questions: s.questions.map((q) => (q.id === "ready" ? { ...q, hidden: true } : q)) })) }, { ...good })));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
