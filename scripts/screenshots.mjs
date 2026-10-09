// Screenshots of the running demo (bun run demo). Not a test. Output: .gate0/screens/.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.DEMO_URL ?? "http://127.0.0.1:7399/";
const OUT = new URL("../.gate0/screens/", import.meta.url);
const tag = process.argv[2] ?? "pass";
mkdirSync(OUT, { recursive: true });

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 400, height: 800 },
];

const browser = await chromium.launch();
try {
  for (const size of sizes) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const shot = (what) => page.screenshot({ path: new URL(`${tag}-${what}-${size.name}-${scheme}.png`, OUT).pathname.slice(1) });
      await page.goto(BASE);
      await page.locator("[data-row]").first().waitFor();
      await shot("inbox");
      if (size.name === "phone") {
        await page.locator("[data-row]").first().click();
        await shot("detail");
        await page.getByRole("button", { name: "Back to the list" }).click();
      }
      await page.keyboard.press("/");
      await page.keyboard.type("no such pull request");
      await shot("empty");
      await page.keyboard.press("Escape");
      if (size.name === "phone") await page.getByRole("button", { name: "Open views" }).click();
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByLabel("Bitbucket URL").waitFor();
      await shot("settings");
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Saved to ${OUT.pathname}`);
