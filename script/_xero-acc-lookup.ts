import { withXero } from "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/apps/clubos/.worktrees/mailer/server/xero";
await withXero(1, async (x, t) => { const a = (await x.accountingApi.getAccounts(t)).body.accounts ?? [];
for (const c of a.filter(a => /^(307|484|106|113|103|104|105-01|112-10|200\/05|200\/11|102-02)/.test(a.code ?? ""))) console.log(c.code, c.status, c.type, c.taxType, "·", c.name); });
