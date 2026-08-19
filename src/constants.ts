/** Shared constants for the ElevenLabs MCP server. */

export const SERVER_NAME = "elevenlabs-mcp-server";
export const SERVER_VERSION = "1.0.0";

/** Default ElevenLabs API host. Override with ELEVENLABS_BASE_URL for data-residency hosts. */
export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

/**
 * Regional API hosts, documented for convenience. Any of these may be passed
 * through ELEVENLABS_BASE_URL.
 */
export const RESIDENCY_HOSTS = [
  "https://api.elevenlabs.io",
  "https://api.us.elevenlabs.io",
  "https://api.eu.residency.elevenlabs.io",
  "https://api.in.residency.elevenlabs.io",
  "https://api.sg.residency.elevenlabs.io",
] as const;

/** Maximum characters a tool may return before its payload is truncated. */
export const CHARACTER_LIMIT = 25_000;

/** Default request timeout. Generation endpoints are slow, so this is generous. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Longer timeout for endpoints that process uploaded media (transcription, dubbing). */
export const UPLOAD_TIMEOUT_MS = 600_000;

/** Refuse to upload files larger than this to keep requests within API limits. */
export const MAX_UPLOAD_BYTES = 1_000 * 1_000 * 1_000; // 1 GB

/** Default directory for generated audio, relative to the server's working directory. */
export const DEFAULT_OUTPUT_DIRNAME = "elevenlabs-output";

/**
 * Output formats accepted by the audio generation endpoints, formatted as
 * codec_samplerate_bitrate.
 */
export const OUTPUT_FORMATS = [
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_32000",
  "pcm_44100",
  "pcm_48000",
  "ulaw_8000",
  "alaw_8000",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "opus_48000_128",
  "opus_48000_192",
] as const;

export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** File extension to use for each audio codec returned by the API. */
export const EXTENSION_BY_CODEC: Record<string, string> = {
  mp3: ".mp3",
  pcm: ".pcm",
  ulaw: ".ulaw",
  alaw: ".alaw",
  opus: ".opus",
};
