import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDatabaseOnlyMissingPriceManifest,
  classifyMissingPriceFinish,
  normalizeProviderPrinting,
  TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS,
} from "../../scripts/lib/tcgcsv-missing-price-audit.mjs";

function createVariant({
  cardId = "card-1",
  currentMarket = null,
  id = "variant-1",
  printing = "normal",
  productRefs = [],
  series = [],
} = {}) {
  return {
    cardId,
    condition: "unspecified",
    createdAt: "2026-07-25T00:00:00.000Z",
    externalVariantId: null,
    id,
    languageCode: "en",
    printing,
    tcgcsvCurrentPrices:
      currentMarket === null
        ? []
        : [
            {
              amountMinor: currentMarket,
              currency: "USD",
              observedAt: "2026-07-25T20:14:30.000Z",
              priceType: "market",
              updatedAt: "2026-07-25T20:14:30.000Z",
            },
          ],
    tcgcsvPriceSeries: series,
    tcgplayerProductRefs: productRefs.map((productRef, index) => ({
      createdAt: "2026-07-25T00:00:00.000Z",
      id: `${id}-ref-${index}`,
      metadata: productRef.metadata ?? {},
      productId: productRef.productId,
      updatedAt: "2026-07-25T00:00:00.000Z",
    })),
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

function createCard({
  id,
  providerFinishKeys = ["normal"],
  providerId = id,
  setId = "set-1",
  setProviderId = "set1",
} = {}) {
  return {
    id,
    name: `Card ${id}`,
    number: "1",
    providerFinishKeys,
    providerId,
    setId,
    setName: `Set ${setId}`,
    setProviderId,
  };
}

test("normalizes provider finish keys exactly like current pricing", () => {
  assert.equal(normalizeProviderPrinting("reverseHolofoil"), "reverse_holofoil");
  assert.equal(
    normalizeProviderPrinting("1stEditionHolofoil"),
    "1st_edition_holofoil",
  );
});

test("classifies each database-only finish gap without guessing", () => {
  assert.equal(
    classifyMissingPriceFinish({ variant: null }),
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MISSING_LOCAL_VARIANT,
  );
  assert.equal(
    classifyMissingPriceFinish({ variant: createVariant() }),
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MISSING_PRODUCT_REF,
  );
  assert.equal(
    classifyMissingPriceFinish({
      variant: createVariant({
        productRefs: [{ productId: "100" }, { productId: "200" }],
      }),
    }),
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MULTIPLE_PRODUCT_REFS,
  );
  assert.equal(
    classifyMissingPriceFinish({
      variant: createVariant({
        productRefs: [
          {
            productId: "100",
            metadata: { tcgcsvMappingStatus: "stale" },
          },
        ],
      }),
    }),
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.UNTRUSTED_PRODUCT_REF,
  );
  assert.equal(
    classifyMissingPriceFinish({
      variant: createVariant({
        productRefs: [{ productId: "100" }],
      }),
    }),
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS
      .TRUSTED_SINGLETON_WITHOUT_CURRENT_MARKET,
  );
  assert.equal(
    classifyMissingPriceFinish({
      variant: createVariant({
        currentMarket: 125,
        productRefs: [{ productId: "100" }],
      }),
    }),
    null,
  );
});

test("builds a deterministic manifest for finish and card-level gaps", () => {
  const activeCards = [
    createCard({ id: "card-2", providerFinishKeys: ["holofoil"] }),
    createCard({ id: "card-1" }),
    createCard({ id: "card-3", providerFinishKeys: [] }),
  ];
  const localVariants = [
    createVariant({
      cardId: "card-1",
      currentMarket: 125,
      productRefs: [{ productId: "100" }],
    }),
  ];
  const input = {
    activeCards,
    databaseSnapshotAt: "2026-07-25T21:00:00.000Z",
    latestTcgcsvMarketObservedAt: "2026-07-25T20:14:30.000Z",
    localVariants,
  };
  const first = buildDatabaseOnlyMissingPriceManifest(input);
  const second = buildDatabaseOnlyMissingPriceManifest({
    ...input,
    activeCards: [...activeCards].reverse(),
    localVariants: [...localVariants].reverse(),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.summary, {
    activeEnglishCards: 3,
    cardsInManifest: 2,
    cardsWithFinishGaps: 1,
    cardsWithPartialPriceCoverage: 0,
    cardsWithTrustedCurrentPrice: 1,
    cardsWithoutTrustedCurrentPrice: 2,
    finishGapClassifications: {
      missing_local_variant: 1,
      missing_product_ref: 0,
      multiple_product_refs: 0,
      trusted_singleton_without_current_market: 0,
      untrusted_product_ref: 0,
    },
    finishGaps: 1,
    pricedVisibleFinishes: 1,
    setsWithFinishGaps: 1,
    setsWithWhollyUnpricedCards: 1,
    unpricedCardsWithoutVisibleFinish: 1,
    visibleFinishes: 2,
  });
  assert.equal(first.cards[0].card.providerId, "card-2");
  assert.equal(
    first.cards[0].finishGaps[0].classification,
    TCGCSV_MISSING_PRICE_GAP_CLASSIFICATIONS.MISSING_LOCAL_VARIANT,
  );
  assert.equal(
    first.cards[1].cardGapClassification,
    "no_provider_finish_or_trusted_local_finish",
  );
  assert.match(first.manifestFingerprint, /^[a-f0-9]{64}$/);
});

test("includes a trusted local finish even when the provider omits it", () => {
  const manifest = buildDatabaseOnlyMissingPriceManifest({
    activeCards: [
      createCard({
        id: "card-1",
        providerFinishKeys: [],
      }),
    ],
    databaseSnapshotAt: "2026-07-25T21:00:00.000Z",
    latestTcgcsvMarketObservedAt: "2026-07-25T20:14:30.000Z",
    localVariants: [
      createVariant({
        cardId: "card-1",
        printing: "reverse_holofoil",
        productRefs: [{ productId: "85669" }],
      }),
    ],
  });

  assert.equal(manifest.summary.visibleFinishes, 1);
  assert.equal(manifest.summary.finishGaps, 1);
  assert.equal(
    manifest.cards[0].finishGaps[0].classification,
    "trusted_singleton_without_current_market",
  );
  assert.equal(manifest.cards[0].finishGaps[0].providerAdvertised, false);
});

test("replaces an unmodeled provider finish with trusted qualified local finishes", () => {
  const manifest = buildDatabaseOnlyMissingPriceManifest({
    activeCards: [
      createCard({
        id: "card-1",
        providerFinishKeys: ["holofoil"],
      }),
    ],
    databaseSnapshotAt: "2026-07-25T21:00:00.000Z",
    latestTcgcsvMarketObservedAt: "2026-07-25T20:14:30.000Z",
    localVariants: [
      createVariant({
        cardId: "card-1",
        currentMarket: 500,
        id: "prerelease",
        printing: "prerelease_holofoil",
        productRefs: [{ productId: "623233" }],
      }),
      createVariant({
        cardId: "card-1",
        currentMarket: 1000,
        id: "staff",
        printing: "prerelease_staff_holofoil",
        productRefs: [{ productId: "624484" }],
      }),
    ],
  });

  assert.equal(manifest.summary.visibleFinishes, 2);
  assert.equal(manifest.summary.pricedVisibleFinishes, 2);
  assert.equal(manifest.summary.finishGaps, 0);
});
