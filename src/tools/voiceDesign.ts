/** Designing a brand-new voice from a description, then saving it to the account. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requestJson } from "../services/client.js";
import { defaultFileName, extensionForContentType, saveBinary } from "../services/files.js";
import { compact, guard, humanBytes, render } from "../services/format.js";
import { fileNameSchema, outputFormatSchema } from "../schemas/common.js";
import type { AddVoiceResponse, VoiceDesignResponse } from "../types.js";

const designVoiceSchema = z
  .object({
    voice_description: z
      .string()
      .min(20, "voice_description must be at least 20 characters for a usable result")
      .max(1000)
      .describe(
        "Description of the voice: age, gender, accent, tone, pacing and delivery. " +
          "e.g. 'a warm middle-aged woman with a soft Irish accent, unhurried and reassuring'",
      ),
    text: z
      .string()
      .min(100)
      .max(1000)
      .optional()
      .describe(
        "Sample text the previews will read, 100-1000 characters. " +
          "Generated automatically when omitted and auto_generate_text is true",
      ),
    auto_generate_text: z
      .boolean()
      .default(true)
      .describe("Let ElevenLabs write the preview text. Set false when supplying your own text"),
    model_id: z
      .enum(["eleven_multilingual_ttv_v2", "eleven_ttv_v3"])
      .default("eleven_multilingual_ttv_v2")
      .describe("Voice design model"),
    guidance_scale: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("How literally the description is followed. Higher is more literal, less creative"),
    loudness: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe("Target loudness of the previews, -1 (quietest) to 1 (loudest)"),
    seed: z.number().int().min(0).max(4_294_967_295).optional().describe("Best-effort determinism"),
    output_format: outputFormatSchema,
    file_name_prefix: fileNameSchema.describe(
      "Prefix for the preview file names inside the output directory. Each preview gets a numbered suffix",
    ),
  })
  .strict();

const saveDesignedVoiceSchema = z
  .object({
    generated_voice_id: z
      .string()
      .min(1)
      .describe("generated_voice_id of the preview to keep, from elevenlabs_design_voice"),
    voice_name: z.string().min(1).max(100).describe("Name for the saved voice"),
    voice_description: z
      .string()
      .min(20)
      .max(1000)
      .describe("Description stored with the voice. Reuse the one you designed with"),
    labels: z
      .record(z.string())
      .optional()
      .describe("Metadata labels, e.g. {\"accent\": \"irish\", \"use_case\": \"audiobook\"}"),
  })
  .strict();

export function registerVoiceDesignTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_design_voice",
    {
      title: "Design a Voice from a Description",
      description: `Generate candidate voices from a text description and save an audio preview of each one.

COST WARNING: this consumes generation credits. It does NOT yet add anything to your account — the previews expire, and keeping one requires a follow-up call to elevenlabs_save_designed_voice with its generated_voice_id.

Use this to invent a voice that does not exist yet. To clone a real person's voice from recordings, use elevenlabs_create_voice_clone.

Args:
  - voice_description (string): 20-1000 characters describing age, gender, accent, tone and pacing
  - text (string, optional): 100-1000 characters the previews will read
  - auto_generate_text (boolean): let ElevenLabs write the preview text, default true
  - model_id ('eleven_multilingual_ttv_v2'|'eleven_ttv_v3'): default 'eleven_multilingual_ttv_v2'
  - guidance_scale (number, optional): 0-100, higher follows the description more literally
  - loudness (number, optional): -1 to 1
  - seed (number, optional)
  - output_format (string): default 'mp3_44100_128'
  - file_name_prefix (string, optional): prefix for the preview files

Returns:
  {
    "preview_text": string,       // what the previews say
    "count": number,
    "previews": [
      {
        "generated_voice_id": string,   // pass to elevenlabs_save_designed_voice to keep it
        "file_path": string,            // absolute path to the preview audio
        "size_bytes": number,
        "duration_secs": number
      }
    ]
  }

Examples:
  - "Invent a warm Irish storyteller voice" ->
    { "voice_description": "a warm middle-aged woman with a soft Irish accent, unhurried and reassuring" }
  - "Give me a gruff villain reading this specific line" ->
    { "voice_description": "a gravelly older man, menacing and slow", "text": "<100+ chars>",
      "auto_generate_text": false }
  - Don't use for: reproducing a real person's voice (use elevenlabs_create_voice_clone)

Error Handling:
  - "the API rejected the parameters" usually means text is shorter than 100 characters while
    auto_generate_text is false
  - Previews are temporary; save the one you want before generating another batch`,
      inputSchema: designVoiceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof designVoiceSchema>) => {
      const data = await requestJson<VoiceDesignResponse>("v1/text-to-voice/design", {
        method: "POST",
        query: { output_format: params.output_format },
        json: compact({
          voice_description: params.voice_description,
          text: params.text,
          auto_generate_text: params.auto_generate_text,
          model_id: params.model_id,
          guidance_scale: params.guidance_scale,
          loudness: params.loudness,
          seed: params.seed,
        }),
      });

      const stem = params.file_name_prefix ?? defaultFileName("voice-design", params.voice_description);
      const previews: Array<Record<string, unknown>> = [];
      for (const [index, preview] of (data.previews ?? []).entries()) {
        const saved = await saveBinary(Buffer.from(preview.audio_base_64, "base64"), {
          fileName: `${stem.replace(/\.[^.]+$/, "")}-${index + 1}`,
          defaultName: `${stem}-${index + 1}`,
          extension: extensionForContentType(preview.media_type),
        });
        previews.push(
          compact({
            generated_voice_id: preview.generated_voice_id,
            file_path: saved.file_path,
            size_bytes: saved.size_bytes,
            duration_secs: preview.duration_secs,
          }),
        );
      }

      const payload = {
        preview_text: data.text ?? params.text ?? "",
        count: previews.length,
        previews,
      };

      return render(
        "markdown",
        payload,
        () => {
          if (!previews.length) return "The API returned no previews. Try a more specific voice_description.";
          const lines = [
            `# Designed ${previews.length} candidate voice(s)`,
            "",
            `Preview text: ${payload.preview_text}`,
            "",
          ];
          for (const [index, preview] of previews.entries()) {
            lines.push(`## Candidate ${index + 1}`);
            lines.push(`- **generated_voice_id**: ${preview["generated_voice_id"]}`);
            lines.push(
              `- **Audio**: ${preview["file_path"]} (${humanBytes(preview["size_bytes"] as number)})`,
            );
            lines.push("");
          }
          lines.push(
            "Listen to the previews, then keep one with elevenlabs_save_designed_voice using its generated_voice_id.",
          );
          return lines.join("\n");
        },
        "previews",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_save_designed_voice",
    {
      title: "Save a Designed Voice",
      description: `Turn one of the previews from elevenlabs_design_voice into a permanent voice in your account.

This modifies your account: it consumes a voice slot. Previews expire, so save the candidate you want soon after designing it.

Args:
  - generated_voice_id (string): from the elevenlabs_design_voice response
  - voice_name (string): name for the saved voice
  - voice_description (string): 20-1000 characters, normally the description you designed with
  - labels (object, optional): metadata, e.g. {"accent": "irish"}

Returns:
  { "voice_id": string, "name": string, "saved": true }

Examples:
  - "Keep the second candidate and call it 'Storyteller'" ->
    { "generated_voice_id": "<id from candidate 2>", "voice_name": "Storyteller",
      "voice_description": "a warm middle-aged woman with a soft Irish accent" }
  - Don't use for: voices from the public library (use elevenlabs_add_shared_voice)

Error Handling:
  - "not found" means the preview expired — design the voice again
  - "permission denied" usually means your voice slots are full`,
      inputSchema: saveDesignedVoiceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof saveDesignedVoiceSchema>) => {
      const data = await requestJson<AddVoiceResponse>("v1/text-to-voice", {
        method: "POST",
        json: compact({
          voice_name: params.voice_name,
          voice_description: params.voice_description,
          generated_voice_id: params.generated_voice_id,
          labels: params.labels,
        }),
      });

      const payload = { voice_id: data.voice_id, name: params.voice_name, saved: true };
      return render(
        "markdown",
        payload,
        () =>
          `Saved '${params.voice_name}' as voice_id ${data.voice_id}. It can now be used with elevenlabs_text_to_speech.`,
      );
    }),
  );
}
