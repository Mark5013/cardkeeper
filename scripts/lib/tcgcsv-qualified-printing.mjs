import svPromoRepairPlan from "../data/tcgcsv-sv-promo-printing-repairs-2026-07-26.json" with {
  type: "json",
};
import promoPrereleaseRepairPlan from "../data/tcgcsv-promo-prerelease-printing-repairs-2026-07-26.json" with {
  type: "json",
};
import englishQualifiedPrintingRepairPlan from "../data/tcgcsv-english-qualified-printing-repairs-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFollowupPlan from "../data/tcgcsv-english-qualified-printing-followup-2026-07-27.json" with {
  type: "json",
};
import englishQualifiedPrintingFinalPlan from "../data/tcgcsv-english-qualified-printing-final-2026-07-27.json" with {
  type: "json",
};

export const TCGCSV_QUALIFIED_PRINTING_KEYS = Object.freeze({
  COSMOS_HOLOFOIL: "cosmos_holofoil",
  HOLIDAY_CALENDAR: "holiday_calendar_holofoil",
  MASTER_BALL: "master_ball_holofoil",
  POKEMON_CENTER_HOLOFOIL: "pokemon_center_holofoil",
  POKE_BALL: "poke_ball_holofoil",
  PRERELEASE_HOLOFOIL: "prerelease_holofoil",
  PRERELEASE_STAFF_HOLOFOIL: "prerelease_staff_holofoil",
  STAFF_HOLOFOIL: "staff_holofoil",
  WORLD_CHAMPIONSHIPS_NORMAL: "world_championships_normal",
  WORLD_CHAMPIONSHIPS_STAFF_NORMAL:
    "world_championships_staff_normal",
});

export const REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS = Object.freeze({
  BLACK_BOLT: 24325,
  BLACK_WHITE_PROMOS: 1407,
  PRISMATIC_EVOLUTIONS: 23821,
  SCARLET_VIOLET_PROMOS: 22872,
  SM_PROMOS: 1861,
  SWSH_PROMOS: 2545,
  WHITE_FLARE: 24326,
  XY_PROMOS: 1451,
});
const ENGLISH_QUALIFIED_PRINTING_REPAIR_PLANS = [
  englishQualifiedPrintingRepairPlan,
  englishQualifiedPrintingFollowupPlan,
  englishQualifiedPrintingFinalPlan,
];

const QUALIFIER_TO_PRINTING = new Map([
  ["Poke Ball Pattern", TCGCSV_QUALIFIED_PRINTING_KEYS.POKE_BALL],
  ["Master Ball Pattern", TCGCSV_QUALIFIED_PRINTING_KEYS.MASTER_BALL],
  ["Holiday Calendar", TCGCSV_QUALIFIED_PRINTING_KEYS.HOLIDAY_CALENDAR],
]);

const ALLOWED_QUALIFIERS_BY_GROUP_ID = new Map([
  [
    String(REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.PRISMATIC_EVOLUTIONS),
    new Set([
      "Poke Ball Pattern",
      "Master Ball Pattern",
      "Holiday Calendar",
    ]),
  ],
  [
    String(REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.BLACK_BOLT),
    new Set(["Poke Ball Pattern", "Master Ball Pattern"]),
  ],
  [
    String(REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.WHITE_FLARE),
    new Set(["Poke Ball Pattern", "Master Ball Pattern"]),
  ],
]);

const PHYSICAL_PRINTING_QUALIFIER_HINT =
  /\b(?:calendar|cosmos|cracked\s+ice|etched|exclusive|foil|holo|league|master\s+ball|misprint|parallel|pattern|poke\s+ball|pok[eé]mon\s+center|prerelease|pre-release|promo|reverse|staff|stamp|winner)\b/i;
const SV_PROMO_ASSIGNMENTS_BY_PRODUCT_ID = new Map(
  svPromoRepairPlan.assignments.map(
    ([cardProviderId, sourcePrinting, productId, targetPrinting]) => [
      String(productId),
      {
        cardProviderId,
        sourcePrinting,
        targetPrinting,
      },
    ],
  ),
);
const PROMO_PRERELEASE_ASSIGNMENTS_BY_PRODUCT_ID = new Map(
  promoPrereleaseRepairPlan.groups.flatMap((group) =>
    group.cards.flatMap(
      ([
        cardProviderId,
        prereleaseProductId,
        prereleaseProductName,
        staffProductId,
        staffProductName,
      ]) => [
        [
          String(prereleaseProductId),
          {
            cardProviderId,
            groupId: String(group.groupId),
            productName: prereleaseProductName,
            sourcePrinting: group.sourcePrinting,
            targetPrinting:
              TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_HOLOFOIL,
          },
        ],
        [
          String(staffProductId),
          {
            cardProviderId,
            groupId: String(group.groupId),
            productName: staffProductName,
            sourcePrinting: group.sourcePrinting,
            targetPrinting:
              TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
          },
        ],
      ],
    ),
  ),
);
const PROMO_PRERELEASE_GROUP_IDS = new Set(
  promoPrereleaseRepairPlan.groups.map((group) => String(group.groupId)),
);
const ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID =
  new Map();
for (const plan of ENGLISH_QUALIFIED_PRINTING_REPAIR_PLANS) {
  for (const [
    cardProviderId,
    sourcePrinting,
    products,
  ] of plan.sources) {
    for (const [
      productId,
      groupId,
      productName,
      targetPrinting,
    ] of products) {
      const normalizedProductId = String(productId);
      const assignments =
        ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID.get(
          normalizedProductId,
        ) ?? [];
      assignments.push({
        cardProviderId,
        groupId: String(groupId),
        productName,
        sourcePrinting,
        targetPrinting,
      });
      ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID.set(
        normalizedProductId,
        assignments,
      );
    }
  }
}

function getParentheticalSegments(value) {
  return Array.from(String(value ?? "").matchAll(/\(([^()]*)\)/g), (match) => ({
    endIndex: match.index + match[0].length,
    qualifier: match[1],
  }));
}

function unsupportedResult(qualifier = null) {
  return {
    status: "unsupported",
    printing: null,
    qualifier,
  };
}

/**
 * Classifies only the reviewed physical-printing qualifiers whose TCGCSV
 * products otherwise share the ordinary "Holofoil" subtype.
 *
 * Subtype normalization deliberately belongs to the caller. A qualified
 * result should be accepted only alongside independent Holofoil subtype
 * evidence.
 */
export function classifyReviewedTcgcsvQualifiedPrinting({
  groupId,
  productId,
  productName,
  sourcePrinting,
}) {
  const normalizedGroupId = String(groupId ?? "").trim();
  const englishQualifiedPrintingAssignments =
    ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID.get(
      String(productId ?? "").trim(),
    ) ?? [];
  const normalizedSourcePrinting = String(
    sourcePrinting ?? "",
  ).trim();
  const englishQualifiedPrintingAssignment =
    normalizedSourcePrinting
      ? englishQualifiedPrintingAssignments.find(
          (assignment) =>
            assignment.sourcePrinting ===
            normalizedSourcePrinting,
        )
      : englishQualifiedPrintingAssignments.length === 1
        ? englishQualifiedPrintingAssignments[0]
        : null;

  if (englishQualifiedPrintingAssignment) {
    return classifyReviewedEnglishQualifiedPrinting({
      assignment: englishQualifiedPrintingAssignment,
      groupId: normalizedGroupId,
      productName,
      sourcePrinting,
    });
  }

  const promoPrereleaseAssignment =
    PROMO_PRERELEASE_ASSIGNMENTS_BY_PRODUCT_ID.get(
      String(productId ?? "").trim(),
    );

  if (promoPrereleaseAssignment) {
    return classifyReviewedPromoPrereleasePrinting({
      assignment: promoPrereleaseAssignment,
      groupId: normalizedGroupId,
      productName,
    });
  }

  if (PROMO_PRERELEASE_GROUP_IDS.has(normalizedGroupId)) {
    // Only the exact reviewed product IDs receive qualified identities.
    return {
      status: "ordinary",
      printing: null,
      qualifier: null,
    };
  }

  if (
    normalizedGroupId ===
    String(REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SCARLET_VIOLET_PROMOS)
  ) {
    return classifyReviewedScarletVioletPromoPrinting({
      productId,
      productName,
    });
  }

  if (
    normalizedSourcePrinting === "normal" &&
    /\(non[- ]holo\)$/i.test(String(productName ?? "").trim())
  ) {
    return {
      status: "ordinary",
      printing: null,
      qualifier: null,
    };
  }

  const reviewedQualifiers = ALLOWED_QUALIFIERS_BY_GROUP_ID.get(
    normalizedGroupId,
  );

  if (!reviewedQualifiers) {
    const suspiciousQualifier = getParentheticalSegments(productName).find(
      ({ qualifier }) => PHYSICAL_PRINTING_QUALIFIER_HINT.test(qualifier),
    )?.qualifier;

    return suspiciousQualifier
      ? unsupportedResult(suspiciousQualifier)
      : {
          status: "ordinary",
          printing: null,
          qualifier: null,
        };
  }

  const normalizedProductName = String(productName ?? "").trim();
  if (!normalizedProductName) return unsupportedResult();

  const parentheticalSegments = getParentheticalSegments(normalizedProductName);
  const suspiciousSegments = parentheticalSegments.filter(({ qualifier }) =>
    PHYSICAL_PRINTING_QUALIFIER_HINT.test(qualifier),
  );
  const terminalSegment = parentheticalSegments.at(-1);
  const hasTerminalQualifier =
    terminalSegment?.endIndex === normalizedProductName.length;
  const exactPrinting = terminalSegment
    ? QUALIFIER_TO_PRINTING.get(terminalSegment.qualifier)
    : undefined;

  if (
    hasTerminalQualifier &&
    exactPrinting &&
    reviewedQualifiers.has(terminalSegment.qualifier) &&
    suspiciousSegments.length === 1
  ) {
    return {
      status: "qualified",
      printing: exactPrinting,
      qualifier: terminalSegment.qualifier,
    };
  }

  if (suspiciousSegments.length > 0) {
    return unsupportedResult(suspiciousSegments[0].qualifier);
  }

  return {
    status: "ordinary",
    printing: null,
    qualifier: null,
  };
}

export function getTcgcsvQualifiedPrintingSourcePrinting(value) {
  const printing = String(value ?? "").trim();

  if (
    printing === "reverse_holofoil" ||
    printing.endsWith("_reverse_holofoil")
  ) {
    return "reverse_holofoil";
  }
  if (printing.endsWith("_holofoil")) return "holofoil";
  if (printing.endsWith("_normal")) return "normal";

  return printing;
}

export function reviewTcgcsvQualifiedPrintingRef({
  groupId,
  normalizedSubtypes = [],
  printing,
  productId,
  productName,
}) {
  const normalizedGroupId = String(groupId ?? "").trim();
  const classification = classifyReviewedTcgcsvQualifiedPrinting({
    groupId: normalizedGroupId,
    productId,
    productName,
    sourcePrinting: getTcgcsvQualifiedPrintingSourcePrinting(printing),
  });

  if (
    !isReviewedTcgcsvQualifiedPrintingIdentity({
      groupId: normalizedGroupId,
      productId,
    })
  ) {
    return {
      classification,
      reason: null,
    };
  }

  if (classification.status === "unsupported") {
    return {
      classification,
      reason: "unsupported physical-printing qualifier in reviewed group",
    };
  }

  if (classification.status !== "qualified") {
    return {
      classification,
      reason: null,
    };
  }

  const distinctSubtypes = new Set(normalizedSubtypes);
  const sourcePrinting = getTcgcsvQualifiedPrintingSourcePrinting(
    classification.printing,
  );
  const matchingEnglishAssignments = (
    ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID.get(
      String(productId ?? "").trim(),
    ) ?? []
  ).filter(
    (assignment) =>
      assignment.groupId === normalizedGroupId &&
      assignment.productName === String(productName ?? "").trim(),
  );
  const reviewedSourcePrintings = new Set(
    matchingEnglishAssignments.map(
      (assignment) => assignment.sourcePrinting,
    ),
  );
  const hasReviewedMultiSourceIdentity =
    reviewedSourcePrintings.size > 1 &&
    [...distinctSubtypes].every((normalizedSubtype) =>
      reviewedSourcePrintings.has(normalizedSubtype),
    );
  if (
    !hasReviewedMultiSourceIdentity &&
    [...distinctSubtypes].some(
      (normalizedSubtype) => normalizedSubtype !== sourcePrinting,
    )
  ) {
    const sourcePrintingLabel =
      sourcePrinting === "holofoil"
        ? "Holofoil"
        : sourcePrinting === "normal"
          ? "Normal"
          : sourcePrinting;

    return {
      classification,
      reason: `qualified product prices do not use only ${sourcePrintingLabel}`,
    };
  }

  if (printing !== classification.printing) {
    return {
      classification,
      reason: `qualified product identifies ${classification.printing}, not ${printing}`,
    };
  }

  return {
    classification,
    reason: null,
  };
}

function classifyReviewedEnglishQualifiedPrinting({
  assignment,
  groupId,
  productName,
  sourcePrinting,
}) {
  const normalizedProductName = String(productName ?? "").trim();
  const normalizedSourcePrinting = String(
    sourcePrinting ?? "",
  ).trim();
  const identityMatches =
    groupId === assignment.groupId &&
    normalizedProductName === assignment.productName &&
    (!normalizedSourcePrinting ||
      normalizedSourcePrinting === assignment.sourcePrinting);

  if (!identityMatches) {
    return unsupportedResult(
      getReviewedPrintingQualifier(assignment.targetPrinting),
    );
  }

  if (assignment.targetPrinting === assignment.sourcePrinting) {
    return {
      status: "ordinary",
      printing: null,
      qualifier: null,
    };
  }

  return {
    status: "qualified",
    printing: assignment.targetPrinting,
    qualifier: getReviewedPrintingQualifier(
      assignment.targetPrinting,
    ),
  };
}

function getReviewedPrintingQualifier(printing) {
  return String(printing)
    .replace(/_(?:holofoil|normal)$/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyReviewedPromoPrereleasePrinting({
  assignment,
  groupId,
  productName,
}) {
  const normalizedProductName = String(productName ?? "").trim();
  const qualifier = parseReviewedScarletVioletPromoQualifier(
    normalizedProductName,
  );

  if (
    groupId !== assignment.groupId ||
    normalizedProductName !== assignment.productName ||
    qualifier?.printing !== assignment.targetPrinting ||
    getTcgcsvQualifiedPrintingSourcePrinting(
      assignment.targetPrinting,
    ) !== assignment.sourcePrinting
  ) {
    return unsupportedResult(qualifier?.label ?? null);
  }

  return {
    status: "qualified",
    printing: assignment.targetPrinting,
    qualifier: qualifier.label,
  };
}

export function isReviewedTcgcsvQualifiedPrintingIdentity({
  groupId,
  productId,
}) {
  const normalizedGroupId = String(groupId ?? "").trim();

  return (
    ALLOWED_QUALIFIERS_BY_GROUP_ID.has(normalizedGroupId) ||
    PROMO_PRERELEASE_GROUP_IDS.has(normalizedGroupId) ||
    PROMO_PRERELEASE_ASSIGNMENTS_BY_PRODUCT_ID.has(
      String(productId ?? "").trim(),
    ) ||
    ENGLISH_QUALIFIED_PRINTING_ASSIGNMENTS_BY_PRODUCT_ID.has(
      String(productId ?? "").trim(),
    ) ||
    normalizedGroupId ===
      String(
        REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS.SCARLET_VIOLET_PROMOS,
      )
  );
}

function classifyReviewedScarletVioletPromoPrinting({
  productId,
  productName,
}) {
  const assignment = SV_PROMO_ASSIGNMENTS_BY_PRODUCT_ID.get(
    String(productId ?? "").trim(),
  );

  // Until the full changed-build group cache is reviewed, only the exact
  // product IDs in the checked-in repair manifest receive new identities.
  if (!assignment) {
    return {
      status: "ordinary",
      printing: null,
      qualifier: null,
    };
  }

  const qualifier = parseReviewedScarletVioletPromoQualifier(productName);

  if (assignment.targetPrinting === assignment.sourcePrinting) {
    return qualifier === null
      ? {
          status: "ordinary",
          printing: null,
          qualifier: null,
        }
      : unsupportedResult(qualifier.label);
  }

  if (
    qualifier?.printing !== assignment.targetPrinting ||
    getTcgcsvQualifiedPrintingSourcePrinting(
      assignment.targetPrinting,
    ) !== assignment.sourcePrinting
  ) {
    return unsupportedResult(qualifier?.label ?? null);
  }

  return {
    status: "qualified",
    printing: assignment.targetPrinting,
    qualifier: qualifier.label,
  };
}

function parseReviewedScarletVioletPromoQualifier(value) {
  const productName = String(value ?? "").trim();
  const cases = [
    {
      pattern: /\s+\(Prerelease\)\s+\[Staff\]$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_STAFF_HOLOFOIL,
      label: "Prerelease Staff",
    },
    {
      pattern: /\s+\(Prerelease\)$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.PRERELEASE_HOLOFOIL,
      label: "Prerelease",
    },
    {
      pattern: /\s+\(Pok[eé]mon Center(?: Exclusive)?\)$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.POKEMON_CENTER_HOLOFOIL,
      label: "Pokémon Center",
    },
    {
      pattern: /\s+\(Cosmos Holo(?:foil)?\)$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.COSMOS_HOLOFOIL,
      label: "Cosmos Holofoil",
    },
    {
      pattern: /\s+\(Staff\)$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.STAFF_HOLOFOIL,
      label: "Staff",
    },
    {
      pattern: /\s+\(World Championships 2024\)\s+\[Staff\]$/i,
      printing:
        TCGCSV_QUALIFIED_PRINTING_KEYS.WORLD_CHAMPIONSHIPS_STAFF_NORMAL,
      label: "World Championships 2024 Staff",
    },
    {
      pattern: /\s+\(World Championships 2024\)$/i,
      printing: TCGCSV_QUALIFIED_PRINTING_KEYS.WORLD_CHAMPIONSHIPS_NORMAL,
      label: "World Championships 2024",
    },
  ];

  return (
    cases.find(({ pattern }) => pattern.test(productName)) ?? null
  );
}
