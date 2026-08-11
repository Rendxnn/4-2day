import { useEffect, useState } from "react";
import type { DetectedMenuProduct, MenuFileAnalysisPayload } from "../../api";
import { Loader2 } from "lucide-react";
import type { PaymentConfigurationAdapter } from "./paymentConfiguration.adapter";
import { DeliveryCoverageSection } from "./DeliveryCoverageSection";
import { MenuUploadSection } from "./MenuUploadSection";
import { PaymentSettingsSection } from "./PaymentSettingsSection";
import { RestaurantKnowledgeSection } from "./RestaurantKnowledgeSection";
import { RestaurantPublicProfileSection } from "./RestaurantPublicProfileSection";
import type { ConfigurationAccess, PaymentConfigurationSnapshot } from "./paymentConfiguration.types";

export function ConfigurationView({
  access,
  adapter,
  locale,
  tenantSlug,
  onAnalyze,
  onCreateProducts,
  onNotify,
  onPaymentConfigurationChanged,
}: {
  access: ConfigurationAccess;
  adapter: PaymentConfigurationAdapter;
  locale: "en" | "es";
  tenantSlug: string;
  onAnalyze: (file: File) => Promise<MenuFileAnalysisPayload>;
  onCreateProducts: (products: DetectedMenuProduct[]) => Promise<void>;
  onNotify: (message: string) => void;
  onPaymentConfigurationChanged?: () => Promise<void> | void;
}) {
  const [snapshot, setSnapshot] = useState<PaymentConfigurationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFeedback(null);

    adapter.getPaymentConfiguration(tenantSlug)
      .then((nextSnapshot) => {
        if (!active) return;
        setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        if (!active) return;
        setFeedback({
          kind: "error",
          message: getPaymentConfigurationErrorMessage(error),
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [adapter, tenantSlug]);

  if (!access.canManage) {
    return null;
  }

  async function reloadSnapshot() {
    const nextSnapshot = await adapter.getPaymentConfiguration(tenantSlug);
    setSnapshot(nextSnapshot);
  }

  async function runMutation(actionKey: string, successMessage: string, operation: () => Promise<void>) {
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      await operation();
      await reloadSnapshot();
      await Promise.resolve(onPaymentConfigurationChanged?.()).catch(() => undefined);
      setFeedback({ kind: "success", message: successMessage });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: getPaymentConfigurationErrorMessage(error),
      });
    } finally {
      setPendingAction(null);
    }
  }

  const resolvedSnapshot = snapshot ?? {
    accounts: [],
    qrs: [],
    constraints: {
      maxActiveAccounts: 5 as const,
      maxActiveQrs: 1 as const,
    },
  };

  return (
    <section className="space-y-8 pb-28 lg:pb-10">
      <MenuUploadSection
        onAnalyze={onAnalyze}
        onCreateProducts={onCreateProducts}
        onNotify={onNotify}
      />

      {loading && !snapshot ? (
        <div className="border-t border-[rgba(255,242,227,0.12)] pt-8">
          <div className="app-panel grid min-h-[220px] place-items-center rounded-[28px]">
            <div className="text-center text-[var(--text-on-dark)]">
              <Loader2 className="mx-auto animate-spin" size={24} />
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-[rgba(246,236,223,0.54)]">
                Cargando configuracion de pagos
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-[rgba(255,242,227,0.12)] pt-8">
          <PaymentSettingsSection
            accounts={resolvedSnapshot.accounts}
            constraints={resolvedSnapshot.constraints}
            feedback={feedback}
            onActivateAccount={(accountId) => runMutation(`account:activate:${accountId}`, "Cuenta activada.", () => adapter.activatePaymentAccount(tenantSlug, accountId))}
            onActivateQr={(qrId) => runMutation(`qr:activate:${qrId}`, "QR activado.", () => adapter.activatePaymentQr(tenantSlug, qrId))}
            onCreateAccount={(input) => runMutation("account:create", "Cuenta creada.", () => adapter.createPaymentAccount(tenantSlug, input))}
            onCreateQr={(input) => runMutation("qr:create", "QR creado.", () => adapter.createPaymentQr(tenantSlug, input))}
            onDeactivateAccount={(accountId) => runMutation(`account:deactivate:${accountId}`, "Cuenta desactivada.", () => adapter.deactivatePaymentAccount(tenantSlug, accountId))}
            onDeactivateQr={(qrId) => runMutation(`qr:deactivate:${qrId}`, "QR desactivado.", () => adapter.deactivatePaymentQr(tenantSlug, qrId))}
            onDeleteAccount={(accountId) => runMutation(`account:delete:${accountId}`, "Cuenta eliminada.", () => adapter.deletePaymentAccount(tenantSlug, accountId))}
            onDeleteQr={(qrId) => runMutation(`qr:delete:${qrId}`, "QR eliminado.", () => adapter.deletePaymentQr(tenantSlug, qrId))}
            onUpdateAccount={(accountId, input) => runMutation(`account:update:${accountId}`, "Cuenta actualizada.", () => adapter.updatePaymentAccount(tenantSlug, accountId, input))}
            onUpdateQr={(qrId, input) => runMutation(`qr:update:${qrId}`, "QR actualizado.", () => adapter.updatePaymentQr(tenantSlug, qrId, input))}
            pendingAction={pendingAction}
            qrs={resolvedSnapshot.qrs}
          />
        </div>
      )}

      <div className="border-t border-[rgba(255,242,227,0.12)] pt-8">
        <DeliveryCoverageSection
          locale={locale}
          onNotify={onNotify}
          tenantSlug={tenantSlug}
        />
      </div>

      <div className="border-t border-[rgba(255,242,227,0.12)] pt-8">
        <RestaurantKnowledgeSection tenantSlug={tenantSlug} />
      </div>

      <div className="border-t border-[rgba(255,242,227,0.12)] pt-8">
        <RestaurantPublicProfileSection
          locale={locale}
          onNotify={onNotify}
          tenantSlug={tenantSlug}
        />
      </div>
    </section>
  );
}

function getPaymentConfigurationErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "No se pudo completar la accion en configuracion de pagos.";
  }

  if (error.message === "accounts_active_limit_reached") {
    return "No puedes activar mas de 5 cuentas al mismo tiempo.";
  }
  if (error.message === "active_account_delete_forbidden") {
    return "Primero desactiva la cuenta antes de eliminarla.";
  }
  if (error.message === "payment_qr_active_conflict") {
    return "Ya existe un QR activo. Desactivalo antes de activar otro.";
  }
  if (error.message === "active_qr_delete_forbidden") {
    return "Primero desactiva el QR antes de eliminarlo.";
  }
  if (error.message === "payment_account_not_found") {
    return "La cuenta seleccionada ya no esta disponible.";
  }
  if (error.message === "payment_qr_not_found") {
    return "El QR seleccionado ya no esta disponible.";
  }

  return "No se pudo completar la accion en configuracion de pagos.";
}
