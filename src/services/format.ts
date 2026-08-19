/** Shared helpers for shaping tool responses. */

import { z } from "zod";
import { CHARACTER_LIMIT } from "../constants.js";
import { describeError } from "./client.js";

export const ResponseFormat = {
  MARKDOWN: "markdown",
  JSON: "json",
} as const;
export type ResponseFormat = (typeof ResponseFormat)[keyof typeof ResponseFormat];

export const responseFormatSchema = z
  .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for a human-readable summary, 'json' for the raw fields");

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** The SDK's CallToolResult allows extra fields; this keeps the shapes compatible. */
  [key: string]: unknown;
}

/** Builds a successful tool result carrying both a rendering and structured data. */
export function toolResult(text: string, structured: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: capText(text) }],
    structuredContent: structured,
  };
}

/** Builds a failed tool result. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wraps a tool handler so no exception escapes as a protocol-level error. */
export function guard<T>(handler: (params: T) => Promise<ToolResult>) {
  return async (params: T): Promise<ToolResult> => {
    try {
      return await handler(params);
    } catch (error) {
      return errorResult(describeError(error));
    }
  };
}

function capText(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n[Output truncated at ${CHARACTER_LIMIT} characters.]`;
}

/**
 * Renders a payload as markdown or JSON, shrinking the named list until the
 * serialized result fits within CHARACTER_LIMIT.
 */
export function render(
  format: ResponseFormat,
  payload: Record<string, unknown>,
  markdown: (payload: Record<string, unknown>) => string,
  listKey?: string,
): ToolResult {
  let current = payload;
  let text = format === ResponseFormat.JSON ? JSON.stringify(current, null, 2) : markdown(current);

  if (listKey && text.length > CHARACTER_LIMIT) {
    const items = current[listKey];
    if (Array.isArray(items) && items.length > 1) {
      let kept = items;
      while (text.length > CHARACTER_LIMIT && kept.length > 1) {
        kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)));
        current = {
          ...payload,
          [listKey]: kept,
          truncated: true,
          truncation_note:
            `Response shortened from ${items.length} to ${kept.length} items to stay within ` +
            `${CHARACTER_LIMIT} characters. Narrow the query or page through the results to see the rest.`,
        };
        text =
          format === ResponseFormat.JSON ? JSON.stringify(current, null, 2) : markdown(current);
      }
    }
  }

  return toolResult(text, current);
}

/** Drops undefined and null entries so request bodies stay minimal. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<T>;
}

/** Appends defined values to a multipart body, JSON-encoding objects and arrays. */
export function appendFields(form: FormData, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      form.append(key, JSON.stringify(value));
    } else {
      form.append(key, String(value));
    }
  }
}

/** Formats a byte count for display. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a unix timestamp as an ISO date, or a dash when absent. */
export function isoDate(unixSeconds?: number | null): string {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toISOString();
}
