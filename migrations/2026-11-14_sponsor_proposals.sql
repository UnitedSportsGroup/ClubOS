-- Sponsor proposals — a proposal page built from a form, the acceptance on it,
-- and the contract and partner it turns into.
--
-- Ryan, 14 Nov 2026: "be good to get those contract and proposal templates in
-- club OS for easy builds and sends."
--
-- United Sports Group → Sponsorship → Prospects → Proposals & contracts.
--
-- 🔴 No status column. Draft / sent / opened / accepted / contract out / signed
-- are worked out on read (shared/sponsor-proposals.ts proposalStage) from the
-- timestamps here, the open events, and the linked e-Sign document's own status.
-- 🔴 A fee of NULL is "not priced yet", never 0. No default.
-- 🔴 The public page is found by `token` only: random, not guessable, not listed.
--
-- Applied and proven by script/apply-sponsor-proposals.ts (dry run by default).
-- No BEGIN/COMMIT here: the applier owns the transaction.

CREATE TABLE IF NOT EXISTS sponsor_proposals (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token               text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  -- siu · cufc (shared/sponsor-proposals.ts PROPOSAL_BRANDS). Validated there.
  brand               text NOT NULL,
  sponsor_company     text NOT NULL CHECK (btrim(sponsor_company) <> ''),
  -- The name the agreement is made out to, when it differs from the trading name.
  sponsor_legal_name  text,
  contact_name        text,
  contact_email       text,
  contact_phone       text,
  -- A picture ClubOS hosts itself (/mailer/img/<key>), and the ground it was drawn for.
  logo_url            text,
  logo_ground         text CHECK (logo_ground IS NULL OR logo_ground IN ('light', 'dark')),
  partnership_title   text NOT NULL DEFAULT '',
  season_label        text,
  intro               text,
  -- [{ name, detail, priceCents|null }]
  assets              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assets) = 'array'),
  -- [text]
  benefits            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits) = 'array'),
  -- Keys from AUDIENCE_STATS. The figures themselves are never stored here.
  audience_keys       text[] NOT NULL DEFAULT '{}',
  term_start          date,
  term_end            date,
  -- Per term, excluding GST. NULL = not priced yet.
  fee_cents           bigint CHECK (fee_cents IS NULL OR fee_cents >= 0),
  payment_terms       text,
  contra              text,
  special_conditions  text,
  deal_id             integer REFERENCES sponsorship_deals(id) ON DELETE SET NULL,
  published_at        timestamptz,
  withdrawn_at        timestamptz,
  -- Set once, by the sponsor, on the public page.
  accepted_at         timestamptz,
  accepted_name       text,
  accepted_email      text,
  accepted_role       text,
  accepted_held       boolean NOT NULL DEFAULT false,
  accepted_reasons    text[],
  -- The Sponsorship Agreement made from this proposal, and what signing it made.
  esign_document_id   integer REFERENCES esign_documents(id) ON DELETE SET NULL,
  partner_id          integer REFERENCES sponsorship_partners(id) ON DELETE SET NULL,
  partner_contract_id integer REFERENCES sponsorship_partner_contracts(id) ON DELETE SET NULL,
  created_by          integer REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Archived, never deleted: a proposal a sponsor has seen is a record.
  archived_at         timestamptz,
  CONSTRAINT sponsor_proposals_term_chk CHECK (term_start IS NULL OR term_end IS NULL OR term_end >= term_start),
  -- An acceptance carries who accepted, and only a published proposal can be accepted.
  CONSTRAINT sponsor_proposals_accept_who_chk CHECK ((accepted_at IS NULL) = (accepted_name IS NULL)),
  CONSTRAINT sponsor_proposals_accept_published_chk CHECK (accepted_at IS NULL OR published_at IS NOT NULL),
  -- A partner contract row is only ever made by a signed agreement.
  CONSTRAINT sponsor_proposals_contract_needs_doc_chk CHECK (partner_contract_id IS NULL OR esign_document_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sponsor_proposals_org_idx ON sponsor_proposals (organization_id, created_at DESC);
-- One proposal per agreement, and one partner contract per proposal.
CREATE UNIQUE INDEX IF NOT EXISTS sponsor_proposals_esign_doc_idx ON sponsor_proposals (esign_document_id) WHERE esign_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sponsor_proposals_partner_contract_idx ON sponsor_proposals (partner_contract_id) WHERE partner_contract_id IS NOT NULL;

-- Page opens and the acceptance, one row each. Append-only in practice.
CREATE TABLE IF NOT EXISTS sponsor_proposal_events (
  id          bigserial PRIMARY KEY,
  proposal_id integer NOT NULL REFERENCES sponsor_proposals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('open', 'accept')),
  visitor_id  text,
  device      text,
  -- A signed-in member of staff looking at it. Never counted as the sponsor.
  is_staff    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsor_proposal_events_proposal_idx ON sponsor_proposal_events (proposal_id, created_at);

ALTER TABLE sponsor_proposals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_proposal_events ENABLE ROW LEVEL SECURITY;
