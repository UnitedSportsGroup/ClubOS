// The pure A/B-test rules, proven without a database.
//   npx tsx script/_test-mailer-tests.ts
import {
  chooseWinner, describeTestPlan, extractEmailLinks, isSuspectedBotUserAgent, isTrackableHref,
  replaceLinkText, splitForTest, trackEmailLinks, validateMailerTest, visibleTextOf, waitLabel,
} from "../shared/mailer-tests";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

const MJML_BUTTON = `<td align="center" bgcolor="#1d4ed8" style="border:none;border-radius:6px;"><a href="https://cufc.co.nz/register?x=1&amp;y=2" style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:15px;padding:12px 28px;text-decoration:none;" target="_blank">Register now</a></td>`;
const HTML = `<!doctype html><html><body>
<p>Hi {{first_name}}, <a href="https://cufc.co.nz/programmes">see the <b>programmes</b></a> and <a href="mailto:info@cufc.co.nz">email us</a>.</p>
${MJML_BUTTON}
<p><a href="https://cufc.co.nz/register?x=1&amp;y=2" style="display:inline-block;padding:10px">Register now</a></p>
<a href="https://cufc.co.nz/"><img src="https://app.usg.co.nz/mailer/crests/cufc.png" alt=""></a>
<a href="{{unsubscribe_url}}">Unsubscribe</a>
<a href="https://join.cufc.co.nz/api/public/unsubscribe?o=1&amp;e=x">Unsubscribe</a>
<a href="https://cufc.co.nz/shop"><span style="color:#fff">Shop &amp; <i>save</i></span></a>
</body></html>`;

console.log("\nmailer A/B rules\n");

// ── Links ───────────────────────────────────────────────────────────────────
const links = extractEmailLinks(HTML);
ok("four distinct links found from five anchors (mailto, the tag and /api/ left out)", links.length === 4, links.map((l) => `${l.kind}:${l.text}`).join(" | "));
ok("the button comes first", links[0].kind === "button" && links[0].text === "Register now", JSON.stringify(links[0]));
ok("two anchors with the same href and wording are ONE link, counted twice", links[0].count === 2);
ok("the picture link has no words and is last", links[links.length - 1].kind === "image" && links[links.length - 1].text === "");
ok("entities inside the wording are decoded", links.some((l) => l.text === "Shop & save"));
ok("a nested bold reads as plain words", links.some((l) => l.text === "see the programmes"));
ok("the href keeps its &amp; exactly as written", links[0].href === "https://cufc.co.nz/register?x=1&amp;y=2");
ok("visibleTextOf collapses whitespace and tags", visibleTextOf(" <b>A</b>\n  B&nbsp;C ") === "A B C");
ok("a merge-tag href is not trackable", !isTrackableHref("{{unsubscribe_url}}"));
ok("an /api/ href is not trackable", !isTrackableHref("https://join.cufc.co.nz/api/public/unsubscribe?o=1"));
ok("a javascript: href is not trackable", !isTrackableHref("javascript:alert(1)"));

const tracked = trackEmailLinks(HTML, links, (l) => `https://app.usg.co.nz/e/c/1/2/${l.idx}/sig`);
ok("every trackable anchor (five) now points at the redirect", (tracked.match(/https:\/\/app\.usg\.co\.nz\/e\/c\/1\/2\//g) || []).length === 5, String((tracked.match(/\/e\/c\//g) || []).length));
ok("the mailto, the merge tag and the unsubscribe link are untouched", tracked.includes('href="mailto:info@cufc.co.nz"') && tracked.includes('href="{{unsubscribe_url}}"') && tracked.includes("/api/public/unsubscribe?o=1"));
ok("the button's words and style survive the rewrite", tracked.includes(">Register now</a>") && tracked.includes("padding:12px 28px"));
ok("the two anchors sharing a link carry the same idx", (tracked.match(new RegExp(`/e/c/1/2/${links[0].idx}/sig`, "g")) || []).length === 2);

// ── Variant B of a link test ────────────────────────────────────────────────
const b = replaceLinkText(HTML, "Register now", "Save my spot");
ok("both buttons reading the target are reworded", b.replaced === 2 && (b.html.match(/>Save my spot</g) || []).length === 2);
ok("nothing else changed", b.html.includes("see the <b>programmes</b>") && b.html.includes("Unsubscribe"));
const b2 = replaceLinkText(HTML, "Shop & save", "Shop <now>");
ok("a wording with tags inside keeps its span and escapes the new words", b2.replaced === 1 && /<span style="color:#fff">Shop &lt;now&gt;(<i><\/i>)?<\/span>/.test(b2.html) && !/save/.test(b2.html), b2.html.match(/<a href="https:\/\/cufc\.co\.nz\/shop">[\s\S]*?<\/a>/)?.[0]);
ok("a wording not in the email replaces nothing", replaceLinkText(HTML, "Nope", "x").replaced === 0);
ok("the reworded B still tracks under the ORIGINAL link's idx", (() => {
  const swapped = links.map((l) => (l.text === "Register now" ? { ...l, text: "Save my spot" } : l));
  const t = trackEmailLinks(b.html, swapped, (l) => `https://app.usg.co.nz/e/c/1/2/${l.idx}/s`);
  return (t.match(new RegExp(`/e/c/1/2/${links[0].idx}/s`, "g")) || []).length === 2;
})());

// ── The split ───────────────────────────────────────────────────────────────
const list = Array.from({ length: 100 }, (_, i) => `p${i}@x.nz`);
const s20 = splitForTest(list, 20, 42);
ok("20% of 100 = 10 A + 10 B, 80 wait", s20.a.length === 10 && s20.b.length === 10 && s20.rest.length === 80);
ok("nobody is in two groups and nobody is missing", new Set([...s20.a, ...s20.b, ...s20.rest]).size === 100);
ok("the same seed gives the same split (a resumed send)", JSON.stringify(splitForTest(list, 20, 42)) === JSON.stringify(s20));
ok("a different seed gives a different split", JSON.stringify(splitForTest(list, 20, 43)) !== JSON.stringify(s20));
ok("the split is shuffled, not the first N", s20.a.join() !== list.slice(0, 10).join());
const s100 = splitForTest(list, 100, 1);
ok("100% = everyone in, half and half, nobody waiting", s100.a.length === 50 && s100.b.length === 50 && s100.rest.length === 0);
const small = splitForTest(list.slice(0, 7), 20, 1);
ok("under 10 people everyone is in the test", small.rest.length === 0 && small.a.length === 4 && small.b.length === 3);
const s11 = splitForTest(list.slice(0, 11), 20, 1);
ok("11 people at 20% = at least one each side and 9 waiting", s11.a.length === 1 && s11.b.length === 1 && s11.rest.length === 9);
const odd = splitForTest(list.slice(0, 51), 100, 1);
ok("an odd list gives A the extra one", odd.a.length === 26 && odd.b.length === 25);

// ── The verdict ─────────────────────────────────────────────────────────────
ok("more opens wins", chooseWinner({ sent: 100, hits: 20 }, { sent: 100, hits: 31 }, "opens").winner === "B");
ok("…and the reason is the metric", chooseWinner({ sent: 100, hits: 20 }, { sent: 100, hits: 31 }, "opens").reason === "opens");
ok("rates, not counts: 5 of 10 beats 20 of 100", chooseWinner({ sent: 10, hits: 5 }, { sent: 100, hits: 20 }, "clicks").winner === "A");
ok("a tie keeps A", chooseWinner({ sent: 50, hits: 10 }, { sent: 50, hits: 10 }, "opens").reason === "tie");
ok("nothing measured keeps A", chooseWinner({ sent: 0, hits: 0 }, { sent: 0, hits: 0 }, "clicks").winner === "A");

// ── Bots ────────────────────────────────────────────────────────────────────
ok("a phone's Safari is a person", !isSuspectedBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"));
ok("Outlook's Safe Links scanner is not", isSuspectedBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) SafeLinks"));
ok("a bare curl is not", isSuspectedBotUserAgent("curl/8.4.0"));
ok("no user agent at all is not", isSuspectedBotUserAgent(""));

// ── Validation ──────────────────────────────────────────────────────────────
const vs = validateMailerTest({ kind: "subject", b: "Term 4 is open", samplePct: 20, waitMinutes: 120 }, "Register for Term 4", HTML);
ok("a subject test validates, judged by opens", vs.ok && vs.plan.metric === "opens" && vs.plan.variantA === "Register for Term 4");
ok("the same subject twice is refused", !validateMailerTest({ kind: "subject", b: "Same" }, "Same", HTML).ok);
ok("a blank second subject is refused", !validateMailerTest({ kind: "subject", b: "  " }, "A", HTML).ok);
const vl = validateMailerTest({ kind: "link", target: "Register now", b: "Save my spot", samplePct: 50, waitMinutes: 60 }, "S", HTML);
ok("a link test validates, judged by clicks, A = the wording", vl.ok && vl.plan.metric === "clicks" && vl.plan.variantA === "Register now" && vl.plan.variantB === "Save my spot");
ok("a link wording the email does not have is refused", !validateMailerTest({ kind: "link", target: "Buy now", b: "x" }, "S", HTML).ok);
ok("a share of 0 is refused", !validateMailerTest({ kind: "subject", b: "B", samplePct: 0 }, "A", HTML).ok);
ok("an unknown kind is refused", !validateMailerTest({ kind: "colour", b: "B" }, "A", HTML).ok);

// ── Words ───────────────────────────────────────────────────────────────────
ok("wait labels read as a person says them", waitLabel(60) === "1 hour" && waitLabel(120) === "2 hours" && waitLabel(1440) === "24 hours" && waitLabel(0) === "straight away");
const plan = describeTestPlan(3800, { samplePct: 20, waitMinutes: 120, metric: "opens" });
ok("the plan names the numbers", /A to 380 and B to 380 now, then whichever has more opens goes to the other 3,040 after 2 hours\./.test(plan), plan);
ok("the 100% plan says nobody waits", /Nobody waits/.test(describeTestPlan(100, { samplePct: 100, waitMinutes: 0, metric: "clicks" })));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
