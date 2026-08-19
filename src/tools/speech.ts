/** Text to speech, speech to text and voice-changer tools. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UPLOAD_TIMEOUT_MS } from "../constants.js";
import { requestBinary, requestJson } from "../services/client.js";
import {
  defaultFileName,
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
import {
  fileNameSchema,
  inputFileSchema,
  outputFormatSchema,
  voiceIdSchema,
  voiceSettingsSchema,
} from "../schemas/common.js";
import type { TranscriptionResponse } from "../types.js";

const textToSpeechSchema = z
  .object({
    text: z
      .string()
      .min(1, "text is required")
      .max(40_000)
      .describe("The text to speak. Punctuation and paragraph breaks shape the delivery"),
    voice_id: voiceIdSchema,
    model_id: z
      .string()
      .default("eleven_multilingual_v2")
      .describe(
        "Model to synthesize with. 'eleven_multilingual_v2' for quality, " +
          "'eleven_flash_v2_5' or 'eleven_turbo_v2_5' for low latency. See elevenlabs_list_models",
      ),
    output_format: outputFormatSchema,
    language_code: z
      .string()
      .min(2)
      .max(5)
      .optional()
      .describe("ISO 639-1 code to force a language. Not supported by eleven_multilingual_v2"),
    voice_settings: voiceSettingsSchema,
    seed: z
      .number()
      .int()
      .min(0)
      .max(4_294_967_295)
      .optional()
      .describe("Best-effort determinism: the same seed and inputs should give the same audio"),
    previous_text: z
      .string()
      .max(10_000)
      .optional()
      .describe("Text immediately before this chunk, to keep prosody continuous across chunks"),
    next_text: z
      .string()
      .max(10_000)
      .optional()
      .describe("Text immediately after this chunk, to keep prosody continuous across chunks"),
    apply_text_normalization: z
      .enum(["auto", "on", "off"])
      .default("auto")
      .describe("Whether numbers and dates are spelled out before synthesis"),
    file_name: fileNameSchema,
  })
  .strict();

const speechToTextSchema = z
  .object({
    file_path: inputFileSchema,
    model_id: z
      .enum(["scribe_v2", "scribe_v1"])
      .default("scribe_v2")
      .describe("Transcription model. scribe_v2 is the current default"),
    language_code: z
      .string()
      .min(2)
      .max(5)
      .optional()
      .describe("ISO 639-1/639-3 code of the spoken language. Detected automatically when omitted"),
    diarize: z
      .boolean()
      .default(false)
      .describe("Label which speaker said what. Adds speaker_id to every word"),
    num_speakers: z
      .number()
      .int()
      .min(1)
      .max(32)
      .optional()
      .describe("Hint for how many speakers are present. Improves diarization accuracy"),
    tag_audio_events: z
      .boolean()
      .default(true)
      .describe("Tag non-speech events such as (laughter) in the transcript"),
    timestamps_granularity: z
      .enum(["none", "word", "character"])
      .default("word")
      .describe("Timestamp detail level in the returned words array"),
    keyterms: z
      .array(z.string().max(50))
      .max(1000)
      .optional()
      .describe("Words or phrases to bias recognition towards. Incurs a 20% surcharge"),
    include_words: z
      .boolean()
      .default(false)
      .describe("Return per-word timings. Off by default because word lists are large"),
    response_format: responseFormatSchema,
  })
  .strict();

const speechToSpeechSchema = z
  .object({
    file_path: inputFileSchema.describe(
      "Local recording of the performance to re-voice. The delivery is preserved; only the timbre changes",
    ),
    voice_id: voiceIdSchema,
    model_id: z
      .string()
      .default("eleven_multilingual_sts_v2")
      .describe("Voice-conversion model. Must support voice conversion — see elevenlabs_list_models"),
    output_format: outputFormatSchema,
    voice_settings: voiceSettingsSchema,
    remove_background_noise: z
      .boolean()
      .default(false)
      .describe("Strip background noise from the input before conversion"),
    seed: z.number().int().min(0).max(4_294_967_295).optional().describe("Best-effort determinism"),
    file_name: fileNameSchema,
  })
  .strict();

export function registerSpeechTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_text_to_speech",
    {
      title: "Text to Speech",
      description: `Synthesize speech from text with an ElevenLabs voice and save it as an audio file.

COST WARNING: this consumes characters from your ElevenLabs quota, roughly one credit per character. Keep the text to what the user actually asked for, and generate once rather than iterating over minor wording changes.

The audio is written to the server's output directory (ELEVENLABS_OUTPUT_DIR, default ./elevenlabs-output) and the absolute path is returned — the audio itself is not returned inline.

Args:
  - text (string): what to say, up to 40000 characters
  - voice_id (string): from elevenlabs_list_voices
  - model_id (string): default 'eleven_multilingual_v2'; use 'eleven_flash_v2_5' for low latency
  - output_format (string): default 'mp3_44100_128'
  - language_code (string, optional): ISO 639-1, ignored by eleven_multilingual_v2
  - voice_settings (object, optional): { stability, similarity_boost, style, use_speaker_boost, speed }
  - seed (number, optional), previous_text / next_text (string, optional): continuity across chunks
  - apply_text_normalization ('auto'|'on'|'off'): default 'auto'
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,        // absolute path to the saved audio
    "size_bytes": number,
    "output_format": string,
    "voice_id": string,
    "model_id": string,
    "character_count": number   // characters billed for this request
  }

Examples:
  - "Read this paragraph aloud" -> { "text": "...", "voice_id": "JBFqnCBsd6RMkjVDRZzb" }
  - "Same line but calmer and slower" ->
    { "text": "...", "voice_id": "...", "voice_settings": { "stability": 0.8, "speed": 0.9 } }
  - "Narrate chapter 2, continuing from chapter 1" ->
    { "text": "<chapter 2>", "voice_id": "...", "previous_text": "<end of chapter 1>" }
  - Don't use for: re-voicing an existing recording (use elevenlabs_speech_to_speech)

Error Handling:
  - "not found" means the voice_id is wrong — look it up with elevenlabs_list_voices
  - "permission denied" on mp3_44100_192 or pcm_44100 means your tier does not include that format
  - "rate limited" means too many concurrent requests; wait and retry`,
      inputSchema: textToSpeechSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof textToSpeechSchema>) => {
      const { data } = await requestBinary(
        `v1/text-to-speech/${encodeURIComponent(params.voice_id)}`,
        {
          method: "POST",
          query: { output_format: params.output_format },
          json: compact({
            text: params.text,
            model_id: params.model_id,
            language_code: params.language_code,
            voice_settings: params.voice_settings,
            seed: params.seed,
            previous_text: params.previous_text,
            next_text: params.next_text,
            apply_text_normalization: params.apply_text_normalization,
          }),
        },
      );

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: defaultFileName("speech", params.text),
        extension: extensionForOutputFormat(params.output_format),
      });

      const payload = {
        ...saved,
        output_format: params.output_format,
        voice_id: params.voice_id,
        model_id: params.model_id,
        character_count: params.text.length,
      };

      return render(
        "markdown",
        payload,
        () =>
          [
            `Saved speech to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
            `- **Voice**: ${params.voice_id}`,
            `- **Model**: ${params.model_id}`,
            `- **Format**: ${params.output_format}`,
            `- **Characters billed**: ${params.text.length}`,
          ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "elevenlabs_speech_to_text",
    {
      title: "Speech to Text",
      description: `Transcribe a local audio or video file with ElevenLabs Scribe.

COST WARNING: billed by audio duration. Diarization, keyterms and entity detection add surcharges.

Handles all major audio and video formats. Returns the transcript as text; per-word timings are only included when include_words is true, because they are large.

Args:
  - file_path (string): local audio or video file
  - model_id ('scribe_v2'|'scribe_v1'): default 'scribe_v2'
  - language_code (string, optional): ISO 639-1/639-3; detected automatically when omitted
  - diarize (boolean): label speakers, default false
  - num_speakers (number, optional): 1-32, hint for diarization
  - tag_audio_events (boolean): tag (laughter) etc., default true
  - timestamps_granularity ('none'|'word'|'character'): default 'word'
  - keyterms (string[], optional): bias recognition towards these terms; 20% surcharge
  - include_words (boolean): include per-word timings, default false
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "text": string,                  // the full transcript
    "language_code": string,
    "language_probability": number,
    "word_count": number,
    "speakers": string[],            // present when diarize is true
    "words": [                       // only when include_words is true
      { "text": string, "start": number, "end": number, "type": string, "speaker_id": string }
    ]
  }

Examples:
  - "Transcribe this interview and tell me who said what" ->
    { "file_path": "/audio/interview.mp3", "diarize": true }
  - "Transcribe this German voicemail" -> { "file_path": "/audio/vm.m4a", "language_code": "de" }
  - "Give me word-level timings for subtitles" ->
    { "file_path": "/video/clip.mp4", "include_words": true }
  - Don't use for: aligning a transcript you already have (use elevenlabs_forced_alignment)

Error Handling:
  - "No file at ..." means the path is wrong — pass an absolute path
  - "the request timed out" means the file is long; split it into shorter segments`,
      inputSchema: speechToTextSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof speechToTextSchema>) => {
      const file = await loadInputFile(params.file_path);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      appendFields(form, {
        model_id: params.model_id,
        language_code: params.language_code,
        diarize: params.diarize,
        num_speakers: params.num_speakers,
        tag_audio_events: params.tag_audio_events,
        timestamps_granularity: params.timestamps_granularity,
        keyterms: params.keyterms,
      });

      const data = await requestJson<TranscriptionResponse>("v1/speech-to-text", {
        method: "POST",
        form,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      const words = data.words ?? [];
      const speakers = params.diarize
        ? [...new Set(words.map((word) => word.speaker_id).filter((id): id is string => Boolean(id)))]
        : undefined;

      const payload = compact({
        text: data.text ?? "",
        language_code: data.language_code,
        language_probability: data.language_probability,
        word_count: words.filter((word) => word.type !== "spacing").length,
        speakers: speakers?.length ? speakers : undefined,
        words: params.include_words ? words : undefined,
      });

      return render(
        params.response_format,
        payload,
        (current) => {
          const lines = ["# Transcript", ""];
          if (current["language_code"]) {
            const probability = current["language_probability"];
            lines.push(
              `- **Language**: ${current["language_code"]}` +
                (typeof probability === "number" ? ` (confidence ${probability.toFixed(2)})` : ""),
            );
          }
          lines.push(`- **Words**: ${current["word_count"]}`);
          const detected = current["speakers"] as string[] | undefined;
          if (detected) lines.push(`- **Speakers**: ${detected.join(", ")}`);
          lines.push("", String(current["text"] ?? ""));
          return lines.join("\n");
        },
        "words",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_speech_to_speech",
    {
      title: "Voice Changer (Speech to Speech)",
      description: `Re-voice an existing recording with a different ElevenLabs voice, preserving the original delivery, timing and emotion.

COST WARNING: billed by audio duration.

Use this when the performance already exists and only the timbre should change. To generate a performance from text instead, use elevenlabs_text_to_speech.

Args:
  - file_path (string): local recording to convert
  - voice_id (string): the target voice
  - model_id (string): default 'eleven_multilingual_sts_v2'; must support voice conversion
  - output_format (string): default 'mp3_44100_128'
  - voice_settings (object, optional)
  - remove_background_noise (boolean): default false
  - seed (number, optional)
  - file_name (string, optional): bare file name inside the output directory

Returns:
  {
    "file_path": string,     // absolute path to the converted audio
    "size_bytes": number,
    "output_format": string,
    "voice_id": string,
    "model_id": string,
    "source_file": string
  }

Examples:
  - "Make my demo track sound like this narrator" ->
    { "file_path": "/audio/demo.wav", "voice_id": "<narrator id>" }
  - "Same but clean up the room noise first" ->
    { "file_path": "/audio/demo.wav", "voice_id": "...", "remove_background_noise": true }
  - Don't use for: removing background noise alone (use elevenlabs_isolate_audio)

Error Handling:
  - "the API rejected the parameters" often means the model does not support voice conversion —
    check can_do_voice_conversion in elevenlabs_list_models`,
      inputSchema: speechToSpeechSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof speechToSpeechSchema>) => {
      const file = await loadInputFile(params.file_path);
      const form = new FormData();
      form.append("audio", file.blob, file.name);
      appendFields(form, {
        model_id: params.model_id,
        voice_settings: params.voice_settings,
        remove_background_noise: params.remove_background_noise,
        seed: params.seed,
      });

      const { data } = await requestBinary(
        `v1/speech-to-speech/${encodeURIComponent(params.voice_id)}`,
        {
          method: "POST",
          query: { output_format: params.output_format },
          form,
          timeoutMs: UPLOAD_TIMEOUT_MS,
        },
      );

      const saved = await saveBinary(data, {
        fileName: params.file_name,
        defaultName: defaultFileName("voice-changed", file.name),
        extension: extensionForOutputFormat(params.output_format),
      });

      const payload = {
        ...saved,
        output_format: params.output_format,
        voice_id: params.voice_id,
        model_id: params.model_id,
        source_file: params.file_path,
      };

      return render(
        "markdown",
        payload,
        () =>
          [
            `Converted ${file.name} to voice ${params.voice_id}.`,
            `Saved to ${saved.file_path} (${humanBytes(saved.size_bytes)}).`,
          ].join("\n"),
      );
    }),
  );
}
