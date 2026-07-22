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

type CardSearchResponse = {
  cards?: { id: string; printings: { value: string; label: string }[] }[];
};

async function saveCollectionItem(
  page: Page,
  cardId: string,
  quantity: number,
  printing = "normal",
) {
  const requestUrl = new URL(`/api/collection/cards/${encodeURIComponent(cardId)}`, page.url());
  const response = await page.request.put(requestUrl.toString(), {
    headers: {
      Origin: requestUrl.origin,
      Referer: page.url(),
      "Sec-Fetch-Site": "same-origin",
      "X-Cardkeeper-Request": "same-origin",
    },
    data: {
      printing,
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

async function getAdvertisedPrinting(page: Page, cardId: string, query: string) {
  const response = await page.request.get(
    `/api/cards/search?query=${encodeURIComponent(query)}&mode=search&pageSize=50`,
  );
  if (!response.ok()) throw new Error(`Unable to load printings for ${cardId}.`);

  const payload = (await response.json()) as CardSearchResponse;
  const printing = payload.cards
    ?.find((card) => card.id === cardId)
    ?.printings.at(0)?.value;

  if (!printing) throw new Error(`Expected ${cardId} to advertise at least one finish.`);
  return printing;
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

    const printing = await getAdvertisedPrinting(page, cardId, cardName);
    const addResult = await saveCollectionItem(page, cardId, 2, printing);
    expect(addResult.ok, addResult.body?.error ?? `Save failed with ${addResult.status}`).toBeTruthy();
    const variantId = addResult.body?.item?.variantId;

    if (!variantId) {
      throw new Error("Expected collection save response to include a variant id.");
    }

    await page.goto("/collection");
    await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
    await expect(page.getByText(cardName).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Collection value history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Collection value history range" }),
    ).toBeVisible();

    await page.getByRole("searchbox", { name: "Card name" }).fill(cardName);
    await expect(page.getByText(cardName).first()).toBeVisible();

    await page.getByRole("button", { name: /sort by/i }).click();
    await page.getByRole("menuitemradio", { name: "Card price: high to low" }).click();
    await expect(page.getByRole("button", { name: /Sort by: Card price: high to low/i })).toBeVisible();

    await page.goto(cardUrl);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /You own 2/ })).toBeVisible();

    const updateResult = await saveCollectionItem(page, cardId, 3, printing);
    expect(updateResult.ok, updateResult.body?.error ?? `Update failed with ${updateResult.status}`).toBeTruthy();

    await page.goto(cardUrl);
    await expect(page.getByRole("heading", { name: /You own 3/ })).toBeVisible();

    const removeResult = await removeCollectionItem(page, variantId);
    expect(removeResult.ok, `Remove failed with ${removeResult.status}`).toBeTruthy();

    await page.goto(cardUrl);
    await expect(page.getByRole("heading", { name: "Add this card" })).toBeVisible();
  });

  test("split Base Set cards advertise finishes accepted by collection updates", async ({
    page,
  }) => {
    await page.goto("/login?next=/search?query=Charmander");
    await page.getByRole("textbox", { name: "Email" }).fill(testEmail!);
    await page.getByRole("textbox", { name: /password/i }).fill(testPassword!);
    await Promise.all([
      page.waitForURL(/\/search\?query=Charmander/),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    const response = await page.request.get(
      "/api/cards/search?query=Charmander&mode=search&pageSize=50",
    );
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as CardSearchResponse;
    const cardsById = new Map(payload.cards?.map((card) => [card.id, card]) ?? []);
    const expectedPrintings = new Map<string, { value: string; label: string }[]>([
      [
        "base1-46",
        [
          { value: "1st_edition", label: "1st Edition Shadowless" },
          { value: "unlimited", label: "Shadowless" },
        ],
      ],
      ["base1-46-unlimited", [{ value: "normal", label: "Normal" }]],
    ]);

    for (const [cardId, printings] of expectedPrintings) {
      const card = cardsById.get(cardId);
      expect(card, `Expected search results to include ${cardId}`).toBeTruthy();
      expect(
        card?.printings.map(({ value, label }) => ({ value, label })),
      ).toEqual(printings);

      await page.goto(`/cards/${encodeURIComponent(cardId)}`);
      const finishTrigger = page.getByRole("button", { name: "Finish" });
      await expect(finishTrigger).toContainText(printings[0].label);
      await finishTrigger.click();
      for (const printing of printings) {
        await expect(
          page.getByRole("menuitemradio", { name: printing.label, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");

      const saveResult = await saveCollectionItem(page, cardId, 1, printings[0].value);
      expect(
        saveResult.ok,
        saveResult.body?.error ?? `Save failed with ${saveResult.status}`,
      ).toBeTruthy();

      const variantId = saveResult.body?.item?.variantId;
      if (!variantId) throw new Error(`Expected ${cardId} save to return a variant id.`);

      const removeResult = await removeCollectionItem(page, variantId);
      expect(removeResult.ok, `Cleanup failed with ${removeResult.status}`).toBeTruthy();
    }
  });
});
