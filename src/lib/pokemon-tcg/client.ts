import "server-only";

import type {
  CardSearchPayload,
  CardSearchResult,
  ParsedCardQuery,
  PokemonTcgCard,
  PokemonTcgCardResponse,
  PokemonTcgSearchResponse,
  PokemonTcgSet,
  PokemonTcgSetResponse,
  PokemonTcgSetsResponse,
  SetCardsPayload,
} from "./types";

const API_BASE_URL = "https://api.pokemontcg.io/v2";
const CARD_NUMBER_PATTERN = /^(?=.*\d)[a-z0-9]+(?:[-/][a-z0-9]+)*$/i;

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizeCardNumber(value: string) {
  return normalize(value).replace(/^#/, "");
}

function escapeLucene(value: string) {
  return value.replace(/([+\-=&|><!(){}\[\]^"~*?:\\/])/g, "\\$1");
}

function buildNamePrefixQuery(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `name:${escapeLucene(term)}*`)
    .join(" ");
}

function buildBroadQuery(parsedQuery: ParsedCardQuery, partialNumber: boolean) {
  const parts: string[] = [];

  if (parsedQuery.name) {
    parts.push(buildNamePrefixQuery(parsedQuery.name));
  }

  if (parsedQuery.number) {
    const number = escapeLucene(parsedQuery.number);
    parts.push(partialNumber ? `number:${number}*` : `number:"${number}"`);
  }

  return parts.join(" ");
}

function buildRelaxedNameQuery(name: string) {
  const longestTerm = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0];

  if (!longestTerm) return "";

  const stemLength = longestTerm.length >= 5 ? 3 : Math.min(longestTerm.length, 2);
  return `name:${escapeLucene(longestTerm.slice(0, stemLength))}*`;
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function getStartingMarketPrice(card: PokemonTcgCard) {
  const marketPrices = Object.values(card.tcgplayer?.prices ?? {})
    .map((price) => price.market)
    .filter((price): price is number => typeof price === "number");

  return marketPrices.length > 0 ? Math.min(...marketPrices) : null;
}

function mapCard(card: PokemonTcgCard): CardSearchResult {
  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    imageSmallUrl: card.images.small,
    imageLargeUrl: card.images.large,
    set: card.set,
    startingPriceUsd: getStartingMarketPrice(card),
    priceUpdatedAt: card.tcgplayer?.updatedAt ?? null,
  };
}

function getHeaders() {
  const headers = new Headers({ Accept: "application/json" });
  const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();

  if (apiKey) {
    headers.set("X-Api-Key", apiKey);
  }

  return headers;
}

function rankClosestCards(cards: PokemonTcgCard[], parsedQuery: ParsedCardQuery) {
  return [...cards].sort((left, right) => {
    const leftNumberPenalty =
      parsedQuery.number && normalizeCardNumber(left.number) !== normalizeCardNumber(parsedQuery.number) ? 1 : 0;
    const rightNumberPenalty =
      parsedQuery.number && normalizeCardNumber(right.number) !== normalizeCardNumber(parsedQuery.number) ? 1 : 0;

    if (leftNumberPenalty !== rightNumberPenalty) {
      return leftNumberPenalty - rightNumberPenalty;
    }

    if (!parsedQuery.name) return left.name.localeCompare(right.name);

    return (
      levenshtein(normalize(parsedQuery.name), normalize(left.name)) -
      levenshtein(normalize(parsedQuery.name), normalize(right.name))
    );
  });
}

async function fetchCards(
  query: string,
  page: number,
  pageSize: number,
  orderBy = "-set.releaseDate,name,number",
) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
    orderBy,
    select: "id,name,number,rarity,artist,images,set,tcgplayer",
  });

  const response = await fetch(`${API_BASE_URL}/cards?${params}`, {
    headers: getHeaders(),
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Pokemon TCG API returned ${response.status}.`);
  }

  return (await response.json()) as PokemonTcgSearchResponse;
}

export async function getPokemonCard(id: string) {
  const response = await fetch(`${API_BASE_URL}/cards/${encodeURIComponent(id)}`, {
    headers: getHeaders(),
    next: { revalidate: 3600 },
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Pokemon TCG API returned ${response.status}.`);
  }

  const payload = (await response.json()) as PokemonTcgCardResponse;
  return payload.data;
}

export async function getPokemonSets() {
  const params = new URLSearchParams({
    page: "1",
    pageSize: "250",
    orderBy: "-releaseDate,name",
  });

  const response = await fetch(`${API_BASE_URL}/sets?${params}`, {
    headers: getHeaders(),
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    throw new Error(`Pokemon TCG API returned ${response.status}.`);
  }

  const payload = (await response.json()) as PokemonTcgSetsResponse;
  return payload.data;
}

export async function getPokemonSet(id: string) {
  const response = await fetch(`${API_BASE_URL}/sets/${encodeURIComponent(id)}`, {
    headers: getHeaders(),
    next: { revalidate: 86400 },
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Pokemon TCG API returned ${response.status}.`);
  }

  const payload = (await response.json()) as PokemonTcgSetResponse;
  return payload.data;
}

function sortSetCards(cards: CardSearchResult[]) {
  return [...cards].sort((left, right) =>
    left.number.localeCompare(right.number, "en", { numeric: true }) ||
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
  );
}

export async function getPokemonCardsBySetPage(input: {
  setId: string;
  page?: number;
  pageSize?: number;
}): Promise<SetCardsPayload> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 250;
  const query = `set.id:${escapeLucene(input.setId)}`;
  const payload = await fetchCards(query, page, pageSize, "number,name");

  return {
    cards: sortSetCards(payload.data.map(mapCard)),
    totalCount: payload.totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(payload.totalCount / pageSize),
  };
}

export async function getPokemonCardsBySet(set: PokemonTcgSet) {
  const firstPayload = await getPokemonCardsBySetPage({ setId: set.id });
  const remainingPayloads =
    firstPayload.totalPages > 1
      ? await Promise.all(
          Array.from({ length: firstPayload.totalPages - 1 }, (_, index) =>
            getPokemonCardsBySetPage({ setId: set.id, page: index + 2 }),
          ),
        )
      : [];
  const cards = [firstPayload, ...remainingPayloads].flatMap((payload) => payload.cards);

  return sortSetCards(cards);
}

export function parseCardSearchQuery(query: string): ParsedCardQuery {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const possibleNumber = tokens.at(-1)?.replace(/^#/, "") ?? "";

  if (possibleNumber && CARD_NUMBER_PATTERN.test(possibleNumber)) {
    return {
      name: tokens.length > 1 ? tokens.slice(0, -1).join(" ") : null,
      number: possibleNumber,
    };
  }

  return { name: tokens.join(" ") || null, number: null };
}

export async function searchPokemonCards(input: {
  query: string;
  mode?: "search" | "suggest";
  page?: number;
  pageSize?: number;
}): Promise<CardSearchPayload> {
  const parsedQuery = parseCardSearchQuery(input.query);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? (input.mode === "suggest" ? 6 : 20);
  const broadQuery = buildBroadQuery(parsedQuery, input.mode === "suggest");

  if (!broadQuery) {
    return {
      cards: [],
      totalCount: 0,
      matchType: "closest",
      parsedQuery,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  let payload = await fetchCards(broadQuery, page, pageSize);

  if (input.mode === "suggest") {
    return {
      cards: payload.data.map(mapCard),
      totalCount: payload.totalCount,
      matchType: "suggestions",
      parsedQuery,
      page,
      pageSize,
      totalPages: Math.ceil(payload.totalCount / pageSize),
    };
  }

  if (payload.totalCount > 0) {
    return {
      cards: payload.data.map(mapCard),
      totalCount: payload.totalCount,
      matchType: "matches",
      parsedQuery,
      page,
      pageSize,
      totalPages: Math.ceil(payload.totalCount / pageSize),
    };
  }

  if (parsedQuery.name && parsedQuery.number) {
    payload = await fetchCards(buildNamePrefixQuery(parsedQuery.name), page, pageSize);
    if (payload.totalCount > 0) {
      return {
        cards: rankClosestCards(payload.data, parsedQuery).map(mapCard),
        totalCount: payload.totalCount,
        matchType: "closest",
        parsedQuery,
        page,
        pageSize,
        totalPages: Math.ceil(payload.totalCount / pageSize),
      };
    }
  }

  if (parsedQuery.name) {
    const relaxedQuery = buildRelaxedNameQuery(parsedQuery.name);
    if (relaxedQuery) {
      const candidates = await fetchCards(relaxedQuery, 1, 250);
      const rankedCards = rankClosestCards(candidates.data, parsedQuery);
      const start = (page - 1) * pageSize;
      const pageCards = rankedCards.slice(start, start + pageSize);

      return {
        cards: pageCards.map(mapCard),
        totalCount: rankedCards.length,
        matchType: "closest",
        parsedQuery,
        page,
        pageSize,
        totalPages: Math.ceil(rankedCards.length / pageSize),
      };
    }
  }

  return {
    cards: [],
    totalCount: 0,
    matchType: "closest",
    parsedQuery,
    page,
    pageSize,
    totalPages: 0,
  };
}
