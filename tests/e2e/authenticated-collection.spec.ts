import { expect, type Page, test } from "@playwright/test";

const testEmail = process.env.TEST_ACCOUNT_EMAIL;
const testPassword = process.env.TEST_ACCOUNT_PASSWORD;

type SaveCollectionResult = {
  ok: boolean;
  status: number;
  body: {
    item?: {
      variantId?: string;
    };
    error?: string;
  } | null;
};

async function saveCollectionItem(page: Page, cardId: string, quantity: number) {
  const requestUrl = new URL(`/api/collection/cards/${encodeURIComponent(cardId)}`, page.url());
  const response = await page.request.put(requestUrl.toString(), {
    headers: {
      Origin: requestUrl.origin,
      Referer: page.url(),
      "Sec-Fetch-Site": "same-origin",
      "X-Cardkeeper-Request": "same-origin",
    },
    data: {
      printing: "normal",
      condition: "near_mint",
      quantity,
    },
  });
  const body = (await response.json().catch(() => null)) as SaveCollectionResult["body"];

  return { ok: response.ok(), status: response.status(), body };
}

async function removeCollectionItem(page: Page, variantId: string) {
  const requestUrl = new URL(`/api/collection/${encodeURIComponent(variantId)}`, page.url());
  const response = await page.request.delete(requestUrl.toString(), {
    headers: {
      Origin: requestUrl.origin,
      Referer: page.url(),
      "Sec-Fetch-Site": "same-origin",
      "X-Cardkeeper-Request": "same-origin",
    },
  });

  return { ok: response.ok(), status: response.status() };
}

test.describe("authenticated collection smoke", () => {
  test.skip(!testEmail || !testPassword, "Set TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD to run authenticated e2e tests.");

  test("test user can add, view, filter, sort, update, and remove a card", async ({ page }) => {
    await page.goto("/login?next=/collection");
    await page.getByRole("textbox", { name: "Email" }).fill(testEmail!);
    await page.getByRole("textbox", { name: /password/i }).fill(testPassword!);
    await Promise.all([
      page.waitForURL(/\/collection/),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();

    await page.goto("/search?query=Pikachu");
    const firstCardLink = page.locator('a[href^="/cards/"]').first();
    await expect(firstCardLink).toBeVisible();
    await firstCardLink.click();

    await expect(page).toHaveURL(/\/cards\//);
    await page.waitForLoadState("networkidle");
    const cardUrl = page.url();
    const cardId = new URL(cardUrl).pathname.split("/").pop();
    const cardName = (await page.locator("h1").first().innerText()).trim();

    if (!cardId) {
      throw new Error("Expected card detail URL to include a card id.");
    }

    const addResult = await saveCollectionItem(page, cardId, 2);
    expect(addResult.ok, addResult.body?.error ?? `Save failed with ${addResult.status}`).toBeTruthy();
    const variantId = addResult.body?.item?.variantId;

    if (!variantId) {
      throw new Error("Expected collection save response to include a variant id.");
    }

    await page.goto("/collection");
    await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
    await expect(page.getByText(cardName).first()).toBeVisible();

    await page.getByRole("searchbox", { name: "Card name" }).fill(cardName);
    await expect(page.getByText(cardName).first()).toBeVisible();

    await page.getByRole("button", { name: /sort by/i }).click();
    await page.getByRole("menuitemradio", { name: "Card price: high to low" }).click();
    await expect(page.getByRole("button", { name: /Sort by: Card price: high to low/i })).toBeVisible();

    await page.goto(cardUrl);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /You own 2/ })).toBeVisible();

    const updateResult = await saveCollectionItem(page, cardId, 3);
    expect(updateResult.ok, updateResult.body?.error ?? `Update failed with ${updateResult.status}`).toBeTruthy();

    await page.goto(cardUrl);
    await expect(page.getByRole("heading", { name: /You own 3/ })).toBeVisible();

    const removeResult = await removeCollectionItem(page, variantId);
    expect(removeResult.ok, `Remove failed with ${removeResult.status}`).toBeTruthy();

    await page.goto(cardUrl);
    await expect(page.getByRole("heading", { name: "Add this card" })).toBeVisible();
  });
});
