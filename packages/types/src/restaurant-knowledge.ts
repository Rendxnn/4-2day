/**
 * Information that a restaurant explicitly supplies for its public digital-menu
 * concierge. It is intentionally separate from the WhatsApp ordering context.
 */
export type RestaurantKnowledgeProduct = {
  /** Stable catalogue id when the entry is linked to a product. */
  productId?: string;
  /** Human-friendly matching key. Required when productId is not supplied. */
  productName?: string;
  aliases?: string[];
  ingredients?: string[];
  allergens?: string[];
  dietaryNotes?: string[];
  pairings?: string[];
  recommendations?: string[];
  spicyOptions?: string[];
  servingNotes?: string[];
  facts?: string[];
  serves?: {
    min?: number;
    max?: number;
    label?: string;
  };
  bestseller?: boolean;
};

export type RestaurantKnowledgeFaq = {
  question: string;
  answer: string;
};

export type RestaurantKnowledgeDocument = {
  version: 1;
  restaurant?: {
    assistantName?: string;
    voice?: string;
    culinaryStyle?: string;
    highlights?: string[];
    serviceNotes?: string[];
  };
  products?: RestaurantKnowledgeProduct[];
  faq?: RestaurantKnowledgeFaq[];
};

export type RestaurantKnowledgeSnapshot = {
  document: RestaurantKnowledgeDocument;
  sourceFileName?: string;
  version: number;
  updatedAt?: string;
};

export type PublicCartaConciergeReply = {
  answer: string;
  /** IDs from the currently published menu; safe for the client to render. */
  recommendedItemIds?: string[];
};
