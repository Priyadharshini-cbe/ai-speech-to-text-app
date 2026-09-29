import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { env } from "~/env";
import { db } from "~/server/db";

const PRODUCT_CREDITS: Record<string, number> = {
  "f1a07060-0616-49bf-b53e-2fdae2e67fed": 50,
  "2cf782ba-2954-4430-987c-76478234cfb4": 200,
  "3fb2e043-d3d5-48bf-96ac-322ce7fd96c0": 400,
};

function verifyWebhookPayload(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): unknown {
  const cleanSecret = secret.trim();

  // 1. Standard Webhooks verification (decodes base64 secret payload with/without whsec_ prefix)
  try {
    const wh = new Webhook(cleanSecret);
    return wh.verify(rawBody, headers);
  } catch (err1) {
    // 2. Raw string format verification
    try {
      const whRaw = new Webhook(cleanSecret, { format: "raw" });
      return whRaw.verify(rawBody, headers);
    } catch {
      // 3. Raw format without whsec_ prefix
      try {
        const whRawStripped = new Webhook(cleanSecret.replace(/^whsec_/, ""), {
          format: "raw",
        });
        return whRawStripped.verify(rawBody, headers);
      } catch {
        // 4. Polar SDK fallback
        try {
          return validateEvent(rawBody, headers, cleanSecret);
        } catch {
          throw err1 instanceof WebhookVerificationError
            ? err1
            : new Error("Webhook signature verification failed");
        }
      }
    }
  }
}

export async function POST(request: Request) {
  const secret = env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Polar Webhook] POLAR_WEBHOOK_SECRET is not configured");
    return Response.json(
      { error: "Webhook secret is not configured" },
      { status: 500 },
    );
  }

  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  console.log("[Polar Webhook] Incoming webhook headers:", {
    hasId: Boolean(webhookId),
    hasTimestamp: Boolean(webhookTimestamp),
    hasSignature: Boolean(webhookSignature),
    signatureVersions:
      webhookSignature
        ?.split(" ")
        .map((s) => s.split(",")[0])
        .filter(Boolean) ?? [],
  });

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.warn("[Polar Webhook] Missing required webhook headers");
    return Response.json(
      { error: "Missing required webhook headers" },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = {
    "webhook-id": webhookId,
    "webhook-timestamp": webhookTimestamp,
    "webhook-signature": webhookSignature,
  };

  const rawBody = await request.text();
  let event: unknown;

  try {
    event = verifyWebhookPayload(rawBody, headers, secret);
    console.log("[Polar Webhook] Signature verified successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification error";
    console.warn("[Polar Webhook] Signature verification failed:", message);
    return Response.json(
      { error: `Invalid webhook signature: ${message}` },
      { status: 400 },
    );
  }

  if (typeof event !== "object" || event === null || !("type" in event)) {
    return Response.json(
      { error: "Invalid webhook payload structure" },
      { status: 400 },
    );
  }

  const eventType = String((event as Record<string, unknown>).type);
  if (eventType !== "order.paid") {
    console.log(`[Polar Webhook] Ignored non-order.paid event: ${eventType}`);
    return Response.json({ received: true });
  }

  const data = (event as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) {
    return Response.json(
      { error: "Invalid order.paid payload: missing data" },
      { status: 400 },
    );
  }

  const dataObj = data as Record<string, unknown>;
  const productId =
    typeof dataObj.productId === "string"
      ? dataObj.productId
      : typeof dataObj.product_id === "string"
        ? dataObj.product_id
        : undefined;

  if (!productId) {
    return Response.json(
      { error: "Missing productId in order.paid event" },
      { status: 400 },
    );
  }

  const customer = dataObj.customer;
  let externalCustomerId: string | null = null;
  if (typeof customer === "object" && customer !== null) {
    const custObj = customer as Record<string, unknown>;
    if (typeof custObj.externalId === "string") {
      externalCustomerId = custObj.externalId;
    } else if (typeof custObj.external_id === "string") {
      externalCustomerId = custObj.external_id;
    }
  }

  if (!externalCustomerId) {
    console.warn(
      "[Polar Webhook] No externalCustomerId found in order customer data",
    );
    return Response.json(
      { error: "No external customer ID found" },
      { status: 400 },
    );
  }

  const creditsToAdd = PRODUCT_CREDITS[productId] ?? 0;
  if (creditsToAdd > 0) {
    try {
      await db.user.update({
        where: { id: externalCustomerId },
        data: { credits: { increment: creditsToAdd } },
      });
      console.log(
        `[Polar Webhook] Successfully added ${creditsToAdd} credits to user ${externalCustomerId}`,
      );
    } catch (dbErr) {
      console.error("[Polar Webhook] Failed to update user credits in database:", dbErr);
      return Response.json(
        { error: "Failed to update user credits in database" },
        { status: 500 },
      );
    }
  } else {
    console.warn(
      `[Polar Webhook] Unknown or unhandled product ID: ${productId}, no credits added`,
    );
  }

  return Response.json({ received: true });
}

