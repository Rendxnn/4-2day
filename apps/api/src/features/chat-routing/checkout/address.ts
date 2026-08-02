import type { DraftOrder } from "@42day/types";
import { getOrCreateActiveDraftOrder, updateDraftOrderCoverage, updateDraftOrderPaymentMethod } from "../../draft-orders/service";
import { saveCustomerAddressFromText, saveCustomerAddressFromWhatsAppLocation } from "../../../modules/customer-address-service/customer-address-service";
import { updateConversationState } from "../../conversations/service";
import { buildAddressSavedPrompt } from "../../../modules/message-router/response-composer";
import { loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import {
  DeliveryCoverageConfigurationError,
  getDeliveryCoverageSettings,
  validateDeliveryCoverageFromWrittenAddress,
  validateDeliveryCoverageFromWhatsappLocation,
} from "../../delivery-coverage/service";
import { reverseGeocodeCoordinatesWithGoogleMaps } from "../../delivery-coverage/google-maps";
import { WHATSAPP_LOCATION_LABEL } from "../../delivery-coverage/customer-safe-address.ts";
import { segmentDeliveryAddress } from "../../delivery-coverage/address-text";
import { startBillingStep } from "./billing";
import { buildAddressValidationRetryPrompt, buildWrittenAddressHelpPrompt } from "./address-prompts";
import { logEvent, safeErrorSummary } from "../../../lib/observability/logger.ts";

export async function tryHandleDeliveryAddress(input: RouteInboundMessageInput, signals: {
  looksLikeAddress?: boolean;
  cannotShareLocation?: boolean;
  normalizedText?: string;
  addressText?: string;
  addressDetails?: string;
  paymentMethod?: "cash" | "transfer" | null;
}): Promise<boolean> {
  if (input.message.type !== "location" && !signals.looksLikeAddress && !signals.cannotShareLocation) {
    return false;
  }

  const menu = await loadCurrentMenu(input);
  const draft = await getOrCreateActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    customerId: input.conversation.customerId,
    locationId: menu.location?.id,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  const settings = await getDeliveryCoverageSettings({
    env: input.env,
    schemaName: input.tenant.schemaName,
    locationId: draft.locationId ?? menu.location?.id,
  });

  if (input.message.type !== "location") {
    if (signals.cannotShareLocation) {
      await updateConversationState({
        env: input.env,
        schemaName: input.tenant.schemaName,
        conversationId: input.conversation.id,
        state: "awaiting_address",
        resetClarificationAttempts: true,
      }).catch(() => undefined);
      await sendAndLogText(input, buildWrittenAddressHelpPrompt());
      return true;
    }

    const segmentedAddress = segmentDeliveryAddress({
      addressText: signals.addressText?.trim() || input.message.text || signals.normalizedText || "",
      details: signals.addressDetails,
    });
    const writtenAddressText = segmentedAddress.addressText;
    const addressDetails = segmentedAddress.details;
    const address = writtenAddressText.length === 0 || settings?.allowWrittenAddressReference === false
      ? null
      : await saveCustomerAddressFromText({
          env: input.env,
          schemaName: input.tenant.schemaName,
          customerId: input.conversation.customerId,
          addressText: writtenAddressText,
          addressDetails,
        });

    if (writtenAddressText) {
      await updateDraftOrderCoverage({
        env: input.env,
        schemaName: input.tenant.schemaName,
        draftOrderId: draft.id,
        customerAddressText: address?.addressText ?? writtenAddressText,
        resolvedDeliveryAddress: address?.addressText ?? writtenAddressText,
        deliveryAddressId: address?.id,
        deliveryAddressDetails: addressDetails,
        validationMethod: "written_address_reference",
        confidence: "low",
        deliveryFeeFixed: menu.location?.deliveryFeeFixed,
      });
    }

    let writtenAddressValidation = null;
    if (writtenAddressText) {
      try {
        writtenAddressValidation = await validateDeliveryCoverageFromWrittenAddress({
          env: input.env,
          schemaName: input.tenant.schemaName,
          locationId: draft.locationId ?? menu.location?.id,
          addressText: writtenAddressText,
        });
      } catch (error) {
        // A geocoding outage must not block checkout when the restaurant has
        // enabled written addresses as a delivery reference.
        logEvent("warn", "delivery_coverage.written_address_geocoding_failed", "No se pudo geocodificar la dirección escrita; continuará como referencia.", {
          environment: input.env.APP_ENV,
          traceId: input.traceId,
          tenantId: input.tenant.id,
          conversationId: input.conversation.id,
          error: safeErrorSummary(error),
        });
      }
    }

    if (writtenAddressValidation) {
      const validatedDraft = await updateDraftOrderCoverage({
        env: input.env,
        schemaName: input.tenant.schemaName,
        draftOrderId: draft.id,
        customerLatitude: writtenAddressValidation.latitude,
        customerLongitude: writtenAddressValidation.longitude,
        deliveryDistanceKm: writtenAddressValidation.distanceKm,
        isInsideDeliveryCoverage: writtenAddressValidation.isInsideCoverage,
        validationMethod: writtenAddressValidation.validationMethod,
        confidence: writtenAddressValidation.confidence,
        checkedAt: new Date().toISOString(),
        customerAddressText: address?.addressText ?? writtenAddressValidation.formattedAddress,
        resolvedDeliveryAddress: address?.addressText ?? writtenAddressText,
        deliveryAddressId: address?.id,
        deliveryAddressDetails: addressDetails,
        deliveryFeeFixed: menu.location?.deliveryFeeFixed,
      });

      if (!writtenAddressValidation.isInsideCoverage && !settings?.allowOutOfCoverageOrders) {
        await updateConversationState({
          env: input.env,
          schemaName: input.tenant.schemaName,
          conversationId: input.conversation.id,
          state: "awaiting_fulfillment_type",
          resetClarificationAttempts: true,
        }).catch(() => undefined);
        await sendAndLogText(input, settings?.outOfCoverageMessage ?? "Lo sentimos, no tenemos cobertura para esa direccion. Puedes recoger en el local.");
        return true;
      }

      const draftWithPayment = signals.paymentMethod
        ? await updateDraftOrderPaymentMethod({
            env: input.env,
            schemaName: input.tenant.schemaName,
            draftOrderId: validatedDraft.id,
            paymentMethod: signals.paymentMethod,
            deliveryFeeFixed: menu.location?.deliveryFeeFixed,
          })
        : validatedDraft;

      await startBillingStep(input, {
        menu,
        draft: draftWithPayment,
        prefix: buildAddressSavedPrompt(
          formatDeliveryAddress(writtenAddressValidation.formattedAddress, addressDetails),
          writtenAddressValidation.isInsideCoverage
            ? "Perfecto, validamos tu direccion y esta dentro de cobertura."
            : "Perfecto, validamos tu direccion. Continuemos con el pedido.",
        ),
      });
      return true;
    }

    // A written address is still useful when Google is unavailable or cannot
    // resolve the exact rooftop. Keep it as the delivery reference instead of
    // trapping the customer in an address/location loop. Coverage can be
    // reviewed by the restaurant when the order is received.
    if (writtenAddressText && settings?.allowWrittenAddressReference !== false) {
      const referenceDraft = await updateDraftOrderCoverage({
        env: input.env,
        schemaName: input.tenant.schemaName,
        draftOrderId: draft.id,
        customerAddressText: address?.addressText ?? writtenAddressText,
        resolvedDeliveryAddress: address?.addressText ?? writtenAddressText,
        deliveryAddressId: address?.id,
        deliveryAddressDetails: addressDetails,
        validationMethod: "written_address_reference",
        confidence: "low",
        deliveryFeeFixed: menu.location?.deliveryFeeFixed,
      });

      const draftWithPayment = signals.paymentMethod
        ? await updateDraftOrderPaymentMethod({
            env: input.env,
            schemaName: input.tenant.schemaName,
            draftOrderId: referenceDraft.id,
            paymentMethod: signals.paymentMethod,
            deliveryFeeFixed: menu.location?.deliveryFeeFixed,
          })
        : referenceDraft;

      await startBillingStep(input, {
        menu,
        draft: draftWithPayment,
        prefix: buildAddressSavedPrompt(
          formatDeliveryAddress(address?.addressText ?? writtenAddressText, addressDetails),
          "Guardamos esta dirección como referencia. El restaurante verificará la cobertura al revisar el pedido.",
        ),
      });
      return true;
    }

    await updateConversationState({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      state: "awaiting_address",
      resetClarificationAttempts: true,
    }).catch(() => undefined);
    await sendAndLogText(
      input,
      buildAddressValidationRetryPrompt(),
    );
    return true;
  }

  let resolvedDeliveryAddress = input.message.location!.address
    ?? input.message.location!.name
    ?? WHATSAPP_LOCATION_LABEL;
  try {
    resolvedDeliveryAddress = await reverseGeocodeCoordinatesWithGoogleMaps({
      env: input.env,
      latitude: input.message.location!.latitude,
      longitude: input.message.location!.longitude,
    }) ?? resolvedDeliveryAddress;
  } catch (error) {
    logEvent("warn", "delivery_coverage.reverse_geocoding_failed", "No se pudo obtener una dirección legible desde la ubicación.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      conversationId: input.conversation.id,
      error: safeErrorSummary(error),
    });
  }

  const address = await saveCustomerAddressFromWhatsAppLocation({
    env: input.env,
    schemaName: input.tenant.schemaName,
    customerId: input.conversation.customerId,
    message: input.message,
    addressText: resolvedDeliveryAddress,
  });
  const resolvedAddressText = address?.addressText ?? resolvedDeliveryAddress;

  let updatedDraft: DraftOrder;
  try {
    const validation = await validateDeliveryCoverageFromWhatsappLocation({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: draft.locationId ?? menu.location?.id,
      customerLatitude: input.message.location!.latitude,
      customerLongitude: input.message.location!.longitude,
    });
    updatedDraft = await updateDraftOrderCoverage({
      env: input.env,
      schemaName: input.tenant.schemaName,
      draftOrderId: draft.id,
      customerLatitude: input.message.location!.latitude,
      customerLongitude: input.message.location!.longitude,
      deliveryDistanceKm: validation.distanceKm,
      isInsideDeliveryCoverage: validation.isInsideCoverage,
      validationMethod: validation.validationMethod,
      confidence: validation.confidence,
      checkedAt: new Date().toISOString(),
      customerAddressText: resolvedAddressText,
      resolvedDeliveryAddress,
      deliveryAddressId: address?.id,
      deliveryAddressDetails: address?.addressDetails,
      deliveryFeeFixed: menu.location?.deliveryFeeFixed,
    });

    if (!validation.isInsideCoverage && !settings?.allowOutOfCoverageOrders) {
      await updateConversationState({
        env: input.env,
        schemaName: input.tenant.schemaName,
        conversationId: input.conversation.id,
        state: "awaiting_fulfillment_type",
        resetClarificationAttempts: true,
      }).catch(() => undefined);
      await sendAndLogText(input, settings?.outOfCoverageMessage ?? "Lo sentimos, no tenemos cobertura para tu ubicacion. Puedes recoger en el local.");
      return true;
    }
  } catch (error) {
    if (!(error instanceof DeliveryCoverageConfigurationError)) throw error;
    updatedDraft = await updateDraftOrderCoverage({
      env: input.env,
      schemaName: input.tenant.schemaName,
      draftOrderId: draft.id,
      customerLatitude: input.message.location!.latitude,
      customerLongitude: input.message.location!.longitude,
      isInsideDeliveryCoverage: null,
      validationMethod: "not_validated",
      confidence: "failed",
      checkedAt: new Date().toISOString(),
      customerAddressText: resolvedAddressText,
      resolvedDeliveryAddress,
      deliveryAddressId: address?.id,
      deliveryAddressDetails: address?.addressDetails,
      deliveryFeeFixed: menu.location?.deliveryFeeFixed,
    });
    await updateConversationState({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      state: "awaiting_fulfillment_type",
      resetClarificationAttempts: true,
    }).catch(() => undefined);
    await sendAndLogText(input, settings?.outOfCoverageMessage ?? "No pudimos validar el domicilio. Puedes recoger en el local.");
    return true;
  }

  const draftWithPayment = signals.paymentMethod
    ? await updateDraftOrderPaymentMethod({
        env: input.env,
        schemaName: input.tenant.schemaName,
        draftOrderId: updatedDraft.id,
        paymentMethod: signals.paymentMethod,
        deliveryFeeFixed: menu.location?.deliveryFeeFixed,
      })
    : updatedDraft;

  await startBillingStep(input, {
    menu,
    draft: draftWithPayment,
    prefix: buildAddressSavedPrompt(resolvedDeliveryAddress, "Perfecto, tenemos cobertura para tu ubicacion."),
  });
  return true;
}

function formatDeliveryAddress(addressText: string, details?: string): string {
  return details ? `${addressText}\nIndicaciones: ${details}` : addressText;
}
