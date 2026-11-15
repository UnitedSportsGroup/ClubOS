// The office's "register a player" handlers, kept by name.
//
// Defined in routes.ts (they lean on a dozen helpers that live there) and
// assigned here as they are registered, so the counter reader's till
// (server/pos-counter-till.ts) can run EXACTLY the code the laptop runs — the
// same pricing, the same "how did you hear about us", the same NZ Football
// identity rule, the same guardian de-duplication. A second copy would drift.
import type { Request, Response } from "express";

type Handler = (req: Request, res: Response) => Promise<unknown>;
export const officeRegistration: { quote?: Handler; create?: Handler } = {};
