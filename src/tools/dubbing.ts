/** Dubbing: translate and re-voice media into other languages. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UPLOAD_TIMEOUT_MS } from "../constants.js";
import { requestBinary, requestJson } from "../services/client.js";
import { extensionForContentType, loadInputFile, saveBinary } from "../services/files.js";
import {
  appendFields,
  compact,
  guard,
  humanBytes,
  render,
  responseFormatSchema,
} from "../services/format.js";
import { fileNameSchema } from "../schemas/common.js";
import type { DubbingResponse } from "../types.js";

const createDubSchema = z
  .object({
    target_lang: z
      .string()
      .min(2)
      .max(5)
      .describe("ISO 639-1 code of the language to dub into, e.g. 'es', 'de', 'ja'"),
    file_path: z
      .string()
      .min(1)
      .optional()
      .describe("Local audio or video file to dub. Provide either file_path or source_url"),
    source_url: z
      .string()
      .url()
      .optional()
      .describe("URL of the media to dub, including YouTube and TikTok links"),
    name: z.string().max(200).optional().describe("Name for the dubbing project"),
    source_lang: z
      .string()
      .min(2)
      .max(5)
      .optional()
      .describe("ISO 639-1 code of the source language. Detected automatically when omitted"),
    num_speakers: z
      .number()
      .int()
      .min(1)
      .max(32)
      .optional()
      .describe("Number of speakers in the source. Detected automatically when omitted"),
    watermark: z.boolean().default(false).describe("Watermark the dubbed output"),
    start_time: z.number().int().min(0).optional().describe("Start of the segment to dub, in seconds"),
    end_time: z.number().int().min(0).optional().describe("End of the segment to dub, in seconds"),
    drop_background_audio: z
      .boolean()
      .default(false)
      .describe("Drop the background track, keeping only dubbed speech. Improves clarity"),
  })
  .strict()
  .refine((value) => Boolean(value.file_path) !== Boolean(value.source_url), {
    message: "Provide exactly one of file_path or source_url",
  });

const getDubSchema = z
  .object({
    dubbing_id: z.string().min(1).describe("dubbing_id returned by elevenlabs_create_dub"),
    response_format: responseFormatSchema,
  })
  .strict();

const downloadDubSchema = z
  .object({
    dubbing_id: z.string().min(1).describe("dubbing_id of a project whose status is 'dubbed'"),
    language_code: z
      .string()
      .min(2)
      .max(5)
      .describe("ISO 639-1 code of the dubbed language to download"),
    file_name: fileNameSchema,
  })
  .strict();

export function registerDubbingTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_create_dub",
    {
      title: "Dub Media into Another Language",
      description: `Start a dubbing job that translates media into another language while preserving each speaker's voice.

COST WARNING: dubbing is billed by media duration and is one of the more expensive endpoints. Only call it when the user explicitly asks for a dub.

This is asynchronous: it returns a dubbing_id immediately. Poll elevenlabs_get_dub_status until the status is 'dubbed', then fetch the result with elevenlabs_download_dub. Dubbing a long video can take many minutes.

Args:
  - target_lang (string): ISO 639-1 code to dub into
  - file_path (string, optional): local media file — provide exactly one of file_path or source_url
  - source_url (string, optional): media URL, including YouTube and TikTok
  - name (string, optional): project name
  - source_lang (string, optional): ISO 639-1 source language; detected when omitted
  - num_speakers (number, optional): 1-32
  - watermark (boolean): default false
  - start_time / end_time (number, optional): dub only this segment, in seconds
  - drop_background_audio (boolean): default false

Returns:
  {
    "dubbing_id": string,             // poll with elevenlabs_get_dub_status
    "name": string,
    "target_lang": string,
    "expected_duration_sec": number   // rough estimate of how long the job will take
  }

Examples:
  - "Dub this explainer into Spanish" ->
    { "file_path": "/video/explainer.mp4", "target_lang": "es" }
  - "Dub the first minute of this YouTube video into German" ->
    { "source_url": "https://youtu.be/...", "target_lang": "de", "end_time": 60 }
  - Don't use for: transcribing without translating (use elevenlabs_speech_to_text)

Error Handling:
  - "Provide exactly one of file_path or source_url" means both or neither were given
  - "permission denied" means your plan does not include dubbing
  - "the request timed out" applies to the upload, not the dub itself; the job may still have started —
    check with elevenlabs_get_dub_status`,
      inputSchema: createDubSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof createDubSchema>) => {
      const form = new FormData();
      if (params.file_path) {
        const file = await loadInputFile(params.file_path);
        form.append("file", file.blob, file.name);
      }
      appendFields(form, {
        target_lang: params.target_lang,
        source_url: params.source_url,
        name: params.name,
        source_lang: params.source_lang,
        num_speakers: params.num_speakers,
        watermark: params.watermark,
        start_time: params.start_time,
        end_time: params.end_time,
        drop_background_audio: params.drop_background_audio,
      });

      const data = await requestJson<DubbingResponse>("v1/dubbing", {
        method: "POST",
        form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      const payload = compact({
        dubbing_id: data.dubbing_id,
        name: data.name ?? params.name,
        target_lang: params.target_lang,
        expected_duration_sec: data.expected_duration_sec,
      });

      return render(
        "markdown",
        payload,
        () =>
          [
            `Started dubbing job ${data.dubbing_id} into ${params.target_lang}.`,
            data.expected_duration_sec
              ? `Expected to take about ${Math.round(data.expected_duration_sec)} seconds.`
              : "",
            "Poll elevenlabs_get_dub_status until the status is 'dubbed', then download it with elevenlabs_download_dub.",
          ]
            .filter(Boolean)
            .join("\n"),
      );
    }),
  );

  server.registerTool(
    "elevenlabs_get_dub_status",
    {
      title: "Check a Dubbing Job",
      description: `Report the status of a dubbing job.

Read-only and free to call. Poll this after elevenlabs_create_dub; the audio is only downloadable once the status is 'dubbed'. Leave several seconds between polls — dubbing a long video takes minutes.

Args:
  - dubbing_id (string): from elevenlabs_create_dub
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "dubbing_id": string,
    "name": string,
    "status": string,             // "dubbing" while running, "dubbed" when ready, "failed" on error
    "source_language": string,
    "target_languages": string[], // pass one of these to elevenlabs_download_dub
    "error": string               // present when status is "failed"
  }

Examples:
  - "Is my dub ready?" -> { "dubbing_id": "<id>" }
  - Don't use for: starting a dub (use elevenlabs_create_dub)

Error Handling:
  - status 'failed' with an error field means the job will not complete — start a new one
  - "not found" means the dubbing_id is wrong or the project was deleted`,
      inputSchema: getDubSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof getDubSchema>) => {
      const data = await requestJson<DubbingResponse>(
        `v1/dubbing/${encodeURIComponent(params.dubbing_id)}`,
      );

      const payload = compact({
        dubbing_id: data.dubbing_id,
        name: data.name,
        status: data.status,
        source_language: data.source_language,
        target_languages: data.target_languages,
        error: data.error,
      });

      return render(params.response_format, payload, (current) => {
        const lines = [`# Dubbing job ${current["dubbing_id"]}`, ""];
        lines.push(`- **Status**: ${current["status"]}`);
        if (current["name"]) lines.push(`- **Name**: ${current["name"]}`);
        if (current["source_language"]) lines.push(`- **Source language**: ${current["source_language"]}`);
        const targets = current["target_languages"] as string[] | undefined;
        if (targets?.length) lines.push(`- **Target languages**: ${targets.join(", ")}`);
        if (current["error"]) lines.push(`- **Error**: ${current["error"]}`);
        if (current["status"] === "dubbed" && targets?.length) {
          lines.push("", `Ready — download with elevenlabs_download_dub using language_code='${targets[0]}'.`);
        }
        return lines.join("\n");
      });
    }),
  );

  server.registerTool(
    "elevenlabs_download_dub",
    {
      title: "Download a Dubbed Track",
      description: `Download the finished audio or video of a dubbing job and save it to the output directory.

Free to call — the job was billed when it was created. The job must already have status 'dubbed'; check with elevenlabs_get_dub_status first.

Args:
  - dubbing_id (string): from elevenlabs_create_dub
  - language_code (string): one of the job's target_languages
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,      // absolute path to the saved media
    "size_bytes": number,
    "dubbing_id": string,
    "language_code": string
  }

Examples:
  - "Download the Spanish dub" -> { "dubbing_id": "<id>", "language_code": "es" }
  - Don't use for: checking whether the job is finished (use elevenlabs_get_dub_status)

Error Handling:
  - "not found" usually means the job has not finished yet — poll elevenlabs_get_dub_status
  - "the API rejected the parameters" means language_code is not one of the job's target languages`,
      inputSchema: downloadDubSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof downloadDubSchema>) => {
      const { data, contentType } = await requestBinary(
        `v1/dubbing/${encodeURIComponent(params.dubbing_id)}/audio/${encodeURIComponent(params.language_code)}`,
        { timeoutMs: UPLOAD_TIMEOUT_MS },
      );

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: `dub-${params.dubbing_id}-${params.language_code}`,
        extension: extensionForContentType(contentType, ".mp4"),
      });

      const payload = {
        ...saved,
        dubbing_id: params.dubbing_id,
        language_code: params.language_code,
      };

      return render(
        "markdown",
        payload,
        () =>
          `Saved the ${params.language_code} dub to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
      );
    }),
  );
}
