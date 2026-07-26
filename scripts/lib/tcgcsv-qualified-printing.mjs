export const TCGCSV_QUALIFIED_PRINTING_KEYS = Object.freeze({
  HOLIDAY_CALENDAR: "holiday_calendar_holofoil",
  MASTER_BALL: "master_ball_holofoil",
  POKE_BALL: "poke_ball_holofoil",
});

export const REVIEWED_TCGCSV_QUALIFIED_PRINTING_GROUPS = Object.freeze({
  BLACK_BOLT: 24325,
  PRISMATIC_EVOLUTIONS: 23821,
  WHITE_FLARE: 24326,
});

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
  productName,
}) {
  const reviewedQualifiers = ALLOWED_QUALIFIERS_BY_GROUP_ID.get(
    String(groupId ?? "").trim(),
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

export function reviewTcgcsvQualifiedPrintingRef({
  groupId,
  normalizedSubtypes = [],
  printing,
  productName,
}) {
  const normalizedGroupId = String(groupId ?? "").trim();
  const classification = classifyReviewedTcgcsvQualifiedPrinting({
    groupId: normalizedGroupId,
    productName,
  });

  if (!ALLOWED_QUALIFIERS_BY_GROUP_ID.has(normalizedGroupId)) {
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
  if (
    [...distinctSubtypes].some(
      (normalizedSubtype) => normalizedSubtype !== "holofoil",
    )
  ) {
    return {
      classification,
      reason: "qualified product prices do not use only Holofoil",
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
