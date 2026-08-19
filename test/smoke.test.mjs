/**
 * End-to-end tests: drives the built server over stdio with a real MCP client,
 * against a mock ElevenLabs API.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MOCK_AUDIO, startMockApi } from "./mockApi.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");

let mock;
let client;
let outputDir;
let sampleAudioPath;

/** Pulls the text of the first content block out of a tool result. */
function text(result) {
  return result.content.map((block) => block.text).join("\n");
}

before(async () => {
  mock = await startMockApi();
  outputDir = await mkdtemp(path.join(tmpdir(), "elevenlabs-mcp-test-"));
  sampleAudioPath = path.join(outputDir, "sample-input.mp3");
  await writeFile(sampleAudioPath, MOCK_AUDIO);

  client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: {
        ...process.env,
        ELEVENLABS_API_KEY: "test-key",
        ELEVENLABS_BASE_URL: mock.url,
        ELEVENLABS_OUTPUT_DIR: outputDir,
      },
      stderr: "ignore",
    }),
  );
});

after(async () => {
  await client?.close();
  await mock?.close();
});

describe("tool registration", () => {
  it("exposes every tool with annotations and a description", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "elevenlabs_add_shared_voice",
      "elevenlabs_compose_music",
      "elevenlabs_create_dub",
      "elevenlabs_create_voice_clone",
      "elevenlabs_delete_voice",
      "elevenlabs_design_voice",
      "elevenlabs_download_dub",
      "elevenlabs_download_history_audio",
      "elevenlabs_forced_alignment",
      "elevenlabs_get_dub_status",
      "elevenlabs_get_subscription",
      "elevenlabs_get_voice",
      "elevenlabs_isolate_audio",
      "elevenlabs_list_history",
      "elevenlabs_list_models",
      "elevenlabs_list_voices",
      "elevenlabs_save_designed_voice",
      "elevenlabs_search_voice_library",
      "elevenlabs_speech_to_speech",
      "elevenlabs_speech_to_text",
      "elevenlabs_text_to_sound_effects",
      "elevenlabs_text_to_speech",
    ]);

    for (const tool of tools) {
      assert.ok(tool.description?.length > 200, `${tool.name} needs a full description`);
      assert.ok(tool.annotations, `${tool.name} is missing annotations`);
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean", tool.name);
      assert.equal(tool.inputSchema.type, "object", tool.name);
    }
  });

  it("marks elevenlabs_delete_voice as the only destructive tool", async () => {
    const { tools } = await client.listTools();
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint).map((t) => t.name);
    assert.deepEqual(destructive, ["elevenlabs_delete_voice"]);
  });
});

describe("read-only tools", () => {
  it("lists voices and surfaces the pagination cursor", async () => {
    const result = await client.callTool({ name: "elevenlabs_list_voices", arguments: { search: "calm" } });
    const rendered = text(result);

    assert.match(rendered, /Alpha \(voice-alpha\)/);
    assert.match(rendered, /accent=british/);
    assert.match(rendered, /next_page_token='page-2'/);
    assert.equal(result.structuredContent.has_more, true);
    assert.equal(result.structuredContent.voices.length, 2);

    const call = mock.requests.at(-1);
    assert.equal(call.path, "/v2/voices");
    assert.equal(call.query.search, "calm");
    assert.equal(call.query.page_size, "20");
    assert.equal(call.apiKey, "test-key");
  });

  it("returns JSON when asked to", async () => {
    const result = await client.callTool({
      name: "elevenlabs_list_voices",
      arguments: { response_format: "json" },
    });
    const parsed = JSON.parse(text(result));
    assert.equal(parsed.voices[0].voice_id, "voice-alpha");
  });

  it("includes stored settings and fine-tuning state for one voice", async () => {
    const result = await client.callTool({
      name: "elevenlabs_get_voice",
      arguments: { voice_id: "voice-alpha" },
    });
    const rendered = text(result);
    assert.match(rendered, /stability/);
    assert.match(rendered, /eleven_multilingual_v2.*fine_tuned/);
    assert.equal(mock.requests.at(-1).query.with_settings, "true");
  });

  it("filters models by capability", async () => {
    const result = await client.callTool({
      name: "elevenlabs_list_models",
      arguments: { capability: "voice_conversion" },
    });
    assert.equal(result.structuredContent.count, 1);
    assert.equal(result.structuredContent.models[0].model_id, "eleven_multilingual_sts_v2");
  });

  it("reports remaining character quota", async () => {
    const result = await client.callTool({ name: "elevenlabs_get_subscription", arguments: {} });
    assert.equal(result.structuredContent.characters_remaining, 98500);
    assert.match(text(result), /1500 of 100000 used/);
  });

  it("computes characters billed per history item", async () => {
    const result = await client.callTool({ name: "elevenlabs_list_history", arguments: {} });
    assert.equal(result.structuredContent.items[0].characters_billed, 11);
    assert.equal(result.structuredContent.has_more, false);
  });

  it("surfaces shared library voices with their owner id", async () => {
    const result = await client.callTool({
      name: "elevenlabs_search_voice_library",
      arguments: { language: "en" },
    });
    assert.match(text(result), /Owner.*owner-1/);
  });
});

describe("generation tools", () => {
  it("writes speech to the output directory and reports the path", async () => {
    const result = await client.callTool({
      name: "elevenlabs_text_to_speech",
      arguments: { text: "Hello world", voice_id: "voice-alpha", file_name: "greeting" },
    });

    const filePath = result.structuredContent.file_path;
    assert.equal(filePath, path.join(outputDir, "greeting.mp3"));
    assert.deepEqual(await readFile(filePath), MOCK_AUDIO);
    assert.equal(result.structuredContent.character_count, 11);

    const call = mock.requests.at(-1);
    assert.equal(call.path, "/v1/text-to-speech/voice-alpha");
    assert.equal(call.query.output_format, "mp3_44100_128");
    const body = JSON.parse(call.body.toString());
    assert.equal(body.text, "Hello world");
    assert.equal(body.model_id, "eleven_multilingual_v2");
  });

  it("chooses the file extension from the requested output format", async () => {
    const result = await client.callTool({
      name: "elevenlabs_text_to_speech",
      arguments: {
        text: "Raw audio",
        voice_id: "voice-alpha",
        output_format: "pcm_24000",
        file_name: "raw-take",
      },
    });
    assert.ok(result.structuredContent.file_path.endsWith("raw-take.pcm"));
  });

  it("transcribes an uploaded file as multipart form data", async () => {
    const result = await client.callTool({
      name: "elevenlabs_speech_to_text",
      arguments: { file_path: sampleAudioPath, diarize: true },
    });

    assert.match(text(result), /Hello from the mock transcriber/);
    assert.deepEqual(result.structuredContent.speakers, ["speaker_0", "speaker_1"]);
    assert.equal(result.structuredContent.word_count, 2, "spacing tokens are not words");
    assert.equal(result.structuredContent.words, undefined, "words are omitted unless requested");

    const call = mock.requests.at(-1);
    assert.match(call.contentType, /^multipart\/form-data/);
    assert.match(call.body.toString(), /name="model_id"\r\n\r\nscribe_v2/);
    assert.match(call.body.toString(), /name="diarize"\r\n\r\ntrue/);
  });

  it("includes word timings on request", async () => {
    const result = await client.callTool({
      name: "elevenlabs_speech_to_text",
      arguments: { file_path: sampleAudioPath, include_words: true },
    });
    assert.equal(result.structuredContent.words.length, 3);
  });

  it("saves generated sound effects", async () => {
    const result = await client.callTool({
      name: "elevenlabs_text_to_sound_effects",
      arguments: { text: "door creaking open", duration_seconds: 3 },
    });
    assert.ok(result.structuredContent.file_path.includes("sfx-door-creaking-open"));
    const body = JSON.parse(mock.requests.at(-1).body.toString());
    assert.equal(body.duration_seconds, 3);
    assert.equal(body.prompt_influence, 0.3);
  });

  it("decodes voice design previews into audio files", async () => {
    const result = await client.callTool({
      name: "elevenlabs_design_voice",
      arguments: {
        voice_description: "a warm middle-aged woman with a soft Irish accent, unhurried",
      },
    });

    const [preview] = result.structuredContent.previews;
    assert.equal(preview.generated_voice_id, "generated-1");
    assert.deepEqual(await readFile(preview.file_path), MOCK_AUDIO);
    assert.match(text(result), /elevenlabs_save_designed_voice/);
  });

  it("aligns a transcript and renders a timing table", async () => {
    const result = await client.callTool({
      name: "elevenlabs_forced_alignment",
      arguments: { file_path: sampleAudioPath, text: "Hello" },
    });
    assert.match(text(result), /\| 0\.00 \| 0\.40 \| Hello \|/);
    assert.equal(result.structuredContent.characters, undefined);
  });

  it("runs a dubbing job end to end", async () => {
    const created = await client.callTool({
      name: "elevenlabs_create_dub",
      arguments: { file_path: sampleAudioPath, target_lang: "es" },
    });
    assert.equal(created.structuredContent.dubbing_id, "dub-1");

    const status = await client.callTool({
      name: "elevenlabs_get_dub_status",
      arguments: { dubbing_id: "dub-1" },
    });
    assert.equal(status.structuredContent.status, "dubbed");

    const downloaded = await client.callTool({
      name: "elevenlabs_download_dub",
      arguments: { dubbing_id: "dub-1", language_code: "es" },
    });
    assert.deepEqual(await readFile(downloaded.structuredContent.file_path), MOCK_AUDIO);
  });
});

describe("error handling", () => {
  it("turns a 404 into an actionable message instead of a protocol error", async () => {
    const result = await client.callTool({
      name: "elevenlabs_get_voice",
      arguments: { voice_id: "missing-voice" },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /not found/i);
    assert.match(text(result), /elevenlabs_list_voices/);
  });

  it("reports a missing input file without calling the API", async () => {
    const before = mock.requests.length;
    const result = await client.callTool({
      name: "elevenlabs_speech_to_text",
      arguments: { file_path: path.join(outputDir, "does-not-exist.mp3") },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /No file at/);
    assert.equal(mock.requests.length, before, "no request should have been made");
  });

  it("refuses a file_name that escapes the output directory", async () => {
    const result = await client.callTool({
      name: "elevenlabs_text_to_speech",
      arguments: { text: "escape attempt", voice_id: "voice-alpha", file_name: "../escaped.mp3" },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /without directory separators/);
  });

  it("rejects unknown parameters", async () => {
    const result = await client.callTool({
      name: "elevenlabs_list_voices",
      arguments: { not_a_real_param: true },
    });
    assert.equal(result.isError, true);
  });

  it("requires exactly one media source for dubbing", async () => {
    const result = await client.callTool({
      name: "elevenlabs_create_dub",
      arguments: { target_lang: "es" },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /exactly one of file_path or source_url/);
  });

  it("deletes a voice when explicitly asked", async () => {
    const result = await client.callTool({
      name: "elevenlabs_delete_voice",
      arguments: { voice_id: "voice-beta" },
    });
    assert.equal(result.structuredContent.deleted, true);
    assert.equal(mock.requests.at(-1).method, "DELETE");
  });
});
