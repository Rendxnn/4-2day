import { useEffect, useRef, useState } from "react";

type Props = {
  onDetected: (value: string) => void;
  onUnavailable: () => void;
};

/** Camera-only QR reader. It never navigates to, retains, or uploads decoded values. */
export function DynamicLinkQrScanner({ onDetected, onUnavailable }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Preparando la cámara trasera…");

  useEffect(() => {
    let active = true;
    let stopped = false;
    let stop: (() => void) | undefined;
    const stopForBackground = () => {
      if (document.visibilityState !== "hidden" || stopped) return;
      stopped = true;
      stop?.();
      onUnavailable();
    };
    document.addEventListener("visibilitychange", stopForBackground);

    void import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      if (!active || !videoRef.current) return;
      const reader = new BrowserQRCodeReader();
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (result) => {
            if (!active || stopped || !result) return;
            stopped = true;
            stop?.();
            onDetected(result.getText());
          },
        );
        stop = controls.stop;
        if (!active || stopped) controls.stop();
        else setMessage("Apunta la cámara al QR de ParaHoy.");
      } catch {
        if (active) {
          setMessage("No fue posible usar la cámara. Puedes pegar el enlace o escribir el código.");
          onUnavailable();
        }
      }
    }).catch(() => {
      if (active) {
        setMessage("No fue posible cargar el lector de cámara.");
        onUnavailable();
      }
    });

    return () => {
      active = false;
      stopped = true;
      stop?.();
      document.removeEventListener("visibilitychange", stopForBackground);
    };
  }, [onDetected, onUnavailable]);

  return <div className="space-y-3">
    <video aria-label="Vista de cámara para escanear QR" className="aspect-square w-full rounded-2xl bg-black object-cover" muted playsInline ref={videoRef} />
    <p aria-live="polite" className="text-center text-sm text-[var(--text-soft)]">{message}</p>
  </div>;
}
