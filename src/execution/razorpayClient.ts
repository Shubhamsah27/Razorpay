export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  baseUrl: string;
  timeoutMs: number;
}

export function razorpayConfigFromEnv(env = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (keyId === undefined || keySecret === undefined) return null;
  if (!keyId.startsWith("rzp_test_")) {
    throw new Error(
      `refusing to run against a non-test key (${keyId.slice(0, 9)}...); Recoup is Test Mode only`,
    );
  }
  return {
    keyId,
    keySecret,
    baseUrl: env.RAZORPAY_BASE_URL ?? "https://api.razorpay.com",
    timeoutMs: Number(env.RAZORPAY_TIMEOUT_MS ?? 10_000),
  };
}

/**
 * The three answers a provider call can give. The distinction between a definite
 * client error and an indeterminate result is the whole safety property: only the
 * former is safe to treat as "did not happen".
 */
export type CallResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "client_error"; status: number; code: string; description: string }
  | { kind: "duplicate_reference"; description: string }
  | { kind: "indeterminate"; reason: string };

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; reason?: string };
}

/** Razorpay reports a reused reference_id as a 400 with this wording. */
function isDuplicateReference(body: RazorpayErrorBody): boolean {
  const description = body.error?.description?.toLowerCase() ?? "";
  return description.includes("reference_id") && description.includes("exist");
}

export async function razorpayCall<T>(
  config: RazorpayConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<CallResult<T>> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();

    if (response.ok) {
      return { kind: "ok", data: JSON.parse(text) as T };
    }

    let parsed: RazorpayErrorBody = {};
    try {
      parsed = JSON.parse(text) as RazorpayErrorBody;
    } catch {
      parsed = {};
    }

    // 429 and 5xx say nothing about whether the effect landed.
    if (response.status === 429 || response.status >= 500) {
      return {
        kind: "indeterminate",
        reason: `HTTP ${response.status}: ${parsed.error?.description ?? text.slice(0, 200)}`,
      };
    }

    if (isDuplicateReference(parsed)) {
      // The reference already exists, which means a previous call did land.
      return {
        kind: "duplicate_reference",
        description: parsed.error?.description ?? "reference_id already exists",
      };
    }

    return {
      kind: "client_error",
      status: response.status,
      code: parsed.error?.code ?? "UNKNOWN",
      description: parsed.error?.description ?? text.slice(0, 200),
    };
  } catch (error) {
    // Aborts and transport failures leave the outcome genuinely unknown.
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "indeterminate", reason: `transport failure: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
