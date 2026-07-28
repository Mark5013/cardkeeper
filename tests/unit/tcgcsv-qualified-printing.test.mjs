import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReviewedTcgcsvQualifiedPrinting,
  getTcgcsvQualifiedPrintingSourcePrinting,
  REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS,
  reviewTcgcsvQualifiedPrintingRef,
  TCGCSV_QUALIFIED_PRINTING_KEYS,
} from "../../scripts/lib/tcgcsv-qualified-printing.mjs";
import promoPrereleaseRepairPlan from "../../scripts/data/tcgcsv-promo-prerelease-printing-repairs-2026-07-26.json" with {
  type: "json",
};
import englishQualifiedPrintingRepairPlan from "../../scripts/data/tcgcsv-english-qualified-printing-repairs-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFollowupPlan from "../../scripts/data/tcgcsv-english-qualified-printing-followup-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFinalPlan from "../../scripts/data/tcgcsv-english-qualified-printing-final-2026-07-27.json" with {
  type: "json",
};

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

test("classifies only the exact reviewed Scarlet & Violet promo products", () => {
  const groupId =
    REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SCARLET_VIOLET_PROMOS;

  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "551688",
      productName: "Thwackey - 115",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "563315",
      productName: "Thwackey - 115 (Prerelease) [Staff]",
    }),
    {
      status: "qualified",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      qualifier: "Prerelease Staff",
    },
  );
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "594468",
      productName: "Magneton - 159 (Pokémon Center Exclusive)",
    }),
    {
      status: "qualified",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKEMON_CENTER_HOLOFOIL,
      qualifier: "Pokémon Center",
    },
  );
  assert.equal(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "563315",
      productName: "Thwackey - 115 (Prerelease)",
    }).status,
    "unsupported",
  );
  assert.equal(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "999999",
      productName: "Unreviewed - 999 (Staff)",
    }).status,
    "ordinary",
  );
});

test("classifies the exact reviewed promo Prerelease and Staff products", () => {
  const cases = [
    {
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_WHITE_PROMOS,
      productId: "90403",
      productName: "Volcarona - BW40 (Prerelease)",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_HOLOFOIL,
      qualifier: "Prerelease",
    },
    {
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_WHITE_PROMOS,
      productId: "97093",
      productName: "Volcarona - BW40 (Prerelease) [Staff]",
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      qualifier: "Prerelease Staff",
    },
    {
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.XY_PROMOS,
      productId: "118863",
      productName: "Moltres (Prerelease)",
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_HOLOFOIL,
      qualifier: "Prerelease",
    },
    {
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SM_PROMOS,
      productId: "127182",
      productName: "Shiinotic - SM10 (Prerelease) [Staff]",
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      qualifier: "Prerelease Staff",
    },
    {
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SWSH_PROMOS,
      productId: "451884",
      productName: "Sunflora - SWSH269 (Prerelease) [STAFF]",
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      qualifier: "Prerelease Staff",
    },
  ];

  for (const {
    groupId,
    productId,
    productName,
    printing,
    qualifier,
  } of cases) {
    assert.deepEqual(
      classifyReviewedTcgcsvQualifiedPrinting({
        groupId,
        productId,
        productName,
      }),
      {
        status: "qualified",
        printing,
        qualifier,
      },
    );
  }
});

test("routes every product in the reviewed promo Prerelease manifest", () => {
  let cardCount = 0;
  let productCount = 0;

  for (const group of promoPrereleaseRepairPlan.groups) {
    for (const [
      ,
      prereleaseProductId,
      prereleaseProductName,
      staffProductId,
      staffProductName,
    ] of group.cards) {
      cardCount += 1;

      for (const [productId, productName, printing, qualifier] of [
        [
          prereleaseProductId,
          prereleaseProductName,
          TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_HOLOFOIL,
          "Prerelease",
        ],
        [
          staffProductId,
          staffProductName,
          TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
          "Prerelease Staff",
        ],
      ]) {
        assert.deepEqual(
          classifyReviewedTcgcsvQualifiedPrinting({
            groupId: group.groupId,
            productId,
            productName,
          }),
          {
            status: "qualified",
            printing,
            qualifier,
          },
        );
        productCount += 1;
      }
    }
  }

  assert.equal(cardCount, promoPrereleaseRepairPlan.expectedCardCount);
  assert.equal(
    productCount,
    promoPrereleaseRepairPlan.expectedProductCount,
  );
});

test("routes every exact English closeout product without broad qualifier inference", () => {
  let assignmentCount = 0;

  for (const plan of [
    englishQualifiedPrintingRepairPlan,
    englishQualifiedPrintingFollowupPlan,
    englishQualifiedPrintingFinalPlan,
  ]) {
    for (const [, sourcePrinting, products] of plan.sources) {
      for (const [
        productId,
        groupId,
        productName,
        targetPrinting,
      ] of products) {
        const classification =
          classifyReviewedTcgcsvQualifiedPrinting({
            groupId,
            productId,
            productName,
            sourcePrinting,
          });

        if (targetPrinting === sourcePrinting) {
          assert.deepEqual(classification, {
            status: "ordinary",
            printing: null,
            qualifier: null,
          });
        } else {
          assert.equal(classification.status, "qualified");
          assert.equal(classification.printing, targetPrinting);
        }
        assignmentCount += 1;
      }
    }
  }

  assert.equal(
    assignmentCount,
    englishQualifiedPrintingRepairPlan.expectedProductCount +
      englishQualifiedPrintingFollowupPlan.expectedProductCount +
      englishQualifiedPrintingFinalPlan.expectedProductCount,
  );
  assert.equal(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: 1539,
      productId: "133846",
      productName: "Oricorio - 14/145 (Pokemon League)",
      sourcePrinting: "holofoil",
    }).status,
    "unsupported",
  );
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: 1432,
      productId: "88087",
      productName: "Pikachu",
      sourcePrinting: "holofoil",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId: 1938,
      productId: "133814",
      productName: "Professor Sycamore - 107a/122 (Non-Holo)",
      sourcePrinting: "normal",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
});

test("retains Reverse Holofoil as the source for qualified league printings", () => {
  assert.equal(
    getTcgcsvQualifiedPrintingSourcePrinting(
      "pokemon_league_reverse_holofoil",
    ),
    "reverse_holofoil",
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: 1539,
      normalizedSubtypes: ["reverse_holofoil"],
      printing: "pokemon_league_reverse_holofoil",
      productId: "133846",
      productName: "Oricorio - 14/145 (Pokemon League)",
    }).reason,
    null,
  );
});

test("accepts exact form products reviewed across multiple source finishes", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: 1397,
      normalizedSubtypes: ["normal", "reverse_holofoil"],
      printing: "50a_normal",
      productId: "85813",
      productName: "Golduck (50a)",
    }).reason,
    null,
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: 1397,
      normalizedSubtypes: ["normal", "reverse_holofoil"],
      printing: "50a_reverse_holofoil",
      productId: "85813",
      productName: "Golduck (50a)",
    }).reason,
    null,
  );
});

test("fails closed on promo Prerelease identity drift", () => {
  const groupId =
    REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_WHITE_PROMOS;

  assert.equal(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "90403",
      productName: "Volcarona - BW40 (Prerelease) [Staff]",
    }).status,
    "unsupported",
  );
  assert.equal(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.XY_PROMOS,
      productId: "90403",
      productName: "Volcarona - BW40 (Prerelease)",
    }).status,
    "unsupported",
  );
  assert.deepEqual(
    classifyReviewedTcgcsvQualifiedPrinting({
      groupId,
      productId: "999999",
      productName: "Unreviewed - BW999 (Prerelease)",
    }),
    {
      status: "ordinary",
      printing: null,
      qualifier: null,
    },
  );
});

test("validates reviewed promo Prerelease refs against Holofoil subtype evidence", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SM_PROMOS,
      normalizedSubtypes: ["holofoil"],
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      productId: "127182",
      productName: "Shiinotic - SM10 (Prerelease) [Staff]",
    }).reason,
    null,
  );
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId: REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SM_PROMOS,
      normalizedSubtypes: ["reverse_holofoil"],
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      productId: "127182",
      productName: "Shiinotic - SM10 (Prerelease) [Staff]",
    }).reason,
    "qualified product prices do not use only Holofoil",
  );
});

test("accepts reviewed qualified Normal products with Normal subtype evidence", () => {
  assert.equal(
    reviewTcgcsvQualifiedPrintingRef({
      groupId:
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SCARLET_VIOLET_PROMOS,
      normalizedSubtypes: ["normal"],
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.WORLD_CHAMPIONSHIPS_STAFF_NORMAL,
      productId: "583726",
      productName:
        "Paradise Resort - 150 (World Championships 2024) [Staff]",
    }).reason,
    null,
  );
});
