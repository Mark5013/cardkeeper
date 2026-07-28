import { expect, test } from "@playwright/test";

test("search keeps the submitted query visible on results", async ({ page }) => {
  await page.goto("/");

  const searchInput = page.getByRole("combobox", { name: /card name and optional number/i });
  await searchInput.fill("Pikachu");
  await expect(searchInput).toHaveValue("Pikachu");
  await Promise.all([
    page.waitForURL(/\/search\?query=Pikachu/),
    page.getByRole("button", { name: "Search cards" }).click(),
  ]);

  await expect(page).toHaveURL(/\/search\?query=Pikachu/);
  await expect(page.getByRole("heading", { name: 'Results for "Pikachu"' })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /card name and optional number/i })).toHaveValue("Pikachu");
  await expect(page.getByText(/Catalog matches|Closest matches/)).toBeVisible();
});

test("search result opens a card detail page with prices and collection prompt", async ({ page }) => {
  await page.goto("/search?query=Pikachu");

  const firstCardLink = page.locator('a[href^="/cards/"]').first();
  await expect(firstCardLink).toBeVisible();
  await firstCardLink.click();

  await expect(page).toHaveURL(/\/cards\//);
  await expect(page.getByRole("heading", { name: "Market prices" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Card information" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to add" })).toBeVisible();
});

test("collection page redirects anonymous users to login with next path", async ({ page }) => {
  await page.goto("/collection");

  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)collection/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});

test("sealed sets scroll continuously and filter with the styled language menu", async ({
  page,
}) => {
  await page.goto("/sealed");

  const englishSets = page.locator('a[href^="/sealed/sets/3/"]');
  const japaneseSets = page.locator('a[href^="/sealed/sets/85/"]');
  await expect
    .poll(async () => (await englishSets.count()) + (await japaneseSets.count()))
    .toBeGreaterThan(60);
  await expect(englishSets.first()).not.toContainText(/From \$|market prices/i);
  await expect(
    page.locator('nav[aria-label="Sealed set pages"]'),
  ).toHaveCount(0);

  const languageMenu = page.getByRole("button", { name: "Language" });
  await languageMenu.click();
  await page.getByRole("menuitemradio", { name: "Japanese" }).click();

  await expect(languageMenu).toContainText("Japanese");
  await expect(englishSets).toHaveCount(0);
  await expect.poll(async () => japaneseSets.count()).toBeGreaterThan(0);
});
