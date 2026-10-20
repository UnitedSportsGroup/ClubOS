/**
 * Pick a "How did you hear about us?" answer in a real browser, the way a
 * person does. Shared by every checkout probe now that a NEW buyer must answer
 * (server/hdyhau.ts) — a probe that skips it is refused and reads as a broken
 * checkout.
 *
 * 🔴 A Radix Select opens on POINTERDOWN, not click — a synthetic el.click()
 * does nothing. puppeteer's page.click() sends real pointer events, so it works.
 */
export async function pickHdyhau(page: any, value = "website", scope = ""): Promise<string> {
  const trigger = `${scope} [data-testid="hdyhau-select"]`.trim();
  await page.waitForSelector(trigger, { timeout: 15000 });
  await page.$eval(trigger, (el: Element) => el.scrollIntoView({ block: "center" }));
  await page.click(trigger);
  const option = `[data-testid="hdyhau-option-${value}"]`;
  await page.waitForSelector(option, { visible: true, timeout: 5000 });
  await page.click(option);
  await new Promise((r) => setTimeout(r, 300));
  return page.$eval(trigger, (el: Element) => (el as HTMLElement).innerText.trim());
}
