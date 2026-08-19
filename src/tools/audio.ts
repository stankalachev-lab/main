/** Sound effects, audio isolation, music composition and forced alignment. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UPLOAD_TIMEOUT_MS } from "../constants.js";
import { requestBinary, requestJson } from "../services/client.js";
import {
  defaultFileName,
  extensionForContentType,
  extensionForOutputFormat,
  loadInputFile,
  saveBinary,
} from "../services/files.js";
import {
  appendFields,
  compact,
  guard,
  humanBytes,
  render,
  responseFormatSchema,
} from "../services/format.js";
import { fileNameSchema, inputFileSchema, outputFormatSchema } from "../schemas/common.js";
import type { ForcedAlignmentResponse } from "../types.js";

const soundEffectSchema = z
  .object({
    text: z
      .string()
      .min(1, "text is required")
      .max(1000)
      .describe(
        "Description of the sound, e.g. 'heavy wooden door creaking open in an empty hall'. " +
          "Concrete, physical descriptions work better than abstract ones",
      ),
    duration_seconds: z
      .number()
      .min(0.5)
      .max(30)
      .optional()
      .describe("Length of the effect. Inferred from the prompt when omitted"),
    prompt_influence: z
      .number()
      .min(0)
      .max(1)
      .default(0.3)
      .describe("Higher values follow the prompt more literally and vary less between runs"),
    loop: z.boolean().default(false).describe("Generate a seamlessly looping effect"),
    output_format: outputFormatSchema,
    file_name: fileNameSchema,
  })
  .strict();

const isolateAudioSchema = z
  .object({
    file_path: inputFileSchema.describe("Local audio or video file to strip background noise from"),
    file_name: fileNameSchema,
  })
  .strict();

const composeMusicSchema = z
  .object({
    prompt: z
      .string()
      .min(1, "prompt is required")
      .max(2000)
      .describe(
        "Description of the track: genre, instrumentation, mood, tempo, structure. " +
          "e.g. 'sparse lo-fi hip hop, dusty piano, 80 bpm, mellow late-night mood'",
      ),
    music_length_ms: z
      .number()
      .int()
      .min(10_000)
      .max(300_000)
      .optional()
      .describe("Track length in milliseconds, 10000-300000. Chosen by the model when omitted"),
    model_id: z
      .enum(["music_v2", "music_v1"])
      .default("music_v2")
      .describe("Music generation model"),
    force_instrumental: z.boolean().default(false).describe("Never generate vocals"),
    seed: z.number().int().min(0).max(4_294_967_295).optional().describe("Best-effort determinism"),
    output_format: outputFormatSchema,
    file_name: fileNameSchema,
  })
  .strict();

const forcedAlignmentSchema = z
  .object({
    file_path: inputFileSchema.describe("Local audio file matching the supplied transcript"),
    text: z
      .string()
      .min(1, "text is required")
      .describe("The exact transcript of the audio, as plain text"),
    include_characters: z
      .boolean()
      .default(false)
      .describe("Include character-level timings as well as word-level ones"),
    response_format: responseFormatSchema,
  })
  .strict();

export function registerAudioTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_text_to_sound_effects",
    {
      title: "Generate a Sound Effect",
      description: `Generate a sound effect or ambience from a text description and save it as an audio file.

COST WARNING: this consumes generation credits.

This produces non-speech audio — foley, ambiences, impacts, UI sounds. For spoken words use elevenlabs_text_to_speech; for music use elevenlabs_compose_music.

Args:
  - text (string): description of the sound, up to 1000 characters
  - duration_seconds (number, optional): 0.5-30; inferred from the prompt when omitted
  - prompt_influence (number): 0-1, default 0.3; higher follows the prompt more literally
  - loop (boolean): generate a seamless loop, default false
  - output_format (string): default 'mp3_44100_128'
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,        // absolute path to the saved audio
    "size_bytes": number,
    "output_format": string,
    "duration_seconds": number, // only when it was requested explicitly
    "prompt": string
  }

Examples:
  - "I need a door creak" -> { "text": "heavy wooden door creaking open in an empty hall" }
  - "Three seconds of rain on a tin roof, loopable" ->
    { "text": "steady rain on a tin roof", "duration_seconds": 3, "loop": true }
  - Don't use for: speech (use elevenlabs_text_to_speech) or music (use elevenlabs_compose_music)

Error Handling:
  - "the API rejected the parameters" usually means duration_seconds is outside 0.5-30
  - loop is only supported by the eleven_text_to_sound_v2 model`,
      inputSchema: soundEffectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof soundEffectSchema>) => {
      const { data } = await requestBinary("v1/sound-generation", {
        method: "POST",
        query: { output_format: params.output_format },
        json: compact({
          text: params.text,
          duration_seconds: params.duration_seconds,
          prompt_influence: params.prompt_influence,
          loop: params.loop,
        }),
      });

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: defaultFileName("sfx", params.text),
        extension: extensionForOutputFormat(params.output_format),
      });

      const payload = compact({
        ...saved,
        output_format: params.output_format,
        duration_seconds: params.duration_seconds,
        prompt: params.text,
      });

      return render(
        "markdown",
        payload,
        () => `Saved sound effect to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
      );
    }),
  );

  server.registerTool(
    "elevenlabs_isolate_audio",
    {
      title: "Isolate Voice from Background Noise",
      description: `Remove background noise and music from a recording, leaving a clean voice track.

COST WARNING: billed by audio duration.

Use this to clean up a noisy recording before transcription or voice cloning. It removes noise; it does not change the speaker's voice.

Args:
  - file_path (string): local audio or video file to clean
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,     // absolute path to the cleaned audio
    "size_bytes": number,
    "source_file": string
  }

Examples:
  - "Clean up this noisy interview recording" -> { "file_path": "/audio/interview.wav" }
  - "Strip the music out before you transcribe it" -> { "file_path": "/audio/podcast.mp3" }
  - Don't use for: changing who the speaker sounds like (use elevenlabs_speech_to_speech)

Error Handling:
  - "No file at ..." means the path is wrong — pass an absolute path
  - "the request timed out" means the file is long; split it into shorter segments`,
      inputSchema: isolateAudioSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof isolateAudioSchema>) => {
      const file = await loadInputFile(params.file_path);
      const form = new FormData();
      form.append("audio", file.blob, file.name);

      const { data, contentType } = await requestBinary("v1/audio-isolation", {
        method: "POST",
        form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: defaultFileName("isolated", file.name),
        extension: extensionForContentType(contentType),
      });

      const payload = { ...saved, source_file: params.file_path };
      return render(
        "markdown",
        payload,
        () =>
          `Isolated the voice track from ${file.name}. Saved to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
      );
    }),
  );

  server.registerTool(
    "elevenlabs_compose_music",
    {
      title: "Compose Music",
      description: `Generate an original music track from a text description and save it as an audio file.

COST WARNING: music generation is one of the more expensive endpoints and is billed by track length. Only call it when the user explicitly asks for music.

Args:
  - prompt (string): genre, instrumentation, mood, tempo and structure
  - music_length_ms (number, optional): 10000-300000; chosen by the model when omitted
  - model_id ('music_v2'|'music_v1'): default 'music_v2'
  - force_instrumental (boolean): never generate vocals, default false
  - seed (number, optional): best-effort determinism
  - output_format (string): default 'mp3_44100_128'
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,       // absolute path to the saved track
    "size_bytes": number,
    "output_format": string,
    "music_length_ms": number, // only when requested explicitly
    "model_id": string,
    "prompt": string
  }

Examples:
  - "Write me 30 seconds of lo-fi study music" ->
    { "prompt": "sparse lo-fi hip hop, dusty piano, 80 bpm, mellow", "music_length_ms": 30000,
      "force_instrumental": true }
  - "An epic orchestral trailer cue" ->
    { "prompt": "epic orchestral trailer cue, taiko drums, rising brass, dramatic finish" }
  - Don't use for: single sounds or ambiences (use elevenlabs_text_to_sound_effects)

Error Handling:
  - "permission denied" means your plan does not include music generation
  - "the request timed out" means the track is long; request a shorter music_length_ms`,
      inputSchema: composeMusicSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof composeMusicSchema>) => {
      const { data } = await requestBinary("v1/music", {
        method: "POST",
        query: { output_format: params.output_format },
        json: compact({
          prompt: params.prompt,
          music_length_ms: params.music_length_ms,
          model_id: params.model_id,
          force_instrumental: params.force_instrumental,
          seed: params.seed,
        }),
      });

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: defaultFileName("music", params.prompt),
        extension: extensionForOutputFormat(params.output_format),
      });

      const payload = compact({
        ...saved,
        output_format: params.output_format,
        music_length_ms: params.music_length_ms,
        model_id: params.model_id,
        prompt: params.prompt,
      });

      return render(
        "markdown",
        payload,
        () => `Saved the composed track to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
      );
    }),
  );

  server.registerTool(
    "elevenlabs_forced_alignment",
    {
      title: "Align a Transcript to Audio",
      description: `Align a transcript you already have against its audio, returning the start and end time of every word.

COST WARNING: billed by audio duration.

Use this when the text is already known and you need timings — subtitles, karaoke, cutting a recording on word boundaries. When you do not have a transcript, use elevenlabs_speech_to_text instead.

Args:
  - file_path (string): local audio file
  - text (string): the exact transcript of that audio
  - include_characters (boolean): also return character-level timings, default false
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "word_count": number,
    "loss": number,                // lower means a better alignment
    "words": [ { "text": string, "start": number, "end": number, "loss": number } ],
    "characters": [ { "text": string, "start": number, "end": number } ]  // only when requested
  }

Examples:
  - "Give me subtitle timings for this narration" ->
    { "file_path": "/audio/narration.mp3", "text": "<the script>" }
  - Don't use for: producing a transcript (use elevenlabs_speech_to_text)

Error Handling:
  - A high loss value means the transcript does not match the audio — check for missing sentences
  - "the API rejected the parameters" usually means the text is empty or far longer than the audio`,
      inputSchema: forcedAlignmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof forcedAlignmentSchema>) => {
      const file = await loadInputFile(params.file_path);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      appendFields(form, { text: params.text });

      const data = await requestJson<ForcedAlignmentResponse>("v1/forced-alignment", {
        method: "POST",
        form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      const words = data.words ?? [];
      const payload = compact({
        word_count: words.length,
        loss: data.loss,
        words,
        characters: params.include_characters ? data.characters : undefined,
      });

      return render(
        params.response_format,
        payload,
        (current) => {
          const list = (current["words"] as ForcedAlignmentResponse["words"]) ?? [];
          const lines = ["# Forced alignment", ""];
          lines.push(`- **Words aligned**: ${current["word_count"]}`);
          if (typeof current["loss"] === "number") {
            lines.push(`- **Alignment loss**: ${(current["loss"] as number).toFixed(4)} (lower is better)`);
          }
          lines.push("", "| start | end | word |", "| --- | --- | --- |");
          for (const word of list) {
            lines.push(`| ${word.start?.toFixed(2)} | ${word.end?.toFixed(2)} | ${word.text} |`);
          }
          return lines.join("\n");
        },
        "words",
      );
    }),
  );
}
