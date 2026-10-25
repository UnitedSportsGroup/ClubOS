// Announcement — one clear message, no photograph, one button.
import { brand, mjmlDoc } from "./sections";
import { brandKit } from "./brand-kit";
import { section, header, label, headline, para, button, muted, footer, PAGE } from "./pieces";
import type { StarterTemplate } from "./types";

function build(brandKey: string): string {
  const b = brand(brandKey);
  const k = brandKit(brandKey);
  const act = k.action ?? { label: "Find out more", href: k.site };
  const sections = [
    header(b, k),
    section(
      [
        label(b, k, "An update"),
        headline(b, k, "The one thing", " you need to know"),
        para(b, k, "Hi {{first_name}}, a short note with one clear message. Say what has changed, what it means for you, and what to do about it, in that order."),
        para(b, k, "Keep it to two paragraphs. If there's more to say, link to it, and let the button do the rest.", undefined, 8),
        button(b, k, act),
      ],
      { padding: "26px 28px 10px" },
    ),
    section([muted(b, "Sent to everyone this affects. Reply to this email if anything here doesn't look right.", 12, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, `A short update from ${b.name}.`);
}

export const announcementTemplate: StarterTemplate = {
  id: "simple-announcement",
  name: "Announcement",
  description: "One clear message, no photograph, one button.",
  category: "announcement",
  brandKeys: "all",
  build,
};
