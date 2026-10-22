import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function generate(page: import("@playwright/test").Page, week: string) {
  await page.getByLabel(/Week/).fill(week);
  await page.getByLabel(/Time zone/).fill("UTC");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(`Report for the week of ${week} is ready`)).toBeVisible({
    timeout: 60_000,
  });
}

test("two consecutive weeks give a trend, and an override shows everywhere", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Weekly Status Report" })).toBeVisible();

  await generate(page, "2026-10-05");
  await generate(page, "2026-10-12");

  const chart = page.getByRole("img", { name: /Overall percent complete and status by week/ });
  await expect(chart).toBeVisible();
  const trend = page.getByRole("table", { name: "Trend data" });
  await expect(trend.getByRole("row")).toHaveCount(3);
  await expect(trend).toContainText("2026-10-05");
  await expect(trend).toContainText("2026-10-12");

  await page.getByRole("button", { name: "Overrides", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("Red");
  await page.getByLabel(/Reason/).fill("Vendor slip");
  await page.getByRole("button", { name: "Save override" }).click();
  await expect(page.getByText("Override saved.")).toBeVisible();
  await expect(page.getByText("The deck is out of date with the latest data.")).toBeVisible();

  await page.getByRole("button", { name: "Dashboard" }).click();
  const overall = page.getByRole("region", { name: "Overall status" });
  await expect(overall).toContainText("Red");
  await expect(overall).toContainText("Overridden (calculated");
  await expect(overall).toContainText("Vendor slip");

  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("region", { name: "Status overrides" })).toContainText("Vendor slip");

  await page.getByRole("button", { name: "Regenerate deck" }).click();
  await expect(page.getByText("The deck is out of date with the latest data.")).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download deck" }).click(),
  ]);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
});
