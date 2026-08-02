import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeWhatsAppPayload } from "../src/modules/whatsapp-webhook/normalize.ts";

test("normaliza metadata de media en mensajes document", () => {
  const [message] = normalizeWhatsAppPayload({
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: "phone-1",
              },
              messages: [
                {
                  id: "wamid-1",
                  from: "573001112233",
                  timestamp: "1710000000",
                  type: "document",
                  document: {
                    id: "media-1",
                    mime_type: "application/pdf",
                    filename: "soporte.pdf",
                    caption: "mi comprobante",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.ok(message);
  assert.equal(message.mediaId, "media-1");
  assert.equal(message.mediaMimeType, "application/pdf");
  assert.equal(message.mediaFilename, "soporte.pdf");
  assert.equal(message.mediaCaption, "mi comprobante");
});

test("un fallo de procesamiento deja el webhook en failed con una causa segura", async () => {
  const webhookEventLog = await readFile(
    new URL("../src/modules/whatsapp-webhook/webhook-event-log.ts", import.meta.url),
    "utf8",
  );

  assert.match(webhookEventLog, /markRawWhatsAppWebhookFailed/);
  assert.match(webhookEventLog, /status: "failed"/);
  assert.match(webhookEventLog, /error_message: errorMessage\.slice/);
  assert.match(webhookEventLog, /processed_at: new Date\(\)\.toISOString\(\)/);
});

test("los callbacks de estado se registran como estados y no como no_messages", async () => {
  const handler = await readFile(new URL("../src/modules/whatsapp-webhook/handler.ts", import.meta.url), "utf8");
  assert.match(handler, /whatsapp\.status\.received/);
  assert.match(handler, /statusTypes/);
  assert.doesNotMatch(handler, /whatsapp\.webhook\.no_messages/);
});
