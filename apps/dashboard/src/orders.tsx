import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConversationAutomation, ConversationTranscript, ConversationTranscriptMessage, KitchenProgress, MenuItem, OpenOrderSummary, OrderDetail, OrderLineItem, OrdersDashboardPayload, OrderStatus, OrderSummary } from "@42day/types";
import {
  acceptOrder,
  confirmOrderPaymentProof,
  DashboardApiError,
  getConversationTranscript,
  getOrder,
  getOrderPaymentProof,
  listOrders,
  rejectOrderOutOfStock,
  retryOrderCustomerNotification,
  updateConversationAutomation,
  updateOrderKitchenProgress,
  updateOrderStatus,
} from "./api";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  LayoutGrid,
  List,
  Lock,
  Loader2,
  MapPin,
  MessageSquareWarning,
  Mic,
  Pencil,
  RefreshCcw,
  Store,
  Truck,
  UserRound,
  Video,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BillingSummaryCard } from "./features/orders/BillingSummaryCard";
import { OrderMetaCard } from "./features/orders/OrderMetaCard";
import {
  buildReplacementPools,
  resolveCategoryFromMenuItem,
  resolveOrderItemCategory,
} from "./features/orders/replacement-options";
import { formatDashboardDateTime, formatDashboardPrice } from "./i18n";

const DeliveryCoverageMap = lazy(async () => {
  const module = await import("./features/configuration/DeliveryCoverageMap");
  return { default: module.DeliveryCoverageMap };
});

type OrdersViewProps = {
  locale: "en" | "es";
  tenantSlug: string;
  menuItems: MenuItem[];
  onRefreshMenu: () => Promise<MenuItem[]>;
  onFocusOrderHandled: (orderId: string) => void;
  onNotify: (message: string) => void;
  focusOrderId?: string;
};

type OrdersFilter = "open" | "pending" | "confirmed" | "closed";
type OrdersLayout = "queue" | "board";
type ClosedRange = "today" | "7d" | "30d" | "custom";
type PendingLane = "restaurant" | "customer";
type ReplacementScope = "same" | "other";
type OperationalStageId = "open" | "review" | "preparing" | "ready" | "finished";

type OrdersFilterConfig = {
  id: OrdersFilter;
  label: string;
  description: string;
};

type RejectModalSubmitValue = {
  orderItemId: string;
  markMenuItemUnavailable: boolean;
  replacementMenuItemIds: string[];
  note: string;
};

const pendingStatuses: OrderStatus[] = ["new", "pending_restaurant_confirmation", "needs_customer_replacement"];
const confirmedStatuses: OrderStatus[] = ["accepted", "payment_pending_review", "preparing", "on_the_way"];
const closedStatuses: OrderStatus[] = ["delivered", "cancelled"];
let activeOrdersLocale: "en" | "es" = "es";

function getFilterTabs(locale: "en" | "es"): OrdersFilterConfig[] {
  return [
    { id: "open", label: locale === "en" ? "Open" : "Abiertos", description: "" },
    { id: "pending", label: locale === "en" ? "Pending" : "Pendientes", description: "" },
    { id: "confirmed", label: locale === "en" ? "Confirmed" : "Confirmados", description: "" },
    { id: "closed", label: locale === "en" ? "Closed" : "Cerrados", description: "" },
  ];
}

export function OrdersView({ focusOrderId = "", locale, menuItems, onFocusOrderHandled, onNotify, onRefreshMenu, tenantSlug }: OrdersViewProps) {
  activeOrdersLocale = locale;
  const filterTabs = useMemo(() => getFilterTabs(locale), [locale]);
  const [filter, setFilter] = useState<OrdersFilter>("open");
  const [queueStage, setQueueStage] = useState<OperationalStageId>("open");
  const [layout, setLayout] = useState<OrdersLayout>("queue");
  const [pendingLane, setPendingLane] = useState<PendingLane>("restaurant");
  const [closedRange, setClosedRange] = useState<ClosedRange>("today");
  const [customClosedDate, setCustomClosedDate] = useState(() => getLocalDateKey(new Date()));
  const [payload, setPayload] = useState<OrdersDashboardPayload | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [modalOrder, setModalOrder] = useState<OrderDetail | null>(null);
  const [modalMenuItems, setModalMenuItems] = useState<MenuItem[]>(menuItems);
  const [cancelOrderCandidate, setCancelOrderCandidate] = useState<OrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [openConversationDetail, setOpenConversationDetail] = useState<OpenOrderSummary | null>(null);
  const [conversationTranscript, setConversationTranscript] = useState<ConversationTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const [automationConfirmation, setAutomationConfirmation] = useState<ConversationAutomation | null>(null);
  const openConversationId = openConversationDetail?.conversationId;

  const loadOrders = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (mode === "initial") {
        setOrdersLoading(true);
      } else {
        setOrdersRefreshing(true);
      }

      try {
        const nextPayload = await listOrders(tenantSlug, "all");
        setPayload(nextPayload);
        setOrdersError("");
      } catch (error) {
        setOrdersError(getDashboardErrorMessage(error, locale === "en" ? "Could not load orders." : "No se pudieron cargar los pedidos.", locale));
      } finally {
        if (mode === "initial") {
          setOrdersLoading(false);
        } else {
          setOrdersRefreshing(false);
        }
      }
    },
    [tenantSlug],
  );

  const loadOrderDetail = useCallback(
    async (orderId: string) => {
      setDetailLoading(true);
      try {
        const nextDetail = await getOrder(tenantSlug, orderId);
        setSelectedOrder(nextDetail);
        setDetailError("");
        return nextDetail;
      } catch (error) {
        setSelectedOrder(null);
        setDetailError(getDashboardErrorMessage(error, locale === "en" ? "Could not load order details." : "No se pudo cargar el detalle del pedido.", locale));
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [tenantSlug],
  );

  useEffect(() => {
    let active = true;

    async function boot() {
      setPayload(null);
      setSelectedOrder(null);
      setSelectedOrderId("");
      if (!tenantSlug) return;

      setOrdersLoading(true);
      try {
        const nextPayload = await listOrders(tenantSlug, "all");
        if (!active) return;
        setPayload(nextPayload);
        setOrdersError("");
      } catch (error) {
        if (!active) return;
        setOrdersError(getDashboardErrorMessage(error, locale === "en" ? "Could not load orders." : "No se pudieron cargar los pedidos.", locale));
      } finally {
        if (active) {
          setOrdersLoading(false);
        }
      }
    }

    void boot();

    const intervalId = window.setInterval(() => {
      if (!active || !tenantSlug) return;
      void loadOrders("refresh");
    }, 20000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadOrders, tenantSlug]);

  useEffect(() => {
    let active = true;
    const conversationId = openConversationId;
    const activeTenantSlug = tenantSlug;

    if (!conversationId || !activeTenantSlug) {
      setConversationTranscript(null);
      setTranscriptLoading(false);
      setTranscriptError("");
      return () => {
        active = false;
      };
    }

    async function loadTranscript(
      targetTenantSlug: string,
      targetConversationId: string,
      initial: boolean,
    ) {
      if (initial) {
        setConversationTranscript(null);
        setTranscriptLoading(true);
      }

      try {
        const transcript = await getConversationTranscript(targetTenantSlug, targetConversationId);
        if (!active) return;
        setConversationTranscript(transcript);
        setTranscriptError("");
      } catch (error) {
        if (!active) return;
        setTranscriptError(getDashboardErrorMessage(
          error,
          locale === "en" ? "Could not load this conversation." : "No se pudo cargar esta conversacion.",
          locale,
        ));
      } finally {
        if (active && initial) {
          setTranscriptLoading(false);
        }
      }
    }

    void loadTranscript(activeTenantSlug, conversationId, true);
    const intervalId = window.setInterval(() => {
      void loadTranscript(activeTenantSlug, conversationId, false);
    }, 8000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [locale, openConversationId, tenantSlug]);

  const allOrders = payload?.orders ?? [];
  const openOrders = payload?.openOrders ?? [];
  const closedOrders = useMemo(
    () => allOrders
      .filter((order) => closedStatuses.includes(order.status))
      .filter((order) => matchesClosedRange(order, closedRange, customClosedDate)),
    [allOrders, closedRange, customClosedDate],
  );
  const counts = useMemo<Record<OrdersFilter, number>>(
    () => ({
      open: payload?.counts.open ?? openOrders.length,
      pending: allOrders.filter((order) => pendingStatuses.includes(order.status)).length,
      confirmed: allOrders.filter((order) => confirmedStatuses.includes(order.status)).length,
      closed: closedOrders.length,
    }),
    [allOrders, closedOrders.length, openOrders.length, payload?.counts.open],
  );

  const filteredOrders = useMemo(() => {
    if (filter === "open") return [] as OrderSummary[];
    if (filter === "closed") return closedOrders;
    return allOrders.filter((order) => matchesFilter(order, filter));
  }, [allOrders, closedOrders, filter]);
  const pendingRestaurantOrders = useMemo(
    () => allOrders.filter((order) => order.status === "pending_restaurant_confirmation" || order.status === "new"),
    [allOrders],
  );
  const pendingCustomerOrders = useMemo(
    () => allOrders.filter((order) => order.status === "needs_customer_replacement"),
    [allOrders],
  );
  const pendingLaneOrders = pendingLane === "restaurant" ? pendingRestaurantOrders : pendingCustomerOrders;
  const operationalGroups = useMemo(
    () => getOperationalGroups(allOrders, openOrders, closedOrders),
    [allOrders, closedOrders, openOrders],
  );
  const queueStageTabs = useMemo(() => [
    {
      id: "open" as const,
      label: locale === "en" ? "Open" : "Abiertos",
      count: operationalGroups.activeOpenChats.length + operationalGroups.rebuildingOrders.length,
    },
    {
      id: "review" as const,
      label: locale === "en" ? "Review" : "Por confirmar",
      count: operationalGroups.reviewOrders.length,
    },
    {
      id: "preparing" as const,
      label: locale === "en" ? "Preparing" : "En preparación",
      count: operationalGroups.paymentReviewOrders.length + operationalGroups.paymentValidatedOrders.length,
    },
    {
      id: "ready" as const,
      label: locale === "en" ? "Ready" : "Listos",
      count: operationalGroups.readyDeliveryOrders.length + operationalGroups.readyPickupOrders.length,
    },
    {
      id: "finished" as const,
      label: locale === "en" ? "Finished" : "Finalizados",
      count: operationalGroups.finishedOrders.length,
    },
  ], [locale, operationalGroups]);

  useEffect(() => {
    if (selectedOrderId && !allOrders.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId("");
      setSelectedOrder(null);
      setDetailOpen(false);
    }
  }, [allOrders, selectedOrderId]);

  useEffect(() => {
    if (!focusOrderId) return;
    const target = allOrders.find((order) => order.id === focusOrderId);
    if (!target) return;

    setQueueStage(getOperationalStageId(target));
    if (pendingStatuses.includes(target.status)) {
      setFilter("pending");
    } else if (confirmedStatuses.includes(target.status)) {
      setFilter("confirmed");
    } else {
      setFilter("closed");
    }
    setSelectedOrderId(target.id);
    setDetailOpen(true);
    // A notification is an intentional, one-time navigation. Clear the
    // request once it was consumed so polling/realtime updates cannot reopen
    // this order every time the orders payload changes.
    onFocusOrderHandled(target.id);
  }, [allOrders, focusOrderId, onFocusOrderHandled]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      return;
    }

    void loadOrderDetail(selectedOrderId);
  }, [loadOrderDetail, selectedOrderId]);

  const selectedSummary = filteredOrders.find((order) => order.id === selectedOrderId)
    ?? allOrders.find((order) => order.id === selectedOrderId);

  async function applyConversationAutomation(automation: ConversationAutomation, enabled: boolean) {
    if (!tenantSlug) return;
    setActionKey(`automation:${automation.conversationId}`);
    try {
      const updated = await updateConversationAutomation(tenantSlug, automation.conversationId, enabled, automation.updatedAt);
      setSelectedOrder((current) => current ? { ...current, conversationAutomation: updated, conversationId: updated.conversationId } : current);
      setOpenConversationDetail((current) => current ? { ...current, conversationAutomation: updated, conversationId: updated.conversationId, conversationState: updated.state, updatedAt: updated.updatedAt } : current);
      setPayload((current) => current ? { ...current, openOrders: current.openOrders.map((entry) => entry.conversationId === updated.conversationId ? { ...entry, conversationAutomation: updated, conversationState: updated.state, updatedAt: updated.updatedAt } : entry) } : current);
      void loadOrders();
      onNotify(enabled ? (locale === "en" ? "Automation resumed for this conversation." : "Automatizacion reactivada para esta conversacion.") : (locale === "en" ? "Automation paused for this conversation." : "Automatizacion pausada para esta conversacion."));
    } catch (error) {
      if (error instanceof DashboardApiError && error.backendError === "conversation_stale") {
        onNotify(locale === "en"
          ? "The customer or another operator changed this conversation. Review the latest state."
          : "El cliente u otro operador cambio esta conversacion. Revisa el estado mas reciente.");
      } else {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not update conversation automation." : "No se pudo actualizar la automatizacion de la conversacion.", locale));
      }
      if (selectedOrder?.conversationId === automation.conversationId) {
        void loadOrderDetail(selectedOrder.id);
      }
      void loadOrders("refresh");
    } finally {
      setActionKey("");
    }
  }

  function requestConversationAutomation(automation: ConversationAutomation | undefined, enabled: boolean) {
    if (!automation) return;
    if (!enabled) {
      setAutomationConfirmation(automation);
      return;
    }
    void applyConversationAutomation(automation, true);
  }

  async function refreshAfterMutation(targetOrderId?: string) {
    await loadOrders("refresh");
    if (targetOrderId) {
      await loadOrderDetail(targetOrderId);
    }
  }

  async function handleAccept(orderId: string) {
    setActionKey(`accept:${orderId}`);
    try {
      const updatedOrder = await acceptOrder(tenantSlug, orderId);
      onNotify(updatedOrder.customerNotificationStatus === "failed"
        ? (locale === "en"
            ? "Order confirmed, but WhatsApp could not notify the customer. Review the alert and retry."
            : "Pedido confirmado, pero WhatsApp no pudo notificar al cliente. Revisa la alerta y reintenta.")
        : (locale === "en" ? "Order confirmed and customer notified." : "Pedido confirmado y cliente notificado."));
      await refreshAfterMutation(orderId);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not confirm the order." : "No se pudo confirmar el pedido.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function handleRetry(orderId: string, status: OrderStatus) {
    const type = status === "needs_customer_replacement" ? "out_of_stock" : "accepted";
    setActionKey(`retry:${orderId}`);
    try {
      const updatedOrder = await retryOrderCustomerNotification(tenantSlug, orderId, type);
      onNotify(updatedOrder.customerNotificationStatus === "failed"
        ? (locale === "en"
            ? "WhatsApp rejected the retry. Check the integration credentials."
            : "WhatsApp rechazó el reintento. Revisa las credenciales de la integración.")
        : (locale === "en" ? "Notification sent again to the customer." : "Notificacion reenviada al cliente."));
      await refreshAfterMutation(orderId);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not retry the notification." : "No se pudo reintentar la notificacion.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function handleReject(orderId: string, values: RejectModalSubmitValue) {
    setActionKey(`reject:${orderId}`);
    try {
      await rejectOrderOutOfStock(tenantSlug, orderId, {
        items: [
          {
            orderItemId: values.orderItemId,
            markMenuItemUnavailable: values.markMenuItemUnavailable,
            replacementMenuItemIds: values.replacementMenuItemIds,
          },
        ],
        note: values.note || undefined,
      });
      setModalOrder(null);
      onNotify(locale === "en" ? "Customer notified about the out-of-stock item." : "Cliente notificado por agotado.");
      await refreshAfterMutation(orderId);
      await onRefreshMenu()
        .then(setModalMenuItems)
        .catch(() => {
          onNotify(locale === "en"
            ? "The customer was notified, but the menu could not be refreshed."
            : "El cliente fue notificado, pero no se pudo actualizar el menu.");
        });
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not notify the out-of-stock item." : "No se pudo notificar el agotado.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function openOutOfStockModal(order: OrderDetail) {
    setActionKey(`menu:refresh:${order.id}`);
    try {
      const currentMenuItems = await onRefreshMenu();
      setModalMenuItems(currentMenuItems);
      setModalOrder(order);
    } catch (error) {
      onNotify(getDashboardErrorMessage(
        error,
        locale === "en"
          ? "Could not refresh the current menu. Try again before reporting the item."
          : "No se pudo actualizar el menu vigente. Intenta de nuevo antes de reportar el agotado.",
        locale,
      ));
    } finally {
      setActionKey("");
    }
  }

  async function handleAdvanceConfirmed(order: OrderDetail) {
    const nextStatus: OrderStatus = "on_the_way";
    const successMessage = order.fulfillmentType === "delivery"
      ? (locale === "en" ? "Order marked as 30 min delivery." : "Pedido marcado como delivery 30 min.")
      : (locale === "en" ? "Order marked as ready for pickup." : "Pedido marcado como listo para recoger.");

    setActionKey(`status:${order.id}:${nextStatus}`);
    try {
      await updateOrderStatus(tenantSlug, order.id, { status: nextStatus });
      onNotify(successMessage);
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not advance the order status." : "No se pudo avanzar el estado del pedido.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function handleViewPaymentProof(order: Pick<OrderSummary, "id">) {
    setActionKey(`proof:view:${order.id}`);
    try {
      const blob = await getOrderPaymentProof(tenantSlug, order.id);
      const objectUrl = window.URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not open the payment proof." : "No se pudo abrir el comprobante.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function handleConfirmPaymentProof(order: Pick<OrderSummary, "id">) {
    setActionKey(`proof:confirm:${order.id}`);
    try {
      await confirmOrderPaymentProof(tenantSlug, order.id);
      onNotify(locale === "en" ? "Payment confirmed and order ready to continue." : "Pago confirmado y pedido listo para continuar.");
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not confirm the payment." : "No se pudo confirmar el pago.", locale));
    } finally {
      setActionKey("");
    }
  }
  async function handleFinalizeOrder(order: OrderDetail) {
    setActionKey(`status:${order.id}:delivered`);
    try {
      await updateOrderStatus(tenantSlug, order.id, { status: "delivered" });
      onNotify(locale === "en" ? "Order completed and moved to closed." : "Pedido finalizado y movido a cerrados.");
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not finalize the order." : "No se pudo finalizar el pedido.", locale));
    } finally {
      setActionKey("");
    }
  }

  async function handleBoardStatusMove(order: OrderSummary, nextStatus: Extract<OrderStatus, "accepted" | "preparing" | "on_the_way" | "delivered">) {
    const action = nextStatus === "accepted" ? `accept:${order.id}` : `status:${order.id}:${nextStatus}`;
    const copy = {
      accepted: locale === "en" ? "Order confirmed and ready for preparation." : "Pedido confirmado y listo para preparación.",
      preparing: locale === "en" ? "Order moved to preparation." : "Pedido movido a preparación.",
      on_the_way: order.fulfillmentType === "delivery"
        ? (locale === "en" ? "Order marked as on the way." : "Pedido marcado en camino.")
        : (locale === "en" ? "Order marked as ready for pickup." : "Pedido marcado listo para recoger."),
      delivered: locale === "en" ? "Order completed and moved to finished." : "Pedido finalizado y movido a completados.",
    }[nextStatus];

    setActionKey(action);
    try {
      if (nextStatus === "accepted") {
        await acceptOrder(tenantSlug, order.id);
      } else {
        await updateOrderStatus(tenantSlug, order.id, { status: nextStatus });
      }
      onNotify(copy);
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not move the order." : "No se pudo mover el pedido.", locale));
    } finally {
      setActionKey("");
    }
  }

  function notifyBlockedMove() {
    onNotify(locale === "en" ? "Complete the stage to drag" : "Completar etapa para arrastrar");
  }

  function handleStageDrop(order: OrderSummary, targetStage: OperationalStageId) {
    const nextStatus = resolveDropStatus(order, targetStage);
    if (!nextStatus) {
      if (getOperationalStageId(order) !== targetStage) notifyBlockedMove();
      return;
    }
    void handleBoardStatusMove(order, nextStatus);
  }

  async function handleKitchenProgress(
    order: OrderSummary,
    patch: { progress?: KitchenProgress; label?: string | null },
  ) {
    setActionKey(`kitchen:${order.id}`);
    try {
      await updateOrderKitchenProgress(tenantSlug, order.id, patch);
      onNotify(locale === "en" ? "Kitchen progress updated." : "Progreso de cocina actualizado.");
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not update kitchen progress." : "No se pudo actualizar el progreso de cocina.", locale));
    } finally {
      setActionKey("");
    }
  }

  function openOrderFromBoard(order: OrderSummary) {
    // Keep the operational context visible: board cards open their detail in
    // the bottom sheet instead of redirecting the restaurant to the queue.
    setOpenConversationDetail(null);
    setDetailError("");
    setSelectedOrderId(order.id);
    setDetailOpen(true);
  }

  async function handleCancelOrder(order: OrderDetail) {
    setActionKey(`status:${order.id}:cancelled`);
    try {
      await updateOrderStatus(tenantSlug, order.id, { status: "cancelled" });
      onNotify(locale === "en" ? "Order cancelled." : "Pedido cancelado.");
      await refreshAfterMutation(order.id);
    } catch (error) {
      onNotify(getDashboardErrorMessage(error, locale === "en" ? "Could not cancel the order." : "No se pudo cancelar el pedido.", locale));
    } finally {
      setActionKey("");
    }
  }

  function openOrderDetail(orderId: string) {
    setOpenConversationDetail(null);
    setSelectedOrderId(orderId);
    setDetailOpen(true);
  }

  function openConversation(order: OpenOrderSummary) {
    setOpenConversationDetail(order);
    if (layout === "queue") {
      setSelectedOrderId("");
      setSelectedOrder(null);
      setDetailOpen(false);
    }
  }

  function openLinkedOrderFromOpenStage(openOrder: OpenOrderSummary) {
    if (!openOrder.linkedOrderId) {
      return;
    }

    const linked = allOrders.find((order) => order.id === openOrder.linkedOrderId);
    if (linked) {
      setQueueStage(getOperationalStageId(linked));
      setFilter(resolveFilterForOrderStatus(linked.status));
    }
    setOpenConversationDetail(null);
    setSelectedOrderId(openOrder.linkedOrderId);
    setDetailOpen(true);
  }

  async function openOutOfStock(orderId: string) {
    const detail = selectedOrder?.id === orderId ? selectedOrder : await loadOrderDetail(orderId);
    if (detail) {
      setSelectedOrderId(orderId);
      setModalOrder(detail);
    }
  }

  async function openCancelConfirmation(orderId: string) {
    const detail = selectedOrder?.id === orderId ? selectedOrder : await loadOrderDetail(orderId);
    if (detail) {
      setSelectedOrderId(orderId);
      setCancelOrderCandidate(detail);
    }
  }

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between">
        <div className={`${layout === "board" ? "hidden" : "grid"} app-panel flex-1 grid-cols-5 gap-1 rounded-[20px] p-1.5 sm:gap-2 sm:rounded-[22px] sm:p-2`}>
          {queueStageTabs.map((tab) => {
            const active = queueStage === tab.id;
            return (
              <button
                className={`min-h-12 rounded-[15px] border px-1 py-2 text-center transition sm:min-h-[58px] sm:px-3 ${
                  active
                    ? "border-[rgba(137,164,196,0.28)] bg-[var(--surface-pending)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                    : "border-transparent text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
                }`}
                key={tab.id}
                onClick={() => {
                  setQueueStage(tab.id);
                  setSelectedOrderId("");
                  setSelectedOrder(null);
                  setDetailOpen(false);
                  setOpenConversationDetail(null);
                }}
                type="button"
              >
                <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-2">
                  <span className="text-[10px] font-semibold sm:text-sm">{tab.label}</span>
                  <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold sm:min-w-7 sm:px-2 sm:text-xs ${active ? "bg-[rgba(137,164,196,0.2)] text-[#4d6783]" : "bg-[rgba(118,93,71,0.08)] text-[var(--text-faint)]"}`}>
                    {tab.count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 self-end">
          <OrdersLayoutToggle layout={layout} locale={locale} onChange={setLayout} />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[rgba(255,242,227,0.12)] bg-[var(--surface-dark-button)] px-3 text-xs font-semibold text-[var(--text-on-dark)] transition hover:bg-[rgba(255,248,240,0.12)] disabled:cursor-not-allowed disabled:opacity-60 lg:h-[58px] lg:min-w-[120px] lg:text-sm"
            disabled={ordersRefreshing}
            onClick={() => void Promise.all([
              loadOrders("refresh"),
              onRefreshMenu().then(setModalMenuItems),
            ]).catch((error) => {
              onNotify(getDashboardErrorMessage(
                error,
                locale === "en" ? "Could not refresh the current menu." : "No se pudo actualizar el menu vigente.",
                locale,
              ));
            })}
            type="button"
          >
            {ordersRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
            {locale === "en" ? "Refresh" : "Actualizar"}
          </button>
        </div>
      </div>

      <div className={`${layout === "board" ? "block" : "hidden"} app-panel overflow-hidden rounded-[20px] sm:rounded-[22px]`}>
        <div className="px-4 pt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          {locale === "en" ? "Finished order range" : "Rango de pedidos finalizados"}
        </div>
        <ClosedOrdersFilter
          customDate={customClosedDate}
          locale={locale}
          range={closedRange}
          onChangeCustomDate={setCustomClosedDate}
          onChangeRange={setClosedRange}
        />
      </div>

      {layout === "board" ? (
        <OrdersBoard
          actionKey={actionKey}
          allOrders={allOrders}
          closedOrders={closedOrders}
          locale={locale}
          onBlockedMove={notifyBlockedMove}
          onCancel={(order) => void openCancelConfirmation(order.id)}
          onConfirmPayment={(order) => void handleConfirmPaymentProof(order)}
          onDropOrder={handleStageDrop}
          onKitchenProgress={(order, patch) => void handleKitchenProgress(order, patch)}
          onMove={(order, status) => void handleBoardStatusMove(order, status)}
          onOpenChat={openConversation}
          onOpenOrder={openOrderFromBoard}
          onToggleAutomation={(automation, enabled) => requestConversationAutomation(automation, enabled)}
          onViewPayment={(order) => void handleViewPaymentProof(order)}
          openOrders={openOrders}
        />
      ) : null}

      <div className={`${layout === "board" ? "hidden" : "grid"} gap-4 xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]`}>
        <RestoredOrdersQueueList
          actionKey={actionKey}
          customClosedDate={customClosedDate}
          groups={operationalGroups}
          locale={locale}
          loading={ordersLoading}
          error={ordersError}
          onAccept={(order) => void handleAccept(order.id)}
          onCancel={(order) => void openCancelConfirmation(order.id)}
          onChangeClosedDate={setCustomClosedDate}
          onChangeClosedRange={setClosedRange}
          onConfirmPayment={(order) => void handleConfirmPaymentProof(order)}
          onKitchenProgress={(order, patch) => void handleKitchenProgress(order, patch)}
          onMove={(order, status) => void handleBoardStatusMove(order, status)}
          onOpenChat={openConversation}
          onOpenOrder={(order) => openOrderDetail(order.id)}
          onOpenWhatsapp={(order) => openWhatsAppConversation(order.whatsappUrl)}
          onReportOutOfStock={(order) => void openOutOfStock(order.id)}
          onToggleAutomation={(automation, enabled) => requestConversationAutomation(automation, enabled)}
          onViewPayment={(order) => void handleViewPaymentProof(order)}
          range={closedRange}
          stage={queueStage}
        />

        <div className="hidden app-panel overflow-hidden rounded-[22px] sm:rounded-[24px]">
          <div className="flex items-center justify-between border-b border-[rgba(118,93,71,0.12)] px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{getFilterLabel(filter, locale)}</p>
              <p className="mt-1 text-xs text-[var(--text-soft)]">
                {filter === "open"
                  ? (locale === "en" ? "Customer chats that are still building the order before restaurant confirmation" : "Chats iniciados por clientes que aun estan armando el pedido antes de confirmar con el restaurante")
                  : (locale === "en" ? "Tap an order to see all details" : "Toca un pedido para ver el detalle")}
              </p>
            </div>
            <span className="rounded-full bg-[rgba(118,93,71,0.09)] px-2.5 py-1 text-xs font-semibold text-[var(--text-soft)]">
              {filter === "open" ? openOrders.length : filteredOrders.length}
            </span>
          </div>
          {filter === "closed" && (
            <ClosedOrdersFilter
              customDate={customClosedDate}
              locale={locale}
              range={closedRange}
              onChangeCustomDate={setCustomClosedDate}
              onChangeRange={setClosedRange}
            />
          )}
          {ordersLoading ? (
            <LoadingBlock copy={locale === "en" ? "Loading orders..." : "Cargando pedidos..."} />
          ) : ordersError ? (
            <ErrorBlock message={ordersError} />
          ) : filter === "open" && openOrders.length === 0 ? (
            <EmptyListState filter={filter} locale={locale} />
          ) : filter === "open" ? (
            <div className="app-scrollbar max-h-none space-y-3 overflow-y-auto p-3 sm:p-4 xl:max-h-[780px]">
              {openOrders.map((order) => (
                <OpenConversationCard
                  actionKey={actionKey}
                  key={order.id}
                  locale={locale}
                  onOpenDetail={() => openConversation(order)}
                  onOpenLinkedOrder={order.linkedOrderId ? () => openLinkedOrderFromOpenStage(order) : undefined}
                  onToggleAutomation={(enabled) => requestConversationAutomation(order.conversationAutomation, enabled)}
                  order={order}
                />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <EmptyListState filter={filter} locale={locale} />
          ) : (
            <div className="app-scrollbar max-h-none space-y-3 overflow-y-auto p-3 sm:p-4 xl:max-h-[780px]">
              {filteredOrders.map((order) => (
                <OperationalOrderCard
                  actionKey={actionKey}
                  key={order.id}
                  locale={locale}
                  onAccept={() => void handleAccept(order.id)}
                  onCancel={() => void openCancelConfirmation(order.id)}
                  onConfirmPayment={() => void handleConfirmPaymentProof(order)}
                  onKitchenProgress={(patch) => void handleKitchenProgress(order, patch)}
                  onMove={(status) => void handleBoardStatusMove(order, status)}
                  onOpen={() => openOrderDetail(order.id)}
                  onOpenWhatsapp={() => openWhatsAppConversation(order.whatsappUrl)}
                  onReportOutOfStock={() => void openOutOfStock(order.id)}
                  onToggleAutomation={(enabled) => requestConversationAutomation(order.conversationAutomation, enabled)}
                  onViewPayment={() => void handleViewPaymentProof(order)}
                  order={order}
                />
              ))}
            </div>
          )}
        </div>

        {false && (
        <div className="hidden">
          <div className="border-b border-[rgba(118,93,71,0.12)] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{getFilterLabel(filter, locale)}</p>
                <p className="mt-2 text-sm text-[var(--text-soft)]">{getFilterDescription(filter, locale)}</p>
              </div>
              <span className="rounded-full bg-[rgba(118,93,71,0.08)] px-3 py-1.5 text-xs font-semibold text-[var(--text-soft)]">
                {filteredOrders.length}
              </span>
            </div>
          </div>

          {ordersLoading ? (
            <LoadingBlock copy={locale === "en" ? "Loading orders..." : "Cargando pedidos..."} />
          ) : ordersError ? (
            <ErrorBlock message={ordersError} />
          ) : filteredOrders.length === 0 ? (
            <EmptyListState filter={filter} locale={locale} />
          ) : filter === "pending" ? (
            <>
              <div className="border-b border-[rgba(118,93,71,0.12)] px-4 py-4">
                <div className="grid grid-cols-1 gap-2 rounded-[20px] bg-[var(--surface-base)] p-2 sm:grid-cols-2">
                  <button
                    className={`rounded-[16px] px-4 py-3 text-left transition ${
                      pendingLane === "restaurant"
                        ? "border border-[rgba(137,164,196,0.28)] bg-[var(--surface-pending)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]"
                        : "border border-transparent text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
                    }`}
                    onClick={() => setPendingLane("restaurant")}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{locale === "en" ? "Restaurant review" : "Confirma restaurante"}</span>
                      <span className="rounded-full bg-[rgba(137,164,196,0.18)] px-2 py-0.5 text-xs font-semibold text-[#4d6783]">
                        {pendingRestaurantOrders.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">{locale === "en" ? "New orders ready for a decision." : "Pedidos nuevos listos para decision."}</p>
                  </button>
                  <button
                    className={`rounded-[16px] px-4 py-3 text-left transition ${
                      pendingLane === "customer"
                        ? "border border-[rgba(197,123,87,0.22)] bg-[rgba(197,123,87,0.1)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]"
                        : "border border-transparent text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
                    }`}
                    onClick={() => setPendingLane("customer")}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{locale === "en" ? "Customer reply" : "Confirma cliente"}</span>
                      <span className="rounded-full bg-[rgba(197,123,87,0.14)] px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">
                        {pendingCustomerOrders.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">{locale === "en" ? "Changes or pending selection in WhatsApp." : "Cambios o seleccion pendiente en WhatsApp."}</p>
                  </button>
                </div>
              </div>
              <div className="app-scrollbar max-h-[58vh] overflow-y-auto px-3 py-3 sm:max-h-[760px] sm:px-4 sm:py-4">
                <OrderBucketSection
                  emptyCopy={pendingLane === "restaurant"
                    ? (locale === "en" ? "There are no orders waiting for restaurant confirmation." : "No hay pedidos esperando confirmacion del restaurante.")
                    : (locale === "en" ? "There are no orders waiting for the customer response." : "No hay pedidos esperando respuesta del cliente.")}
                  onSelectOrder={setSelectedOrderId}
                  orders={pendingLaneOrders}
                  selectedOrderId={selectedOrderId}
                  title={pendingLane === "restaurant"
                    ? (locale === "en" ? "Waiting on restaurant" : "Espera restaurante")
                    : (locale === "en" ? "Waiting on customer" : "Espera cliente")}
                  tone={pendingLane}
                />
              </div>
            </>
          ) : (
            <div className="app-scrollbar max-h-[58vh] space-y-3 overflow-y-auto px-3 py-3 sm:max-h-[860px] sm:px-4 sm:py-4">
              {filteredOrders.map((order) => {
                const active = order.id === selectedOrderId;
                const acceptedStage = order.status === "accepted";
                return (
                  <button
                    className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                      active
                        ? acceptedStage
                          ? "border-[rgba(79,122,97,0.38)] bg-[rgba(226,238,231,0.92)] shadow-[inset_5px_0_0_rgba(79,122,97,0.82)]"
                          : "border-[rgba(137,164,196,0.34)] bg-[var(--surface-strong)]"
                        : acceptedStage
                          ? "border-[rgba(79,122,97,0.28)] bg-[rgba(226,238,231,0.72)] shadow-[inset_5px_0_0_rgba(79,122,97,0.68)] hover:bg-[rgba(226,238,231,0.95)]"
                          : "border-[rgba(118,93,71,0.1)] bg-[var(--surface-base)] hover:bg-[var(--surface-muted)]"
                    }`}
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <OrderStatusBadge locale={locale} status={order.status} />
                          {order.customerNotificationStatus === "failed" && <NotificationBadge locale={locale} status="failed" />}
                        </div>
                        <p className="mt-3 truncate text-sm font-semibold text-[var(--text-strong)]">
                          {order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-faint)]">
                          {formatDateTime(order.createdAt, locale)}
                        </p>
                        <OrderSummaryIconChips locale={locale} order={order} />
                        {filter === "confirmed" ? (
                          <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                            acceptedStage
                              ? "bg-[var(--success)] text-white shadow-[0_6px_18px_rgba(79,122,97,0.22)]"
                              : "bg-[rgba(79,122,97,0.12)] text-[var(--success)]"
                          }`}>
                            {getConfirmedProgressLabel(order, locale)}
                          </p>
                        ) : null}
                        {filter === "closed" ? (
                          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                            Cuenta #{getOrderReceiptCode(order.id)}
                          </p>
                        ) : null}
                        <p className="mt-2 text-sm text-[var(--text-soft)]">{order.customerPhone || (locale === "en" ? "No phone" : "Sin telefono")}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <p className="text-sm font-semibold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</p>
                        <ChevronRight className={active ? "text-[var(--warning)]" : "text-[var(--text-faint)]"} size={18} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        <div className="app-panel hidden min-w-0 overflow-hidden rounded-[26px] xl:block">
          {openConversationDetail ? (
            <OpenConversationDetailPanel
              actionKey={actionKey}
              locale={locale}
              onClose={() => setOpenConversationDetail(null)}
              onToggleAutomation={(enabled) => requestConversationAutomation(openConversationDetail.conversationAutomation, enabled)}
              order={openConversationDetail}
              transcript={conversationTranscript}
              transcriptError={transcriptError}
              transcriptLoading={transcriptLoading}
            />
          ) : !selectedOrderId ? (
            <div className="grid min-h-[380px] place-items-center px-4 py-10 text-center sm:min-h-[520px] sm:px-5">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[rgba(118,93,71,0.08)] text-[var(--text-faint)]">
                  <ClipboardList size={24} />
                </div>
                <p className="app-display mt-5 text-[2.2rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "No order selected" : "Sin pedido seleccionado"}</p>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[var(--text-soft)]">
                  {locale === "en"
                    ? "Select an order from the list to review details, confirm it, or report an out-of-stock item."
                    : "Selecciona un pedido de la lista para revisar el detalle, confirmar o reportar un agotado."}
                </p>
              </div>
            </div>
          ) : detailLoading ? (
            <LoadingBlock copy={locale === "en" ? "Loading order details..." : "Cargando detalle del pedido..."} />
          ) : detailError ? (
            <ErrorBlock message={detailError} />
          ) : selectedOrder ? (
            <OrderDetailPanel
              actionKey={actionKey}
              menuItems={menuItems}
              onAccept={() => void handleAccept(selectedOrder.id)}
              onAdvanceConfirmed={() => void handleAdvanceConfirmed(selectedOrder)}
              onCancel={() => setCancelOrderCandidate(selectedOrder)}
              onConfirmPaymentProof={() => void handleConfirmPaymentProof(selectedOrder)}
              onFinalize={() => void handleFinalizeOrder(selectedOrder)}
              onOpenRejectModal={() => void openOutOfStockModal(selectedOrder)}
              onRetry={() => void handleRetry(selectedOrder.id, selectedOrder.status)}
              onViewPaymentProof={() => void handleViewPaymentProof(selectedOrder)}
              onToggleAutomation={(enabled) => requestConversationAutomation(selectedOrder.conversationAutomation, enabled)}
              order={selectedOrder}
              selectedSummary={selectedSummary}
            />
          ) : (
            <ErrorBlock message={locale === "en" ? "Could not resolve the selected order details." : "No se pudo resolver el detalle del pedido seleccionado."} />
          )}
        </div>
      </div>

      {detailOpen ? (
        <div className={`fixed inset-0 z-40 flex items-end bg-[rgba(14,11,9,0.58)] backdrop-blur-sm ${layout === "board" ? "" : "xl:hidden"}`} onClick={() => setDetailOpen(false)}>
          <div
            aria-label={locale === "en" ? "Order detail" : "Detalle del pedido"}
            aria-modal="true"
            className={`app-panel app-scrollbar max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] ${layout === "board" ? "order-detail-sheet mx-auto max-w-[1160px] rounded-t-[32px]" : ""}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            {layout === "board" ? <div aria-hidden="true" className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-[rgba(118,93,71,0.28)]" /> : null}
            {detailLoading ? (
              <LoadingBlock copy={locale === "en" ? "Loading order details..." : "Cargando detalle del pedido..."} />
            ) : detailError ? (
              <ErrorBlock message={detailError} />
            ) : selectedOrder ? (
              <OrderDetailPanel
                actionKey={actionKey}
                menuItems={menuItems}
                onAccept={() => void handleAccept(selectedOrder.id)}
                onAdvanceConfirmed={() => void handleAdvanceConfirmed(selectedOrder)}
                onCancel={() => setCancelOrderCandidate(selectedOrder)}
                onClose={() => setDetailOpen(false)}
                onConfirmPaymentProof={() => void handleConfirmPaymentProof(selectedOrder)}
                onFinalize={() => void handleFinalizeOrder(selectedOrder)}
                onOpenRejectModal={() => void openOutOfStockModal(selectedOrder)}
                onRetry={() => void handleRetry(selectedOrder.id, selectedOrder.status)}
                onViewPaymentProof={() => void handleViewPaymentProof(selectedOrder)}
                onToggleAutomation={(enabled) => requestConversationAutomation(selectedOrder.conversationAutomation, enabled)}
                order={selectedOrder}
                selectedSummary={selectedSummary}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {openConversationDetail ? (
        <div className={`fixed inset-0 z-40 grid place-items-end bg-[rgba(14,11,9,0.58)] p-3 backdrop-blur-sm sm:place-items-center ${layout === "queue" ? "xl:hidden" : ""}`} onClick={() => setOpenConversationDetail(null)}>
          <div className="app-panel max-h-[94dvh] w-full max-w-3xl overflow-hidden rounded-[28px]" onClick={(event) => event.stopPropagation()}>
            <OpenConversationDetailPanel
              actionKey={actionKey}
              locale={locale}
              onClose={() => setOpenConversationDetail(null)}
              onToggleAutomation={(enabled) => requestConversationAutomation(openConversationDetail.conversationAutomation, enabled)}
              order={openConversationDetail}
              transcript={conversationTranscript}
              transcriptError={transcriptError}
              transcriptLoading={transcriptLoading}
            />
          </div>
        </div>
      ) : null}

      {automationConfirmation ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(14,11,9,0.58)] p-4 backdrop-blur-sm">
          <div className="app-panel w-full max-w-md rounded-[28px] p-6">
            <p className="app-display text-2xl text-[var(--text-strong)]">{locale === "en" ? "Pause bot replies?" : "¿Pausar respuestas del bot?"}</p>
            <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">{locale === "en" ? "The bot will not respond to the customer’s next messages until staff turns automation back on." : "El bot no respondera los proximos mensajes del cliente hasta que el equipo reactive la automatizacion."}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 py-2 text-sm font-semibold text-[var(--text-soft)]" onClick={() => setAutomationConfirmation(null)} type="button">{locale === "en" ? "Cancel" : "Cancelar"}</button>
              <button className="rounded-2xl bg-[var(--warning)] px-4 py-2 text-sm font-bold text-white" onClick={() => { const automation = automationConfirmation; setAutomationConfirmation(null); void applyConversationAutomation(automation, false); }} type="button">{locale === "en" ? "Pause automation" : "Pausar automatizacion"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {modalOrder && (
        <OutOfStockModal
          menuItems={modalMenuItems}
          onClose={() => setModalOrder(null)}
          onSubmit={(values) => handleReject(modalOrder.id, values)}
          order={modalOrder}
          submitting={actionKey === `reject:${modalOrder.id}`}
        />
      )}
      {cancelOrderCandidate && (
        <CancelOrderModal
          locale={locale}
          onClose={() => setCancelOrderCandidate(null)}
          onConfirm={async () => {
            await handleCancelOrder(cancelOrderCandidate);
            setCancelOrderCandidate(null);
          }}
          order={cancelOrderCandidate}
          submitting={actionKey === `status:${cancelOrderCandidate.id}:cancelled`}
        />
      )}
    </section>
  );
}

function OrdersLayoutToggle({
  layout,
  locale,
  onChange,
}: {
  layout: OrdersLayout;
  locale: "en" | "es";
  onChange: (layout: OrdersLayout) => void;
}) {
  return (
    <div className="app-panel flex h-11 items-center gap-1 rounded-[14px] p-1 lg:h-[58px] lg:rounded-[18px]" role="group" aria-label={locale === "en" ? "Order view" : "Vista de pedidos"}>
      <button
        aria-pressed={layout === "queue"}
        className={`inline-flex h-full items-center justify-center gap-2 rounded-[10px] px-3 text-xs font-bold transition ${layout === "queue" ? "bg-[var(--panel-strong)] text-[var(--text-strong)] shadow-sm" : "text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"}`}
        onClick={() => onChange("queue")}
        title={locale === "en" ? "Queue view" : "Vista de bandeja"}
        type="button"
      >
        <List size={16} />
        <span className="hidden sm:inline">{locale === "en" ? "Queue" : "Bandeja"}</span>
      </button>
      <button
        aria-pressed={layout === "board"}
        className={`inline-flex h-full items-center justify-center gap-2 rounded-[10px] px-3 text-xs font-bold transition ${layout === "board" ? "bg-[var(--panel-strong)] text-[var(--text-strong)] shadow-sm" : "text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"}`}
        onClick={() => onChange("board")}
        title={locale === "en" ? "Board view" : "Vista de tablero"}
        type="button"
      >
        <LayoutGrid size={16} />
        <span className="hidden sm:inline">{locale === "en" ? "Board" : "Tablero"}</span>
      </button>
    </div>
  );
}

type OperationalOrdersProps = {
  actionKey: string;
  allOrders: OrderSummary[];
  closedOrders: OrderSummary[];
  locale: "en" | "es";
  onBlockedMove: () => void;
  onCancel: (order: OrderSummary) => void;
  onConfirmPayment: (order: OrderSummary) => void;
  onDropOrder: (order: OrderSummary, stage: OperationalStageId) => void;
  onKitchenProgress: (order: OrderSummary, patch: { progress?: KitchenProgress; label?: string | null }) => void;
  onMove: (order: OrderSummary, status: Extract<OrderStatus, "accepted" | "preparing" | "on_the_way" | "delivered">) => void;
  onOpenChat: (order: OpenOrderSummary) => void;
  onOpenOrder: (order: OrderSummary) => void;
  onToggleAutomation: (automation: ConversationAutomation | undefined, enabled: boolean) => void;
  onViewPayment: (order: OrderSummary) => void;
  openOrders: OpenOrderSummary[];
};

function getOperationalGroups(allOrders: OrderSummary[], openOrders: OpenOrderSummary[], closedOrders: OrderSummary[]) {
  const rebuildingOrders = allOrders.filter((order) => order.status === "needs_customer_replacement");
  const boardOrderIds = new Set(allOrders.map((order) => order.id));
  const activeOpenChats = openOrders.filter((order) => !order.linkedOrderId || !boardOrderIds.has(order.linkedOrderId));
  const reviewOrders = allOrders.filter((order) => ["new", "pending_restaurant_confirmation"].includes(order.status));
  const paymentReviewOrders = allOrders.filter((order) =>
    order.status === "payment_pending_review"
    || (["accepted", "preparing"].includes(order.status) && order.paymentMethod === "transfer" && !order.paymentConfirmedAt));
  const paymentValidatedOrders = allOrders.filter((order) =>
    ["accepted", "preparing"].includes(order.status)
    && (order.paymentMethod === "cash" || Boolean(order.paymentConfirmedAt)));
  const readyDeliveryOrders = allOrders.filter((order) => order.status === "on_the_way" && order.fulfillmentType === "delivery");
  const readyPickupOrders = allOrders.filter((order) => order.status === "on_the_way" && order.fulfillmentType === "pickup");

  return {
    rebuildingOrders,
    activeOpenChats,
    reviewOrders,
    paymentReviewOrders,
    paymentValidatedOrders,
    readyDeliveryOrders,
    readyPickupOrders,
    finishedOrders: closedOrders,
  };
}

function OrdersBoard({
  actionKey,
  allOrders,
  closedOrders,
  locale,
  onBlockedMove,
  onCancel,
  onConfirmPayment,
  onDropOrder,
  onKitchenProgress,
  onMove,
  onOpenChat,
  onOpenOrder,
  onToggleAutomation,
  onViewPayment,
  openOrders,
}: OperationalOrdersProps) {
  const {
    rebuildingOrders,
    activeOpenChats,
    reviewOrders,
    paymentReviewOrders,
    paymentValidatedOrders,
    readyDeliveryOrders,
    readyPickupOrders,
    finishedOrders,
  } = getOperationalGroups(allOrders, openOrders, closedOrders);
  const renderOrderCard = (order: OrderSummary) => (
    <BoardOrderCard
      actionKey={actionKey}
      key={order.id}
      locale={locale}
      onBlockedMove={onBlockedMove}
      onCancel={() => onCancel(order)}
      onConfirmPayment={onConfirmPayment}
      onKitchenProgress={onKitchenProgress}
      onMove={onMove}
      onOpen={() => onOpenOrder(order)}
      onToggleAutomation={(enabled) => onToggleAutomation(order.conversationAutomation, enabled)}
      onViewPayment={onViewPayment}
      order={order}
    />
  );

  const columns: Array<{
    id: string;
    title: string;
    description: string;
    tone: string;
    labelTone: string;
    count: number;
    content: ReactNode;
  }> = [
    {
      id: "open",
      title: locale === "en" ? "Open chats" : "Chats abiertos",
      description: locale === "en" ? "New conversations and orders being rebuilt" : "Conversaciones nuevas y pedidos que se están rearmando",
      tone: "border-[rgba(97,135,158,0.22)] bg-[rgba(220,231,244,0.52)]",
      labelTone: "bg-[rgba(97,135,158,0.16)] text-[#46697c]",
      count: activeOpenChats.length + rebuildingOrders.length,
      content: (
        <>
          {rebuildingOrders.length > 0 ? (
            <BoardSubsection count={rebuildingOrders.length} label={locale === "en" ? "Rebuilding order" : "Rearmando pedido"} tone="warning">
              {rebuildingOrders.map(renderOrderCard)}
            </BoardSubsection>
          ) : null}
          {activeOpenChats.length > 0 ? (
            <BoardSubsection count={activeOpenChats.length} label={locale === "en" ? "Building order" : "Armando pedido"} tone="info">
              {activeOpenChats.map((order) => <BoardOpenChatCard actionKey={actionKey} key={order.id} locale={locale} onOpen={() => onOpenChat(order)} onToggleAutomation={(enabled) => onToggleAutomation(order.conversationAutomation, enabled)} order={order} />)}
            </BoardSubsection>
          ) : null}
        </>
      ),
    },
    {
      id: "review",
      title: locale === "en" ? "Restaurant review" : "Por confirmar",
      description: locale === "en" ? "The restaurant must confirm availability" : "El restaurante debe confirmar disponibilidad",
      tone: "border-[rgba(193,157,98,0.26)] bg-[rgba(246,237,213,0.72)]",
      labelTone: "bg-[rgba(193,157,98,0.2)] text-[#826239]",
      count: reviewOrders.length,
      content: reviewOrders.map(renderOrderCard),
    },
    {
      id: "preparing",
      title: locale === "en" ? "In preparation" : "En preparación",
      description: locale === "en" ? "Validate payment and move the kitchen forward" : "Valida el pago y avanza el trabajo de cocina",
      tone: "border-[rgba(132,111,164,0.22)] bg-[rgba(235,229,244,0.72)]",
      labelTone: "bg-[rgba(132,111,164,0.16)] text-[#65567f]",
      count: paymentReviewOrders.length + paymentValidatedOrders.length,
      content: (
        <>
          <BoardSubsection count={paymentReviewOrders.length} label={locale === "en" ? "Payment to validate" : "Por validar pago"} tone="payment">
            {paymentReviewOrders.map(renderOrderCard)}
          </BoardSubsection>
          <BoardSubsection count={paymentValidatedOrders.length} label={locale === "en" ? "Payment validated" : "Pago validado"} tone="success">
            {paymentValidatedOrders.map(renderOrderCard)}
          </BoardSubsection>
        </>
      ),
    },
    {
      id: "ready",
      title: locale === "en" ? "Ready for pickup / delivery" : "Listo para recoger / domicilio",
      description: locale === "en" ? "Finish when delivery or pickup is complete" : "Finaliza cuando se entregue o se recoja",
      tone: "border-[rgba(90,111,170,0.22)] bg-[rgba(224,231,247,0.7)]",
      labelTone: "bg-[rgba(90,111,170,0.16)] text-[#4c5f8f]",
      count: readyDeliveryOrders.length + readyPickupOrders.length,
      content: (
        <>
          <BoardSubsection count={readyDeliveryOrders.length} label={locale === "en" ? "Home delivery" : "Domicilio"} tone="delivery">
            {readyDeliveryOrders.map(renderOrderCard)}
          </BoardSubsection>
          <BoardSubsection count={readyPickupOrders.length} label={locale === "en" ? "Pickup" : "Para recoger"} tone="pickup">
            {readyPickupOrders.map(renderOrderCard)}
          </BoardSubsection>
        </>
      ),
    },
    {
      id: "finished",
      title: locale === "en" ? "Finished" : "Finalizados",
      description: locale === "en" ? "Delivered or cancelled" : "Entregados o cancelados",
      tone: "border-[rgba(118,93,71,0.16)] bg-[rgba(239,234,228,0.78)]",
      labelTone: "bg-[rgba(118,93,71,0.12)] text-[var(--text-soft)]",
      count: finishedOrders.length,
      content: finishedOrders.map(renderOrderCard),
    },
  ];

  const totalActionable = rebuildingOrders.length + reviewOrders.length + paymentReviewOrders.length + paymentValidatedOrders.length + readyDeliveryOrders.length + readyPickupOrders.length;

  return (
    <section className="app-panel overflow-hidden rounded-[24px] sm:rounded-[26px]">
      <div className="flex flex-col gap-3 border-b border-[rgba(118,93,71,0.12)] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Operational board" : "Tablero operativo"}</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--text-strong)]">{locale === "en" ? "See the next move at a glance" : "Ve de un vistazo qué falta mover"}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-soft)]">{locale === "en" ? "Each card changes color with its real status. Actions use the same order flow as the queue." : "Cada tarjeta cambia de color con su estado real. Las acciones usan el mismo flujo seguro de la bandeja."}</p>
        </div>
        <div className="rounded-2xl bg-[rgba(197,123,87,0.1)] px-4 py-3 text-sm font-bold text-[var(--warning)]">
          {totalActionable} {locale === "en" ? "card(s) need progress" : "tarjeta(s) requieren avance"}
        </div>
      </div>

      <div className="app-scrollbar overflow-x-auto p-3 sm:p-4">
        <div className="grid min-w-[1500px] grid-cols-5 gap-3">
          {columns.map((column) => (
            <section
              className={`flex max-h-[calc(100vh-250px)] min-h-[520px] flex-col rounded-[22px] border transition ${column.tone}`}
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const order = allOrders.find((candidate) => candidate.id === event.dataTransfer.getData("application/x-parahoy-order"));
                if (order) onDropOrder(order, column.id as OperationalStageId);
              }}
            >
              <header className="border-b border-[rgba(118,93,71,0.1)] px-4 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-extrabold text-[var(--text-strong)]">{column.title}</h3>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--text-soft)]">{column.description}</p>
                  </div>
                  <span className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-extrabold ${column.labelTone}`}>{column.count}</span>
                </div>
              </header>
              <div className="app-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {column.count === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-[rgba(118,93,71,0.16)] bg-white/40 px-3 py-8 text-center text-xs leading-5 text-[var(--text-faint)]">
                    {locale === "en" ? "Nothing in this stage." : "No hay pedidos en esta etapa."}
                  </div>
                ) : column.content}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function BoardSubsection({
  children,
  count,
  label,
  tone,
}: {
  children: ReactNode;
  count: number;
  label: string;
  tone: "delivery" | "info" | "payment" | "pickup" | "success" | "warning";
}) {
  const tones = {
    delivery: "border-[#6b82b3]/20 bg-[#6b82b3]/10 text-[#4c5f8f]",
    info: "border-[#5f879e]/20 bg-[#5f879e]/10 text-[#46697c]",
    payment: "border-[#c57b57]/20 bg-[#c57b57]/10 text-[#9a5d40]",
    pickup: "border-[#4f7a61]/20 bg-[#4f7a61]/10 text-[#426b52]",
    success: "border-[#5e895f]/20 bg-[#5e895f]/10 text-[#426b52]",
    warning: "border-[#d56f43]/25 bg-[#fff0e7] text-[#9f4d2b]",
  }[tone];

  return (
    <section className="space-y-2.5">
      <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.1em] ${tones}`}>
        <span>{label}</span>
        <span>{count}</span>
      </div>
      {count > 0 ? children : <p className="px-2 py-2 text-center text-[11px] text-[var(--text-faint)]">—</p>}
    </section>
  );
}

function RestoredOrdersQueueList({
  actionKey,
  customClosedDate,
  error,
  groups,
  loading,
  locale,
  onAccept,
  onCancel,
  onChangeClosedDate,
  onChangeClosedRange,
  onConfirmPayment,
  onKitchenProgress,
  onMove,
  onOpenChat,
  onOpenOrder,
  onOpenWhatsapp,
  onReportOutOfStock,
  onToggleAutomation,
  onViewPayment,
  range,
  stage,
}: {
  actionKey: string;
  customClosedDate: string;
  error: string;
  groups: ReturnType<typeof getOperationalGroups>;
  loading: boolean;
  locale: "en" | "es";
  onAccept: (order: OrderSummary) => void;
  onCancel: (order: OrderSummary) => void;
  onChangeClosedDate: (value: string) => void;
  onChangeClosedRange: (range: ClosedRange) => void;
  onConfirmPayment: (order: OrderSummary) => void;
  onKitchenProgress: (order: OrderSummary, patch: { progress?: KitchenProgress; label?: string | null }) => void;
  onMove: (order: OrderSummary, status: Extract<OrderStatus, "accepted" | "preparing" | "on_the_way" | "delivered">) => void;
  onOpenChat: (order: OpenOrderSummary) => void;
  onOpenOrder: (order: OrderSummary) => void;
  onOpenWhatsapp: (order: OrderSummary) => void;
  onReportOutOfStock: (order: OrderSummary) => void;
  onToggleAutomation: (automation: ConversationAutomation | undefined, enabled: boolean) => void;
  onViewPayment: (order: OrderSummary) => void;
  range: ClosedRange;
  stage: OperationalStageId;
}) {
  const metadata = {
    open: {
      title: locale === "en" ? "Open chats" : "Abiertos",
      description: locale === "en" ? "Customers building or rebuilding an order" : "Clientes armando o rearmando su pedido",
      count: groups.activeOpenChats.length + groups.rebuildingOrders.length,
    },
    review: {
      title: locale === "en" ? "Restaurant review" : "Por confirmar",
      description: locale === "en" ? "Orders waiting for the restaurant decision" : "Pedidos esperando la decisión del restaurante",
      count: groups.reviewOrders.length,
    },
    preparing: {
      title: locale === "en" ? "In preparation" : "En preparación",
      description: locale === "en" ? "Payment validation and kitchen progress" : "Validación de pago y avance de cocina",
      count: groups.paymentReviewOrders.length + groups.paymentValidatedOrders.length,
    },
    ready: {
      title: locale === "en" ? "Ready for pickup / delivery" : "Listo para recoger / domicilio",
      description: locale === "en" ? "Orders ready for pickup or on delivery" : "Pedidos listos para recoger o en domicilio",
      count: groups.readyDeliveryOrders.length + groups.readyPickupOrders.length,
    },
    finished: {
      title: locale === "en" ? "Finished" : "Finalizados",
      description: locale === "en" ? "Delivered and cancelled orders" : "Pedidos entregados y cancelados",
      count: groups.finishedOrders.length,
    },
  }[stage];

  const renderOrder = (order: OrderSummary) => (
    <OperationalOrderCard
      actionKey={actionKey}
      key={order.id}
      locale={locale}
      onAccept={() => onAccept(order)}
      onCancel={() => onCancel(order)}
      onConfirmPayment={() => onConfirmPayment(order)}
      onKitchenProgress={(patch) => onKitchenProgress(order, patch)}
      onMove={(status) => onMove(order, status)}
      onOpen={() => onOpenOrder(order)}
      onOpenWhatsapp={() => onOpenWhatsapp(order)}
      onReportOutOfStock={() => onReportOutOfStock(order)}
      onToggleAutomation={(enabled) => onToggleAutomation(order.conversationAutomation, enabled)}
      onViewPayment={() => onViewPayment(order)}
      order={order}
    />
  );

  let content: ReactNode;
  if (stage === "open") {
    content = (
      <>
        {groups.rebuildingOrders.length > 0 ? (
          <QueueListSection label={locale === "en" ? "Rebuilding order" : "Rearmando pedido"}>
            {groups.rebuildingOrders.map(renderOrder)}
          </QueueListSection>
        ) : null}
        {groups.activeOpenChats.length > 0 ? (
          <QueueListSection label={locale === "en" ? "Building order" : "Armando pedido"}>
            {groups.activeOpenChats.map((order) => (
              <OpenConversationCard
                actionKey={actionKey}
                key={order.id}
                locale={locale}
                onOpenDetail={() => onOpenChat(order)}
                onOpenLinkedOrder={undefined}
                onToggleAutomation={(enabled) => onToggleAutomation(order.conversationAutomation, enabled)}
                order={order}
              />
            ))}
          </QueueListSection>
        ) : null}
      </>
    );
  } else if (stage === "review") {
    content = groups.reviewOrders.map(renderOrder);
  } else if (stage === "preparing") {
    content = (
      <>
        <QueueListSection label={locale === "en" ? "Payment to validate" : "Por validar pago"}>
          {groups.paymentReviewOrders.map(renderOrder)}
        </QueueListSection>
        <QueueListSection label={locale === "en" ? "Payment validated" : "Pago validado"}>
          {groups.paymentValidatedOrders.map(renderOrder)}
        </QueueListSection>
      </>
    );
  } else if (stage === "ready") {
    content = (
      <>
        <QueueListSection label={locale === "en" ? "Home delivery" : "Domicilio"}>
          {groups.readyDeliveryOrders.map(renderOrder)}
        </QueueListSection>
        <QueueListSection label={locale === "en" ? "Pickup" : "Para recoger"}>
          {groups.readyPickupOrders.map(renderOrder)}
        </QueueListSection>
      </>
    );
  } else {
    content = groups.finishedOrders.map(renderOrder);
  }

  return (
    <div className="app-panel overflow-hidden rounded-[22px] sm:rounded-[24px]">
      <div className="flex items-center justify-between border-b border-[rgba(118,93,71,0.12)] px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{metadata.title}</p>
          <p className="mt-1 text-xs text-[var(--text-soft)]">{metadata.description}</p>
        </div>
        <span className="rounded-full bg-[rgba(118,93,71,0.09)] px-2.5 py-1 text-xs font-semibold text-[var(--text-soft)]">{metadata.count}</span>
      </div>
      {stage === "finished" ? (
        <ClosedOrdersFilter
          customDate={customClosedDate}
          locale={locale}
          range={range}
          onChangeCustomDate={onChangeClosedDate}
          onChangeRange={onChangeClosedRange}
        />
      ) : null}
      {loading ? (
        <LoadingBlock copy={locale === "en" ? "Loading orders..." : "Cargando pedidos..."} />
      ) : error ? (
        <ErrorBlock message={error} />
      ) : metadata.count === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--text-faint)]">
          {locale === "en" ? "There are no orders in this stage." : "No hay pedidos en esta etapa."}
        </div>
      ) : (
        <div className="app-scrollbar max-h-none space-y-3 overflow-y-auto p-3 sm:p-4 xl:max-h-[780px]">{content}</div>
      )}
    </div>
  );
}

function QueueListSection({ children, label }: { children: ReactNode; label: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasChildren) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3 px-1 pt-1">
        <p className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-faint)]">{label}</p>
        <span className="h-px flex-1 bg-[rgba(118,93,71,0.12)]" />
      </div>
      {children}
    </section>
  );
}

function OrdersQueue(props: OperationalOrdersProps) {
  const {
    rebuildingOrders,
    activeOpenChats,
    reviewOrders,
    paymentReviewOrders,
    paymentValidatedOrders,
    readyDeliveryOrders,
    readyPickupOrders,
    finishedOrders,
  } = getOperationalGroups(props.allOrders, props.openOrders, props.closedOrders);

  const renderOrderCard = (order: OrderSummary) => (
    <BoardOrderCard
      actionKey={props.actionKey}
      key={order.id}
      locale={props.locale}
      onBlockedMove={props.onBlockedMove}
      onCancel={() => props.onCancel(order)}
      onConfirmPayment={props.onConfirmPayment}
      onKitchenProgress={props.onKitchenProgress}
      onMove={props.onMove}
      onOpen={() => props.onOpenOrder(order)}
      onToggleAutomation={(enabled) => props.onToggleAutomation(order.conversationAutomation, enabled)}
      onViewPayment={props.onViewPayment}
      order={order}
    />
  );

  const sections: Array<{
    id: OperationalStageId;
    title: string;
    description: string;
    tone: string;
    count: number;
    content: ReactNode;
  }> = [
    {
      id: "open",
      title: props.locale === "en" ? "Open chats" : "Chats abiertos",
      description: props.locale === "en" ? "Building or rebuilding an order" : "Armando o rearmando el pedido",
      tone: "border-[rgba(97,135,158,0.22)] bg-[rgba(220,231,244,0.52)]",
      count: activeOpenChats.length + rebuildingOrders.length,
      content: (
        <>
          <BoardSubsection count={rebuildingOrders.length} label={props.locale === "en" ? "Rebuilding order" : "Rearmando pedido"} tone="warning">
            {rebuildingOrders.map(renderOrderCard)}
          </BoardSubsection>
          <BoardSubsection count={activeOpenChats.length} label={props.locale === "en" ? "Building order" : "Armando pedido"} tone="info">
            {activeOpenChats.map((order) => <BoardOpenChatCard actionKey={props.actionKey} key={order.id} locale={props.locale} onOpen={() => props.onOpenChat(order)} onToggleAutomation={(enabled) => props.onToggleAutomation(order.conversationAutomation, enabled)} order={order} />)}
          </BoardSubsection>
        </>
      ),
    },
    {
      id: "review",
      title: props.locale === "en" ? "Restaurant review" : "Por confirmar",
      description: props.locale === "en" ? "The restaurant validates availability" : "El restaurante valida disponibilidad",
      tone: "border-[rgba(193,157,98,0.26)] bg-[rgba(246,237,213,0.72)]",
      count: reviewOrders.length,
      content: reviewOrders.map(renderOrderCard),
    },
    {
      id: "preparing",
      title: props.locale === "en" ? "In preparation" : "En preparación",
      description: props.locale === "en" ? "Payment and kitchen progress" : "Pago y avance de cocina",
      tone: "border-[rgba(132,111,164,0.22)] bg-[rgba(235,229,244,0.72)]",
      count: paymentReviewOrders.length + paymentValidatedOrders.length,
      content: (
        <>
          <BoardSubsection count={paymentReviewOrders.length} label={props.locale === "en" ? "Payment to validate" : "Por validar pago"} tone="payment">
            {paymentReviewOrders.map(renderOrderCard)}
          </BoardSubsection>
          <BoardSubsection count={paymentValidatedOrders.length} label={props.locale === "en" ? "Payment validated" : "Pago validado"} tone="success">
            {paymentValidatedOrders.map(renderOrderCard)}
          </BoardSubsection>
        </>
      ),
    },
    {
      id: "ready",
      title: props.locale === "en" ? "Ready for pickup / delivery" : "Listo para recoger / domicilio",
      description: props.locale === "en" ? "Waiting for pickup or delivery" : "Esperando recogida o entrega",
      tone: "border-[rgba(90,111,170,0.22)] bg-[rgba(224,231,247,0.7)]",
      count: readyDeliveryOrders.length + readyPickupOrders.length,
      content: (
        <>
          <BoardSubsection count={readyDeliveryOrders.length} label={props.locale === "en" ? "Home delivery" : "Domicilio"} tone="delivery">
            {readyDeliveryOrders.map(renderOrderCard)}
          </BoardSubsection>
          <BoardSubsection count={readyPickupOrders.length} label={props.locale === "en" ? "Pickup" : "Para recoger"} tone="pickup">
            {readyPickupOrders.map(renderOrderCard)}
          </BoardSubsection>
        </>
      ),
    },
    {
      id: "finished",
      title: props.locale === "en" ? "Finished" : "Finalizados",
      description: props.locale === "en" ? "Delivered or cancelled in the selected range" : "Entregados o cancelados en el rango elegido",
      tone: "border-[rgba(118,93,71,0.16)] bg-[rgba(239,234,228,0.78)]",
      count: finishedOrders.length,
      content: finishedOrders.map(renderOrderCard),
    },
  ];

  return (
    <section className="app-panel overflow-hidden rounded-[24px] sm:rounded-[26px]">
      <div className="border-b border-[rgba(118,93,71,0.12)] px-4 py-4 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{props.locale === "en" ? "Section view" : "Vista por secciones"}</p>
        <h2 className="mt-1 text-lg font-bold text-[var(--text-strong)]">{props.locale === "en" ? "The same operation, in a vertical flow" : "La misma operación, en flujo vertical"}</h2>
      </div>
      <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-2 2xl:grid-cols-3">
        {sections.map((section) => (
          <section
            className={`rounded-[22px] border p-3 transition ${section.tone}`}
            key={section.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const order = props.allOrders.find((candidate) => candidate.id === event.dataTransfer.getData("application/x-parahoy-order"));
              if (order) props.onDropOrder(order, section.id);
            }}
          >
            <header className="mb-3 flex items-start justify-between gap-3 border-b border-[rgba(118,93,71,0.1)] px-1 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-[var(--text-strong)]">{section.title}</h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--text-soft)]">{section.description}</p>
              </div>
              <span className="rounded-full bg-white/65 px-2.5 py-1 text-xs font-extrabold text-[var(--text-soft)]">{section.count}</span>
            </header>
            <div className="space-y-3">
              {section.count > 0 ? section.content : (
                <p className="rounded-[16px] border border-dashed border-[rgba(118,93,71,0.16)] bg-white/35 px-3 py-6 text-center text-xs text-[var(--text-faint)]">
                  {props.locale === "en" ? "Nothing in this stage." : "No hay pedidos en esta etapa."}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function BoardOpenChatCard({
  actionKey,
  locale,
  onOpen,
  onToggleAutomation,
  order,
}: {
  actionKey: string;
  locale: "en" | "es";
  onOpen: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  order: OpenOrderSummary;
}) {
  const humanReview = Boolean(order.conversationAutomation && !order.conversationAutomation.effectiveEnabled);
  const automation = order.conversationAutomation;
  return (
    <article className="rounded-[18px] border border-[rgba(97,135,158,0.18)] border-l-4 border-l-[#5f879e] bg-[rgba(255,251,246,0.94)] p-3 shadow-[0_7px_18px_rgba(58,49,42,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em] ${humanReview ? "bg-[rgba(197,123,87,0.16)] text-[var(--warning)]" : "bg-[rgba(97,135,158,0.14)] text-[#46697c]"}`}>{humanReview ? (locale === "en" ? "Human review" : "Revisión humana") : (locale === "en" ? "AI assisting" : "IA atendiendo")}</span>
        <span className="text-[10px] font-semibold text-[var(--text-faint)]">{formatRelativeTime(order.updatedAt, locale)}</span>
      </div>
      <button className="mt-3 w-full text-left" onClick={onOpen} type="button">
        <p className="truncate text-sm font-extrabold text-[var(--text-strong)]">{order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-soft)]">{getOrderItemsSummary(order.items ?? [], locale)}</p>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs font-bold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</span>{order.whatsappUrl ? <a className="text-xs font-bold text-[var(--success)] hover:underline" href={order.whatsappUrl} rel="noreferrer" target="_blank">WhatsApp</a> : null}</div>
      {automation && !automation.terminal ? (
        <AutomationSwitch
          busy={actionKey === `automation:${automation.conversationId}`}
          className="mt-2 !h-9 w-full !text-[11px]"
          enabled={automation.enabled}
          locale={locale}
          onToggle={() => onToggleAutomation(!automation.enabled)}
        />
      ) : null}
    </article>
  );
}

function BoardOrderCard({
  actionKey,
  locale,
  onBlockedMove,
  onCancel,
  onConfirmPayment,
  onKitchenProgress,
  onMove,
  onOpen,
  onToggleAutomation,
  onViewPayment,
  order,
}: {
  actionKey: string;
  locale: "en" | "es";
  onBlockedMove: () => void;
  onCancel: () => void;
  onConfirmPayment: (order: OrderSummary) => void;
  onKitchenProgress: (order: OrderSummary, patch: { progress?: KitchenProgress; label?: string | null }) => void;
  onMove: (order: OrderSummary, status: Extract<OrderStatus, "accepted" | "preparing" | "on_the_way" | "delivered">) => void;
  onOpen: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  onViewPayment: (order: OrderSummary) => void;
  order: OrderSummary;
}) {
  const progress = order.kitchenProgress ?? 0;
  const [sliderProgress, setSliderProgress] = useState<KitchenProgress>(progress);
  const [editingStage, setEditingStage] = useState(false);
  const [stageLabel, setStageLabel] = useState(order.kitchenStageLabel ?? "");
  const action = getBoardNextAction(order, locale);
  const palette = getBoardOrderCardPalette(order);
  const automation = order.conversationAutomation;
  const isMoving = action ? actionKey === (action.status === "accepted" ? `accept:${order.id}` : `status:${order.id}:${action.status}`) : false;
  const kitchenUpdating = actionKey === `kitchen:${order.id}`;
  const awaitingTransferProof = ["accepted", "preparing"].includes(order.status) && order.paymentMethod === "transfer" && !order.paymentConfirmedAt;
  const isKitchenOrder = ["accepted", "preparing"].includes(order.status) && !awaitingTransferProof;
  const isPaymentReview = order.status === "payment_pending_review";
  const requiresAttention = ["new", "pending_restaurant_confirmation", "needs_customer_replacement", "payment_pending_review"].includes(order.status);
  const visibleStageLabel = sliderProgress === progress && order.kitchenStageLabel?.trim()
    ? order.kitchenStageLabel.trim()
    : getDefaultKitchenStageLabel(sliderProgress, locale);
  const canCancel = !closedStatuses.includes(order.status);
  const dragTarget = getNextOperationalStageId(order);

  useEffect(() => {
    setSliderProgress(progress);
    setStageLabel(order.kitchenStageLabel ?? "");
  }, [order.id, order.kitchenStageLabel, progress]);

  function commitKitchenProgress(nextProgress: KitchenProgress = sliderProgress) {
    if (nextProgress === progress || kitchenUpdating) return;
    onKitchenProgress(order, { progress: nextProgress, label: null });
  }

  return (
    <article
      className={`rounded-[18px] border border-l-4 p-3 shadow-[0_7px_18px_rgba(58,49,42,0.06)] transition hover:-translate-y-0.5 ${dragTarget ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed"} ${palette}`}
      draggable
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) {
          event.preventDefault();
          return;
        }
        if (!dragTarget) {
          event.preventDefault();
          onBlockedMove();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-parahoy-order", order.id);
        event.dataTransfer.setData("text/plain", order.id);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <OrderStatusBadge locale={locale} status={order.status} />
        {requiresAttention ? <span className="rounded-full bg-[rgba(197,123,87,0.14)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--warning)]">{order.status === "needs_customer_replacement" ? (locale === "en" ? "Rebuilding" : "Rearmando") : (locale === "en" ? "Action" : "Acción")}</span> : null}
      </div>
      <button className="mt-3 w-full text-left" onClick={onOpen} type="button">
        <div className="flex items-baseline justify-between gap-2"><p className="min-w-0 truncate text-sm font-extrabold text-[var(--text-strong)]">{order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}</p><p className="shrink-0 text-sm font-extrabold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</p></div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-soft)]">{getOrderItemsSummary(order.items ?? [], locale)}</p>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-[var(--text-faint)]"><span>{formatRelativeTime(order.updatedAt, locale)}</span><span>•</span><span>{order.fulfillmentType === "delivery" ? (locale === "en" ? "Delivery" : "Domicilio") : (locale === "en" ? "Pickup" : "Recoge")}</span><span>•</span><span>{order.items?.length ?? 0} {locale === "en" ? "items" : "items"}</span></div>

      {isPaymentReview ? (
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button aria-label={locale === "en" ? "View payment proof" : "Ver comprobante"} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#5f879e]/25 bg-white/60 px-3 text-[11px] font-bold text-[#46697c] transition hover:bg-white disabled:opacity-60" disabled={actionKey === `proof:view:${order.id}`} onClick={() => onViewPayment(order)} type="button">
            {actionKey === `proof:view:${order.id}` ? <Loader2 className="animate-spin" size={13} /> : <Eye size={13} />}
            {locale === "en" ? "Proof" : "Comprobante"}
          </button>
          <button className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-[#5e895f] px-3 text-[11px] font-extrabold text-white transition hover:bg-[#4d784f] disabled:opacity-60" disabled={actionKey === `proof:confirm:${order.id}`} onClick={() => onConfirmPayment(order)} type="button">
            {actionKey === `proof:confirm:${order.id}` ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
            {locale === "en" ? "Validate payment" : "Validar pago"}
          </button>
        </div>
      ) : null}
      {awaitingTransferProof ? (
        <div className="mt-3 rounded-xl border border-dashed border-[#5f879e]/25 bg-white/45 px-3 py-2 text-center text-[11px] font-bold leading-4 text-[#46697c]">
          {locale === "en" ? "Waiting for the customer's payment proof" : "Esperando el comprobante del cliente"}
        </div>
      ) : null}

      {isKitchenOrder ? (
        <div className="mt-3 rounded-[14px] border border-[rgba(101,86,127,0.14)] bg-white/55 p-2.5">
          <div className="flex items-center gap-2">
            <input
              aria-label={locale === "en" ? "Kitchen progress" : "Progreso de cocina"}
              className="h-2 flex-1 cursor-ew-resize accent-[#806b9d]"
              disabled={kitchenUpdating}
              draggable={false}
              max={100}
              min={0}
              onBlur={(event) => commitKitchenProgress(Number(event.currentTarget.value) as KitchenProgress)}
              onChange={(event) => setSliderProgress(Number(event.target.value) as KitchenProgress)}
              onKeyUp={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                  commitKitchenProgress(Number(event.currentTarget.value) as KitchenProgress);
                }
              }}
              onPointerUp={(event) => commitKitchenProgress(Number(event.currentTarget.value) as KitchenProgress)}
              step={25}
              type="range"
              value={sliderProgress}
            />
            <span className="w-8 text-right text-[10px] font-extrabold text-[#65567f]">{sliderProgress}%</span>
          </div>
          {editingStage ? (
            <div className="mt-2 flex items-center gap-1.5">
              <input autoFocus className="min-w-0 flex-1 rounded-lg border border-[rgba(101,86,127,0.18)] bg-white px-2 py-1.5 text-[11px] text-[var(--text-strong)] outline-none focus:border-[#806b9d]" maxLength={60} onChange={(event) => setStageLabel(event.target.value)} placeholder={getDefaultKitchenStageLabel(sliderProgress, locale)} value={stageLabel} />
              <button aria-label={locale === "en" ? "Save label" : "Guardar texto"} className="grid h-7 w-7 place-items-center rounded-lg bg-[#806b9d] text-white" disabled={kitchenUpdating} onClick={() => { onKitchenProgress(order, { label: stageLabel.trim() || null }); setEditingStage(false); }} type="button"><Check size={12} /></button>
              <button aria-label={locale === "en" ? "Cancel editing" : "Cancelar edición"} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--text-faint)] hover:bg-black/5" onClick={() => { setStageLabel(order.kitchenStageLabel ?? ""); setEditingStage(false); }} type="button"><X size={12} /></button>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-bold text-[#65567f]">{visibleStageLabel}</span>
              <button aria-label={locale === "en" ? "Edit kitchen label" : "Editar texto de cocina"} className="grid h-5 w-5 shrink-0 place-items-center rounded text-[rgba(101,86,127,0.52)] transition hover:bg-[rgba(101,86,127,0.1)] hover:text-[#65567f]" onClick={() => setEditingStage(true)} type="button"><Pencil size={10} /></button>
            </div>
          )}
          {sliderProgress === 100 ? (
            <div className="mt-2 rounded-lg bg-[rgba(79,122,97,0.12)] px-2 py-2 text-center text-[10px] font-extrabold leading-4 text-[var(--success)]">
              {locale === "en" ? "Ready: move it to pickup / delivery" : "Listo: avanza a recoger / domicilio"}
            </div>
          ) : <p className="mt-2 text-center text-[10px] font-bold text-[var(--text-faint)]">{locale === "en" ? "Drag the bar in 25% steps" : "Desliza la barra en pasos de 25%"}</p>}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {action ? <button className={`inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${action.tone}`} disabled={isMoving} onClick={() => onMove(order, action.status)} type="button">{isMoving ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}{isMoving ? (locale === "en" ? "Moving..." : "Moviendo...") : action.label}</button> : <button className="inline-flex min-h-9 flex-1 items-center justify-center rounded-xl border border-[rgba(118,93,71,0.12)] px-3 text-xs font-bold text-[var(--text-soft)] transition hover:bg-[rgba(118,93,71,0.06)]" onClick={onOpen} type="button">{locale === "en" ? "View detail" : "Ver detalle"}</button>}
        {order.whatsappUrl ? <a aria-label={locale === "en" ? "Open WhatsApp" : "Abrir WhatsApp"} className="grid h-9 w-9 place-items-center rounded-xl border border-[rgba(79,122,97,0.2)] text-[var(--success)] transition hover:bg-[rgba(79,122,97,0.08)]" href={order.whatsappUrl} rel="noreferrer" target="_blank"><ExternalLink size={14} /></a> : null}
      </div>
      {(automation && !automation.terminal) || canCancel ? (
        <div className="mt-2 flex items-center gap-2 border-t border-[rgba(118,93,71,0.1)] pt-2">
          {automation && !automation.terminal ? (
            <AutomationSwitch
              busy={actionKey === `automation:${automation.conversationId}`}
              className="!h-9 min-w-0 flex-1 !text-[11px]"
              enabled={automation.enabled}
              locale={locale}
              onToggle={() => onToggleAutomation(!automation.enabled)}
            />
          ) : null}
          {canCancel ? (
            <button
              aria-label={locale === "en" ? "Cancel order" : "Cancelar pedido"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(180,94,84,0.2)] text-[#914d47] transition hover:bg-[rgba(180,94,84,0.08)]"
              onClick={onCancel}
              title={locale === "en" ? "Cancel order" : "Cancelar pedido"}
              type="button"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {!dragTarget && !closedStatuses.includes(order.status) ? (
        <div className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">
          <Lock size={10} />
          {locale === "en" ? "Complete stage to drag" : "Completar etapa para arrastrar"}
        </div>
      ) : null}
    </article>
  );
}

function getBoardNextAction(order: OrderSummary, locale: "en" | "es") {
  if (order.status === "pending_restaurant_confirmation") return { status: "accepted" as const, label: locale === "en" ? "Confirm order" : "Confirmar pedido", tone: "bg-[#6f926f] hover:bg-[#5c7f5c]" };
  const paymentValidated = order.paymentMethod === "cash" || Boolean(order.paymentConfirmedAt);
  if (["accepted", "preparing"].includes(order.status) && paymentValidated && (order.kitchenProgress ?? 0) === 100) return { status: "on_the_way" as const, label: order.fulfillmentType === "delivery" ? (locale === "en" ? "Send to delivery" : "Enviar a domicilio") : (locale === "en" ? "Ready for pickup" : "Listo para recoger"), tone: "bg-[#5f729e] hover:bg-[#4e618c]" };
  if (order.status === "on_the_way") return { status: "delivered" as const, label: locale === "en" ? "Complete order" : "Finalizar pedido", tone: "bg-[#6f7e69] hover:bg-[#5d6b58]" };
  return undefined;
}

function getOperationalStageId(order: OrderSummary): OperationalStageId {
  if (order.status === "needs_customer_replacement") return "open";
  if (["new", "pending_restaurant_confirmation"].includes(order.status)) return "review";
  if (["accepted", "preparing", "payment_pending_review"].includes(order.status)) return "preparing";
  if (order.status === "on_the_way") return "ready";
  return "finished";
}

function getNextOperationalStageId(order: OrderSummary): OperationalStageId | null {
  if (order.status === "pending_restaurant_confirmation") return "preparing";

  const paymentValidated = order.paymentMethod === "cash" || Boolean(order.paymentConfirmedAt);
  if (["accepted", "preparing"].includes(order.status) && paymentValidated && (order.kitchenProgress ?? 0) === 100) {
    return "ready";
  }

  if (order.status === "on_the_way") return "finished";
  return null;
}

function resolveDropStatus(
  order: OrderSummary,
  targetStage: OperationalStageId,
): Extract<OrderStatus, "accepted" | "on_the_way" | "delivered"> | null {
  if (getNextOperationalStageId(order) !== targetStage) return null;
  if (targetStage === "preparing") return "accepted";
  if (targetStage === "ready") return "on_the_way";
  if (targetStage === "finished") return "delivered";
  return null;
}

function getBoardOrderCardPalette(order: OrderSummary) {
  if (order.status === "on_the_way") {
    return order.fulfillmentType === "delivery"
      ? "border-[rgba(90,111,170,0.28)] border-l-[#5f729e] bg-[rgba(239,244,255,0.98)]"
      : "border-[rgba(79,122,97,0.28)] border-l-[#4f7a61] bg-[rgba(239,250,243,0.98)]";
  }

  return {
    new: "border-[rgba(193,157,98,0.26)] border-l-[#9d7e42] bg-[rgba(255,250,238,0.96)]",
    pending_restaurant_confirmation: "border-[rgba(193,157,98,0.3)] border-l-[#b28a43] bg-[rgba(255,249,233,0.98)]",
    needs_customer_replacement: "border-[rgba(213,111,67,0.34)] border-l-[#d56f43] bg-[rgba(255,239,230,0.99)]",
    payment_pending_review: "border-[rgba(97,135,158,0.24)] border-l-[#5f879e] bg-[rgba(242,248,251,0.98)]",
    accepted: "border-[rgba(79,122,97,0.24)] border-l-[#5e895f] bg-[rgba(241,249,242,0.98)]",
    preparing: "border-[rgba(132,111,164,0.24)] border-l-[#806b9d] bg-[rgba(247,244,252,0.98)]",
    on_the_way: "",
    delivered: "border-[rgba(79,122,97,0.18)] border-l-[#75846f] bg-[rgba(246,249,244,0.96)]",
    cancelled: "border-[rgba(180,94,84,0.22)] border-l-[#b45e54] bg-[rgba(253,244,242,0.96)]",
  }[order.status];
}

function getDefaultKitchenStageLabel(progress: KitchenProgress, locale: "en" | "es") {
  const labels = locale === "en"
    ? { 0: "Queued", 25: "Preparing ingredients", 50: "In the oven", 75: "Plating", 100: "Served" }
    : { 0: "En cola", 25: "Preparando ingredientes", 50: "En el horno", 75: "Emplatando", 100: "Servido" };
  return labels[progress];
}

function ClosedOrdersFilter({
  customDate,
  locale,
  onChangeCustomDate,
  onChangeRange,
  range,
}: {
  customDate: string;
  locale: "en" | "es";
  onChangeCustomDate: (date: string) => void;
  onChangeRange: (range: ClosedRange) => void;
  range: ClosedRange;
}) {
  const options: Array<{ id: ClosedRange; label: string }> = [
    { id: "today", label: locale === "en" ? "Today" : "Hoy" },
    { id: "7d", label: locale === "en" ? "7 days" : "7 dias" },
    { id: "30d", label: locale === "en" ? "30 days" : "30 dias" },
    { id: "custom", label: locale === "en" ? "One day" : "Un dia" },
  ];

  return (
    <div className="border-b border-[rgba(118,93,71,0.12)] px-4 py-3">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((option) => {
            const active = range === option.id;
            return (
              <button
                className={`rounded-[14px] border px-3 py-2 text-xs font-bold transition ${
                  active
                    ? "border-[rgba(118,93,71,0.22)] bg-[var(--surface-closed)] text-[var(--text-strong)]"
                    : "border-[rgba(118,93,71,0.1)] text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
                }`}
                key={option.id}
                onClick={() => onChangeRange(option.id)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {range === "custom" ? (
          <input
            className="h-11 rounded-[14px] border border-[rgba(118,93,71,0.14)] bg-white/70 px-3 text-sm font-semibold text-[var(--text-strong)] outline-none focus:border-[rgba(118,93,71,0.28)]"
            onChange={(event) => onChangeCustomDate(event.target.value)}
            type="date"
            value={customDate}
          />
        ) : null}
      </div>
    </div>
  );
}

function OpenConversationCard({
  actionKey,
  locale,
  onOpenDetail,
  onOpenLinkedOrder,
  onToggleAutomation,
  order,
}: {
  actionKey: string;
  locale: "en" | "es";
  onOpenDetail: () => void;
  onOpenLinkedOrder?: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  order: OpenOrderSummary;
}) {
  const automation = order.conversationAutomation;
  return (
    <article className="rounded-[20px] border border-[rgba(137,164,196,0.18)] bg-[rgba(255,251,246,0.92)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[rgba(137,164,196,0.16)] px-3 py-1 text-xs font-semibold text-[#4d6783]">
            {locale === "en" ? "Open chat" : "Chat abierto"}
          </span>
          {order.conversationState ? (
            <span className="inline-flex items-center rounded-full bg-[rgba(118,93,71,0.08)] px-3 py-1 text-xs font-semibold text-[var(--text-soft)]">
              {getConversationStateLabel(order.conversationState, locale)}
            </span>
          ) : null}
          {automation && !automation.effectiveEnabled ? (
            <span className="inline-flex items-center rounded-full bg-[rgba(197,123,87,0.14)] px-3 py-1 text-xs font-bold text-[var(--warning)]">
              {locale === "en" ? "Human review" : "Revision humana"}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs font-medium text-[var(--text-faint)]">{formatRelativeTime(order.updatedAt, locale)}</span>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-base font-semibold text-[var(--text-strong)]">
          {order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}
        </h3>
        <p className="shrink-0 text-base font-extrabold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</p>
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-[var(--text-strong)]">
        {getOrderItemsSummary(order.items ?? [], locale)}
      </p>
      <p className="mt-2 text-xs leading-5 text-[var(--text-soft)]">
        {order.customerPhone || (locale === "en" ? "No phone yet" : "Sin telefono")} - {formatDateTime(order.createdAt, locale)}
      </p>
      {order.customerAddressText ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-soft)]">{order.customerAddressText}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {order.draftOrderId
            ? `${locale === "en" ? "Draft" : "Borrador"} #${getOrderReceiptCode(order.draftOrderId)}`
            : (locale === "en" ? "Conversation started" : "Conversacion iniciada")}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {automation ? (
            <AutomationSwitch
              busy={actionKey === `automation:${automation.conversationId}`}
              enabled={automation.enabled}
              locale={locale}
              onToggle={() => onToggleAutomation(!automation.enabled)}
            />
          ) : null}
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[rgba(118,93,71,0.14)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(118,93,71,0.06)]"
            onClick={onOpenDetail}
            type="button"
          >
            <ClipboardList size={15} />
            {locale === "en" ? "Details" : "Detalle"}
          </button>
          {onOpenLinkedOrder ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[rgba(118,93,71,0.14)] px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(118,93,71,0.06)]"
              onClick={onOpenLinkedOrder}
              type="button"
            >
              <ChevronRight size={15} />
              {locale === "en" ? "Open order" : "Abrir pedido"}
            </button>
          ) : null}
          {order.whatsappUrl ? (
            <a
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[rgba(79,122,97,0.2)] px-3 text-sm font-semibold text-[var(--success)] transition hover:bg-[rgba(79,122,97,0.08)]"
              href={order.whatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={15} />
              {locale === "en" ? "Open WhatsApp" : "Abrir WhatsApp"}
            </a>
          ) : (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[rgba(118,93,71,0.12)] px-3 text-sm font-semibold text-[var(--text-faint)]"
              disabled
              type="button"
            >
              <ExternalLink size={15} />
              {locale === "en" ? "No WhatsApp" : "Sin WhatsApp"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function OperationalOrderCard({
  actionKey,
  locale,
  onAccept,
  onCancel,
  onConfirmPayment,
  onKitchenProgress,
  onMove,
  onOpen,
  onOpenWhatsapp,
  onReportOutOfStock,
  onToggleAutomation,
  onViewPayment,
  order,
}: {
  actionKey: string;
  locale: "en" | "es";
  onAccept: () => void;
  onCancel: () => void;
  onConfirmPayment: () => void;
  onKitchenProgress: (patch: { progress?: KitchenProgress; label?: string | null }) => void;
  onMove: (status: Extract<OrderStatus, "accepted" | "preparing" | "on_the_way" | "delivered">) => void;
  onOpen: () => void;
  onOpenWhatsapp: () => void;
  onReportOutOfStock: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  onViewPayment: () => void;
  order: OrderSummary;
}) {
  const canDecide = order.status === "pending_restaurant_confirmation";
  const notificationFailed = order.customerNotificationStatus === "failed";
  const action = getBoardNextAction(order, locale);
  const automation = order.conversationAutomation;
  const canCancel = !closedStatuses.includes(order.status);
  const isPaymentReview = order.status === "payment_pending_review";
  const isKitchenOrder = ["accepted", "preparing"].includes(order.status)
    && (order.paymentMethod === "cash" || Boolean(order.paymentConfirmedAt));
  const isMoving = action
    ? actionKey === (action.status === "accepted" ? `accept:${order.id}` : `status:${order.id}:${action.status}`)
    : false;

  return (
    <article
      className="cursor-pointer rounded-[20px] border border-[rgba(118,93,71,0.12)] bg-[rgba(255,251,246,0.92)] p-4 transition hover:border-[rgba(118,93,71,0.22)] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[rgba(197,123,87,0.1)]"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <OrderStatusBadge locale={locale} status={order.status} />
          {notificationFailed ? <AlertCircle className="shrink-0 text-[var(--warning)]" size={15} /> : null}
        </div>
        <span className="shrink-0 text-xs font-medium text-[var(--text-faint)]">{formatRelativeTime(order.createdAt, locale)}</span>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-base font-semibold text-[var(--text-strong)]">
          {locale === "en" ? "Order" : "Pedido"} #{getOrderReceiptCode(order.id)}
        </h3>
        <p className="shrink-0 text-base font-extrabold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</p>
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-[var(--text-strong)]">
        {getOrderItemsSummary(order.items, locale)}
      </p>
      <OrderSummaryIconChips locale={locale} order={order} />
      {closedStatuses.includes(order.status) ? (
        <p className="mt-1 text-xs font-semibold text-[var(--text-faint)]">
          {locale === "en" ? "Closed" : "Cerrado"}: {formatDateTime(order.updatedAt, locale)}
        </p>
      ) : null}

      {isPaymentReview ? (
        <div className="mt-4 grid grid-cols-2 gap-2" onClick={(event) => event.stopPropagation()}>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] border border-[#5f879e]/25 px-3 text-xs font-semibold text-[#46697c]"
            disabled={actionKey === `proof:view:${order.id}`}
            onClick={onViewPayment}
            type="button"
          >
            {actionKey === `proof:view:${order.id}` ? <Loader2 className="animate-spin" size={14} /> : <Eye size={14} />}
            {locale === "en" ? "View proof" : "Ver comprobante"}
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] bg-[#5e895f] px-3 text-xs font-bold text-white disabled:opacity-60"
            disabled={actionKey === `proof:confirm:${order.id}`}
            onClick={onConfirmPayment}
            type="button"
          >
            {actionKey === `proof:confirm:${order.id}` ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
            {locale === "en" ? "Validate payment" : "Validar pago"}
          </button>
        </div>
      ) : null}

      {isKitchenOrder ? (
        <QueueKitchenProgress
          busy={actionKey === `kitchen:${order.id}`}
          locale={locale}
          onChange={onKitchenProgress}
          order={order}
        />
      ) : null}

      {canDecide ? (
        <div className="mt-4 grid gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:opacity-60"
            disabled={actionKey === `accept:${order.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onAccept();
            }}
            type="button"
          >
            {actionKey === `accept:${order.id}` ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            {actionKey === `accept:${order.id}`
              ? (locale === "en" ? "Confirming..." : "Confirmando...")
              : (locale === "en" ? "Confirm order" : "Confirmar pedido")}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-[rgba(197,123,87,0.2)] px-3 text-sm font-semibold text-[var(--warning)] transition hover:bg-[rgba(197,123,87,0.08)]"
            onClick={(event) => {
              event.stopPropagation();
              onReportOutOfStock();
            }}
            type="button"
          >
            <MessageSquareWarning size={15} />
            <span className="min-[390px]:hidden">{locale === "en" ? "Out" : "Agotado"}</span>
            <span className="hidden min-[390px]:inline">{locale === "en" ? "Report out" : "Reportar agotado"}</span>
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-[rgba(180,94,84,0.2)] px-3 text-sm font-semibold text-[#914d47] transition hover:bg-[rgba(180,94,84,0.08)] min-[360px]:col-span-2"
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
            type="button"
          >
            <X size={15} />
            {locale === "en" ? "Cancel order" : "Cancelar pedido"}
          </button>
          <button
            className="min-[360px]:col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-[rgba(79,122,97,0.2)] px-3 text-sm font-semibold text-[var(--success)] transition hover:bg-[rgba(79,122,97,0.08)] disabled:cursor-not-allowed disabled:border-[rgba(118,93,71,0.12)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
            disabled={!order.whatsappUrl}
            onClick={(event) => {
              event.stopPropagation();
              onOpenWhatsapp();
            }}
            type="button"
          >
            <ExternalLink size={15} />
            {order.whatsappUrl
              ? (locale === "en" ? "Open WhatsApp" : "Abrir WhatsApp")
              : (locale === "en" ? "No WhatsApp" : "Sin WhatsApp")}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs font-semibold text-[var(--text-soft)]" onClick={(event) => event.stopPropagation()}>
          {action ? (
            <button
              className={`inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-[12px] px-3 text-xs font-extrabold text-white transition disabled:opacity-60 ${action.tone}`}
              disabled={isMoving}
              onClick={() => onMove(action.status)}
              type="button"
            >
              {isMoving ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}
              {isMoving ? (locale === "en" ? "Moving..." : "Moviendo...") : action.label}
            </button>
          ) : null}
          <button
            className="inline-flex items-center gap-1 rounded-full border border-[rgba(79,122,97,0.16)] px-3 py-1.5 text-[var(--success)] transition hover:bg-[rgba(79,122,97,0.08)] disabled:cursor-not-allowed disabled:border-[rgba(118,93,71,0.12)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
            disabled={!order.whatsappUrl}
            onClick={(event) => {
              event.stopPropagation();
              onOpenWhatsapp();
            }}
            type="button"
          >
            <ExternalLink size={13} />
            {order.whatsappUrl ? "WhatsApp" : (locale === "en" ? "No WhatsApp" : "Sin WhatsApp")}
          </button>
          <span className="inline-flex items-center gap-1">
            {locale === "en" ? "View details" : "Ver detalle"}
            <ChevronRight size={15} />
          </span>
        </div>
      )}

      {(automation && !automation.terminal) || (canCancel && !canDecide) ? (
        <div className="mt-3 flex items-center gap-2 border-t border-[rgba(118,93,71,0.1)] pt-3" onClick={(event) => event.stopPropagation()}>
          {automation && !automation.terminal ? (
            <AutomationSwitch
              busy={actionKey === `automation:${automation.conversationId}`}
              className="!h-10 min-w-0 flex-1 !text-xs"
              enabled={automation.enabled}
              locale={locale}
              onToggle={() => onToggleAutomation(!automation.enabled)}
            />
          ) : null}
          {canCancel && !canDecide ? (
            <button
              aria-label={locale === "en" ? "Cancel order" : "Cancelar pedido"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[rgba(180,94,84,0.2)] text-[#914d47] transition hover:bg-[rgba(180,94,84,0.08)]"
              onClick={onCancel}
              title={locale === "en" ? "Cancel order" : "Cancelar pedido"}
              type="button"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function QueueKitchenProgress({
  busy,
  locale,
  onChange,
  order,
}: {
  busy: boolean;
  locale: "en" | "es";
  onChange: (patch: { progress?: KitchenProgress; label?: string | null }) => void;
  order: OrderSummary;
}) {
  const progress = order.kitchenProgress ?? 0;
  const [preview, setPreview] = useState<KitchenProgress>(progress);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(order.kitchenStageLabel ?? "");

  useEffect(() => {
    setPreview(progress);
    setLabel(order.kitchenStageLabel ?? "");
  }, [order.id, order.kitchenStageLabel, progress]);

  const visibleLabel = preview === progress && order.kitchenStageLabel?.trim()
    ? order.kitchenStageLabel.trim()
    : getDefaultKitchenStageLabel(preview, locale);

  function commit(next: KitchenProgress) {
    if (!busy && next !== progress) onChange({ progress: next, label: null });
  }

  return (
    <div className="mt-4 rounded-[16px] border border-[rgba(101,86,127,0.14)] bg-[rgba(247,244,252,0.8)] p-3" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-3">
        <input
          aria-label={locale === "en" ? "Kitchen progress" : "Progreso de cocina"}
          className="h-2 min-w-0 flex-1 cursor-ew-resize accent-[#806b9d]"
          disabled={busy}
          draggable={false}
          max={100}
          min={0}
          onBlur={(event) => commit(Number(event.currentTarget.value) as KitchenProgress)}
          onChange={(event) => setPreview(Number(event.target.value) as KitchenProgress)}
          onPointerUp={(event) => commit(Number(event.currentTarget.value) as KitchenProgress)}
          step={25}
          type="range"
          value={preview}
        />
        <span className="w-9 text-right text-[11px] font-extrabold text-[#65567f]">{preview}%</span>
      </div>
      {editing ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[rgba(101,86,127,0.18)] bg-white px-2 py-1.5 text-xs text-[var(--text-strong)] outline-none"
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            value={label}
          />
          <button className="grid h-7 w-7 place-items-center rounded-lg bg-[#806b9d] text-white" onClick={() => { onChange({ label: label.trim() || null }); setEditing(false); }} type="button"><Check size={12} /></button>
          <button className="grid h-7 w-7 place-items-center rounded-lg text-[var(--text-faint)]" onClick={() => setEditing(false)} type="button"><X size={12} /></button>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-bold text-[#65567f]">{visibleLabel}</span>
          <button aria-label={locale === "en" ? "Edit kitchen label" : "Editar texto de cocina"} className="grid h-5 w-5 place-items-center rounded text-[rgba(101,86,127,0.52)]" onClick={() => setEditing(true)} type="button"><Pencil size={10} /></button>
        </div>
      )}
    </div>
  );
}

function OrderDetailPanel({
  actionKey,
  menuItems,
  onAccept,
  onAdvanceConfirmed,
  onCancel,
  onClose,
  onConfirmPaymentProof,
  onFinalize,
  onOpenRejectModal,
  onRetry,
  onViewPaymentProof,
  onToggleAutomation,
  order,
  selectedSummary,
}: {
  actionKey: string;
  menuItems: MenuItem[];
  onAccept: () => void;
  onAdvanceConfirmed: () => void;
  onCancel: () => void;
  onClose?: () => void;
  onConfirmPaymentProof: () => void;
  onFinalize: () => void;
  onOpenRejectModal: () => void;
  onRetry: () => void;
  onViewPaymentProof: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  order: OrderDetail;
  selectedSummary?: OrderSummary;
}) {
  const locale = activeOrdersLocale;
  const notificationFailed = order.customerNotificationStatus === "failed";
  const canAccept = order.status === "pending_restaurant_confirmation";
  const canReject = order.status === "pending_restaurant_confirmation";
  const canRetry = notificationFailed && (order.status === "accepted" || order.status === "needs_customer_replacement");
  const canAdvanceConfirmed = ["accepted", "preparing"].includes(order.status)
    && (order.paymentMethod === "cash" || Boolean(order.paymentConfirmedAt))
    && (order.kitchenProgress ?? 0) === 100;
  const canFinalize = order.status === "on_the_way";
  const canCancel = !closedStatuses.includes(order.status);
  const canConfirmPaymentProof = order.status === "payment_pending_review" && Boolean(order.paymentProof);
  const whatsappUrl = selectedSummary?.whatsappUrl ?? order.whatsappUrl;
  const replacementOptions = order.restaurantReviewMetadata?.replacementMenuItems ?? [];
  const automation = order.conversationAutomation;
  const unavailableItems = order.restaurantReviewMetadata?.unavailableItems ?? [];
  const advanceLabel = order.fulfillmentType === "delivery"
    ? (locale === "en" ? "Mark as 30 min delivery" : "Marcar delivery 30 min")
    : (locale === "en" ? "Mark as ready for pickup" : "Marcar listo para recoger");
  const billingHeaderName = order.billing?.type === "electronic"
    ? order.billing.legalName?.trim()
    : order.billing?.fullName?.trim();
  return (
    <div className="flex min-h-[420px] flex-col sm:min-h-[620px]">
      <div className="border-b border-[rgba(118,93,71,0.12)] px-4 py-5 sm:px-6">
        {onClose ? (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Order detail" : "Detalle del pedido"}</span>
            <button
              aria-label={locale === "en" ? "Close order detail" : "Cerrar detalle del pedido"}
              className="grid h-10 w-10 place-items-center rounded-full border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)]"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 xl:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge locale={locale} status={order.status} />
              {notificationFailed && <NotificationBadge locale={locale} status="failed" />}
              {selectedSummary?.customerNotificationStatus === "sent" && <NotificationBadge locale={locale} status="sent" />}
              {automation && !automation.effectiveEnabled ? <span className="inline-flex rounded-full bg-[rgba(197,123,87,0.14)] px-3 py-1 text-xs font-bold text-[var(--warning)]">{locale === "en" ? "Human intervention required" : "Requiere intervencion humana"}</span> : null}
            </div>
            {billingHeaderName ? <h3 className="app-display mt-4 text-[2rem] leading-none text-[var(--text-strong)] sm:text-[2.6rem]">{billingHeaderName}</h3> : null}
            <p className="mt-3 text-[1.05rem] leading-7 text-[var(--text-soft)]">
              {order.customerPhone || (locale === "en" ? "No phone" : "Sin telefono")} - {formatDateTime(order.createdAt, locale)}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <InfoChip icon={order.fulfillmentType === "delivery" ? Truck : Store} label={order.fulfillmentType === "delivery" ? (locale === "en" ? "Delivery" : "Domicilio") : (locale === "en" ? "Pickup" : "Recoge en local")} />
              <InfoChip icon={ClipboardList} label={order.paymentMethod === "transfer" ? "Transferencia" : "Efectivo"} />
              <InfoChip icon={Clock} label={order.serviceTiming === "scheduled" && order.scheduledFor ? formatDateTime(order.scheduledFor, locale) : (locale === "en" ? "As soon as possible" : "Lo antes posible")} />
            </div>
            {confirmedStatuses.includes(order.status) ? (
              <OrderProgressRail fulfillmentType={order.fulfillmentType} locale={locale} status={order.status} />
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-4 xl:w-[300px] xl:shrink-0 xl:items-end">
            {automation ? (
              <AutomationSwitch
                busy={actionKey === `automation:${automation.conversationId}`}
                className="w-full"
                disabled={automation.terminal}
                enabled={automation.enabled}
                locale={locale}
                onToggle={() => onToggleAutomation(!automation.enabled)}
              />
            ) : null}
            <div className="grid w-full grid-cols-1 gap-2">
            {canAccept && (
              <ActionButton
                active={actionKey === `accept:${order.id}`}
                icon={Check}
                label={actionKey === `accept:${order.id}` ? (locale === "en" ? "Confirming..." : "Confirmando...") : (locale === "en" ? "Confirm order" : "Confirmar pedido")}
                onClick={onAccept}
                variant="primary"
                className="!w-full"
              />
            )}
            {canConfirmPaymentProof && (
              <ActionButton
                active={actionKey === `proof:confirm:${order.id}`}
                icon={Check}
                label={actionKey === `proof:confirm:${order.id}` ? (locale === "en" ? "Confirming payment..." : "Confirmando pago...") : (locale === "en" ? "Confirm payment" : "Confirmar pago")}
                onClick={onConfirmPaymentProof}
                variant="primary"
                className="!w-full"
              />
            )}
            {canAdvanceConfirmed && (
              <ActionButton
                active={actionKey === `status:${order.id}:on_the_way`}
                icon={Check}
                label={actionKey === `status:${order.id}:on_the_way` ? (locale === "en" ? "Updating..." : "Actualizando...") : advanceLabel}
                onClick={onAdvanceConfirmed}
                variant="primary"
                className="!w-full"
              />
            )}
            {canFinalize && (
              <ActionButton
                active={actionKey === `status:${order.id}:delivered`}
                icon={Check}
                label={actionKey === `status:${order.id}:delivered` ? (locale === "en" ? "Finishing..." : "Finalizando...") : (locale === "en" ? "Complete order" : "Finalizar pedido")}
                onClick={onFinalize}
                variant="primary"
                className="!w-full"
              />
            )}
            {canReject && (
              <ActionButton
                className="!w-full"
                icon={MessageSquareWarning}
                label={locale === "en" ? "Report out of stock" : "Reportar agotado"}
                onClick={onOpenRejectModal}
                variant="secondary"
              />
            )}
            {whatsappUrl ? (
              <a
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-[rgba(79,122,97,0.2)] px-4 text-sm font-semibold text-[var(--success)] transition hover:bg-[rgba(79,122,97,0.08)]"
                href={whatsappUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={16} />
                {locale === "en" ? "Open WhatsApp" : "Abrir WhatsApp"}
              </a>
            ) : (
              <button
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-faint)]"
                disabled
                type="button"
              >
                <ExternalLink size={16} />
                {locale === "en" ? "No WhatsApp" : "Sin WhatsApp"}
              </button>
            )}
            {canRetry && (
              <ActionButton
                active={actionKey === `retry:${order.id}`}
                icon={RefreshCcw}
                label={actionKey === `retry:${order.id}` ? (locale === "en" ? "Sending again..." : "Reenviando...") : (locale === "en" ? "Retry WhatsApp" : "Reenviar WhatsApp")}
                onClick={onRetry}
                variant="warning"
              />
            )}
            {order.paymentProof && (
              <ActionButton
                active={actionKey === `proof:view:${order.id}`}
                icon={ClipboardList}
                label={actionKey === `proof:view:${order.id}` ? (locale === "en" ? "Opening..." : "Abriendo...") : (locale === "en" ? "View proof" : "Ver comprobante")}
                onClick={onViewPaymentProof}
                variant="secondary"
              />
            )}
            {canCancel && (
              <div className="mt-2 border-t border-[rgba(118,93,71,0.12)] pt-2">
                <ActionButton
                  active={actionKey === `status:${order.id}:cancelled`}
                  className="!w-full"
                  icon={X}
                  label={actionKey === `status:${order.id}:cancelled` ? (locale === "en" ? "Cancelling..." : "Cancelando...") : (locale === "en" ? "Cancel order" : "Cancelar pedido")}
                  onClick={onCancel}
                  variant="warning"
                />
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="divide-y divide-[rgba(118,93,71,0.12)]">
          <section className="px-4 py-5 sm:px-6">
            <div className="mb-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">{locale === "en" ? "Order items" : "Items del pedido"}</h4>
                <p className="text-xs text-[var(--text-faint)]">{order.items.length} {locale === "en" ? "products" : "productos"}</p>
              </div>
              <div className="space-y-3">
                {order.items.map((item, index) => (
                  <OrderItemCard item={item} key={getOrderItemKey(item, index)} menuItems={menuItems} />
                ))}
              </div>
            </div>
            {order.fulfillmentType === "delivery" ? (
              <DeliveryCoverageDetail locale={locale} order={order} />
            ) : null}
            {order.restaurantReviewNote && (
              <p className="mt-4 text-sm leading-7 text-[var(--text-soft)]">
                <span className="font-semibold text-[var(--text-strong)]">{locale === "en" ? "Internal note:" : "Nota interna:"}</span> {order.restaurantReviewNote}
              </p>
            )}
            {notificationFailed && order.customerNotificationError && (
              <p className="mt-4 rounded-[22px] border border-[rgba(197,123,87,0.18)] bg-[rgba(197,123,87,0.08)] px-4 py-3 text-sm font-medium text-[var(--warning)]">
                {locale === "en" ? "Customer notification error:" : "Error de envio al cliente:"} {order.customerNotificationError}
              </p>
            )}
            {order.paymentProof && (
              <div className="mt-4 rounded-[22px] border border-[rgba(97,135,158,0.18)] bg-[rgba(97,135,158,0.08)] px-4 py-4 text-sm text-[#46697c]">
                <p className="font-semibold text-[#2d5369]">{locale === "en" ? "Transfer proof" : "Comprobante de transferencia"}</p>
                <p className="mt-2">{locale === "en" ? "Status" : "Estado"}: {getPaymentProofStatusLabel(order.paymentProof.status, locale)}</p>
                <p className="mt-1">{locale === "en" ? "Received" : "Recibido"}: {formatDateTime(order.paymentProof.createdAt, locale)}</p>
                {order.paymentProof.mimeType && <p className="mt-1">{locale === "en" ? "Format" : "Formato"}: {order.paymentProof.mimeType}</p>}
                {order.paymentProof.fileSize !== undefined && <p className="mt-1">{locale === "en" ? "Size" : "Tamano"}: {formatFileSize(order.paymentProof.fileSize)}</p>}
              </div>
            )}
          </section>
          {order.status === "needs_customer_replacement" && (
            <section className="px-4 py-5 sm:px-6">
              <div className="rounded-[24px] border border-[rgba(197,123,87,0.18)] bg-[rgba(197,123,87,0.08)] p-5">
                <div className="flex items-center gap-2 text-[var(--warning)]">
                  <AlertCircle size={17} />
                  <h4 className="text-sm font-semibold uppercase tracking-[0.12em]">{locale === "en" ? "Waiting for customer decision" : "Esperando decision del cliente"}</h4>
                </div>
                {unavailableItems.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {unavailableItems.map((item) => (
                      <p className="text-sm leading-6 text-[var(--warning)]" key={item.orderItemId}>
                        {locale === "en" ? "Out of stock:" : "Agotado:"} <span className="font-semibold">{item.name}</span> - {locale === "en" ? "category" : "categoria"} {item.category || (locale === "en" ? "uncategorized" : "sin categoria")}
                      </p>
                    ))}
                  </div>
                )}
                {replacementOptions.length > 0 && (
                  <div className="mt-5 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--warning)]">{locale === "en" ? "Options sent" : "Opciones enviadas"}</p>
                    {replacementOptions.map((option, index) => (
                      <div className="flex flex-col gap-2 rounded-[18px] bg-white/75 px-3 py-3 text-sm text-[var(--text-strong)] sm:flex-row sm:items-center sm:justify-between" key={option.menuItemId}>
                        <span>{index + 1}. {option.name}</span>
                        <span className="font-semibold">{formatPrice(option.price, locale)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <OrderMetaCard
            formatDateTime={formatDateTime}
            getNotificationLabel={getNotificationLabel}
            getOrderStatusLabel={getOrderStatusLabel}
            locale={locale}
            order={order}
          />
        </div>

        <aside className="border-t border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] px-4 py-5 xl:border-l xl:border-t-0 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Bill and summary" : "Cuenta y factura"}</p>
          <div className="mt-4 rounded-[18px] bg-[var(--surface-base)] px-4 py-3">
            <SummaryRow label={locale === "en" ? "Receipt" : "Factura"} value={`#${getOrderReceiptCode(order.id)}`} />
          </div>
          <div className="mt-4 space-y-3">
            <SummaryRow label={locale === "en" ? "Subtotal" : "Subtotal"} value={formatPrice(order.subtotal, locale)} />
            <SummaryRow label={locale === "en" ? "Delivery" : "Domicilio"} value={formatPrice(order.deliveryFee, locale)} />
            <SummaryRow label={locale === "en" ? "Discount" : "Descuento"} value={formatPrice(order.discountTotal, locale)} />
          </div>
          <div className="my-4 border-t border-[rgba(118,93,71,0.12)]" />
          <SummaryRow emphasis label="Total" value={formatPrice(order.total, locale)} />
          <BillingSummaryCard locale={locale} order={order} />
        </aside>
      </div>

    </div>
  );
}

function AutomationSwitch({
  busy,
  className,
  disabled = false,
  enabled,
  locale,
  onToggle,
}: {
  busy: boolean;
  className?: string;
  disabled?: boolean;
  enabled: boolean;
  locale: "en" | "es";
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={enabled}
      className={`inline-flex h-10 items-center justify-between gap-3 rounded-2xl border border-[rgba(118,93,71,0.12)] bg-white/80 px-3 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
      disabled={disabled || busy}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span>{enabled ? (locale === "en" ? "Bot active" : "Bot activo") : (locale === "en" ? "Human review" : "Revision humana")}</span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-[var(--success)]" : "bg-[rgba(118,93,71,0.22)]"}`}>
        {busy ? <Loader2 className="absolute left-1 top-1 animate-spin text-white" size={16} /> : null}
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgba(49,41,35,0.18)] transition ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function OpenConversationDetailPanel({
  actionKey,
  locale,
  onClose,
  onToggleAutomation,
  order,
  transcript,
  transcriptError,
  transcriptLoading,
}: {
  actionKey: string;
  locale: "en" | "es";
  onClose: () => void;
  onToggleAutomation: (enabled: boolean) => void;
  order: OpenOrderSummary;
  transcript: ConversationTranscript | null;
  transcriptError: string;
  transcriptLoading: boolean;
}) {
  const automation = order.conversationAutomation;
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [order.conversationId, transcript?.messages.length]);

  return (
    <div className="flex max-h-[94dvh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[rgba(118,93,71,0.12)] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">{locale === "en" ? "Open conversation" : "Conversacion abierta"}</p>
          <h3 className="app-display mt-1 truncate text-3xl text-[var(--text-strong)]">{order.customerName || order.customerPhone || (locale === "en" ? "Customer" : "Cliente")}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-[var(--text-soft)]">
            <span className="rounded-full bg-[rgba(79,122,97,0.1)] px-2.5 py-1 text-[var(--success)]">
              {order.conversationState ? getConversationStateLabel(order.conversationState, locale) : (locale === "en" ? "In progress" : "En curso")}
            </span>
            {order.draftOrderId ? (
              <span className="rounded-full bg-[rgba(118,93,71,0.08)] px-2.5 py-1">
                {locale === "en" ? "Draft" : "Borrador"} #{getOrderReceiptCode(order.draftOrderId)}
              </span>
            ) : null}
          </div>
        </div>
        <button aria-label={locale === "en" ? "Close conversation details" : "Cerrar detalle de conversacion"} className="grid h-10 w-10 place-items-center rounded-full border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)]" onClick={onClose} type="button"><X size={18} /></button>
      </div>

      <div className="conversation-transcript app-scrollbar min-h-[320px] flex-1 overflow-y-auto px-3 py-4 sm:min-h-[430px] sm:px-5">
        {transcriptLoading ? (
          <div className="grid min-h-[300px] place-items-center text-center">
            <div>
              <Loader2 className="mx-auto animate-spin text-[var(--success)]" size={24} />
              <p className="mt-3 text-xs font-semibold text-[var(--text-soft)]">
                {locale === "en" ? "Loading conversation..." : "Cargando conversacion..."}
              </p>
            </div>
          </div>
        ) : transcript?.messages.length ? (
          <div className="space-y-2.5">
            {transcript.hasMore ? (
              <div className="mx-auto w-fit rounded-full bg-white/80 px-3 py-1.5 text-[10px] font-semibold text-[var(--text-soft)] shadow-sm">
                {locale === "en" ? "Showing the most recent messages" : "Mostrando los mensajes mas recientes"}
              </div>
            ) : null}
            {transcript.messages.map((message, index) => {
              const previous = transcript.messages[index - 1];
              const showDate = !previous || getTranscriptDateKey(previous.createdAt) !== getTranscriptDateKey(message.createdAt);
              return (
                <div key={message.id}>
                  {showDate ? (
                    <div className="mx-auto mb-3 mt-2 w-fit rounded-full bg-[rgba(255,255,255,0.82)] px-3 py-1 text-[10px] font-bold text-[var(--text-soft)] shadow-sm">
                      {formatTranscriptDate(message.createdAt, locale)}
                    </div>
                  ) : null}
                  <ConversationMessageBubble locale={locale} message={message} />
                </div>
              );
            })}
            <div ref={transcriptEndRef} />
          </div>
        ) : transcriptError ? (
          <div className="grid min-h-[300px] place-items-center px-4 text-center">
            <div>
              <AlertCircle className="mx-auto text-[#914d47]" size={26} />
              <p className="mt-3 max-w-sm text-sm font-semibold text-[var(--text-strong)]">{transcriptError}</p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[300px] place-items-center px-4 text-center">
            <div>
              <MessageSquareWarning className="mx-auto text-[var(--text-faint)]" size={28} />
              <p className="mt-3 text-sm font-semibold text-[var(--text-strong)]">
                {locale === "en" ? "No messages have been recorded yet." : "Todavia no hay mensajes registrados."}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-[rgba(118,93,71,0.12)] bg-[var(--panel-strong)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="min-w-0 truncate text-xs text-[var(--text-soft)]">
          <strong className="text-[var(--text-strong)]">{locale === "en" ? "Current order:" : "Pedido actual:"}</strong>{" "}
          {getOrderItemsSummary(order.items ?? [], locale)}
        </p>
        {automation ? <AutomationSwitch busy={actionKey === `automation:${automation.conversationId}`} className="shrink-0" disabled={automation.terminal} enabled={automation.enabled} locale={locale} onToggle={() => onToggleAutomation(!automation.enabled)} /> : null}
      </div>
    </div>
  );
}

function ConversationMessageBubble({
  locale,
  message,
}: {
  locale: "en" | "es";
  message: ConversationTranscriptMessage;
}) {
  const inbound = message.direction === "inbound";
  const attachment = getTranscriptAttachment(message.messageType, locale);

  return (
    <div className={`flex ${inbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-[18px] px-3.5 py-2.5 shadow-[0_2px_8px_rgba(49,41,35,0.08)] sm:max-w-[78%] ${
        inbound
          ? "rounded-br-[5px] bg-[#d9fdd3] text-[#17251d]"
          : "rounded-bl-[5px] bg-white text-[var(--text-strong)]"
      }`}>
        <div className={`mb-1 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.12em] ${
          inbound ? "justify-end text-[#47785a]" : "text-[var(--warning)]"
        }`}>
          {inbound ? <UserRound size={11} /> : <Bot size={11} />}
          {inbound ? (locale === "en" ? "Customer" : "Cliente") : "ParaHoy"}
        </div>
        {attachment ? (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-black/[0.045] px-2.5 py-2 text-xs font-semibold">
            <attachment.Icon size={15} />
            <span>{attachment.label}</span>
          </div>
        ) : null}
        {message.text?.trim() ? (
          <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.55]">{message.text}</p>
        ) : attachment ? null : (
          <p className="text-[13px] italic text-[var(--text-soft)]">
            {locale === "en" ? "Message without visible text" : "Mensaje sin texto visible"}
          </p>
        )}
        <div className={`mt-1.5 flex items-center justify-end gap-1 text-[9px] font-medium ${
          inbound ? "text-[#62806b]" : "text-[var(--text-faint)]"
        }`}>
          <span>{formatTranscriptTime(message.createdAt, locale)}</span>
          {!inbound ? <CheckCheck className={message.status === "sent" ? "text-[#4f86a6]" : ""} size={13} /> : null}
        </div>
      </div>
    </div>
  );
}

function getTranscriptAttachment(messageType: string, locale: "en" | "es"): { Icon: LucideIcon; label: string } | null {
  const normalized = messageType.toLowerCase();
  if (normalized === "text") return null;
  if (normalized === "image" || normalized === "sticker") {
    return { Icon: ImageIcon, label: normalized === "sticker" ? "Sticker" : (locale === "en" ? "Image" : "Imagen") };
  }
  if (normalized === "audio" || normalized === "voice") {
    return { Icon: Mic, label: locale === "en" ? "Voice message" : "Mensaje de voz" };
  }
  if (normalized === "location") {
    return { Icon: MapPin, label: locale === "en" ? "Shared location" : "Ubicacion compartida" };
  }
  if (normalized === "video") {
    return { Icon: Video, label: "Video" };
  }

  return { Icon: FileText, label: locale === "en" ? "Attachment" : "Archivo adjunto" };
}

function getTranscriptDateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatTranscriptDate(value: string, locale: "en" | "es"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatTranscriptTime(value: string, locale: "en" | "es"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CO", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function CancelOrderModal({
  locale,
  onClose,
  onConfirm,
  order,
  submitting,
}: {
  locale: "en" | "es";
  onClose: () => void;
  onConfirm: () => Promise<void>;
  order: OrderDetail;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-[rgba(14,11,9,0.55)] p-0 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div className="app-panel reveal-up w-full overflow-hidden rounded-t-[28px] sm:max-w-lg sm:rounded-[30px]">
        <div className="flex items-start justify-between border-b border-[rgba(118,93,71,0.12)] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
              {locale === "en" ? "Cancel order" : "Cancelar pedido"}
            </p>
            <h3 className="app-display mt-2 text-[2.2rem] leading-none text-[var(--text-strong)]">
              {locale === "en" ? "Confirm cancellation" : "Confirmar cancelacion"}
            </h3>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-2xl border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] transition hover:bg-white"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <div className="rounded-[22px] border border-[rgba(180,94,84,0.18)] bg-[rgba(180,94,84,0.08)] p-4 text-sm leading-6 text-[#914d47]">
            {locale === "en"
              ? "This will cancel the order and reset the AI agent so the conversation can start a new order flow."
              : "Esto cancelara el pedido y reiniciara el agente IA para que la conversacion pueda iniciar un nuevo flujo de pedido."}
          </div>
          <div className="mt-4 rounded-[20px] bg-[var(--surface-base)] p-4">
            <p className="text-sm font-semibold text-[var(--text-strong)]">
              {order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}
            </p>
            <p className="mt-1 text-xs text-[var(--text-soft)]">
              {locale === "en" ? "Order" : "Pedido"} #{getOrderReceiptCode(order.id)} - {formatPrice(order.total, locale)}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[rgba(118,93,71,0.12)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(248,241,232,0.6)]"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            {locale === "en" ? "Keep order" : "Mantener pedido"}
          </button>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#914d47] px-5 text-sm font-semibold text-white transition hover:bg-[#7f403b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            onClick={() => void onConfirm()}
            type="button"
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : <X size={16} />}
            {submitting ? (locale === "en" ? "Cancelling..." : "Cancelando...") : (locale === "en" ? "Yes, cancel" : "Si, cancelar")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutOfStockModal({
  menuItems,
  onClose,
  onSubmit,
  order,
  submitting,
}: {
  menuItems: MenuItem[];
  onClose: () => void;
  onSubmit: (values: RejectModalSubmitValue) => Promise<void>;
  order: OrderDetail;
  submitting: boolean;
}) {
  const locale = activeOrdersLocale;
  const [selectedOrderItemId, setSelectedOrderItemId] = useState(order.items.find((item) => item.id)?.id ?? "");
  const [markMenuItemUnavailable, setMarkMenuItemUnavailable] = useState(true);
  const [selectedReplacementIds, setSelectedReplacementIds] = useState<string[]>([]);
  const [replacementScope, setReplacementScope] = useState<ReplacementScope>("same");
  const [note, setNote] = useState("");

  const selectedOrderItem = useMemo(
    () => order.items.find((item) => item.id === selectedOrderItemId) ?? null,
    [order.items, selectedOrderItemId],
  );

  const replacementPools = useMemo(
    () => buildReplacementPools(menuItems, selectedOrderItem),
    [menuItems, selectedOrderItem],
  );

  const replacementSuggestions = replacementScope === "same" ? replacementPools.same : replacementPools.other;

  useEffect(() => {
    setReplacementScope("same");
    setSelectedReplacementIds(replacementPools.same.slice(0, 3).map((item) => item.id));
  }, [replacementPools.same]);

  function selectReplacementScope(scope: ReplacementScope) {
    setReplacementScope(scope);
    setSelectedReplacementIds(replacementPools[scope].slice(0, 3).map((item) => item.id));
  }

  const categoryLabel = (selectedOrderItem
    ? resolveOrderItemCategory(selectedOrderItem, menuItems)
    : undefined)
    || (locale === "en" ? "uncategorized" : "sin categoria");

  const canSubmit = Boolean(selectedOrderItemId) && selectedReplacementIds.length > 0;

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-[rgba(14,11,9,0.55)] p-0 backdrop-blur-sm sm:place-items-center sm:p-4">
      <div className="app-panel reveal-up flex max-h-[96vh] w-full flex-col overflow-hidden rounded-t-[28px] sm:max-h-[92vh] sm:max-w-3xl sm:rounded-[30px]">
        <div className="flex items-start justify-between border-b border-[rgba(118,93,71,0.12)] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{locale === "en" ? "Out of stock" : "Agotados"}</p>
            <h3 className="app-display mt-2 text-[2.2rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "Report out of stock" : "Reportar agotado"}</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">
              {locale === "en"
                ? "The customer will receive active alternatives. We prioritize the same category, and you can open other categories if needed."
                : "El cliente recibira alternativas activas. Priorizamos la misma categoria y puedes abrir otras categorias si hace falta."}
            </p>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-2xl border border-[rgba(118,93,71,0.12)] text-[var(--text-soft)] transition hover:bg-white"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="app-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <section className="rounded-[24px] bg-[rgba(248,241,232,0.58)] p-4">
            <StepLabel step={1} title={locale === "en" ? "Out-of-stock item" : "Item agotado"} />
            <div className="mt-4 space-y-2">
              {order.items.map((item, index) => {
                const itemId = item.id ?? "";
                const active = itemId === selectedOrderItemId;
                return (
                  <button
                    className={`flex w-full flex-col gap-2 rounded-[20px] border px-4 py-3 text-left transition sm:flex-row sm:items-center sm:justify-between ${
                      active
                        ? "border-[rgba(197,123,87,0.22)] bg-[rgba(197,123,87,0.08)] text-[var(--text-strong)]"
                        : "border-[rgba(118,93,71,0.1)] bg-white/80 text-[var(--text-strong)] hover:bg-white"
                    }`}
                    disabled={!item.id}
                    key={getOrderItemKey(item, index)}
                    onClick={() => setSelectedOrderItemId(itemId)}
                    type="button"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.quantity} x {item.name}</p>
                      <p className="mt-1 text-xs text-[var(--text-faint)]">
                        {resolveOrderItemCategory(item, menuItems) || (locale === "en" ? "uncategorized" : "sin categoria")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">{formatPrice(item.lineTotal, locale)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[24px] bg-[rgba(248,241,232,0.58)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <StepLabel step={2} title={locale === "en" ? "Alternatives for the customer" : "Alternativas para el cliente"} />
                <p className="mt-3 text-sm leading-6 text-[var(--text-soft)]">{locale === "en" ? "Category used" : "Categoria usada"}: {categoryLabel}</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-soft)]">
                <input
                  checked={markMenuItemUnavailable}
                  className="h-4 w-4 rounded border-[rgba(118,93,71,0.32)]"
                  onChange={(event) => setMarkMenuItemUnavailable(event.target.checked)}
                  type="checkbox"
                />
                {locale === "en" ? "Mark as unavailable in menu" : "Marcar no disponible en menu"}
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 rounded-[20px] bg-[var(--surface-base)] p-2 sm:grid-cols-2">
              <ReplacementScopeTab
                active={replacementScope === "same"}
                count={replacementPools.same.length}
                label={locale === "en" ? "Same category" : "Misma categoria"}
                onClick={() => selectReplacementScope("same")}
              />
              <ReplacementScopeTab
                active={replacementScope === "other"}
                count={replacementPools.other.length}
                label={locale === "en" ? "Other categories" : "Otras categorias"}
                onClick={() => selectReplacementScope("other")}
              />
            </div>

            {replacementSuggestions.length === 0 ? (
              <div className="mt-4 rounded-[20px] border border-[rgba(197,123,87,0.18)] bg-[rgba(197,123,87,0.08)] px-4 py-3 text-sm leading-6 text-[var(--warning)]">
                {replacementScope === "same"
                  ? (locale === "en"
                    ? "There are no active products in this category. Open other categories to suggest a different menu option."
                    : "No hay productos activos en esta categoria. Abre otras categorias para recomendar otra opcion del menu.")
                  : (locale === "en"
                    ? "There are no other active products available to suggest."
                    : "No hay otros productos activos disponibles para recomendar.")}
              </div>
            ) : (
              <div className="app-scrollbar mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                {replacementSuggestions.map((item) => {
                  const checked = selectedReplacementIds.includes(item.id);
                  return (
                    <label
                      className="flex flex-col gap-3 rounded-[20px] border border-[rgba(118,93,71,0.1)] bg-white/80 px-4 py-3 text-sm text-[var(--text-strong)] sm:flex-row sm:items-start sm:justify-between"
                      key={item.id}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          checked={checked}
                          className="mt-0.5 h-4 w-4 rounded border-[rgba(118,93,71,0.32)]"
                          onChange={(event) => {
                            setSelectedReplacementIds((current) => (
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((entry) => entry !== item.id)
                            ));
                          }}
                          type="checkbox"
                        />
                        <div>
                          <p className="font-semibold">{getMenuItemDisplayName(item)}</p>
                          <p className="mt-1 text-xs text-[var(--text-faint)]">{item.product?.category || categoryLabel}</p>
                        </div>
                      </div>
                      <span className="shrink-0 font-semibold">{formatPrice(resolveMenuItemPrice(item), locale)}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {replacementSuggestions.length > 0 && selectedReplacementIds.length === 0 ? (
              <p className="mt-3 text-xs font-semibold text-[var(--warning)]">
                {locale === "en" ? "Select at least one alternative before sending." : "Selecciona al menos una alternativa antes de enviar."}
              </p>
            ) : null}
          </section>

          <section className="rounded-[24px] bg-[rgba(248,241,232,0.58)] p-4">
            <StepLabel step={3} title={locale === "en" ? "Internal note" : "Nota interna"} />
            <textarea
              className="mt-4 min-h-28 w-full rounded-[20px] border border-[rgba(118,93,71,0.12)] bg-white/80 px-4 py-3 text-sm text-[var(--text-strong)] outline-none transition focus:border-[rgba(118,93,71,0.24)] focus:bg-white focus:ring-4 focus:ring-[rgba(197,123,87,0.08)]"
              onChange={(event) => setNote(event.target.value)}
              placeholder={locale === "en" ? "Ex. No Coca-Cola, offer other cold drinks." : "Ej. Sin Coca-Cola, se ofrecen otras bebidas frias."}
              value={note}
            />
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[rgba(118,93,71,0.12)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(118,93,71,0.12)] px-4 text-sm font-semibold text-[var(--text-soft)] transition hover:bg-[rgba(248,241,232,0.6)]"
            onClick={onClose}
            type="button"
          >
            {locale === "en" ? "Cancel" : "Cancelar"}
          </button>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--text-strong)] px-5 text-sm font-semibold text-white transition hover:bg-[#312923] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSubmit || submitting}
            onClick={() => {
              if (!canSubmit) return;
              void onSubmit({
                orderItemId: selectedOrderItemId,
                markMenuItemUnavailable,
                replacementMenuItemIds: selectedReplacementIds,
                note,
              });
            }}
            type="button"
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : <MessageSquareWarning size={16} />}
            {submitting ? (locale === "en" ? "Sending..." : "Enviando...") : (locale === "en" ? "Send by WhatsApp" : "Enviar por WhatsApp")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliveryCoverageDetail({
  locale,
  order,
}: {
  locale: "en" | "es";
  order: OrderDetail;
}) {
  const legacyCoordinates = parseSharedLocationCoordinates(order.deliveryAddress);
  const customerLatitude = order.customerLatitude ?? legacyCoordinates?.latitude;
  const customerLongitude = order.customerLongitude ?? legacyCoordinates?.longitude;
  const hasExactLocation = customerLatitude !== undefined && customerLongitude !== undefined;
  const restaurantLocation = order.restaurantLocation;
  const canShowMap = hasExactLocation && restaurantLocation !== undefined;
  const addressText = getDisplayDeliveryAddress(order);
  const requiresLocation = order.coverageValidationMethod === "written_address_reference"
    && !hasExactLocation;
  const status = requiresLocation
    ? (locale === "en" ? "Location required" : "Requiere ubicacion")
    : order.isInsideDeliveryCoverage === true
      ? (locale === "en" ? "Inside coverage" : "Dentro de cobertura")
      : order.isInsideDeliveryCoverage === false
        ? (locale === "en" ? "Outside coverage" : "Fuera de cobertura")
        : (locale === "en" ? "Not validated" : "No validado");
  const statusClass = order.isInsideDeliveryCoverage === true
    ? "bg-[rgba(79,122,97,0.12)] text-[var(--success)]"
    : "bg-[rgba(197,123,87,0.12)] text-[var(--warning)]";
  const isApproximate = order.coverageValidationMethod === "geocoded_address" && order.coverageConfidence === "low";

  return (
    <div className="mt-5 border-t border-[rgba(118,93,71,0.12)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{locale === "en" ? "Delivery location" : "Ubicacion de entrega"}</h4>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{status}</span>
      </div>
      {addressText ? <p className="mt-4 text-sm leading-6 text-[var(--text-soft)]"><span className="font-semibold text-[var(--text-strong)]">{locale === "en" ? "Address:" : "Direccion:"}</span> {addressText}</p> : null}
      {order.deliveryAddressDetails ? <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]"><span className="font-semibold text-[var(--text-strong)]">{locale === "en" ? "Delivery details:" : "Indicaciones:"}</span> {order.deliveryAddressDetails}</p> : null}
      {canShowMap ? (
        <div className="mt-4">
          <Suspense fallback={<div className="grid h-[220px] place-items-center rounded-[18px] bg-[var(--surface-base)]"><Loader2 className="animate-spin text-[var(--text-soft)]" size={20} /></div>}>
            <DeliveryCoverageMap
              compact
              customerLatitude={customerLatitude}
              customerLongitude={customerLongitude}
              draggableMarker={false}
              latitude={restaurantLocation.latitude}
              longitude={restaurantLocation.longitude}
              onLocationChange={() => undefined}
              radiusKm={restaurantLocation.deliveryRadiusKm ?? 0.1}
            />
          </Suspense>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-[var(--text-soft)]">
            <span>{locale === "en" ? "Green: restaurant" : "Verde: restaurante"}</span>
            <span aria-hidden="true">·</span>
            <span>{locale === "en" ? "Orange: customer" : "Naranja: cliente"}</span>
            {isApproximate ? <span className="rounded-full bg-[rgba(197,123,87,0.12)] px-2 py-1 font-semibold text-[var(--warning)]">{locale === "en" ? "Approximate location" : "Ubicacion aproximada"}</span> : null}
          </div>
        </div>
      ) : null}
      {requiresLocation ? (
        <div className="mt-4 flex items-start gap-2 rounded-[14px] bg-[rgba(197,123,87,0.1)] px-3 py-3 text-sm leading-6 text-[var(--warning)]">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          {locale === "en" ? "The customer wrote an address, but coverage has not been validated with an exact location yet." : "El cliente escribio una direccion, pero todavia no se valido cobertura con ubicacion exacta."}
        </div>
      ) : null}
      {!canShowMap && !requiresLocation ? <p className="mt-3 text-xs leading-5 text-[var(--text-soft)]">{locale === "en" ? "The map is unavailable because this order does not have both locations." : "El mapa no esta disponible porque esta orden no tiene ambas ubicaciones."}</p> : null}
    </div>
  );
}

function getDisplayDeliveryAddress(order: Pick<OrderDetail, "customerAddressText" | "deliveryAddress" | "resolvedDeliveryAddress">): string | undefined {
  const writtenAddress = order.customerAddressText?.trim() || order.deliveryAddress?.trim();
  if (writtenAddress && !parseSharedLocationCoordinates(writtenAddress)) return writtenAddress;
  return order.resolvedDeliveryAddress?.trim() || undefined;
}

function parseSharedLocationCoordinates(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^\s*(?:ubicaci[oó]n\s+compartida\s*:\s*)?(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/i);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

function OrderItemCard({ item, menuItems }: { item: OrderLineItem; menuItems: MenuItem[] }) {
  const locale = activeOrdersLocale;
  return (
    <article className="rounded-[22px] border border-[rgba(118,93,71,0.1)] bg-[rgba(255,251,246,0.86)] p-4">
      <div className="flex items-start justify-between gap-3">
        <OrderItemVisual item={item} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-strong)]">
            {item.quantity} x {item.name}
          </p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            {locale === "en" ? "Category" : "Categoria"}: {item.categorySnapshot || resolveCategoryFromMenuItem(menuItems, item.menuItemId) || (locale === "en" ? "uncategorized" : "sin categoria")}
          </p>
          {item.notes && <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">{locale === "en" ? "Note" : "Nota"}: {item.notes}</p>}
        </div>
        <p className="shrink-0 text-sm font-semibold text-[var(--text-strong)]">{formatPrice(item.lineTotal, locale)}</p>
      </div>
    </article>
  );
}

function OrderItemVisual({ item }: { item: OrderLineItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const emoji = item.productEmoji?.trim() || "🍽️";

  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--surface-muted)] text-xl" role="img" aria-label={item.name}>
      {item.productImageUrl && !imageFailed ? (
        <img alt="" className="h-full w-full object-cover" onError={() => setImageFailed(true)} src={item.productImageUrl} />
      ) : emoji}
    </span>
  );
}

function StepLabel({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--text-strong)] text-xs font-semibold text-white">{step}</span>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{title}</p>
    </div>
  );
}

function ReplacementScopeTab({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-[16px] px-3 py-2 text-left text-sm font-semibold transition ${
        active
          ? "border border-[rgba(197,123,87,0.22)] bg-[rgba(197,123,87,0.1)] text-[var(--text-strong)]"
          : "border border-transparent text-[var(--text-soft)] hover:bg-[var(--surface-muted)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span className="ml-2 rounded-full bg-[rgba(118,93,71,0.12)] px-2 py-0.5 text-xs">{count}</span>
    </button>
  );
}

function OrderBucketSection({
  emptyCopy,
  onSelectOrder,
  orders,
  selectedOrderId,
  title,
  tone,
}: {
  emptyCopy: string;
  onSelectOrder: (orderId: string) => void;
  orders: OrderSummary[];
  selectedOrderId: string;
  title: string;
  tone: PendingLane;
}) {
  const locale = activeOrdersLocale;
  const titlePalette = tone === "restaurant"
    ? "bg-[rgba(137,164,196,0.12)] text-[#4f6884]"
    : "bg-[rgba(197,123,87,0.16)] text-[var(--warning)]";

  return (
    <section className={`rounded-[22px] border px-3 py-3 ${
      tone === "restaurant"
        ? "border-[rgba(137,164,196,0.18)] bg-[rgba(220,231,244,0.54)]"
        : "border-[rgba(197,123,87,0.16)] bg-[rgba(237,228,220,0.72)]"
    }`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${titlePalette}`}>{title}</span>
        <span className="rounded-full bg-[rgba(118,93,71,0.12)] px-2 py-0.5 text-xs font-semibold text-[var(--text-soft)]">
          {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <p className="rounded-[16px] bg-[var(--surface-base)] px-3 py-4 text-sm text-[var(--text-soft)]">{emptyCopy}</p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const active = order.id === selectedOrderId;
            return (
              <button
                className={`w-full rounded-[18px] border px-3 py-3 text-left transition ${
                  active
                    ? "border-[rgba(137,164,196,0.34)] bg-[var(--surface-strong)]"
                    : "border-[rgba(118,93,71,0.1)] bg-[var(--surface-base)] hover:bg-[var(--surface-muted)]"
                }`}
                key={order.id}
                onClick={() => onSelectOrder(order.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OrderStatusBadge locale={locale} status={order.status} />
                      {order.customerNotificationStatus === "failed" ? <NotificationBadge locale={locale} status="failed" /> : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-[var(--text-strong)]">
                      {order.customerName?.trim() || order.customerPhone || (locale === "en" ? "Unnamed customer" : "Cliente sin nombre")}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-faint)]">{formatDateTime(order.createdAt, locale)}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      Cuenta #{getOrderReceiptCode(order.id)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-[var(--text-strong)]">{formatPrice(order.total, locale)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SummaryRow({ emphasis = false, label, value }: { emphasis?: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className={`min-w-0 ${emphasis ? "text-sm font-semibold text-[var(--text-strong)]" : "text-sm text-[var(--text-soft)]"}`}>{label}</span>
      <span className={`min-w-0 break-words text-right ${emphasis ? "text-sm font-semibold text-[var(--text-strong)]" : "text-sm font-medium text-[var(--text-strong)]"}`}>{value}</span>
    </div>
  );
}

function ActionButton({
  active = false,
  className,
  icon: Icon,
  label,
  onClick,
  variant,
}: {
  active?: boolean;
  className?: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant: "primary" | "secondary" | "warning";
}) {
  const palette = {
    primary: "bg-[var(--text-strong)] text-white hover:bg-[#312923]",
    secondary: "border border-[rgba(118,93,71,0.12)] bg-[var(--surface-base)] text-[var(--text-strong)] hover:bg-[var(--surface-muted)]",
    warning: "border border-[rgba(197,123,87,0.18)] bg-[rgba(197,123,87,0.08)] text-[var(--warning)] hover:bg-[rgba(197,123,87,0.12)]",
  }[variant];

  return (
    <button
      className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition sm:w-auto ${palette} ${className ?? ""}`}
      disabled={active}
      onClick={onClick}
      type="button"
    >
      {active ? <Loader2 className="animate-spin" size={16} /> : <Icon size={16} />}
      {label}
    </button>
  );
}

function OrderProgressRail({
  fulfillmentType,
  locale,
  status,
}: {
  fulfillmentType: OrderSummary["fulfillmentType"];
  locale: "en" | "es";
  status: OrderStatus;
}) {
  const steps = [
    { id: "accepted", label: locale === "en" ? "Accepted" : "Aceptado" },
    { id: "preparing", label: locale === "en" ? "Preparing" : "Preparando" },
    { id: "on_the_way", label: fulfillmentType === "delivery" ? (locale === "en" ? "On the way" : "En camino") : (locale === "en" ? "Ready" : "Listo") },
  ] as const;
  const currentIndex = getConfirmedStageIndex(status);

  return (
    <div className="mt-4 rounded-[22px] border border-[rgba(79,122,97,0.18)] bg-[rgba(226,238,231,0.72)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-extrabold text-[var(--success)]">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--success)] text-white">
            <Check size={16} />
          </span>
          {getConfirmedProgressLabel({ status, fulfillmentType }, locale)}
        </div>
        <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--success)]">
          {locale === "en" ? "Confirmed status" : "Estado confirmado"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => {
          const reached = index <= currentIndex;
          return (
            <div
              className={`rounded-2xl border px-3 py-2 text-xs font-bold ${
                reached
                  ? "border-[rgba(79,122,97,0.2)] bg-white text-[var(--success)]"
                  : "border-[rgba(118,93,71,0.08)] bg-[rgba(255,251,246,0.5)] text-[var(--text-faint)]"
              }`}
              key={step.id}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(79,122,97,0.12)] text-[11px]">
                {index + 1}
              </span>
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderStatusBadge({ locale, status }: { locale: "en" | "es"; status: OrderStatus }) {
  const palette = {
    new: "bg-[rgba(118,93,71,0.08)] text-[var(--text-soft)]",
    pending_restaurant_confirmation: "bg-[rgba(193,157,98,0.14)] text-[#8a6a3f]",
    needs_customer_replacement: "bg-[rgba(197,123,87,0.12)] text-[var(--warning)]",
    payment_pending_review: "bg-[rgba(97,135,158,0.12)] text-[#46697c]",
    accepted: "bg-[var(--success)] text-white shadow-[0_6px_18px_rgba(79,122,97,0.22)]",
    preparing: "bg-[rgba(132,111,164,0.12)] text-[#65567f]",
    on_the_way: "bg-[rgba(90,111,170,0.12)] text-[#4c5f8f]",
    delivered: "bg-[rgba(118,93,71,0.12)] text-[var(--text-soft)]",
    cancelled: "bg-[rgba(180,94,84,0.12)] text-[#914d47]",
  }[status];

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${palette}`}>
      {getOrderStatusLabel(status, locale)}
    </span>
  );
}

function NotificationBadge({ locale, status }: { locale: "en" | "es"; status: "failed" | "sent" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
        status === "failed"
          ? "bg-[rgba(197,123,87,0.12)] text-[var(--warning)]"
          : "bg-[rgba(79,122,97,0.12)] text-[var(--success)]"
      }`}
    >
      {status === "failed"
        ? (locale === "en" ? "WhatsApp failed" : "WhatsApp fallido")
        : (locale === "en" ? "WhatsApp sent" : "WhatsApp enviado")}
    </span>
  );
}

function InfoChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex w-full items-center gap-2 rounded-full bg-[var(--surface-base)] px-3 py-2 text-xs font-semibold text-[var(--text-soft)] ring-1 ring-[rgba(118,93,71,0.12)] sm:w-auto">
      <Icon size={14} />
      {label}
    </span>
  );
}

function OrderSummaryIconChips({ locale, order }: { locale: "en" | "es"; order: Pick<OrderSummary, "fulfillmentType" | "paymentMethod" | "scheduledFor" | "serviceTiming"> }) {
  const fulfillment = order.fulfillmentType === "delivery"
    ? (locale === "en" ? "Delivery" : "Domicilio")
    : (locale === "en" ? "Pickup" : "Recoge en local");
  const payment = order.paymentMethod === "transfer"
    ? (locale === "en" ? "Bank transfer" : "Transferencia")
    : (locale === "en" ? "Cash" : "Efectivo");
  const timing = order.serviceTiming === "scheduled" && order.scheduledFor
    ? formatDateTime(order.scheduledFor, locale)
    : (locale === "en" ? "As soon as possible" : "Lo antes posible");
  const fulfillmentIcon = order.fulfillmentType === "delivery" ? Truck : Store;

  return (
    <div className="mt-3 flex items-center gap-2 text-[var(--text-soft)]">
      <SummaryIconChip icon={fulfillmentIcon} label={fulfillment} />
      <SummaryIconChip icon={ClipboardList} label={payment} />
      <SummaryIconChip icon={Clock} label={timing} />
    </div>
  );
}

function SummaryIconChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span aria-label={label} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(118,93,71,0.08)]" title={label}>
      <Icon aria-hidden="true" size={14} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function LoadingBlock({ copy }: { copy: string }) {
  return (
    <div className="grid min-h-[380px] place-items-center px-5 py-10 sm:min-h-[620px]">
      <div className="inline-flex items-center gap-3 rounded-full bg-[rgba(248,241,232,0.72)] px-5 py-3 text-sm font-semibold text-[var(--text-soft)]">
        <Loader2 className="animate-spin" size={17} />
        {copy}
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="grid min-h-[380px] place-items-center px-5 py-10 sm:min-h-[620px]">
      <div className="max-w-md rounded-[24px] border border-[rgba(180,94,84,0.18)] bg-[rgba(190,110,95,0.08)] px-5 py-5 text-sm leading-7 text-[#8c4e47]">
        {message}
      </div>
    </div>
  );
}

function EmptyListState({ filter, locale }: { filter: OrdersFilter; locale: "en" | "es" }) {
  const copy = {
    open: locale === "en" ? "There are no customer conversations in progress right now." : "No hay conversaciones activas de clientes en este momento.",
    pending: locale === "en" ? "There are no pending orders right now." : "No hay pedidos pendientes en este momento.",
    confirmed: locale === "en" ? "There are no confirmed orders in progress." : "No hay pedidos confirmados en curso.",
    closed: locale === "en" ? "There are no closed orders for this filter." : "No hay pedidos cerrados para este filtro.",
  }[filter];

  return (
    <div className="grid min-h-[380px] place-items-center px-6 py-10 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[rgba(118,93,71,0.08)] text-[var(--text-faint)]">
          <ClipboardList size={24} />
        </div>
        <p className="app-display mt-5 text-[2rem] leading-none text-[var(--text-strong)]">{locale === "en" ? "Empty queue" : "Bandeja vacia"}</p>
        <p className="mt-3 max-w-xs text-sm leading-7 text-[var(--text-soft)]">{copy}</p>
      </div>
    </div>
  );
}

function matchesClosedRange(order: OrderSummary, range: ClosedRange, customDate: string) {
  const closedAt = new Date(order.updatedAt || order.createdAt);
  if (Number.isNaN(closedAt.getTime())) return false;

  if (range === "custom") {
    return getLocalDateKey(closedAt) === customDate;
  }

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === "today") {
    return closedAt >= start;
  }

  const days = range === "7d" ? 7 : 30;
  start.setDate(start.getDate() - (days - 1));
  return closedAt >= start;
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openWhatsAppConversation(whatsappUrl?: string) {
  if (!whatsappUrl) return;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

function getConversationStateLabel(state: string, locale: "en" | "es") {
  const labels: Record<string, string> = {
    browsing: locale === "en" ? "Browsing" : "Explorando",
    collecting_order: locale === "en" ? "Taking order" : "Tomando pedido",
    collecting_address: locale === "en" ? "Taking address" : "Tomando direccion",
    collecting_payment: locale === "en" ? "Payment" : "Pago",
    waiting_customer: locale === "en" ? "Waiting customer" : "Esperando cliente",
    manual_intervention: locale === "en" ? "Manual review" : "Revision manual",
    awaiting_restaurant_confirmation: locale === "en" ? "Restaurant review" : "En revisión del restaurante",
    awaiting_replacement_selection: locale === "en" ? "Choosing replacement" : "Eligiendo alternativa",
    awaiting_product_configuration: locale === "en" ? "Choosing product options" : "Eligiendo opciones",
    awaiting_more_items: locale === "en" ? "Adding products" : "Agregando productos",
    awaiting_fulfillment_type: locale === "en" ? "Choosing delivery" : "Definiendo entrega",
    awaiting_address: locale === "en" ? "Confirming address" : "Confirmando dirección",
    awaiting_payment_method: locale === "en" ? "Choosing payment" : "Eligiendo pago",
    awaiting_confirmation: locale === "en" ? "Confirming order" : "Confirmando pedido",
    awaiting_transfer_proof: locale === "en" ? "Awaiting proof" : "Esperando comprobante",
    completed: locale === "en" ? "Order completed" : "Pedido finalizado",
  };
  return labels[state] ?? (locale === "en" ? "Conversation in progress" : "Conversación en curso");
}

function matchesFilter(order: OrderSummary, filter: OrdersFilter) {
  if (filter === "open") {
    return false;
  }

  if (filter === "pending") {
    return pendingStatuses.includes(order.status);
  }

  if (filter === "confirmed") {
    return confirmedStatuses.includes(order.status);
  }

  return closedStatuses.includes(order.status);
}

function resolveFilterForOrderStatus(status: OrderStatus): OrdersFilter {
  if (pendingStatuses.includes(status)) {
    return "pending";
  }

  if (confirmedStatuses.includes(status)) {
    return "confirmed";
  }

  return "closed";
}

function getFilterLabel(filter: OrdersFilter, locale: "en" | "es") {
  return getFilterTabs(locale).find((tab) => tab.id === filter)?.label ?? (locale === "en" ? "Orders" : "Pedidos");
}

function getFilterDescription(filter: OrdersFilter, locale: "en" | "es") {
  return getFilterTabs(locale).find((tab) => tab.id === filter)?.description ?? "";
}

function getFilterTabClasses(filter: OrdersFilter, active: boolean) {
  if (!active) {
    return "border-transparent text-[var(--text-soft)] hover:bg-[var(--surface-muted)]";
  }

  return {
    open: "border-[rgba(137,164,196,0.22)] bg-[rgba(137,164,196,0.12)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
    pending: "border-[rgba(137,164,196,0.22)] bg-[var(--surface-pending)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
    confirmed: "border-[rgba(79,122,97,0.18)] bg-[var(--surface-confirmed)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
    closed: "border-[rgba(118,93,71,0.16)] bg-[var(--surface-closed)] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
  }[filter];
}

function getFilterCountClasses(filter: OrdersFilter, active: boolean) {
  if (!active) {
    return "bg-[rgba(118,93,71,0.08)] text-[var(--text-soft)]";
  }

  return {
    open: "bg-[rgba(137,164,196,0.18)] text-[#4d6783]",
    pending: "bg-[rgba(137,164,196,0.18)] text-[#4d6783]",
    confirmed: "bg-[rgba(79,122,97,0.14)] text-[var(--success)]",
    closed: "bg-[rgba(118,93,71,0.12)] text-[var(--text-soft)]",
  }[filter];
}

function getOrderStatusLabel(status: OrderStatus, locale: "en" | "es") {
  return {
    new: locale === "en" ? "New" : "Nuevo",
    pending_restaurant_confirmation: locale === "en" ? "Restaurant pending" : "Pendiente restaurante",
    needs_customer_replacement: locale === "en" ? "Rebuilding order" : "Rearmando pedido",
    payment_pending_review: locale === "en" ? "Payment pending" : "Pago pendiente",
    accepted: locale === "en" ? "Accepted" : "Aceptado",
    preparing: locale === "en" ? "Preparing" : "En preparacion",
    on_the_way: locale === "en" ? "On the way" : "En camino",
    delivered: locale === "en" ? "Delivered" : "Entregado",
    cancelled: locale === "en" ? "Cancelled" : "Cancelado",
  }[status];
}

function getConfirmedStageIndex(status: OrderStatus) {
  if (status === "on_the_way") return 2;
  if (status === "preparing" || status === "payment_pending_review") return 1;
  return 0;
}

function getConfirmedProgressLabel(order: Pick<OrderSummary, "status" | "fulfillmentType">, locale: "en" | "es") {
  if (order.status === "on_the_way") {
    return order.fulfillmentType === "delivery"
      ? (locale === "en" ? "Delivery in 30 min" : "Delivery 30 min")
      : (locale === "en" ? "Order ready for pickup" : "Pedido listo para recoger");
  }

  if (order.status === "accepted" || order.status === "preparing" || order.status === "payment_pending_review") {
    return locale === "en" ? "We are preparing your order" : "Estamos preparando tu pedido";
  }

  return "";
}
function getNotificationLabel(status: OrderDetail["customerNotificationStatus"] | undefined, locale: "en" | "es") {
  if (status === "failed") {
    return locale === "en" ? "failed" : "fallida";
  }

  if (status === "sent") {
    return locale === "en" ? "sent" : "enviada";
  }

  return locale === "en" ? "pending" : "pendiente";
}

function getPaymentProofStatusLabel(status: string | undefined, locale: "en" | "es") {
  if (status === "approved") return locale === "en" ? "Approved" : "Aprobado";
  if (status === "review_pending") return locale === "en" ? "Pending review" : "Pendiente de revision";
  if (status === "stored") return locale === "en" ? "Stored" : "Guardado";
  if (status === "received") return locale === "en" ? "Received" : "Recibido";
  if (status === "rejected") return locale === "en" ? "Rejected" : "Rechazado";
  return locale === "en" ? "No status" : "Sin estado";
}

function getDashboardErrorMessage(error: unknown, fallback: string, locale: "en" | "es") {
  if (error instanceof DashboardApiError) {
    if (error.backendError === "order_module_unavailable") {
      return locale === "en"
        ? "This tenant does not have the orders module available in the database yet."
        : "El tenant aun no tiene el modulo de ordenes disponible en base de datos.";
    }

    if (error.backendError === "order_kitchen_not_completed") {
      return locale === "en"
        ? "Move the kitchen progress to 100% before marking the order as ready."
        : "Lleva el progreso de cocina al 100% antes de marcar el pedido como listo.";
    }

    if (error.backendError === "order_payment_not_confirmed") {
      return locale === "en"
        ? "Validate the payment before moving this order to pickup or delivery."
        : "Valida el pago antes de mover este pedido a recoger o domicilio.";
    }

    return error.backendError ? `${fallback} (${error.backendError})` : fallback;
  }

  if (error instanceof Error) {
    return `${fallback} (${error.message})`;
  }

  return fallback;
}

function getOrderItemsSummary(items: OrderLineItem[] | undefined, locale: "en" | "es") {
  if (!items || items.length === 0) {
    return locale === "en" ? "Products available in order details" : "Productos disponibles en el detalle";
  }

  const visible = items.slice(0, 2).map((item) => `${item.quantity}x ${item.name}`);
  const remaining = items.length - visible.length;
  return remaining > 0
    ? `${visible.join(", ")} +${remaining}`
    : visible.join(", ");
}

function formatRelativeTime(value: string | undefined, locale: "en" | "es") {
  if (!value) return locale === "en" ? "just now" : "ahora";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return locale === "en" ? "just now" : "ahora";

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return locale === "en" ? "just now" : "ahora";
  if (elapsedMinutes < 60) return locale === "en" ? `${elapsedMinutes} min ago` : `hace ${elapsedMinutes} min`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return locale === "en" ? `${elapsedHours} h ago` : `hace ${elapsedHours} h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return locale === "en" ? `${elapsedDays} d ago` : `hace ${elapsedDays} d`;
}

function formatPrice(value: number | undefined, locale: "en" | "es") {
  return formatDashboardPrice(locale, value);
}

function formatDateTime(value: string | undefined, locale: "en" | "es") {
  return formatDashboardDateTime(locale, value);
}

function formatFileSize(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveMenuItemPrice(item: MenuItem) {
  return item.priceOverride ?? item.product?.basePrice ?? 0;
}

function getMenuItemDisplayName(item: MenuItem) {
  return item.displayName || item.product?.name || "Producto sin nombre";
}

function getOrderItemKey(item: OrderLineItem, index: number) {
  return item.id ?? `${item.name}-${item.quantity}-${index}`;
}

function normalizeText(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getOrderReceiptCode(orderId: string) {
  const compact = orderId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return compact.slice(-8) || orderId.slice(-8);
}
