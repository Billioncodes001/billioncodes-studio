import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function unlock(page: Page) {
  await page.goto("/#start");
  await page
    .getByLabel("Workspace password")
    .fill("synthetic-studio-test-password");
  await page.getByRole("button", { name: "Unlock proposal desk" }).click();
  await expect(page.locator("#desk")).toBeVisible();
}
async function proposal(page: Page, name: string) {
  await page.getByLabel("What shall we call it?").fill(name);
  await page
    .getByLabel("Prepared for", { exact: true })
    .fill("Fictional Common Ground workshop");
  await page
    .getByLabel("Prepared by", { exact: true })
    .fill("Independent developer");
  await page
    .getByLabel("Project objective")
    .fill(
      "Replace scattered paper repair requests with a searchable intake queue and a simple status workflow.",
    );
  await page
    .getByLabel("Scope line 1", { exact: true })
    .fill("Map the intake workflow and define a testable release scope.");
  await page.getByLabel("Quantity 1", { exact: true }).fill("2.50");
  await page.getByLabel("Rate 1", { exact: true }).fill("125.50");
  await page.getByRole("button", { name: "+ Add scope line" }).click();
  await page
    .getByLabel("Scope line 2", { exact: true })
    .fill("Build and test the repair intake prototype.");
  await page
    .getByRole("combobox", { name: "Unit 2", exact: true })
    .selectOption("milestone");
  await page.getByLabel("Rate 2", { exact: true }).fill("800.00");
  await page.getByLabel("Fixed discount", { exact: true }).fill("25.00");
  await page.getByLabel("Tax percentage", { exact: true }).fill("7.50");
  await page
    .getByLabel("Assumptions", { exact: true })
    .fill(
      "The workshop provides its status vocabulary and one reviewer for feedback.",
    );
  await page
    .getByLabel("Not included", { exact: true })
    .fill("Payments, public accounts and automated messages.");
  await page
    .getByLabel("Delivery and payment notes", { exact: true })
    .fill(
      "Two review rounds. Proposed milestones require a separate agreement.",
    );
}
async function inspect(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    report.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
test("complete proposal workflow, cents, revision comparison, export, archive and restore", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await unlock(page);
  await proposal(page, "Neighbourhood repair desk / " + info.project.name);
  await expect(page.locator("#totals .grand-total")).toContainText(
    "NGN 1,170.41",
  );
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 1");
  await expect(
    page.getByRole("combobox", { name: "Currency", exact: true }),
  ).toBeDisabled();
  await inspect(page);
  await page.getByLabel("Rate 2", { exact: true }).fill("900.00");
  await page
    .getByLabel("Revision note", { exact: true })
    .fill("Expanded prototype scope.");
  await expect(
    page.getByRole("button", { name: "Archive proposal", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 2");
  await page.getByLabel("Revision to inspect").selectOption("1");
  await page
    .getByText("Compare selected with latest saved", { exact: true })
    .click();
  await expect(page.locator("#comparison")).toContainText("+NGN 107.50");
  await expect(page.locator("#comparison")).toContainText("900.00");
  const exported = await (
    await page.request.get(
      (await page.locator("#export-json").getAttribute("href"))!,
    )
  ).json();
  expect(exported.revision).toBe(1);
  expect(exported.totals.totalMinor).toBe(117041);
  expect(exported.snapshot.lines[1].rate).toBe("800.00");
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Print / save PDF" }).click(),
  ]);
  await expect(print.getByRole("heading", { level: 1 })).toContainText(
    "Neighbourhood repair desk",
  );
  await expect(print.locator("body")).toContainText("NGN 1,170.41");
  await inspect(print);
  await print.emulateMedia({ media: "print" });
  await expect(print.locator("body")).toContainText("Revision 1");
  if (info.project.name === "desktop" && process.env.UPDATE_SCREENSHOTS === "1")
    await print.screenshot({ path: "docs/proposal.png", fullPage: true });
  await print.close();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Archive proposal", exact: true })
    .click();
  await expect(page.locator("#stamp")).toHaveText("ARCHIVED / REVISION 3");
  await expect(page.getByLabel("Rate 1", { exact: true })).toBeDisabled();
  await page.getByLabel("Revision to inspect").selectOption("1");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Restore selected as a new draft" })
    .click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 4");
  await expect(page.getByLabel("Rate 2", { exact: true })).toHaveValue(
    "800.00",
  );
  await page.reload();
  await page
    .getByRole("button", { name: /Neighbourhood repair desk/ })
    .filter({ hasText: info.project.name })
    .click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 4");
  expect(errors).toEqual([]);
  if (
    info.project.name === "desktop" &&
    process.env.UPDATE_SCREENSHOTS === "1"
  ) {
    await page.screenshot({ path: "docs/full-page.png", fullPage: true });
    await page
      .locator(".document-heading")
      .evaluate((el) =>
        el.scrollIntoView({ block: "start", behavior: "instant" }),
      );
    await page.screenshot({ path: "docs/desk.png" });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: "docs/home.png" });
  }
});
test("network retries avoid duplicates and two-tab conflicts retain unsaved pricing", async ({
  page,
  context,
}, info) => {
  await unlock(page);
  await proposal(page, "Conflict review / " + info.project.name);
  let lost = false;
  await page.route("**/api/action", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#notice")).toContainText("Connection lost");
  await expect(page.getByLabel("Rate 2", { exact: true })).toHaveValue(
    "800.00",
  );
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 1");
  await page.unroute("**/api/action");
  const other = await context.newPage();
  await other.goto("/#desk");
  await other
    .getByRole("button", { name: /Conflict review/ })
    .filter({ hasText: info.project.name })
    .click();
  await other.getByLabel("Rate 2", { exact: true }).fill("950.00");
  await other.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(other.locator("#stamp")).toHaveText("DRAFT / REVISION 2");
  await page.getByLabel("Rate 2", { exact: true }).fill("880.00");
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#conflict")).toBeVisible();
  await expect(page.getByLabel("Rate 2", { exact: true })).toHaveValue(
    "880.00",
  );
  await page
    .getByRole("button", { name: "Review latest saved proposal", exact: true })
    .click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 2");
  await expect(page.getByLabel("Rate 2", { exact: true })).toHaveValue(
    "880.00",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Replace editor with latest saved",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Rate 2", { exact: true })).toHaveValue(
    "950.00",
  );
  await expect(
    page
      .locator("#proposals")
      .getByRole("button", { name: /Conflict review/ })
      .filter({ hasText: info.project.name }),
  ).toHaveCount(1);
  await other.close();
});
test("session loss preserves a draft through unlock and explicit lock clears private DOM", async ({
  page,
  context,
}) => {
  await unlock(page);
  await proposal(page, "Private unsaved proposal");
  await context.clearCookies();
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#desk")).toBeHidden();
  await expect(page.locator("#access")).toBeVisible();
  await page
    .getByLabel("Workspace password")
    .fill("synthetic-studio-test-password");
  await page.getByRole("button", { name: "Unlock proposal desk" }).click();
  await expect(page.getByLabel("What shall we call it?")).toHaveValue(
    "Private unsaved proposal",
  );
  await expect(page.getByLabel("Rate 1", { exact: true })).toHaveValue(
    "125.50",
  );
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 1");
  await page.getByRole("button", { name: "Lock desk", exact: true }).click();
  await expect(page.locator("#desk")).toBeHidden();
  await expect(page.locator("#snapshot")).toBeEmpty();
  await expect(page.locator("#legacy")).toBeEmpty();
  await expect(page.getByLabel("What shall we call it?")).toHaveValue("");
  expect((await page.request.get("/api/state")).status()).toBe(401);
  await inspect(page);
});
test("legacy illustrations are read-only and malformed rates do not become zero", async ({
  page,
}, info) => {
  await unlock(page);
  await page
    .getByText("Original illustrative estimates / read-only", { exact: true })
    .click();
  await expect(page.locator("#legacy")).toContainText("NGN 240,000.00");
  await expect(page.locator("#legacy button")).toHaveCount(0);
  const record = await (
    await page.request.get(
      (await page.locator("#legacy a").getAttribute("href"))!,
    )
  ).json();
  expect(record.record.estimate).toBe(240000);
  await page
    .getByLabel("What shall we call it?")
    .fill("Decimal boundaries / " + info.project.name);
  await page
    .getByLabel("Project objective")
    .fill("A synthetic rounding check, not a commercial rate.");
  await page
    .getByRole("combobox", { name: "Currency", exact: true })
    .selectOption("USD");
  await page
    .getByLabel("Scope line 1", { exact: true })
    .fill("Fractional scope example");
  await expect(page.locator("#totals")).toContainText("plain decimal");
  await page.getByLabel("Quantity 1", { exact: true }).fill("0.50");
  await page.getByLabel("Rate 1", { exact: true }).fill("0.001");
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#notice")).toContainText("two decimal places");
  await expect(page.locator("#stamp")).toHaveText("NOT YET SAVED");
  await page.getByLabel("Rate 1", { exact: true }).fill("0.01");
  await page.getByLabel("Tax percentage", { exact: true }).fill("50.00");
  await expect(page.locator("#totals .grand-total")).toContainText("USD 0.02");
  await page.getByRole("button", { name: "Save proposal revision" }).click();
  await expect(page.locator("#stamp")).toHaveText("DRAFT / REVISION 1");
  await page.getByLabel("Find a proposal").fill("nothing matches this query");
  await expect(page.locator("#proposals")).toContainText(
    "No proposals here yet",
  );
  await page.getByLabel("Find a proposal").fill("");
  await inspect(page);
});
