import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReviewedTcgcsvQualifiedPrinting,
  REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS,
  reviewTcgcsvQualifiedPrintingRef,
  TCGCSV_QUALIFIED_PRINTING_KEYS,
} from "../../scripts/lib/tcgcsv-qualified-printing.mjs";

test("classifies the reviewed patterned products in each official set group", () => {
  const cases = [
    {
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      productName: "Buneary - 083/131 (Poke Ball Pattern)",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL,
      qualifier: "Poke Ball Pattern",
    },
    {
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_BOLT,
      productName: "Snivy - 001/086 (Master Ball Pattern)",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL,
      qualifier: "Master Ball Pattern",
    },
    {
      groupId: String(
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.WHITE_FLARE,
      ),
      productName: "Tepig - 011/086 (Poke Ball Pattern)",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL,
      qualifier: "Poke Ball Pattern",
    },
  ];

  for (const { groupId, productName, printing, qualifier } of cases) {
    assert.deepEqual(
      classifyReviewedTcgcsvQualifiedPrinting({ groupId, productName }),
      {
        status: "qualified",
        printing,
        qualifier,
      },
    );
  }
});

test("restricts Holiday Calendar to its reviewed Prismatic Evolutions group", () => {
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      productName: "Glaceon ex - 026/131 (Holiday Calendar)",
    }),
    {
      status: "qualified",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.HOLIDAY_CALENDAR,
      qualifier: "Holiday Calendar",
    },
  );

  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_BOLT,
      productName: "Glaceon ex - 026/131 (Holiday Calendar)",
    }),
    {
      status: "unsupported",
      printing: null,
      qualifier: "Holiday Calendar",
    },
  );
});

test("leaves ordinary subtype classification to the caller", () => {
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      productName: "Umbreon ex - 161/131 (Special Illustration Rare)",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
});

test("fails closed for lookalike and combined physical-printing qualifiers", () => {
  const productNames = [
    "Buneary - 083/131 (Poké Ball Pattern)",
    "Buneary - 083/131 (Poke Ball Patterned)",
    "Buneary - 083/131 (Poke Ball Pattern) (Staff)",
    "Buneary - 083/131 (Staff) (Poke Ball Pattern)",
    "Buneary - 083/131 (Poke Ball Pattern) reprint",
  ];

  for (const productName of productNames) {
    assert.equal(
      classifyReviewedTcgcsvQualifiedPrinting({
        groupId:
          REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
        productName,
      }).status,
      "unsupported",
    );
  }
});

test("does not trust exact qualifier text outside the reviewed group IDs", () => {
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: 3170,
      productName: "Buneary - 083/131 (Poke Ball Pattern)",
    }),
    {
      status: "unsupported",
      printing: null,
      qualifier: "Poke Ball Pattern",
    },
  );
});

test("fails closed when product identity is unavailable in a reviewed group", () => {
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      productName: "",
    }),
    {
      status: "unsupported",
      printing: null,
      qualifier: null,
    },
  );

  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: 3170,
      productName: "",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
});

test("requires an existing qualified product ref to use its exact local printing", () => {
  const input = {
    groupId:
      REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
    normalizedSubtypes: ["holofoil"],
    productName: "Buneary - 083/131 (Poke Ball Pattern)",
  };

  assert.deepEqual(
    reviewTcgcsvQualifiedPrintingRef({
      ...input,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL,
    }),
    {
      classification: {
        status: "qualified",
        printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL,
        qualifier: "Poke Ball Pattern",
      },
      reason: null,
    },
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      ...input,
      printing: "holofoil",
    }).reason,
    "qualified product identifies poke_ball_holofoil, not holofoil",
  );
});

test("validates qualified refs without requiring a current price row", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_BOLT,
      normalizedSubtypes: [],
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL,
      productName: "Snivy - 001/086 (Master Ball Pattern)",
    }).reason,
    null,
  );
});

test("rejects qualifier and subtype drift during ref reconciliation", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      normalizedSubtypes: ["holofoil"],
      printing: "holofoil",
      productName: "Buneary - 083/131 (Poke Ball Patterned)",
    }).reason,
    "unsupported physical-printing qualifier in reviewed group",
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.WHITE_FLARE,
      normalizedSubtypes: ["reverse_holofoil"],
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL,
      productName: "Tepig - 011/086 (Poke Ball Pattern)",
    }).reason,
    "qualified product prices do not use only Holofoil",
  );
});

test("does not change ordinary ref reconciliation outside reviewed qualifiers", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS,
      normalizedSubtypes: ["holofoil", "reverse_holofoil"],
      printing: "reverse_holofoil",
      productName: "Umbreon ex - 161/131 (Special Illustration Rare)",
    }).reason,
    null,
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: 3170,
      normalizedSubtypes: ["holofoil"],
      printing: "holofoil",
      productName: "Buneary - 083/131 (Poke Ball Pattern)",
    }).reason,
    null,
  );
});
