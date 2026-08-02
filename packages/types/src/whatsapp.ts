export type WhatsAppMessageType =
  | "text"
  | "button"
  | "interactive"
  | "image"
  | "document"
  | "audio"
  | "location"
  | "unknown";

export type NormalizedWhatsAppLocation = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export type NormalizedInboundMessage = {
  provider: "whatsapp_cloud";
  providerMessageId: string;
  phoneNumberId: string;
  wabaId?: string;
  from: string;
  timestamp?: string;
  type: WhatsAppMessageType;
  text?: string;
  mediaId?: string;
  mediaCaption?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  location?: NormalizedWhatsAppLocation;
  raw: unknown;
};

export type OutboundTextMessage = {
  to: string;
  text: string;
};

export type OutboundImageMessage = {
  to: string;
  imageUrl: string;
  caption?: string;
};

export type OutboundMessageResult = {
  ok: boolean;
  httpStatus: number;
  providerMessageId?: string;
  error?: {
    code?: string | number;
    subcode?: string | number;
    type?: string;
    safeDetail?: string;
  };
  raw: unknown;
};
