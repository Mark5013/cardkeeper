import "server-only";

import { cache } from "react";

import { logWarn, measureOperation } from "@/lib/observability";
import type { PokemonTcgCard } from "@/lib/pokemon-tcg/types";

type EbayEnvironment = "production" | "sandbox";

type EbayToken = {
  accessToken: string;
  expiresAt: number;
};

type EbaySearchResponse = {
  itemSummaries?: EbayItemSummary[];
  total?: number;
};

type EbayItemSummary = {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  image?: { imageUrl?: string };
  price?: EbayAmount;
  shippingOptions?: Array<{ shippingCost?: EbayAmount }>;
  itemLocation?: {
    city?: string;
    stateOrProvince?: string;
    country?: string;
  };
  buyingOptions?: string[];
  condition?: string;
};

type EbayAmount = {
  value?: string;
  currency?: string;
};

export type EbayListing = {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: string | null;
  shipping: string | null;
  location: string | null;
  buyingOptions: string[];
  condition: string | null;
};

export type EbayListingsResult = {
  listings: EbayListing[];
  total: number | null;
  searchUrl: string;
  isConfigured: boolean;
};

let tokenCache: EbayToken | null = null;

function getEnvironment(): EbayEnvironment {
  return process.env.EBAY_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

function getApiBaseUrl(environment: EbayEnvironment) {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function getCredentials() {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function getMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
}

function getScope() {
  return process.env.EBAY_OAUTH_SCOPE?.trim() || "https://api.ebay.com/oauth/api_scope";
}

function formatAmount(amount: EbayAmount | undefined) {
  if (!amount?.value || !amount.currency) return null;

  const numericValue = Number(amount.value);
  if (!Number.isFinite(numericValue)) return `${amount.value} ${amount.currency}`;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: amount.currency,
  }).format(numericValue);
}

function buildEbaySearchQuery(card: PokemonTcgCard) {
  return `${card.name} ${card.set.name} ${card.number} Pokemon card`.slice(0, 100);
}

export function buildEbaySearchUrl(card: PokemonTcgCard) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", buildEbaySearchQuery(card));
  return url.toString();
}

async function getApplicationAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const credentials = getCredentials();
  if (!credentials) return null;

  const environment = getEnvironment();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: getScope(),
  });

  const response = await fetch(`${getApiBaseUrl(environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`eBay token request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token || !payload.expires_in) {
    throw new Error("eBay token response was missing access token data");
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + payload.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

function mapListing(item: EbayItemSummary): EbayListing | null {
  if (!item.itemId || !item.title) return null;

  const url = item.itemAffiliateWebUrl || item.itemWebUrl;
  if (!url) return null;

  const location = [
    item.itemLocation?.city,
    item.itemLocation?.stateOrProvince,
    item.itemLocation?.country,
  ].filter(Boolean).join(", ");

  return {
    id: item.itemId,
    title: item.title,
    url,
    imageUrl: item.image?.imageUrl ?? null,
    price: formatAmount(item.price),
    shipping: formatAmount(item.shippingOptions?.[0]?.shippingCost),
    location: location || null,
    buyingOptions: item.buyingOptions ?? [],
    condition: item.condition ?? null,
  };
}

export const getEbayListingsForCard = cache(async (
  card: PokemonTcgCard,
): Promise<EbayListingsResult> => {
  const searchUrl = buildEbaySearchUrl(card);
  const credentials = getCredentials();
  const environment = getEnvironment();

  if (!credentials) {
    return { listings: [], total: null, searchUrl, isConfigured: false };
  }

  try {
    const accessToken = await getApplicationAccessToken();
    if (!accessToken) {
      return { listings: [], total: null, searchUrl, isConfigured: false };
    }

    const url = new URL(`${getApiBaseUrl(environment)}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", buildEbaySearchQuery(card));
    url.searchParams.set("limit", "20");
    url.searchParams.set("sort", "price");
    url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE|AUCTION}");

    const payload = await measureOperation(
      "ebay.listings.search",
      async () => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-EBAY-C-MARKETPLACE-ID": getMarketplaceId(),
          },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`eBay listing search failed with ${response.status}`);
        }

        return (await response.json()) as EbaySearchResponse;
      },
      { cardId: card.id },
    );

    const listings = (payload.itemSummaries ?? []).flatMap((item) => {
        const listing = mapListing(item);
        return listing ? [listing] : [];
      });

    return {
      listings,
      total: typeof payload.total === "number" ? payload.total : null,
      searchUrl,
      isConfigured: true,
    };
  } catch (error) {
    logWarn("ebay.listings.failed", {
      cardId: card.id,
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    logWarn("ebay.listings.falling_back_to_search_link", { cardId: card.id });
    return { listings: [], total: null, searchUrl, isConfigured: true };
  }
});
