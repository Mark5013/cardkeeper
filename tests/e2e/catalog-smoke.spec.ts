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
