import assert from "node:assert/strict";
import test from "node:test";

import {
  doesTcgcsvProductNameMatchCard,
  getTcgcsvCollectorNumberEvidence,
  isReviewedPokemonFutsalProduct,
  isSupplementalTcgcsvGroup,
  isTcgcsvCollectorNumberCompatibleWithSet,
} from "../../scripts/lib/tcgcsv-group-matching.mjs";

test("recognizes supplemental promo groups", () => {
  assert.equal(isSupplementalTcgcsvGroup("Nintendo Promos"), true);
});

test("matches known TCGCSV qualifiers without weakening card identity", () => {
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Pikachu δ",
      productName: "Pikachu (Delta Species) - 035 (Value Pack)",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Bisharp",
      productName: "Bisharp - Darkrai Deck",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Nidoran ♂",
      productName: "Nidoran M - 055/102",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Pikachu δ",
      productName: "Ivysaur - 35/100 (Prerelease)",
    }),
    false,
  );
});

test("does not treat distinct Pokemon suffixes as product qualifiers", () => {
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Pikachu",
      productName: "Pikachu V",
    }),
    false,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Pikachu",
      productName: "Pikachu ex",
    }),
    false,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Mewtwo",
      productName: "Mewtwo VSTAR",
    }),
    false,
  );
});

test("normalizes catalog edition suffixes and TCGplayer energy abbreviations", () => {
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Charizard (Shadowless)",
      productName: "Charizard",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Heat Fire Energy",
      productName: "Heat R Energy",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Unit Energy FightingDarknessFairy",
      productName: "Unit Energy FDY",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Boss's Orders (Ghetsis)",
      productName: "Boss's Orders - 172/193",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "PokéStop",
      productName: "PokeStop",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Bagon δ",
      productName: "Bagon - 057/113 (Delta Species)",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Fairy Charm Dragon",
      productName: "Fairy Charm O",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Charizard ★ δ",
      productName: "Charizard Star (Delta Species)",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Nidoran ♀ δ",
      productName: "Nidoran F (Delta Species)",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "PokéNav",
      productName: "Pokenav",
    }),
    true,
  );
  assert.equal(
    doesTcgcsvProductNameMatchCard({
      cardName: "Drowzee",
      productName: "Drowsee",
    }),
    true,
  );
});

test("uses a full collector-number denominator to disambiguate local sets", () => {
  assert.equal(
    isTcgcsvCollectorNumberCompatibleWithSet({
      productName: "Oricorio - 55/145",
      productNumber: "55/145",
      setPrintedTotal: 145,
    }),
    true,
  );
  assert.equal(
    isTcgcsvCollectorNumberCompatibleWithSet({
      productName: "Oricorio - 55/145",
      productNumber: "55/145",
      setPrintedTotal: 168,
    }),
    false,
  );
});

test("fails closed when product name and metadata disagree on collector number", () => {
  assert.deepEqual(
    getTcgcsvCollectorNumberEvidence({
      productName: "Oricorio - 55/145",
      productNumber: "055/045",
    }),
    {
      denominator: null,
      hasConflict: true,
      numerator: "55",
    },
  );
});

test("recognizes only the reviewed numbered Pokemon Futsal products", () => {
  assert.equal(
    isReviewedPokemonFutsalProduct({
      productName: "Pikachu - 003/005 (Pokemon Futsal)",
      productNumber: "003/005",
    }),
    true,
  );
  assert.equal(
    isReviewedPokemonFutsalProduct({
      productName: "Pikachu - 003/005",
      productNumber: "003/005",
    }),
    false,
  );
  assert.equal(
    isReviewedPokemonFutsalProduct({
      productName: "Pikachu - 003/025 (Pokemon Futsal)",
      productNumber: "003/025",
    }),
    false,
  );
  assert.equal(
    isReviewedPokemonFutsalProduct({
      productName: "Pikachu - 004/005 (Pokemon Futsal)",
      productNumber: "003/005",
    }),
    false,
  );
});
