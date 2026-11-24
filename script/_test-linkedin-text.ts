/** LinkedIn stores post words with its own marks; check they come back as plain words. npx tsx script/_test-linkedin-text.ts */
process.env.DATABASE_URL ||= "postgres://x:x@localhost/x";
const { linkedinPlainText } = await import("../server/social/sync");
let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => { const ok = got === want; if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); };
eq("a mention becomes the name", linkedinPlainText("Thanks @[Fusion5](urn:li:organization:123) for the night"), "Thanks Fusion5 for the night");
eq("a hashtag becomes #tag", linkedinPlainText("Game day {hashtag|\\#|OneUnited}"), "Game day #OneUnited");
eq("escaped punctuation is plain", linkedinPlainText("3-1 win \\(away\\) \\#proud \\_now\\_"), "3-1 win (away) #proud _now_");
eq("empty is null", linkedinPlainText(""), null);
eq("nothing is null", linkedinPlainText(undefined), null);
console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
