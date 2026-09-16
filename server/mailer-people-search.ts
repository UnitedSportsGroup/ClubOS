// "I only know the player's name." — the Mailer's recipient search.
//
// Daniel, 2026-09-10, relaying Olga: "she needs this kind of search by auto
// contacts for our clubos mailer as she don't know parents or kids emails and
// sometimes only knows player name, so needs to be able to easily search and as
// she's typing it's showing what we have, as well the option to just enter a
// completely new custom email too."
//
// 🔴 THE WHOLE POINT: A PLAYER'S EMAIL IS USUALLY THEIR PARENT'S. Olga searches
// "Beauden Whittle" and the address that reaches him is mirrenleigh7@gmail.com,
// which belongs to Mirren Harvey — a different surname. So a hit on a CHILD
// returns the GUARDIAN's address, and says whose it is, every time. A search
// that silently attached a child's own (usually empty) email field would look
// like it worked and email nobody.
//
// 🔴 A PERSON WITH NO REACHABLE ADDRESS IS STILL SHOWN, greyed, with the reason.
// Friendly Manager does exactly this (a dimmed "+ contacts"), and it is the
// honest answer: hiding them makes Olga search again for someone who is really
// there, and tells her nothing about why she cannot reach them.
//
// 🔴 UNFINISHED CHECKOUTS ARE HIDDEN, per the standing rule — a person whose
// only tie to the club is an abandoned checkout is not a registration and must
// not appear on a staff screen. FM-imported families are never hidden.
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { hiddenContactIds } from "./registration-visibility";

export type PersonHit = {
  key: string;                    // contact-123
  contactId: number;
  name: string;
  type: string;                   // player | guardian | staff …
  /** The address that actually reaches this person. */
  email: string | null;
  /** Whose mailbox it is, when it is not their own. */
  emailOwner: string | null;
  /** Why there is no address, when there is none. */
  unreachable: string | null;
  detail: string | null;          // a programme, for telling two same-names apart
};

export function registerMailerPeopleSearch(app: Express, requireAuth: any) {
  /**
   * Type-ahead over the people this club can email.
   *
   * Matched on first name, last name, the whole name, or an email — because
   * Olga may know any one of those and nothing else.
   */
  app.get("/api/admin/mailer/search-people", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) return res.json({ people: [] });
      const like = `%${q.toLowerCase()}%`;
      const hidden = await hiddenContactIds();

      // One query. The guardian is joined in the same pass, because the whole
      // question is "who do I actually email for this person".
      const { rows }: any = await db.execute(sql`
        SELECT c.id, c.type::text AS type, c.first_name, c.last_name, c.email,
               g.id AS g_id, g.first_name AS g_first, g.last_name AS g_last, g.email AS g_email,
               (SELECT p.name FROM registrations r JOIN programs p ON p.id = r.program_id
                 WHERE r.contact_id = c.id ORDER BY r.registered_at DESC LIMIT 1) AS programme
        FROM contacts c
        LEFT JOIN contact_relationships cr ON cr.player_id = c.id
        LEFT JOIN contacts g ON g.id = cr.guardian_id AND g.email IS NOT NULL AND g.email <> ''
        -- 🔴 A merged duplicate must never be a mailer recipient: Olga would
        -- pick a name that reaches nobody, or email one family twice.
        WHERE c.merged_into_contact_id IS NULL
          AND (lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) LIKE ${like}
            OR lower(coalesce(c.email,'')) LIKE ${like})
        ORDER BY
          -- an exact-ish prefix first: typing "tah" should surface Taha before Mohamad Taha
          CASE WHEN lower(coalesce(c.first_name,'')) LIKE ${q.toLowerCase() + "%"} THEN 0 ELSE 1 END,
          c.last_name NULLS LAST, c.first_name NULLS LAST
        LIMIT 40`);

      const seen = new Set<number>();
      // 🔴 Collapse the SAME PERSON recorded twice — same name, same resolved
      // address. ClubOS carries ~175 duplicate-people groups from the abandoned
      // checkout path, and "Beauden Tubb" really does appear twice in this
      // search. Showing him twice invites Olga to email one address twice.
      //
      // 🔴 Keyed on name AND email, never email alone: Beauden and Chester
      // Whittle are two different children who share mirrenleigh7@gmail.com,
      // and collapsing siblings would silently drop one from the send.
      const byPerson = new Set<string>();
      const people: PersonHit[] = [];
      for (const r of rows) {
        if (seen.has(r.id) || hidden.has(r.id)) continue;   // the join can repeat a child per guardian
        seen.add(r.id);
        const own = String(r.email ?? "").trim();
        const guardianEmail = String(r.g_email ?? "").trim();
        const guardianName = [r.g_first, r.g_last].filter(Boolean).join(" ").trim();

        // 🔴 Their own address wins when they have one; otherwise the guardian's,
        // named. Never silently.
        let email: string | null = null, emailOwner: string | null = null, unreachable: string | null = null;
        if (own) email = own;
        else if (guardianEmail) { email = guardianEmail; emailOwner = guardianName || "their parent"; }
        else unreachable = r.type === "player" ? "no email, and no parent on file with one" : "no email on file";

        const personKey = `${[r.first_name, r.last_name].filter(Boolean).join(" ").trim().toLowerCase()}|${(email ?? "").toLowerCase()}`;
        if (byPerson.has(personKey)) continue;
        byPerson.add(personKey);

        people.push({
          key: `contact-${r.id}`,
          contactId: r.id,
          name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "(no name)",
          type: r.type,
          email, emailOwner, unreachable,
          detail: r.programme ?? null,
        });
        if (people.length >= 20) break;
      }
      res.json({ people });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * The same type-ahead, for UNITED PRINTS — where the people worth emailing
   * are not players and guardians but the shop's own customers and the sales
   * list it is working through.
   *
   * Daniel, 2026-09-16: *"instead of search and find contacts like players in
   * cufc you can find people from our sales outreach list or our united prints
   * clients to autofill it by clicking it and speed it up."*
   *
   * 🔴 Same doctrine as the club search above: a person with NO reachable
   * address is still returned, greyed, with the reason — hiding them makes
   * somebody search twice for a contact who is really there and says nothing
   * about why they cannot be reached.
   *
   * 🔴 Three sources, each labelled, because "who is this?" is the question a
   * name alone does not answer: a trade account holder, a CRM contact, and a
   * sales prospect are three different relationships with the shop.
   */
  app.get("/api/admin/print-mailer/search-people", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) return res.json({ people: [] });
      const like = `%${q.toLowerCase()}%`;

      const { rows }: any = await db.execute(sql`
        -- Trade accounts: people who signed in at join.unitedprints.co.nz
        SELECT 'account-' || c.id AS key, coalesce(c.name, c.email) AS name, c.email,
               coalesce(c.company, 'Trade account') AS detail, 'Account' AS source, 1 AS rank
          FROM print_customers c
         WHERE c.disabled_at IS NULL
           AND (lower(coalesce(c.name,'')) LIKE ${like} OR lower(c.email) LIKE ${like}
                OR lower(coalesce(c.company,'')) LIKE ${like})
        UNION ALL
        -- CRM contacts: everyone the shop has actually done work for
        SELECT 'contact-' || k.id, trim(coalesce(k.first_name,'') || ' ' || coalesce(k.last_name,'')),
               k.email, coalesce(k.company, 'Customer'), 'Customer', 2
          FROM print_contacts k
         WHERE lower(coalesce(k.first_name,'') || ' ' || coalesce(k.last_name,'')) LIKE ${like}
            OR lower(coalesce(k.email,'')) LIKE ${like} OR lower(coalesce(k.company,'')) LIKE ${like}
        UNION ALL
        -- The sales list being worked through
        SELECT 'prospect-' || s.id, coalesce(s.contact_name, s.name), s.email,
               coalesce(s.name, s.category), 'Prospect', 3
          FROM sales_prospects s
         WHERE s.stage <> 'declined'
           AND (lower(coalesce(s.name,'')) LIKE ${like} OR lower(coalesce(s.contact_name,'')) LIKE ${like}
                OR lower(coalesce(s.email,'')) LIKE ${like})
        ORDER BY rank, 2
        LIMIT 30`);

      res.json({
        people: rows.map((r: any) => ({
          key: r.key,
          name: r.name || r.email || "Unnamed",
          type: r.source,
          email: r.email || null,
          emailOwner: null,
          // Say WHY, rather than dropping them off the list.
          unreachable: r.email ? null : "no email on file",
          detail: r.detail ?? null,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
