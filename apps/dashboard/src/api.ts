import type {
  AcceptOrderRequest,
  AutomationSettings,
  ConversationAutomation,
  ConversationTranscript,
  DeliveryCoverageSettings,
  HumanInterventionAlert,
  KitchenProgress,
  MenuItem,
  DashboardNotificationRecord,
  OrderCustomerNotificationType,
  OrderDetail,
  OrdersBucket,
  OrdersDashboardPayload,
  OrderStatus,
  OrderSummary,
  Product,
  ProductCategory,
  PublicCartaPayload,
  PublicCartaConciergeReply,
  RestaurantPublicProfilePayload,
  RestaurantPublicProfileSettings,
  RejectOutOfStockOrderRequest,
  RestaurantKnowledgeDocument,
  RestaurantKnowledgeSnapshot,
  RetryOrderCustomerNotificationRequest,
  TodayMenuPayload,
  UpdateDeliveryCoverageSettingsRequest,
  UpdateRestaurantPublicProfileSettingsRequest,
} from "@42day/types";
import { getAccessToken } from "./auth";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly backendError?: string,
  ) {
    super(message);
  }
}

export type TenantRole = "encargado" | "trabajador";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const token = await getAccessToken();
  const headers = isFormData
    ? { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    : {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

  const response = await fetch(`${apiBaseUrl}/dashboard${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    const backendError = payload?.error;
    throw new DashboardApiError(
      backendError ? `${backendError} (${response.status})` : `dashboard_api_error:${response.status}`,
      response.status,
      path,
      backendError,
    );
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = await getAccessToken();
  const response = await fetch(`${apiBaseUrl}/dashboard${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    const backendError = payload?.error;
    throw new DashboardApiError(
      backendError ? `${backendError} (${response.status})` : `dashboard_api_error:${response.status}`,
      response.status,
      path,
      backendError,
    );
  }

  return response.blob();
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/dashboard${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    const backendError = payload?.error;
    throw new DashboardApiError(
      backendError ? `${backendError} (${response.status})` : `dashboard_api_error:${response.status}`,
      response.status,
      path,
      backendError,
    );
  }

  return response.json() as Promise<T>;
}

export type DashboardTenant = {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  role?: TenantRole;
};

export type DashboardMe = {
  user: {
    id: string;
    email?: string;
    app_metadata?: {
      role?: string;
      system_admin?: boolean;
    };
  };
  tenants: DashboardTenant[];
};

export type AdminOverview = {
  activeRestaurantCount: number;
};

export type AdminRestaurantStatus = "active" | "inactive" | "suspended";

export type AdminRestaurantMember = {
  userId: string;
  email?: string;
  name?: string;
  role: "encargado" | "trabajador";
  status: "active" | "inactive";
  createdAt?: string;
  lastSignInAt?: string;
};

export type AdminRestaurant = {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  status: AdminRestaurantStatus;
  timezone: string;
  currency: string;
  automationEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  cartaUrlPath: string;
  publicProfileUrlPath: string;
  defaultPassword: string;
  location?: {
    id: string;
    name: string;
    address?: string;
    phone?: string;
    deliveryFeeFixed: number;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    automationEnabled: boolean;
    isActive: boolean;
  };
  members: AdminRestaurantMember[];
  metrics: {
    activeProductCount: number;
    todayMenuItemCount: number;
    ordersTodayCount: number;
    pendingOrderCount: number;
    completedTodayCount: number;
    revenueToday: number;
    lastOrderAt?: string;
  };
};

export type RestaurantAnalyticsPayload = {
  dataStatus: "ready" | "empty";
  metrics: {
    agentServedConversations: number;
    purchaseIntentConversations: number;
    agentConfirmedOrders: number;
    closeRatePercent: number | null;
    humanInterventionConversations: number;
    averageFirstResponseMinutes: number | null;
    averageCompletionMinutes: number | null;
    totalValue: number;
    averageTicket: number;
    manualCorrections: number;
    manualCorrectionRatePercent: number | null;
  };
  funnel: {
    items: Array<{ key: string; label: string; value: number }>;
    losses: Record<string, number>;
  };
  timing: {
    averageFirstResponseMinutes: number | null;
    averageCompletionMinutes: number | null;
    responseSampleSize: number;
    completionSampleSize: number;
    completionBuckets: Array<{ key: string; label: string; value: number }>;
    underFivePercent: number | null;
    underTenPercent: number | null;
  };
  activity: {
    daily: Array<{ date: string; value: number }>;
    hourly: Array<{ hour: number; value: number }>;
  };
  abandonment: {
    value: number;
    byCurrentState: Array<{ key: string; value: number }>;
    note: string;
  };
  humanIntervention: {
    conversations: number;
    alerts: number;
    unresolved: number;
    reasons: Array<{ key: string; value: number }>;
  };
  quality: {
    withoutManualCorrection: number;
    restaurantCorrections: number;
    unavailableItemEvents: number;
    cancelledAfterAvailabilityIssue: number;
    incompleteOrders: number | null;
    duplicateOrders: number | null;
  };
  limitations: string[];
};

export type RestaurantAnalyticsSnapshot = {
  id: string;
  tenantId: string;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  payload: RestaurantAnalyticsPayload;
  previousPayload: RestaurantAnalyticsPayload;
  calculatedAt: string;
};

export type CreateAdminRestaurantPayload = {
  name: string;
  slug?: string;
  timezone?: string;
  currency?: string;
  status?: AdminRestaurantStatus;
  automationEnabled?: boolean;
  locationName?: string;
  locationAddress?: string;
  locationPhone?: string;
  deliveryFeeFixed?: number;
  ownerEmail?: string;
  ownerName?: string;
  ownerPassword?: string;
};

export type UpdateAdminRestaurantPayload = Partial<{
  name: string;
  status: AdminRestaurantStatus;
  timezone: string;
  currency: string;
  automationEnabled: boolean;
  locationName: string;
  locationAddress: string;
  locationPhone: string;
  deliveryFeeFixed: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  locationAutomationEnabled: boolean;
}>;

export type DashboardDiagnostics = {
  tenant: string;
  schema: string;
  productsTable: boolean;
  productImageColumn: boolean;
  productImagesBucket: boolean;
};

export type PaymentAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentQr = {
  id: string;
  label: string;
  imageUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentConfigurationSnapshot = {
  accounts: PaymentAccount[];
  qrs: PaymentQr[];
  constraints: {
    maxActiveAccounts: 5;
    maxActiveQrs: 1;
  };
};

export type PaymentConfigurationHealth = {
  hasActiveTransferMethod: boolean;
  activeAccountsCount: number;
  activeQrCount: number;
  hasActiveQr: boolean;
};

export type DetectedMenuProduct = {
  name: string;
  description?: string;
  basePrice: number;
  category?: string;
  currency?: string;
  emoji?: string;
  confidence?: number;
  isAvailable?: boolean;
  options?: Product["options"];
  productType?: Product["productType"];
};

export type MenuFileAnalysisPayload = {
  categories?: Array<{
    items: DetectedMenuProduct[];
    name: string;
  }>;
  fileType: "image" | "excel" | "csv" | "pdf" | "txt";
  needsAiFallback: boolean;
  parser: string;
  products: DetectedMenuProduct[];
  source: "deterministic" | "ai";
  warnings: string[];
};

export type LunchReminderPreview = {
  lookbackDays: number;
  recipientCount: number;
  menuItemCount: number;
  canSend: boolean;
  messagePreview: string;
  recipients: Array<{
    customerId: string;
    name?: string;
    phone: string;
    lastOrderAt: string;
  }>;
};

export type LunchReminderSendResult = {
  batchId: string;
  lookbackDays: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  menuItemCount: number;
  results: Array<{
    customerId: string;
    name?: string;
    phone: string;
    lastOrderAt: string;
    status: "sent" | "failed";
    providerMessageId?: string;
  }>;
};

export function listTenants() {
  return request<DashboardTenant[]>("/tenants");
}

export function getMe() {
  return request<DashboardMe>("/me");
}

export function getAdminOverview() {
  return request<AdminOverview>("/admin/overview");
}

export function listAdminRestaurants() {
  return request<{ restaurants: AdminRestaurant[] }>("/admin/restaurants");
}

export function listRestaurantAnalytics(startDate: string, endDate: string) {
  return request<{ range: { startDate: string; endDate: string }; snapshots: RestaurantAnalyticsSnapshot[] }>(
    `/admin/analytics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

export function calculateRestaurantAnalytics(restaurantId: string, startDate: string, endDate: string) {
  return request<{ snapshot: RestaurantAnalyticsSnapshot }>(`/admin/analytics/restaurants/${restaurantId}/calculate`, {
    method: "POST",
    body: JSON.stringify({ startDate, endDate }),
  });
}

export function createAdminRestaurant(payload: CreateAdminRestaurantPayload) {
  return request<{ restaurant: AdminRestaurant; owner?: AdminRestaurantMember; temporaryPassword?: string }>("/admin/restaurants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAdminRestaurant(restaurantId: string, payload: UpdateAdminRestaurantPayload) {
  return request<{ restaurant?: AdminRestaurant }>(`/admin/restaurants/${restaurantId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAdminRestaurant(restaurantId: string) {
  return request<{ ok: true }>(`/admin/restaurants/${restaurantId}`, {
    method: "DELETE",
  });
}

export function createAdminRestaurantMember(
  restaurantId: string,
  payload: {
    email: string;
    name?: string;
    role?: AdminRestaurantMember["role"];
    password?: string;
  },
) {
  return request<{ member: AdminRestaurantMember; temporaryPassword: string }>(`/admin/restaurants/${restaurantId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAdminRestaurantMember(
  restaurantId: string,
  userId: string,
  payload: Partial<Pick<AdminRestaurantMember, "name" | "role" | "status">>,
) {
  return request<{ restaurant?: AdminRestaurant }>(`/admin/restaurants/${restaurantId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAdminRestaurantMember(restaurantId: string, userId: string) {
  return request<{ ok: true }>(`/admin/restaurants/${restaurantId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function resetAdminRestaurantMemberPassword(restaurantId: string, userId: string, password?: string) {
  return request<{ temporaryPassword: string }>(`/admin/restaurants/${restaurantId}/members/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function getDiagnostics(tenantSlug: string) {
  return request<DashboardDiagnostics>(`/${tenantSlug}/diagnostics`);
}

export function getTodayMenu(tenantSlug: string) {
  return request<TodayMenuPayload>(`/${tenantSlug}/menu/today`);
}

export function getLunchReminderPreview(tenantSlug: string) {
  return request<LunchReminderPreview>(`/${tenantSlug}/lunch-reminders/preview`);
}

export function sendLunchReminders(tenantSlug: string) {
  return request<LunchReminderSendResult>(`/${tenantSlug}/lunch-reminders/send`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getPublicCarta(tenantSlug: string) {
  return publicRequest<PublicCartaPayload>(`/public/${tenantSlug}/carta`);
}

export function getPublicRestaurantProfile(tenantSlug: string) {
  return publicRequest<RestaurantPublicProfilePayload>(`/public/${tenantSlug}/profile`);
}

export function askPublicCartaConcierge(
  tenantSlug: string,
  input: {
    question: string;
    history: Array<{ role: "visitor" | "assistant"; text: string }>;
  },
) {
  return publicRequest<PublicCartaConciergeReply>(`/public/${tenantSlug}/carta/concierge`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getRestaurantKnowledge(tenantSlug: string) {
  return request<RestaurantKnowledgeSnapshot>(`/${tenantSlug}/settings/carta-concierge`);
}

export function updateRestaurantKnowledge(
  tenantSlug: string,
  input: { document: RestaurantKnowledgeDocument; sourceFileName?: string },
) {
  return request<RestaurantKnowledgeSnapshot>(`/${tenantSlug}/settings/carta-concierge`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getRestaurantPublicProfileSettings(tenantSlug: string) {
  return request<RestaurantPublicProfileSettings>(`/${tenantSlug}/settings/public-profile`);
}

export function updateRestaurantPublicProfileSettings(
  tenantSlug: string,
  input: UpdateRestaurantPublicProfileSettingsRequest,
) {
  return request<RestaurantPublicProfileSettings>(`/${tenantSlug}/settings/public-profile`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listOrders(tenantSlug: string, bucket: OrdersBucket = "pending_confirmation") {
  return request<OrdersDashboardPayload>(`/${tenantSlug}/orders?bucket=${bucket}`);
}

export function listNotifications(tenantSlug: string) {
  return request<DashboardNotificationRecord[]>(`/${tenantSlug}/notifications`);
}

export function getOrder(tenantSlug: string, orderId: string) {
  return request<OrderDetail>(`/${tenantSlug}/orders/${orderId}`);
}

export function getConversationTranscript(tenantSlug: string, conversationId: string) {
  return request<ConversationTranscript>(
    `/${tenantSlug}/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
}

export function updateConversationAutomation(tenantSlug: string, conversationId: string, enabled: boolean, expectedUpdatedAt: string) {
  return request<ConversationAutomation>(`/${tenantSlug}/conversations/${conversationId}/automation`, {
    method: "PATCH",
    body: JSON.stringify({ enabled, expectedUpdatedAt }),
  });
}

export function getOrderPaymentProof(tenantSlug: string, orderId: string) {
  return requestBlob(`/${tenantSlug}/orders/${orderId}/payment-proof`);
}

export function confirmOrderPaymentProof(tenantSlug: string, orderId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/orders/${orderId}/payment-proof/confirm`, {
    method: "POST",
  });
}

export function updateOrderKitchenProgress(
  tenantSlug: string,
  orderId: string,
  patch: {
    progress?: KitchenProgress;
    label?: string | null;
  },
) {
  return request<OrderSummary>(`/${tenantSlug}/orders/${orderId}/kitchen-progress`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function updateOrderStatus(
  tenantSlug: string,
  orderId: string,
  patch: {
    status?: OrderStatus;
    restaurantConfirmed?: boolean;
    paymentConfirmed?: boolean;
  },
) {
  return request(`/${tenantSlug}/orders/${orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function acceptOrder(tenantSlug: string, orderId: string, payload: AcceptOrderRequest = {}) {
  return request<OrderSummary>(`/${tenantSlug}/orders/${orderId}/accept`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rejectOrderOutOfStock(
  tenantSlug: string,
  orderId: string,
  payload: RejectOutOfStockOrderRequest,
) {
  return request(`/${tenantSlug}/orders/${orderId}/reject-out-of-stock`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function retryOrderCustomerNotification(
  tenantSlug: string,
  orderId: string,
  type: OrderCustomerNotificationType | RetryOrderCustomerNotificationRequest["type"],
) {
  return request<OrderSummary>(`/${tenantSlug}/orders/${orderId}/customer-notification/retry`, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

export function listAlerts(tenantSlug: string, status?: HumanInterventionAlert["status"]) {
  const suffix = status ? `?status=${status}` : "";
  return request<HumanInterventionAlert[]>(`/${tenantSlug}/alerts${suffix}`);
}

export function acknowledgeAlert(tenantSlug: string, alertId: string) {
  return request<HumanInterventionAlert>(`/${tenantSlug}/alerts/${alertId}/acknowledge`, {
    method: "PATCH",
  });
}

export function resolveAlert(tenantSlug: string, alertId: string) {
  return request<HumanInterventionAlert>(`/${tenantSlug}/alerts/${alertId}/resolve`, {
    method: "PATCH",
  });
}

export function getAutomationSettings(tenantSlug: string) {
  return request<AutomationSettings>(`/${tenantSlug}/settings/automation`);
}

export function updateAutomationSettings(tenantSlug: string, enabled: boolean) {
  return request<AutomationSettings>(`/${tenantSlug}/settings/automation`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function getDeliveryCoverageSettings(tenantSlug: string) {
  return request<DeliveryCoverageSettings>(`/${tenantSlug}/settings/delivery-coverage`);
}

export function updateDeliveryCoverageSettings(tenantSlug: string, payload: UpdateDeliveryCoverageSettingsRequest) {
  return request<DeliveryCoverageSettings>(`/${tenantSlug}/settings/delivery-coverage`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getPaymentConfiguration(tenantSlug: string) {
  return request<PaymentConfigurationSnapshot>(`/${tenantSlug}/settings/payment-configuration`);
}

export function getPaymentConfigurationHealth(tenantSlug: string) {
  return request<PaymentConfigurationHealth>(`/${tenantSlug}/settings/payment-configuration/health`);
}

export function createPaymentAccount(
  tenantSlug: string,
  payload: {
    bankName: string;
    accountNumber: string;
    holderName: string;
    isActive?: boolean;
  },
) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-accounts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePaymentAccountRequest(
  tenantSlug: string,
  accountId: string,
  payload: Partial<{
    bankName: string;
    accountNumber: string;
    holderName: string;
    isActive: boolean;
  }>,
) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deletePaymentAccountRequest(tenantSlug: string, accountId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-accounts/${accountId}`, {
    method: "DELETE",
  });
}

export function activatePaymentAccountRequest(tenantSlug: string, accountId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-accounts/${accountId}/activate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function deactivatePaymentAccountRequest(tenantSlug: string, accountId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-accounts/${accountId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function createPaymentQrRequest(
  tenantSlug: string,
  payload: {
    label: string;
    file: File;
    isActive?: boolean;
  },
) {
  const formData = new FormData();
  formData.set("label", payload.label);
  formData.set("file", payload.file);
  if (payload.isActive !== undefined) {
    formData.set("isActive", payload.isActive ? "true" : "false");
  }

  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-qrs`, {
    method: "POST",
    body: formData,
  });
}

export function updatePaymentQrRequest(
  tenantSlug: string,
  qrId: string,
  payload: {
    label?: string;
    file?: File;
  },
) {
  const formData = new FormData();
  if (payload.label !== undefined) {
    formData.set("label", payload.label);
  }
  if (payload.file) {
    formData.set("file", payload.file);
  }

  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-qrs/${qrId}`, {
    method: "PATCH",
    body: formData,
  });
}

export function deletePaymentQrRequest(tenantSlug: string, qrId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-qrs/${qrId}`, {
    method: "DELETE",
  });
}

export function activatePaymentQrRequest(tenantSlug: string, qrId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-qrs/${qrId}/activate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function deactivatePaymentQrRequest(tenantSlug: string, qrId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/settings/payment-qrs/${qrId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
export function createProduct(tenantSlug: string, product: Partial<Product>) {
  return request<Product>(`/${tenantSlug}/products`, {
    method: "POST",
    body: JSON.stringify(product),
  });
}

export function uploadProductImage(tenantSlug: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return request<{ bucket: string; path: string; publicUrl: string }>(`/${tenantSlug}/uploads/product-image`, {
    method: "POST",
    body: formData,
    headers: {},
  });
}

export function analyzeMenuImage(tenantSlug: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return request<{ products: DetectedMenuProduct[] }>(`/${tenantSlug}/uploads/menu-image/analyze`, {
    method: "POST",
    body: formData,
    headers: {},
  });
}

export function analyzeMenuFile(tenantSlug: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return request<MenuFileAnalysisPayload>(`/${tenantSlug}/uploads/menu-file/analyze`, {
    method: "POST",
    body: formData,
  });
}

export function updateProduct(tenantSlug: string, productId: string, patch: Partial<Product>) {
  return request<Product>(`/${tenantSlug}/products/${productId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function updateProductCategoryEmoji(tenantSlug: string, categoryId: string, emoji: string) {
  return request<ProductCategory>(`/${tenantSlug}/product-categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify({ emoji }),
  });
}

export function deleteProduct(tenantSlug: string, productId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/products/${productId}`, {
    method: "DELETE",
  });
}

export function addMenuItem(tenantSlug: string, productId: string) {
  return request<MenuItem>(`/${tenantSlug}/menu/today/items`, {
    method: "POST",
    body: JSON.stringify({ productId }),
  });
}

export function updateMenuItem(tenantSlug: string, itemId: string, patch: Partial<MenuItem>) {
  return request<MenuItem>(`/${tenantSlug}/menu/today/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteMenuItem(tenantSlug: string, itemId: string) {
  return request<{ ok: true }>(`/${tenantSlug}/menu/today/items/${itemId}`, {
    method: "DELETE",
  });
}
