// Shop drop — the hero product, two more beside each other, how to get it.
import { brand, mjmlDoc, type Brand } from "./sections";
import { brandKit, type BrandKit } from "./brand-kit";
import { section, header, label, hero, headline, para, button, muted, productPair, footer, PAGE } from "./pieces";
import type { StarterTemplate } from "./types";

type Item = { photo: number; name: string; price: string; href: string };
type Copy = {
  preheader: string;
  lbl: string;
  headA: string; headB: string;
  body: string;
  cta: { label: string; href: string };
  pair: [Item, Item];
  delivery: string;
  photo: number | null;
};

function copyFor(k: BrandKit, b: Brand): Copy {
  const shop = k.shop ?? k.site;
  switch (k.key) {
    // Photo indexes below point into the brand's PRODUCT shots where it has
    // them (the club shop's own, on white), else its photographs.
    case "siu":
      return {
        preheader: "The home jersey has landed. Members get early access.",
        lbl: "New in the shop", headA: "The home jersey", headB: " has landed",
        body: "Black and gold, built for the South. The home jersey in adult and youth sizes, with names and numbers printed in the club shop. Members get early access and free pick-up.",
        cta: { label: "Shop the home jersey", href: shop },
        pair: [{ photo: 1, name: "Fan scarf", price: "In the club shop", href: shop }, { photo: 2, name: "Casual hoodie", price: "Adult sizes", href: shop }],
        delivery: "Free pick-up from the club shop at United Sports Centre, or courier anywhere in New Zealand.",
        photo: 0,
      };
    case "cufc":
      return {
        preheader: "The 2026 kit is in the club shop, adults and kids, with the training jacket to match.",
        lbl: "New in the shop", headA: "The 2026 kit", headB: " is in the shop",
        body: "The short-sleeve football set in adult and kids' sizes, the training jacket to go over it, and the 2026 team photos as an instant download. All in the club shop, collected from United Sports Centre or couriered.",
        cta: { label: "Shop the 2026 kit", href: shop },
        pair: [{ photo: 1, name: "Football set, kids", price: "In the club shop", href: shop }, { photo: 2, name: "Training jacket", price: "Adult sizes", href: shop }],
        delivery: "Free to collect from United Sports Centre, or $5 by NZ Post. Team photo downloads are instant.",
        photo: 0,
      };
    case "mfl":
      return {
        preheader: "Team kits ready to ship: 113 KELME designs from $49.99.",
        lbl: "New in the shop", headA: "Team kits", headB: " ready to ship",
        body: "One hundred and thirteen KELME kit designs, in stock and ready to ship. Shirts from $39.99, full kits from $49.99, with names and numbers on request.",
        cta: { label: "Shop team kits", href: shop },
        pair: [{ photo: -1, name: "Full kit", price: "$49.99", href: shop }, { photo: -1, name: "Shirt only", price: "$39.99", href: shop }],
        delivery: "Pick up from United Sports Centre on league night, or courier to your door.",
        photo: 1,
      };
    case "cic":
      return {
        preheader: "Tournament merchandise: the hoodie, the cap and the pin.",
        lbl: "The tournament shop", headA: "CIC merchandise", headB: " is open",
        body: "Take the tournament home. The hoodie, the cap, the keyring and the pin, shipped now or collected from the merchandise tent on site.",
        cta: { label: "Shop the collection", href: "https://shop.cicyouth.com" },
        pair: [{ photo: 1, name: "Tournament cap", price: "$25", href: "https://shop.cicyouth.com" }, { photo: 2, name: "Pin badge", price: "$6", href: "https://shop.cicyouth.com" }],
        delivery: "Ships anywhere in the world. Collect from the merchandise tent during tournament week.",
        photo: 0,
      };
    case "prints":
      return {
        preheader: "Custom tees from the tee studio: your design, printed in Christchurch.",
        lbl: "New from the studio", headA: "Custom tees", headB: " from the tee studio",
        body: "Upload your artwork, place it on the shirt and see it before you order. Printed in Christchurch, shipped nationwide, with trade pricing for clubs and businesses.",
        cta: { label: "Design a tee", href: "https://shop.unitedprints.co.nz/print/dtf" },
        pair: [{ photo: 0, name: "Custom tee", price: "Instant quote by quantity", href: "https://shop.unitedprints.co.nz/print/dtf" }, { photo: 0, name: "Banners & signage", price: "Priced by the square metre", href: "https://unitedprints.co.nz/instant-quote" }],
        delivery: "Collect from United Sports Centre or courier nationwide. Trade accounts get their own pricing at checkout.",
        photo: null,
      };
    default:
      return {
        preheader: `New in the ${b.name} shop.`,
        lbl: "New in the shop", headA: "The new thing", headB: " has landed",
        body: "Two sentences on what it is and why it's worth having.",
        cta: { label: "Shop now", href: shop },
        pair: [{ photo: 0, name: "Product one", price: "$", href: shop }, { photo: 1, name: "Product two", price: "$", href: shop }],
        delivery: "How to get it: pick-up or delivery.",
        photo: k.photos.length ? 0 : null,
      };
  }
}

function build(brandKey: string): string {
  const b = brand(brandKey);
  const kit = brandKit(brandKey);
  // The shop template reads the brand's product shots where it has them.
  const k: BrandKit = kit.products?.length ? { ...kit, photos: kit.products } : kit;
  const c = copyFor(k, b);
  const sections = [
    header(b, k),
    section([label(b, k, c.lbl)], { padding: "26px 28px 0" }),
    hero(b, k, c.photo, `${c.headA}${c.headB}`, c.cta.href),
    section([headline(b, k, c.headA, c.headB), para(b, k, c.body, undefined, 8), button(b, k, c.cta)], { padding: "0 28px 10px" }),
    section([label(b, k, "Also in the shop")], { padding: "18px 28px 0", rule: true }),
    productPair(b, k, c.pair),
    section([label(b, k, "Delivery & pick-up"), para(b, k, c.delivery, undefined, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, c.preheader);
}

export const productTemplate: StarterTemplate = {
  id: "product-launch",
  name: "Shop drop",
  description: "The hero product, two more side by side, and how to get them.",
  category: "product",
  brandKeys: ["siu", "cufc", "mfl", "cic", "prints"],
  build,
};
