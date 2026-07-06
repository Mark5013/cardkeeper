export type PokemonTcgPrice = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number;
};

export type PokemonTcgLegality = "Legal" | "Banned";

export type PokemonTcgAttack = {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
};

export type PokemonTcgAbility = {
  name: string;
  text: string;
  type: string;
};

export type PokemonTcgCardmarketPrice = {
  averageSellPrice?: number;
  lowPrice?: number;
  trendPrice?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  reverseHoloSell?: number;
  reverseHoloLow?: number;
  reverseHoloTrend?: number;
};

export type PokemonTcgCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  artist?: string;
  supertype?: string;
  subtypes?: string[];
  level?: string;
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  rules?: string[];
  abilities?: PokemonTcgAbility[];
  attacks?: PokemonTcgAttack[];
  weaknesses?: Array<{ type: string; value: string }>;
  resistances?: Array<{ type: string; value: string }>;
  retreatCost?: string[];
  convertedRetreatCost?: number;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  legalities?: Partial<Record<"standard" | "expanded" | "unlimited", PokemonTcgLegality>>;
  regulationMark?: string;
  images: {
    small: string;
    large: string;
  };
  set: {
    id: string;
    name: string;
    series: string;
    printedTotal?: number;
    total?: number;
    releaseDate?: string;
    updatedAt?: string;
    images?: {
      symbol: string;
      logo: string;
    };
  };
  tcgplayer?: {
    url?: string;
    updatedAt: string;
    prices: Record<string, PokemonTcgPrice>;
  };
  cardmarket?: {
    url?: string;
    updatedAt: string;
    prices: PokemonTcgCardmarketPrice;
  };
};

export type PokemonTcgCardResponse = {
  data: PokemonTcgCard;
};

export type PokemonTcgSet = {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  updatedAt: string;
  images?: {
    symbol: string;
    logo: string;
  };
};

export type PokemonTcgSetResponse = {
  data: PokemonTcgSet;
};

export type PokemonTcgSetsResponse = {
  data: PokemonTcgSet[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
};

export type PokemonTcgSearchResponse = {
  data: PokemonTcgCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
};

export type CardSearchResult = {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  artist: string | null;
  imageSmallUrl: string;
  imageLargeUrl: string;
  set: {
    id: string;
    name: string;
    series: string;
  };
  startingPriceUsd: number | null;
  priceUpdatedAt: string | null;
  printings: Array<{
    value: string;
    label: string;
    price: PokemonTcgPrice | null;
  }>;
};

export type ParsedCardQuery = {
  name: string | null;
  number: string | null;
};

export type CardSearchMatchType = "matches" | "closest" | "suggestions";

export type CardSearchPayload = {
  cards: CardSearchResult[];
  totalCount: number;
  matchType: CardSearchMatchType;
  parsedQuery: ParsedCardQuery;
  page: number;
  pageSize: number;
  sort?: "relevance" | "price-desc" | "price-asc";
  totalPages: number;
};

export type SetCardsPayload = {
  cards: CardSearchResult[];
  totalCount: number;
  page: number;
  pageSize: number;
  sort?: "number-asc" | "price-desc" | "price-asc";
  totalPages: number;
};
