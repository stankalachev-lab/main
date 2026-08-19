/** Zod fragments reused across tool schemas. */

import { z } from "zod";
import { DEFAULT_OUTPUT_FORMAT, OUTPUT_FORMATS } from "../constants.js";

export const outputFormatSchema = z
  .enum(OUTPUT_FORMATS)
  .default(DEFAULT_OUTPUT_FORMAT)
  .describe(
    "Audio format as codec_samplerate_bitrate. mp3_44100_192 needs Creator tier or above; " +
      "pcm_44100 and above need Pro tier or above. Use ulaw_8000 for Twilio.",
  );

export const fileNameSchema = z
  .string()
  .min(1)
  .max(120)
  .optional()
  .describe(
    "File name (no directories) to save the audio under, inside the server's output directory. " +
      "Defaults to a generated name. The extension is added automatically when omitted.",
  );

export const voiceIdSchema = z
  .string()
  .min(1, "voice_id is required")
  .describe("ElevenLabs voice id, e.g. 'JBFqnCBsd6RMkjVDRZzb'. Look one up with elevenlabs_list_voices.");

export const voiceSettingsSchema = z
  .object({
    stability: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("0 is most expressive and variable, 1 is most stable and monotone"),
    similarity_boost: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How closely the output should match the original voice"),
    style: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Style exaggeration. Higher values raise latency; not supported by every model"),
    use_speaker_boost: z
      .boolean()
      .optional()
      .describe("Boosts similarity to the original speaker at the cost of latency"),
    speed: z
      .number()
      .min(0.7)
      .max(1.2)
      .optional()
      .describe("Speaking rate. 1.0 is the voice's natural speed"),
  })
  .strict()
  .optional()
  .describe("Per-request overrides for the voice's stored settings");

export const inputFileSchema = z
  .string()
  .min(1)
  .describe(
    "Path to a local audio or video file. Absolute paths are safest; relative paths resolve " +
      "against the server's working directory.",
  );
