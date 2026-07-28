const SUPPLEMENTAL_GROUP_TERMS = [
  "academy",
  "blister",
  "burger king",
  "deck",
  "energies",
  "first partner",
  "jumbo",
  "league",
  "mcdonald",
  "placement",
  "prize pack",
  "professor",
  "promo",
  "promos",
  "shadowless",
  "trick or trade",
  "trainer kit",
  "world championship",
];

function normalizeGroupName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENERGY_TYPE_CODES = new Map([
  ["c", "colorless"],
  ["d", "darkness"],
  ["f", "fighting"],
  ["fdy", "fighting darkness fairy"],
  ["g", "grass"],
  ["gfpd", "grass fire psychic darkness"],
  ["grw", "grass fire water"],
  ["l", "lightning"],
  ["lpm", "lightning psychic metal"],
  ["m", "metal"],
  ["o", "dragon"],
  ["p", "psychic"],
  ["r", "fire"],
  ["w", "water"],
  ["wlfm", "water lightning fighting metal"],
  ["y", "fairy"],
]);

export function normalizeTcgcsvCardName(value, { stripQualifiers = false } = {}) {
  const normalizedValue = String(value ?? "")
    .replace(/δ/gi, " delta ")
    .replace(/[★☆]/g, " star ")
    .replace(/\u25c7/g, " prism star ")
    .replace(/♀/g, " f ")
    .replace(/♂/g, " m ");
  const withoutQualifiers = stripQualifiers
    ? normalizedValue.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    : normalizedValue;
  const tokens = withoutQualifiers
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\bpok[eé]mon\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token === "imposter") return "impostor";
      if (token === "drowsee") return "drowzee";
      if (token === "exeggcutor") return "exeggutor";
      if (token === "mach") return "machine";
      return ENERGY_TYPE_CODES.get(token) ?? token;
    });

  return tokens
    .join(" ")
    .replace(/\bpoke nav\b/g, "pokenav")
    .replace(/\bdelta species\b/g, "delta");
}

function stripTcgcsvCollectorSuffix(value) {
  return value
    .replace(/\s+[a-z]*\d+[a-z]?(?:\s+\d+)?\b.*$/, "")
    .trim();
}

function getTcgcsvProductIdentityCandidates(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return [];

  const sourceName = rawValue.split(/\s+-\s+/, 1)[0];
  const candidates = [rawValue, sourceName].flatMap((candidate) => {
    const fullName = normalizeTcgcsvCardName(candidate);
    const strippedName = normalizeTcgcsvCardName(candidate, {
      stripQualifiers: true,
    });

    return [
      fullName,
      strippedName,
      stripTcgcsvCollectorSuffix(fullName),
      stripTcgcsvCollectorSuffix(strippedName),
    ];
  });

  if (/\(\s*delta species\s*\)/i.test(rawValue)) {
    const deltaBaseName = sourceName.replace(
      /\(\s*delta species\s*\)/gi,
      " ",
    );
    candidates.push(normalizeTcgcsvCardName(`${deltaBaseName} delta`));
  }

  return candidates.filter(Boolean);
}

export function normalizeTcgcsvCollectorNumber(value) {
  return String(value ?? "")
    .split("/")[0]
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^0+(?=\d)/, "")
    .replace(/^([a-z]+)0+(?=\d)/, "$1")
    .trim();
}

function parseCollectorNumber(value) {
  const rawValue = String(value ?? "").trim();
  const match = rawValue.match(/#?\s*([a-z]*\d+[a-z]?)\s*\/\s*0*(\d+)\b/i);

  if (!match) {
    return {
      denominator: null,
      numerator: normalizeTcgcsvCollectorNumber(rawValue),
    };
  }

  return {
    denominator: Number(match[2]),
    numerator: normalizeTcgcsvCollectorNumber(match[1]),
  };
}

function parseCollectorNumberFromProductName(value) {
  const matches = Array.from(
    String(value ?? "").matchAll(/#?\s*([a-z]*\d+[a-z]?)\s*\/\s*0*(\d+)\b/gi),
  );
  const match = matches.at(-1);

  if (!match) return null;

  return {
    denominator: Number(match[2]),
    numerator: normalizeTcgcsvCollectorNumber(match[1]),
  };
}

export function getTcgcsvCollectorNumberEvidence({
  productName,
  productNumber,
}) {
  const extended = parseCollectorNumber(productNumber);
  const named = parseCollectorNumberFromProductName(productName);
  const hasConflict = Boolean(
    named &&
      (named.numerator !== extended.numerator ||
        (extended.denominator !== null &&
          named.denominator !== extended.denominator)),
  );

  return {
    denominator: hasConflict
      ? null
      : named?.denominator ?? extended.denominator,
    hasConflict,
    numerator: extended.numerator,
  };
}

export function isReviewedPokemonFutsalProduct({
  productName,
  productNumber,
}) {
  const evidence = getTcgcsvCollectorNumberEvidence({
    productName,
    productNumber,
  });
  const normalizedProductName = normalizeGroupName(productName);

  return (
    !evidence.hasConflict &&
    evidence.denominator === 5 &&
    ["1", "2", "3", "4", "5"].includes(evidence.numerator) &&
    normalizedProductName.includes("pokemon futsal")
  );
}

export function isTcgcsvCollectorNumberCompatibleWithSet({
  productName,
  productNumber,
  setPrintedTotal,
}) {
  const evidence = getTcgcsvCollectorNumberEvidence({
    productName,
    productNumber,
  });

  if (evidence.hasConflict) return false;
  if (evidence.denominator === null || !Number.isInteger(setPrintedTotal)) {
    return true;
  }

  return evidence.denominator === setPrintedTotal;
}

export function doesTcgcsvProductNameMatchCard({
  cardName,
  productCleanName,
  productName,
}) {
  const normalizedCardNames = [
    normalizeTcgcsvCardName(cardName),
    normalizeTcgcsvCardName(cardName, { stripQualifiers: true }),
  ].filter(Boolean);
  const normalizedProductNames = [productName, productCleanName].flatMap(
    getTcgcsvProductIdentityCandidates,
  );

  return normalizedCardNames.some((normalizedCardName) =>
    normalizedProductNames.includes(normalizedCardName),
  );
}

export function isSupplementalTcgcsvGroup(groupName) {
  const normalizedName = normalizeGroupName(groupName);
  return SUPPLEMENTAL_GROUP_TERMS.some((term) => normalizedName.includes(term));
}
