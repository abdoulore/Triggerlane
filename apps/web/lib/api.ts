export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8787");

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues?: unknown[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body != null) headers.set("content-type", "application/json");
  const method = options?.method?.toUpperCase() ?? "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("idempotency-key")) {
    headers.set("idempotency-key", crypto.randomUUID());
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  const payload = (await response.json()) as T & { error?: { code: string; message: string; issues?: unknown[] } };
  if (!response.ok) {
    throw new ApiError(payload.error?.code ?? "REQUEST_FAILED", payload.error?.message ?? "Request failed.", payload.error?.issues);
  }
  return payload;
}
