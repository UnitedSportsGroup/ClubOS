// What every campaign email is put through before it leaves — proven, not assumed.
//
// The two claims worth holding to: a merge tag never reaches a recipient as
// braces, and an unsubscribe link is always there. Both are the kind of thing
// that is fine in every test you write by hand and wrong on the one email that
// goes to 3,800 people.
//
//   npx tsx script/_verify-mailer-render.ts

import {
  applyMergeTags,
  hasUnsubscribeLink,
  renderForRecipient,
  visibleTextLength,
} from "../server/mailer-render";

let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

const UNSUB = "https://join.cufc.co.nz/api/public/unsubscribe?o=1&e=a%40b.com&t=tok";
const ctx = { email: "a@b.com", unsubscribeUrl: UNSUB, firstName: "Ada", lastName: "Lovelace" };

// ── merge tags ───────────────────────────────────────────────────────────────
ok(applyMergeTags("Hi {{first_name}},", ctx) === "Hi Ada,", "{{first_name}} resolves");
ok(applyMergeTags("Hi {{ first_name }},", ctx) === "Hi Ada,", "whitespace inside the braces is tolerated");
ok(applyMergeTags("Hi {{First_Name}},", ctx) === "Hi Ada,", "tags are case-insensitive");
ok(applyMergeTags("{{last_name}}", ctx) === "Lovelace", "{{last_name}} resolves");
ok(applyMergeTags("{{email}}", ctx) === "a@b.com", "{{email}} resolves");
ok(applyMergeTags("{{unsubscribe_url}}", ctx) === UNSUB, "{{unsubscribe_url}} resolves");

ok(
  applyMergeTags("Hi {{first_name}},", { email: "x@y.com", unsubscribeUrl: UNSUB }) === "Hi there,",
  "an unknown first name reads 'Hi there,' — never a blank or a guess",
);
ok(
  applyMergeTags("Hi {{first_name}},", { ...ctx, firstName: "   " }) === "Hi there,",
  "a whitespace-only name falls back too",
);
ok(
  applyMergeTags("{{promo_code}}", ctx) === "{{promo_code}}",
  "an unknown tag is left visible rather than silently deleted",
);
ok(
  applyMergeTags("{{first_name}}", { ...ctx, firstName: "Tom & <b>Jerry</b>" }) ===
    "Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;",
  "a name out of the database is escaped — it cannot break or inject into the markup",
);

// ── the unsubscribe guarantee ────────────────────────────────────────────────
const bare = "<html><body><p>Come to the camp.</p></body></html>";
const rendered = renderForRecipient(bare, ctx);
ok(rendered.includes(UNSUB), "a design with no unsubscribe link gets one");
ok(
  rendered.indexOf("</body>") > rendered.indexOf(UNSUB),
  "the footer goes INSIDE </body>, where clients keep it",
);

const withTag = "<html><body><p>Hi</p><a href='{{unsubscribe_url}}'>Unsubscribe</a></body></html>";
const once = renderForRecipient(withTag, ctx);
ok(once.split(UNSUB).length - 1 === 1, "a design that uses the merge tag is not given a second footer");

ok(
  !hasUnsubscribeLink("<p>To unsubscribe, reply STOP</p>", UNSUB),
  "the word 'unsubscribe' in prose does not count as a link",
);
ok(
  hasUnsubscribeLink(`<a href="https://join.cufc.co.nz/api/public/unsubscribe?o=1&e=z">x</a>`, UNSUB),
  "a hand-written link at the public endpoint does count",
);

const noBody = "<p>fragment, no body tag</p>";
ok(renderForRecipient(noBody, ctx).includes(UNSUB), "a fragment still gets the footer");

// Two recipients must not see each other's links.
const a = renderForRecipient(withTag, { email: "a@b.com", unsubscribeUrl: "URL_A" });
const b = renderForRecipient(withTag, { email: "c@d.com", unsubscribeUrl: "URL_B" });
ok(a.includes("URL_A") && !a.includes("URL_B"), "each recipient gets their own unsubscribe URL");
ok(b.includes("URL_B") && !b.includes("URL_A"), "and only their own");

// ── the empty-design guard ───────────────────────────────────────────────────
ok(visibleTextLength("<html><head><style>p{color:red}</style></head><body></body></html>") === 0,
  "a document with only styling counts as empty");
ok(visibleTextLength('<div style="height:20px">&nbsp;</div>') === 0, "a spacer counts as empty");
ok(visibleTextLength("<html><body><h1>Camp is on</h1></body></html>") > 5, "real copy counts as content");


// ── the open pixel ──────────────────────────────────────────────────────────
// 🔴 Without this the Mailer can never record an open, and it shipped that way:
// runBroadcastQueue always passed a pixel URL as sendOne's SECOND argument, but
// a callback written `(email) => …` is valid TypeScript, so the CUFC mailer
// silently opted out. Every campaign read "Not opened" for everyone, forever.
{
  const base = "<html><body><p>Hello</p></body></html>";
  const withPixel = renderForRecipient(base, { email: "a@b.c", unsubscribeUrl: "https://x/u", pixelUrl: "https://app.usg.co.nz/api/public/email/open?c=1" });
  ok(withPixel.includes("https://app.usg.co.nz/api/public/email/open?c=1"), "the pixel URL is embedded when one is given");
  ok(/<img[^>]+width="1"[^>]+height="1"/.test(withPixel), "it is a 1x1 image");
  ok(withPixel.indexOf("<img") < withPixel.indexOf("</body>"), "the pixel sits INSIDE </body>, not after it");
  ok(withPixel.includes('alt=""') && withPixel.includes("display:none"), "it is invisible — no broken-image box mid-campaign");

  const without = renderForRecipient(base, { email: "a@b.c", unsubscribeUrl: "https://x/u" });
  ok(!without.includes("<img"), "no pixel is added when none is given — other mailers are untouched");

  // ⚠️ The obvious assertion here is wrong and passed for the wrong reason at
  // first: `src="…"` is followed by width="1", so a regex looking for "another
  // quote after the src" matches whatever the escaping does. Pull out the src
  // VALUE and check that, which is the thing that could actually break out.
  const quoted = renderForRecipient(base, { email: "a@b.c", unsubscribeUrl: "https://x/u", pixelUrl: 'https://x/p?a="b onerror=alert(1)' });
  const src = /<img[^>]*\ssrc="([^"]*)"/.exec(quoted)?.[1] ?? "";
  ok(src.includes("&quot;"), "a quote in the URL is escaped to &quot;");
  ok(!src.includes('"'), "the src value carries no raw quote to close the attribute with");
  ok(!/onerror\s*=/.test(quoted.slice(quoted.indexOf("<img")).split(">")[0].replace(src, "")), "nothing escapes into a new attribute");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
