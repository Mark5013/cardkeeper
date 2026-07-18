export type CollectionItemDto = {
  id: string;
  cardVariantId: string;
  providerCardId: string;
  cardName: string;
  cardNumber: string;
  providerSetId: string;
  setName: string;
  imageSmallUrl: string | null;
  imageLargeUrl: string | null;
  printing: string;
  condition: string;
  quantity: number;
  unitPriceUsd: number | null;
  estimatedValueUsd: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CollectionSummaryDto = {
  items: CollectionItemDto[];
  uniqueCards: number;
  uniqueVariants: number;
  totalCopies: number;
  estimatedValueUsd: number;
  unpricedVariants: number;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
};

export type OwnedCardVariantDto = {
  variantId: string;
  printing: string;
  condition: string;
  quantity: number;
};
