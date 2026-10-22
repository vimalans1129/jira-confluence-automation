import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Weekly Status Report" })).toBeVisible();
}

test("sign in, generate against the mock Jira, see the report and download the deck", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText(/No report has been generated yet/)).toBeVisible();

  await page.getByLabel(/Week/).fill("2026-10-14");
  await page.getByLabel(/Time zone/).fill("UTC");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText(/is ready/)).toBeVisible({ timeout: 60_000 });
  const overall = page.getByRole("region", { name: "Overall status" });
  await expect(overall).toContainText(/Red|Amber|Green/);
  await expect(page.getByRole("table")).toBeVisible();

  await page.getByRole("button", { name: "Report" }).click();
  await expect(page.getByRole("heading", { name: "Key risks and issues" })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download deck" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Weekly_Status_DEMO_2026-10-12.pptx");
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
});

test("a dry run shows metrics without offering a deck", async ({ page }) => {
  await signIn(page);
  await page.getByLabel(/Week/).fill("2026-10-07");
  await page.getByLabel(/Dry run/).check();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText(/\(dry run\)/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Download deck" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Overall status" })).toBeVisible();
});
