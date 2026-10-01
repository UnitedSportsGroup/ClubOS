// WebSMS Connexus adapter — offline proof. Stubs `fetch`; never touches the network, never sends.
//   npx tsx script/test-sms-websms.ts
// Every response shape below is Connexus's documented one (api.websms.co.nz/api/connexus, 1 Oct 2026)
// or the one the Katerina's Beauty adapter observed live (the HTTP-200 "Insufficient funds").
import { WebSmsProvider, mapConnexusStatus } from "../server/marketing/sms/providers/websms";

let pass = 0, fail = 0;
const ok = (cond: unknown, name: string) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const throwsLike = async (fn: () => Promise<unknown>, re: RegExp, name: string) => {
  try { await fn(); ok(false, name); } catch (e: any) { ok(re.test(String(e?.message)), `${name} (${e?.message})`); }
};

type Call = { url: string; init: any };
let calls: Call[] = [];
let script: Array<(c: Call) => Response> = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
(globalThis as any).fetch = async (url: string, init: any) => {
  const c = { url: String(url), init }; calls.push(c);
  const next = script.shift();
  if (!next) throw new Error(`unexpected fetch ${url}`);
  return next(c);
};
const token = (v = "tok-1") => () => json(200, { access_token: v, expires_in: 86400 });

process.env.WEBSMS_CLIENT_ID = "test-id";
process.env.WEBSMS_CLIENT_SECRET = "test-secret";
delete process.env.WEBSMS_SANDBOX;
const p = new WebSmsProvider();

console.log("send");
calls = []; script = [token(), () => json(200, { success: true, status: "accepted", message_id: "1158493", to: "6421234567", parts: 1 })];
const r = await p.send({ to: "+6421234567", body: "Kia ora from CUFC", clientRef: "c12:p34", messageClass: "marketing" });
ok(calls[0].url.endsWith("/auth/token") && String(calls[0].init.body).includes("client_id=test-id"), "authenticates with client id + secret (OAuth2, not a static key)");
const sent = JSON.parse(calls[1].init.body);
ok(calls[1].init.headers.Authorization === "Bearer tok-1", "sends with the bearer token");
ok(sent.to === "6421234567", "number in dialling format, no '+'");
ok(sent.messageClass === "marketing", "messageClass passed through");
ok(sent.messageId === "c12:p34", "clientRef passed as messageId (comes back on the DLR)");
ok(sent.sandbox === undefined, "no sandbox flag unless WEBSMS_SANDBOX=1");
ok(r.providerMessageId === "1158493" && r.segments === 1 && r.costCentsEstimate === 10, "result: id, segments, 10c");

calls = []; script = [() => json(200, { success: true, message_id: 9, parts: 2 })];
await p.send({ to: "+6421234567", body: "x", clientRef: "x".repeat(40) });
const s2 = JSON.parse(calls[0].init.body);
ok(calls.length === 1, "token is cached between sends");
ok(s2.messageId === undefined, "a clientRef over 36 chars is left off, never truncated into a collision");
ok(s2.messageClass === "marketing", "messageClass defaults to marketing");

console.log("failures");
calls = []; script = [() => json(200, { success: false, message: "Insufficient funds", required: 0.115 })];
await throwsLike(() => p.send({ to: "+6421234567", body: "x", clientRef: "a" }), /Insufficient funds/, "HTTP 200 with success:false is a FAILURE");
calls = []; script = [() => json(200, { success: true, messages: [{ success: false, message: "Invalid number" }], summary: { failed: 1 } })];
await throwsLike(() => p.send({ to: "+6421234567", body: "x", clientRef: "a" }), /Invalid number/, "a per-message success:false in a bulk-shaped reply is a FAILURE");
calls = []; script = [() => json(401, {}), token("tok-2"), () => json(200, { success: true, message_id: 77, parts: 1 })];
const r3 = await p.send({ to: "+6421234567", body: "x", clientRef: "a" });
ok(r3.providerMessageId === "77" && calls[1].url.endsWith("/auth/token") && calls[2].init.headers.Authorization === "Bearer tok-2", "a 401 refreshes the token and retries once");
calls = []; script = [() => json(200, { success: true, status: "accepted" })];
await throwsLike(() => p.send({ to: "+6421234567", body: "x", clientRef: "a" }), /no message_id/, "accepted with no message_id is refused (nothing to join a DLR to)");

process.env.WEBSMS_SANDBOX = "1";
calls = []; script = [() => json(200, { success: true, message_id: 5, parts: 1 })];
await p.send({ to: "+6421234567", body: "x", clientRef: "a" });
ok(JSON.parse(calls[0].init.body).sandbox === true, "WEBSMS_SANDBOX=1 sets sandbox:true");
delete process.env.WEBSMS_SANDBOX;

console.log("delivery receipts");
const dlr = (statusCode: number) => p.parseDeliveryReceipt({ headers: {}, body: { type: "dlr", messageId: "987654", status: "X", statusCode, timestamp: 1759300000 } });
ok(dlr(1)?.status === "delivered" && dlr(1)?.providerMessageId === "987654", "1 DELIVRD → delivered, joined on messageId");
ok(dlr(1)?.at.getTime() === 1759300000 * 1000, "unix-seconds timestamp read as a date");
ok(dlr(2)?.status === "failed" && dlr(16)?.status === "failed", "2/16 UNDELIV → failed");
ok(dlr(-1)?.status === "failed", "-1 BLOCKED (unsubscribed/invalid) → failed");
ok(dlr(4)?.status === "expired", "4 QUEUED/expired → expired");
ok(dlr(8) === null, "8 ACCEPTD is in flight → not terminal");
ok(mapConnexusStatus(999) === null, "an unknown code is never recorded as a result");
ok(p.parseDeliveryReceipt({ headers: {}, body: { type: "SMS", from: "+6421", body: "STOP" } }) === null, "an inbound reply is not mistaken for a DLR");

console.log("inbound");
const inb = p.parseInbound({ headers: {}, body: { type: "SMS", messageId: "555", from: "+6421234567", to: "2190", body: "STOP", timestamp: 1759300000 } });
ok(inb?.from === "+6421234567" && inb?.body === "STOP" && inb?.providerMessageId === "555", "reads the sender's number and text (the legacy adapter could not)");
ok(p.parseInbound({ headers: {}, body: { type: "SMS", from: "6421234567", body: "hi" } })?.from === "+6421234567", "a sender without '+' is normalised to E.164 so STOP finds the profile");
ok(p.parseInbound({ headers: {}, body: { type: "dlr", messageId: "1", statusCode: 1 } }) === null, "a DLR is not mistaken for an inbound reply");
ok(p.parseInbound({ headers: {}, body: {} }) === null, "an empty body parses to nothing");

console.log("config");
delete process.env.WEBSMS_CLIENT_ID;
await throwsLike(() => new WebSmsProvider().send({ to: "+6421", body: "x", clientRef: "a" }), /WEBSMS_CLIENT_ID is not set/, "no credentials = a clear error, not a silent send");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
