/** Authenticated HTTP client for the ElevenLabs REST API. */

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from "../constants.js";

export interface ElevenLabsConfig {
  apiKey: string;
  baseUrl: string;
}

/** Raised when a request reaches the API but the API rejects it. */
export class ElevenLabsApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly endpoint: string,
  ) {
    super(`ElevenLabs API returned ${status} for ${endpoint}: ${detail}`);
    this.name = "ElevenLabsApiError";
  }
}

/** Raised when the server is not configured with an API key. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ELEVENLABS_API_KEY is not set. Export it in the environment that launches this MCP server; " +
        "create a key at https://elevenlabs.io/app/settings/api-keys.",
    );
    this.name = "MissingApiKeyError";
  }
}

/** Raised for problems the caller can fix locally (bad path, oversized file). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/**
 * Reads configuration from the environment on every call so that a key rotated
 * in the parent process is picked up without a restart.
 */
export function getConfig(): ElevenLabsConfig {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  const baseUrl = (process.env.ELEVENLABS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

export type QueryValue = string | number | boolean | string[] | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Query;
  /** JSON request body. Mutually exclusive with `form`. */
  json?: unknown;
  /** Multipart request body. Mutually exclusive with `json`. */
  form?: FormData;
  timeoutMs?: number;
}

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(`${baseUrl}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, entry);
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

/** Pulls the most useful message out of ElevenLabs' several error body shapes. */
async function readErrorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return response.statusText || "no response body";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const detail = (parsed as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (detail && typeof detail === "object") {
        const message = (detail as { message?: unknown }).message;
        const status = (detail as { status?: unknown }).status;
        if (typeof message === "string") {
          return typeof status === "string" ? `${status}: ${message}` : message;
        }
      }
      if (Array.isArray(detail)) {
        // FastAPI validation errors: [{loc: [...], msg: "..."}]
        return detail
          .map((item) => {
            const loc = (item as { loc?: unknown[] }).loc?.join(".") ?? "body";
            const msg = (item as { msg?: string }).msg ?? "invalid value";
            return `${loc}: ${msg}`;
          })
          .join("; ");
      }
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  } catch {
    // Body was not JSON; fall through to the raw text.
  }
  return body.slice(0, 500);
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { apiKey, baseUrl } = getConfig();
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { "xi-api-key": apiKey };

  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form; // fetch sets the multipart boundary itself
  } else if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  const endpoint = `${method} /${path.replace(/^\/+/, "")}`;
  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, path, options.query), {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ElevenLabsApiError(408, "the request timed out before the API responded", endpoint);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new ElevenLabsApiError(0, `could not reach ${baseUrl} (${reason})`, endpoint);
  }

  if (!response.ok) {
    throw new ElevenLabsApiError(response.status, await readErrorDetail(response), endpoint);
  }
  return response;
}

/** Performs a request and parses the JSON response. */
export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface BinaryResponse {
  data: Buffer;
  contentType: string;
}

/** Performs a request and returns the raw response body (generated audio). */
export async function requestBinary(
  path: string,
  options: RequestOptions = {},
): Promise<BinaryResponse> {
  const response = await send(path, options);
  const data = Buffer.from(await response.arrayBuffer());
  return {
    data,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Turns any thrown value into a message that tells the agent what to do next. */
export function describeError(error: unknown): string {
  if (error instanceof MissingApiKeyError || error instanceof InvalidInputError) {
    return `Error: ${error.message}`;
  }
  if (error instanceof ElevenLabsApiError) {
    const suffix = ` (${error.endpoint}: ${error.detail})`;
    switch (error.status) {
      case 0:
        return `Error: could not reach the ElevenLabs API. Check network access and ELEVENLABS_BASE_URL.${suffix}`;
      case 401:
        return `Error: authentication failed. Check that ELEVENLABS_API_KEY is a valid, active key.${suffix}`;
      case 403:
        return `Error: permission denied. The API key may lack the required scope, or your plan may not include this endpoint.${suffix}`;
      case 404:
        return `Error: not found. Verify the id you passed — use elevenlabs_list_voices or elevenlabs_list_models to look one up.${suffix}`;
      case 408:
        return `Error: the request timed out. Try a shorter input, or retry.${suffix}`;
      case 422:
        return `Error: the API rejected the parameters. Fix the fields named below and retry.${suffix}`;
      case 429:
        return `Error: rate limited or too many concurrent requests. Wait a few seconds and retry.${suffix}`;
      default:
        if (error.status >= 500) {
          return `Error: ElevenLabs reported a server error. This is usually transient — retry shortly.${suffix}`;
        }
        return `Error: request failed with status ${error.status}.${suffix}`;
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
