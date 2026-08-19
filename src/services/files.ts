/** Reading input media from disk and writing generated audio back to disk. */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_OUTPUT_DIRNAME,
  EXTENSION_BY_CODEC,
  MAX_UPLOAD_BYTES,
} from "../constants.js";
import { InvalidInputError } from "./client.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pcm": "audio/pcm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

/** Directory generated files are written to. Override with ELEVENLABS_OUTPUT_DIR. */
export function resolveOutputDir(): string {
  const configured = process.env.ELEVENLABS_OUTPUT_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), DEFAULT_OUTPUT_DIRNAME);
}

/** Maps an output_format such as `mp3_44100_128` to the extension to save under. */
export function extensionForOutputFormat(outputFormat: string): string {
  const codec = outputFormat.split("_")[0] ?? "";
  return EXTENSION_BY_CODEC[codec] ?? ".bin";
}

/** Maps a response content-type to an extension, for endpoints without an output_format. */
export function extensionForContentType(contentType: string, fallback = ".mp3"): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/flac": ".flac",
    "audio/basic": ".ulaw",
    "video/mp4": ".mp4",
  };
  return known[type] ?? fallback;
}

/** Turns arbitrary text into a short, filesystem-safe file name stem. */
export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "output";
}

export interface SavedFile {
  /** Absolute path the file was written to. */
  file_path: string;
  /** Size of the file in bytes. */
  size_bytes: number;
}

export interface SaveOptions {
  /** Caller-supplied file name. Must be a bare name, not a path. */
  fileName?: string | undefined;
  /** Name used when the caller does not supply one. */
  defaultName: string;
  /** Extension including the leading dot, appended when the name lacks one. */
  extension: string;
}

/**
 * Writes bytes into the configured output directory.
 *
 * `fileName` is restricted to a bare name so that a tool call can never write
 * outside the output directory.
 */
export async function saveBinary(data: Buffer, options: SaveOptions): Promise<SavedFile> {
  const outputDir = resolveOutputDir();
  const requested = options.fileName?.trim();
  let name: string;

  if (requested) {
    if (requested !== path.basename(requested) || requested === "." || requested === "..") {
      throw new InvalidInputError(
        `file_name must be a bare file name without directory separators (got '${requested}'). ` +
          "Set the ELEVENLABS_OUTPUT_DIR environment variable to change where files are written.",
      );
    }
    name = requested;
  } else {
    name = options.defaultName;
  }

  if (!path.extname(name)) {
    name += options.extension;
  }

  const filePath = path.join(outputDir, name);
  if (path.relative(outputDir, filePath).startsWith("..")) {
    throw new InvalidInputError(`Refusing to write outside the output directory ${outputDir}.`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(filePath, data);
  return { file_path: filePath, size_bytes: data.byteLength };
}

/** Builds a collision-resistant default file name for a generation. */
export function defaultFileName(prefix: string, seedText: string): string {
  const digest = createHash("sha1").update(`${Date.now()}:${seedText}`).digest("hex").slice(0, 8);
  return `${prefix}-${slugify(seedText)}-${digest}`;
}

export interface LoadedFile {
  blob: Blob;
  name: string;
  size_bytes: number;
}

/** Reads a local media file so it can be attached to a multipart request. */
export async function loadInputFile(filePath: string): Promise<LoadedFile> {
  const resolved = path.resolve(filePath);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved);
  } catch {
    throw new InvalidInputError(
      `No file at '${resolved}'. Pass an absolute path, or a path relative to the server's working directory (${process.cwd()}).`,
    );
  }
  if (!info.isFile()) {
    throw new InvalidInputError(`'${resolved}' is not a regular file.`);
  }
  if (info.size === 0) {
    throw new InvalidInputError(`'${resolved}' is empty.`);
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new InvalidInputError(
      `'${resolved}' is ${info.size} bytes, larger than the ${MAX_UPLOAD_BYTES} byte upload limit.`,
    );
  }

  const data = await readFile(resolved);
  const name = path.basename(resolved);
  const type = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
  return { blob: new Blob([data], { type }), name, size_bytes: info.size };
}
