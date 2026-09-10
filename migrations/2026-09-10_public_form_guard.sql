-- Anti-spam for every PUBLIC form that emails the address typed into it.
--
-- 10 Sept 2026. atarangilodge.com's enquiry form was found to have mailed 25
-- HARVESTED third-party addresses in one day, from a domain verified on Resend
-- eight days earlier. An audit of every app found the same shape live in
-- ClubOS: the MFL league waitlist, the CUGC free-session booking and the United
-- Prints quote request all send a confirmation to whatever address the request
-- supplied, with no honeypot, no rate limit and no CAPTCHA between them and a
-- bot. Those three sit on minifootball.co.nz, cugc.co.nz and
-- unitedprints.co.nz — far more findable than a lodge in Kaikoura.
--
-- One table, every form. Deliberately not per-form counters: a bot rate limited
-- on the waitlist simply moves to the quote form. One clock, one log.
--
-- 🔴 ClubOS runs TWO Fly machines. The in-memory limiters already in
-- hiring-routes.ts and open-training-routes.ts are per-machine, so each is
-- really only half a limit. This one is in Postgres, which both machines share.

CREATE TABLE IF NOT EXISTS public_form_submissions (
  id          serial PRIMARY KEY,
  form        text NOT NULL,             -- mfl_waitlist | cugc_free_session | print_quote | open_training
  ip          text,
  email       text,
  outcome     text NOT NULL,             -- accepted | held
  reasons     text[],
  page        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_form_submissions_ip_idx    ON public_form_submissions (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS public_form_submissions_email_idx ON public_form_submissions (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS public_form_submissions_form_idx  ON public_form_submissions (form, created_at DESC);

ALTER TABLE public_form_submissions ENABLE ROW LEVEL SECURITY;
