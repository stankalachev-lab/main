/** A stand-in for the ElevenLabs REST API, used by the smoke tests. */

import { createServer } from "node:http";

const AUDIO = Buffer.from("ID3fake-mp3-payload-for-tests");

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function audio(res) {
  res.writeHead(200, { "content-type": "audio/mpeg" });
  res.end(AUDIO);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Starts the mock and returns { url, close, requests } where `requests` records
 * every call the server under test made.
 */
export async function startMockApi() {
  const requests = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const body = await readBody(req);
      requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        apiKey: req.headers["xi-api-key"],
        contentType: req.headers["content-type"],
        body,
      });

      if (req.headers["xi-api-key"] !== "test-key") {
        return json(res, 401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
      }

      const route = `${req.method} ${url.pathname}`;

      switch (true) {
        case route === "GET /v2/voices":
          return json(res, 200, {
            voices: [
              {
                voice_id: "voice-alpha",
                name: "Alpha",
                category: "premade",
                description: "Calm narrator",
                labels: { accent: "british", use_case: "narration" },
                preview_url: "https://example.invalid/alpha.mp3",
              },
              { voice_id: "voice-beta", name: "Beta", category: "cloned", labels: {} },
            ],
            has_more: true,
            next_page_token: "page-2",
          });

        case route === "GET /v1/voices/voice-alpha":
          return json(res, 200, {
            voice_id: "voice-alpha",
            name: "Alpha",
            category: "premade",
            settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 },
            fine_tuning: { state: { eleven_multilingual_v2: "fine_tuned" } },
          });

        case route === "GET /v1/voices/missing-voice":
          return json(res, 404, { detail: { status: "voice_not_found", message: "Voice not found" } });

        case route === "DELETE /v1/voices/voice-beta":
          return json(res, 200, { status: "ok" });

        case route === "GET /v1/shared-voices":
          return json(res, 200, {
            voices: [
              {
                voice_id: "shared-1",
                public_owner_id: "owner-1",
                name: "Shared One",
                category: "professional",
                language: "en",
                cloned_by_count: 42,
              },
            ],
            has_more: false,
          });

        case route === "GET /v1/models":
          return json(res, 200, [
            {
              model_id: "eleven_multilingual_v2",
              name: "Multilingual v2",
              can_do_text_to_speech: true,
              can_do_voice_conversion: false,
              maximum_text_length_per_request: 10000,
              languages: [{ language_id: "en", name: "English" }],
            },
            {
              model_id: "eleven_multilingual_sts_v2",
              name: "STS v2",
              can_do_text_to_speech: false,
              can_do_voice_conversion: true,
            },
          ]);

        case route === "GET /v1/user/subscription":
          return json(res, 200, {
            tier: "creator",
            status: "active",
            character_count: 1500,
            character_limit: 100000,
            next_character_count_reset_unix: 1893456000,
            voice_slots_used: 3,
            voice_limit: 30,
          });

        case route === "GET /v1/user":
          return json(res, 200, { user_id: "user-123" });

        case route === "GET /v1/history":
          return json(res, 200, {
            history: [
              {
                history_item_id: "hist-1",
                voice_id: "voice-alpha",
                voice_name: "Alpha",
                model_id: "eleven_multilingual_v2",
                text: "Hello there",
                date_unix: 1735689600,
                character_count_change_from: 0,
                character_count_change_to: 11,
                state: "created",
                source: "TTS",
              },
            ],
            last_history_item_id: "hist-1",
            has_more: false,
          });

        case route === "GET /v1/history/hist-1/audio":
          return audio(res);

        case route.startsWith("POST /v1/text-to-speech/"):
        case route.startsWith("POST /v1/speech-to-speech/"):
        case route === "POST /v1/sound-generation":
        case route === "POST /v1/music":
        case route === "POST /v1/audio-isolation":
          return audio(res);

        case route === "POST /v1/speech-to-text":
          return json(res, 200, {
            language_code: "en",
            language_probability: 0.99,
            text: "Hello from the mock transcriber.",
            words: [
              { text: "Hello", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" },
              { text: " ", start: 0.4, end: 0.45, type: "spacing" },
              { text: "world", start: 0.45, end: 0.9, type: "word", speaker_id: "speaker_1" },
            ],
          });

        case route === "POST /v1/forced-alignment":
          return json(res, 200, {
            loss: 0.0123,
            words: [{ text: "Hello", start: 0, end: 0.4, loss: 0.01 }],
            characters: [{ text: "H", start: 0, end: 0.05 }],
          });

        case route === "POST /v1/text-to-voice/design":
          return json(res, 200, {
            text: "A preview sentence.",
            previews: [
              {
                audio_base_64: AUDIO.toString("base64"),
                generated_voice_id: "generated-1",
                media_type: "audio/mpeg",
                duration_secs: 4.2,
              },
            ],
          });

        case route === "POST /v1/text-to-voice":
          return json(res, 200, { voice_id: "saved-voice-1" });

        case route === "POST /v1/voices/add":
          return json(res, 200, { voice_id: "cloned-voice-1", requires_verification: false });

        case route.startsWith("POST /v1/voices/add/"):
          return json(res, 200, { voice_id: "added-shared-1" });

        case route === "POST /v1/dubbing":
          return json(res, 200, {
            dubbing_id: "dub-1",
            name: "Test dub",
            expected_duration_sec: 30,
          });

        case route === "GET /v1/dubbing/dub-1":
          return json(res, 200, {
            dubbing_id: "dub-1",
            name: "Test dub",
            status: "dubbed",
            source_language: "en",
            target_languages: ["es"],
          });

        case route === "GET /v1/dubbing/dub-1/audio/es":
          return audio(res);

        default:
          return json(res, 404, { detail: `no mock route for ${route}` });
      }
    })();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const MOCK_AUDIO = AUDIO;
