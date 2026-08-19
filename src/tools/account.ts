/** Account, model catalogue and generation-history tools. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requestBinary, requestJson } from "../services/client.js";
import { extensionForContentType, saveBinary } from "../services/files.js";
import {
  compact,
  guard,
  humanBytes,
  isoDate,
  render,
  responseFormatSchema,
} from "../services/format.js";
import { fileNameSchema } from "../schemas/common.js";
import type { HistoryResponse, Model, Subscription, User } from "../types.js";

const listModelsSchema = z
  .object({
    capability: z
      .enum(["any", "text_to_speech", "voice_conversion"])
      .default("any")
      .describe("Only return models that support this capability"),
    include_languages: z
      .boolean()
      .default(false)
      .describe("Include each model's supported language list. Off by default because it is long"),
    response_format: responseFormatSchema,
  })
  .strict();

const subscriptionSchema = z
  .object({
    response_format: responseFormatSchema,
  })
  .strict();

const listHistorySchema = z
  .object({
    page_size: z.number().int().min(1).max(100).default(20).describe("Items per page (1-100)"),
    start_after_history_item_id: z
      .string()
      .optional()
      .describe("Continue after this id, taken from a previous response's next_cursor"),
    voice_id: z.string().optional().describe("Only return generations made with this voice"),
    search: z.string().max(200).optional().describe("Free-text filter over the generated text"),
    source: z
      .enum(["TTS", "STS"])
      .optional()
      .describe("Filter by generation source: text to speech or speech to speech"),
    response_format: responseFormatSchema,
  })
  .strict();

const downloadHistorySchema = z
  .object({
    history_item_id: z
      .string()
      .min(1)
      .describe("history_item_id from elevenlabs_list_history"),
    file_name: fileNameSchema,
  })
  .strict();

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_list_models",
    {
      title: "List ElevenLabs Models",
      description: `List the available ElevenLabs models and what each one can do.

Read-only and free to call. Use it to pick a model_id for elevenlabs_text_to_speech or elevenlabs_speech_to_speech, or to check a model's per-request character limit before sending a long script.

Args:
  - capability ('any'|'text_to_speech'|'voice_conversion'): filter by capability, default 'any'
  - include_languages (boolean): include supported languages, default false
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "count": number,
    "models": [
      {
        "model_id": string,                       // pass this to the speech tools
        "name": string,
        "description": string,
        "can_do_text_to_speech": boolean,
        "can_do_voice_conversion": boolean,
        "can_use_style": boolean,
        "can_use_speaker_boost": boolean,
        "maximum_text_length_per_request": number,
        "languages": [ { "language_id": string, "name": string } ]  // only when requested
      }
    ]
  }

Examples:
  - "Which model should I use for low latency?" -> { "capability": "text_to_speech" }
  - "Does any model support Japanese?" -> { "include_languages": true }
  - Don't use for: listing voices (use elevenlabs_list_voices)

Error Handling:
  - "authentication failed" means ELEVENLABS_API_KEY is missing or invalid`,
      inputSchema: listModelsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof listModelsSchema>) => {
      const models = await requestJson<Model[]>("v1/models");
      const filtered = models.filter((model) => {
        if (params.capability === "text_to_speech") return model.can_do_text_to_speech === true;
        if (params.capability === "voice_conversion") return model.can_do_voice_conversion === true;
        return true;
      });

      const payload = {
        count: filtered.length,
        models: filtered.map((model) =>
          compact({
            model_id: model.model_id,
            name: model.name,
            description: model.description,
            can_do_text_to_speech: model.can_do_text_to_speech,
            can_do_voice_conversion: model.can_do_voice_conversion,
            can_use_style: model.can_use_style,
            can_use_speaker_boost: model.can_use_speaker_boost,
            maximum_text_length_per_request: model.maximum_text_length_per_request,
            languages: params.include_languages ? model.languages : undefined,
          }),
        ),
      };

      return render(
        params.response_format,
        payload,
        (current) => {
          const list = current["models"] as Array<Record<string, unknown>>;
          if (!list.length) return `No models match capability '${params.capability}'.`;
          const lines = ["# ElevenLabs models", ""];
          for (const model of list) {
            lines.push(`## ${model["name"] ?? model["model_id"]} (${model["model_id"]})`);
            if (model["description"]) lines.push(`- ${model["description"]}`);
            const abilities = [
              model["can_do_text_to_speech"] ? "text to speech" : undefined,
              model["can_do_voice_conversion"] ? "voice conversion" : undefined,
              model["can_use_style"] ? "style" : undefined,
              model["can_use_speaker_boost"] ? "speaker boost" : undefined,
            ].filter(Boolean);
            if (abilities.length) lines.push(`- **Supports**: ${abilities.join(", ")}`);
            if (model["maximum_text_length_per_request"]) {
              lines.push(`- **Max characters per request**: ${model["maximum_text_length_per_request"]}`);
            }
            const languages = model["languages"] as Array<{ name?: string }> | undefined;
            if (languages?.length) {
              lines.push(`- **Languages**: ${languages.map((lang) => lang.name).join(", ")}`);
            }
            lines.push("");
          }
          return lines.join("\n");
        },
        "models",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_get_subscription",
    {
      title: "Get Account Usage and Limits",
      description: `Report the account's subscription tier, character quota usage and voice slot usage.

Read-only and free to call. Use it before a large generation to check remaining quota, or when a request fails with a permission error, to see whether the plan is the cause.

Args:
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "tier": string,                       // e.g. "creator"
    "status": string,                     // e.g. "active"
    "character_count": number,            // characters used this period
    "character_limit": number,
    "characters_remaining": number,
    "next_reset": string,                 // ISO timestamp of the next quota reset
    "voice_slots_used": number,
    "voice_limit": number,
    "professional_voice_slots_used": number,
    "professional_voice_limit": number,
    "billing_period": string
  }

Examples:
  - "How much quota do I have left?" -> {}
  - "Why was my clone rejected?" -> {} to check voice_slots_used against voice_limit
  - Don't use for: per-request costs of a specific generation (see the ElevenLabs dashboard)

Error Handling:
  - "authentication failed" means ELEVENLABS_API_KEY is missing or invalid`,
      inputSchema: subscriptionSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof subscriptionSchema>) => {
      const [subscription, user] = await Promise.all([
        requestJson<Subscription>("v1/user/subscription"),
        requestJson<User>("v1/user").catch(() => undefined),
      ]);

      const used = subscription.character_count ?? 0;
      const limit = subscription.character_limit ?? 0;
      const payload = compact({
        user_id: user?.user_id,
        tier: subscription.tier,
        status: subscription.status,
        character_count: used,
        character_limit: limit,
        characters_remaining: Math.max(0, limit - used),
        next_reset: subscription.next_character_count_reset_unix
          ? isoDate(subscription.next_character_count_reset_unix)
          : undefined,
        voice_slots_used: subscription.voice_slots_used,
        voice_limit: subscription.voice_limit,
        professional_voice_slots_used: subscription.professional_voice_slots_used,
        professional_voice_limit: subscription.professional_voice_limit,
        billing_period: subscription.billing_period,
      });

      return render(params.response_format, payload, (current) => {
        const lines = ["# ElevenLabs account", ""];
        lines.push(`- **Tier**: ${current["tier"] ?? "unknown"} (${current["status"] ?? "unknown"})`);
        lines.push(
          `- **Characters**: ${current["character_count"]} of ${current["character_limit"]} used, ` +
            `${current["characters_remaining"]} remaining`,
        );
        if (current["next_reset"]) lines.push(`- **Quota resets**: ${current["next_reset"]}`);
        if (current["voice_limit"] !== undefined) {
          lines.push(`- **Voice slots**: ${current["voice_slots_used"]} of ${current["voice_limit"]} used`);
        }
        if (current["professional_voice_limit"] !== undefined) {
          lines.push(
            `- **Professional voice slots**: ${current["professional_voice_slots_used"]} of ` +
              `${current["professional_voice_limit"]} used`,
          );
        }
        return lines.join("\n");
      });
    }),
  );

  server.registerTool(
    "elevenlabs_list_history",
    {
      title: "List Generation History",
      description: `List past generations on the account, newest first, with the text, voice, model and character cost of each.

Read-only and free to call. Use it to find a previous generation's history_item_id so its audio can be re-downloaded with elevenlabs_download_history_audio, or to review what a voice has already been used for.

Args:
  - page_size (number): 1-100, default 20
  - start_after_history_item_id (string, optional): from a previous response's next_cursor
  - voice_id (string, optional): only generations made with this voice
  - search (string, optional): free-text filter over the generated text
  - source ('TTS'|'STS', optional): text to speech or speech to speech only
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "count": number,
    "items": [
      {
        "history_item_id": string,   // pass to elevenlabs_download_history_audio
        "voice_id": string,
        "voice_name": string,
        "model_id": string,
        "text": string,              // truncated to 200 characters
        "date": string,              // ISO timestamp
        "characters_billed": number,
        "state": string,
        "source": string
      }
    ],
    "has_more": boolean,
    "next_cursor": string            // pass as start_after_history_item_id when has_more is true
  }

Examples:
  - "What have I generated recently?" -> {}
  - "Find that intro I made with the narrator voice" ->
    { "voice_id": "<narrator id>", "search": "welcome" }
  - Don't use for: downloading the audio itself (use elevenlabs_download_history_audio)

Error Handling:
  - An empty items array means nothing matched, or logging was disabled for those requests`,
      inputSchema: listHistorySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof listHistorySchema>) => {
      const data = await requestJson<HistoryResponse>("v1/history", {
        query: compact({
          page_size: params.page_size,
          start_after_history_item_id: params.start_after_history_item_id,
          voice_id: params.voice_id,
          search: params.search,
          source: params.source,
        }),
      });

      const items = (data.history ?? []).map((item) =>
        compact({
          history_item_id: item.history_item_id,
          voice_id: item.voice_id,
          voice_name: item.voice_name,
          model_id: item.model_id,
          text: item.text ? item.text.slice(0, 200) : undefined,
          date: isoDate(item.date_unix),
          characters_billed:
            item.character_count_change_to !== undefined && item.character_count_change_from !== undefined
              ? item.character_count_change_to - item.character_count_change_from
              : undefined,
          state: item.state,
          source: item.source,
        }),
      );

      const payload = compact({
        count: items.length,
        items,
        has_more: data.has_more ?? false,
        next_cursor: data.has_more ? data.last_history_item_id ?? undefined : undefined,
      });

      return render(
        params.response_format,
        payload,
        (current) => {
          const list = current["items"] as Array<Record<string, unknown>>;
          if (!list.length) return "No history items matched.";
          const lines = ["# Generation history", ""];
          for (const item of list) {
            lines.push(`## ${item["date"]} — ${item["voice_name"] ?? item["voice_id"]}`);
            lines.push(`- **history_item_id**: ${item["history_item_id"]}`);
            if (item["model_id"]) lines.push(`- **Model**: ${item["model_id"]}`);
            if (item["characters_billed"] !== undefined) {
              lines.push(`- **Characters billed**: ${item["characters_billed"]}`);
            }
            if (item["text"]) lines.push(`- **Text**: ${item["text"]}`);
            lines.push("");
          }
          if (current["has_more"]) {
            lines.push(
              `More results available — call again with start_after_history_item_id='${current["next_cursor"]}'.`,
            );
          }
          return lines.join("\n");
        },
        "items",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_download_history_audio",
    {
      title: "Download Audio from History",
      description: `Re-download the audio of a past generation and save it to the output directory.

Free to call — the generation was already billed when it was created, so this is the cheap way to recover audio you have lost.

Args:
  - history_item_id (string): from elevenlabs_list_history
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,       // absolute path to the saved audio
    "size_bytes": number,
    "history_item_id": string
  }

Examples:
  - "Get me that intro audio again" -> { "history_item_id": "<id from elevenlabs_list_history>" }
  - Don't use for: generating new audio (use elevenlabs_text_to_speech)

Error Handling:
  - "not found" means the item was deleted, or was generated with logging disabled`,
      inputSchema: downloadHistorySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof downloadHistorySchema>) => {
      const { data, contentType } = await requestBinary(
        `v1/history/${encodeURIComponent(params.history_item_id)}/audio`,
      );

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: `history-${params.history_item_id}`,
        extension: extensionForContentType(contentType),
      });

      const payload = { ...saved, history_item_id: params.history_item_id };
      return render(
        "markdown",
        payload,
        () => `Saved history item ${params.history_item_id} to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
      );
    }),
  );
}
