import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBaseSetCardOverrides,
  applyBaseSetSetOverrides,
  buildCanonicalProductMappings,
  createUnlimitedProviderCard,
  getShadowlessCardName,
  getTcgplayerHighResolutionImageUrl,
} from "../../scripts/lib/base-set-editions.mjs";

test("applies persistent Shadowless names to Base Set provider data", () => {
  const set = applyBaseSetSetOverrides({ id: "base1", name: "Base" });
  const card = applyBaseSetCardOverrides({
    id: "base1-4",
    name: "Charizard",
    set: { id: "base1", name: "Base" },
    tcgplayer: { url: "https://example.com/unlimited" },
  });

  assert.equal(set.name, "Base Set (Shadowless)");
  assert.equal(card.name, "Charizard (Shadowless)");
  assert.equal(card.set.name, "Base Set (Shadowless)");
  assert.equal(card.tcgplayer, undefined);
  assert.equal(getShadowlessCardName(card.name), "Charizard (Shadowless)");
});

test("maps only exact card name and collector-number products", () => {
  const result = buildCanonicalProductMappings(
    [{ provider_id: "base1-4", name: "Charizard (Shadowless)", number: "4" }],
    [
      {
        productId: 42382,
        name: "Charizard",
        extendedData: [{ name: "Number", value: "004/102" }],
      },
      {
        productId: 657516,
        name: "Charizard (Black Dot Error)",
        extendedData: [{ name: "Number", value: "004/102" }],
      },
    ],
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.mappings.get("base1-4").productId, 42382);
});

test("supports only the known Base Set product naming exceptions", () => {
  const result = buildCanonicalProductMappings(
    [
      { provider_id: "base1-8", name: "Machamp (Shadowless)", number: "8" },
      { provider_id: "base1-55", name: "Nidoran ♂ (Shadowless)", number: "55" },
      { provider_id: "base1-73", name: "Impostor Professor Oak (Shadowless)", number: "73" },
    ],
    [
      product(42425, "Machamp - 8/102", "008/102"),
      product(42399, "Nidoran M", "055/102"),
      product(86271, "Imposter Professor Oak", "073/102"),
    ],
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    [...result.mappings.values()].map((value) => value.productId),
    [42425, 42399, 86271],
  );
});

test("creates an Unlimited provider card with TCGplayer artwork and identity", () => {
  const card = createUnlimitedProviderCard({
    shadowlessCard: {
      id: "base1-4",
      name: "Charizard (Shadowless)",
      images: { small: "shadowless-small", large: "shadowless-large" },
      set: { id: "base1", name: "Base Set (Shadowless)" },
    },
    product: {
      imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/42382_200w.jpg",
      url: "https://www.tcgplayer.com/product/42382/pokemon-base-set-charizard",
    },
  });

  assert.equal(card.id, "base1-4-unlimited");
  assert.equal(card.name, "Charizard");
  assert.equal(card.set.id, "base1-unlimited");
  assert.equal(
    card.images.large,
    "https://tcgplayer-cdn.tcgplayer.com/product/42382_in_1000x1000.jpg",
  );
  assert.equal(card.tcgplayer.url.includes("/42382/"), true);
  assert.equal(
    getTcgplayerHighResolutionImageUrl(card.images.small),
    card.images.large,
  );
});

function product(productId, name, number) {
  return {
    productId,
    name,
    extendedData: [{ name: "Number", value: number }],
  };
}
