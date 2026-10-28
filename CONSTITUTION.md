# ClubOS Constitution

The rules every change to ClubOS must keep. Check a change against this list before it ships
(`/implement` Phase 3, step 4). Written 29 Oct 2026 from the legal and privacy review in
`outputs/legal-compliance/2026-10-29-clubos/` (AIOS workspace). If a rule is wrong, change it
here, on purpose. Never route around it quietly.

ClubOS holds children's names, dates of birth, addresses, ethnicity, medical and allergy notes,
and families' payments. In New Zealand that is governed by the Privacy Act 2020 (the 13 IPPs,
including IPP 3A since 1 May 2026), the Unsolicited Electronic Messages Act 2007 and the Fair
Trading Act 1986. Once signed, NZ Football's Third Party Integration Deed adds to them.

## 1. Who can see what

1. **Every `/api/admin` route is staff-only.** A signed-in person must be a super admin or a
   member of a workspace (`requireStaffForAdminApi`, server/auth.ts). Public signup exists for
   the fan apps, so "signed in" never means "staff".
2. **A route that returns people is gated by tab AND workspace**, never `requireAuth` alone.
   Send `X-Workspace-Slug` (`workspaceFetch()`); answer 404 out of scope.
3. **Super admin is not a test of access.** Prove a feature as ordinary staff (View As, or the
   staff-parity check) before calling it done.
4. **Least access.** A programme lead sees their programme. Payroll, contracts, medical notes and
   bank details sit behind locked tabs or per-person grants.

## 2. What we collect, and saying so

5. **Collect only what the purpose needs.** A new personal-data field needs a reason written next
   to it in the schema.
6. **Every form that collects personal data links the privacy statement.** The statement names
   every party the data goes to (NZ Football/Sporty, Stripe, Meta, Google, Anthropic, Resend, the
   SMS provider, Fly.io, Supabase). Adding a new outside service means updating the statement in
   the same change.
7. **A child's data comes from their parent or guardian.** No child creates their own account.
8. **Blank means unknown.** Never default a fact about a person, such as ethnicity, consent or
   medical status.

## 3. Where data goes

9. **No new outside service touches personal data without sign-off.** Record it in the
   sub-processor list: what data it gets, the country, and why.
10. **Trackers never fire on pages that show children's, medical or ethnicity data.** This covers
    the Meta pixel, Conversions API and GA4. Raw IP addresses are never sent to an ad platform.
11. **Logs hold no personal data.** No response bodies, no exports, no tokens.
12. **No personal data in git.** Rosters, exports and contact files go to Club Drive, never into
    the repo.

## 4. AI (Rambo and every model call)

13. **AI tools are hand-written, read-only and permission-checked**, rebuilt per message from the
    asker's live access. The model never writes SQL.
14. **Medical, allergy and ethnicity columns never enter a model's context.**
15. **NZ Football Membership Data stays out of Rambo, the Mailer and analytics** until NZF agrees
    in writing (deed cl. 10.2).
16. **Club data is never used to train a model.** Use only API providers that do not train on
    inputs.

## 5. Messages to families

17. **Marketing needs consent and a working unsubscribe, honoured within 5 working days**
    (UEMA s11). Opt-outs are filtered at send. SMS carries STOP.
18. **Operational messages stay operational.** A receipt, a roll change or a cancellation never
    carries a sales pitch.

## 6. Money

19. **The server decides every amount.** Recurring or deposit terms are stated next to the pay
    button in real numbers.
20. **Paid means paid.** Use `REAL_REGISTRATION_STATUSES`. Never hard-delete a money record:
    remove it with who, when and why.

## 7. Requests, retention, breaches

21. **We can answer "what do you hold about me?" within 20 working days** and correct it. Deletion
    removes the person and keeps the anonymised financial record (7 years).
22. **Data has a keep-by date** (retention schedule, draft). Past it, it is reviewed or purged.
23. **A suspected breach goes to the Privacy Officer within 1 hour.** That includes an outage that
    locks us out of data. NZF hears within 48 hours, and the OPC is notified of serious harm as
    soon as practicable.

## 8. Shipping

24. **Deploy only with `./deploy.sh`.** Probe production first and push after.
25. **A security or privacy fix ships with a test that fails without it.**
