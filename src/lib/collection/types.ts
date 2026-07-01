export type CollectionItemDto = {
  id: string;
  cardVariantId: string;
  providerCardId: string;
  cardName: string;
  cardNumber: string;
  setName: string;
  imageSmallUrl: string | null;
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
};

export type OwnedCardVariantDto = {
  variantId: string;
  printing: string;
  condition: string;
  quantity: number;
};
