# elevenlabs-mcp-server

An MCP server for the [ElevenLabs](https://elevenlabs.io) API. It gives an MCP client
22 tools covering text to speech, speech to text, the voice changer, sound effects,
music, voice design, voice management, generation history and dubbing.

Generated audio is written to a directory on disk and the tool returns the file path,
so large audio payloads never pass through the model's context.

## Requirements

- Node.js 18 or newer
- An ElevenLabs API key from <https://elevenlabs.io/app/settings/api-keys>

## Install

```bash
npm install
npm run build
```

## Configure

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ELEVENLABS_API_KEY` | yes | — | Your API key. The server exits at startup if it is missing. |
| `ELEVENLABS_OUTPUT_DIR` | no | `./elevenlabs-output` | Where generated audio is written. |
| `ELEVENLABS_BASE_URL` | no | `https://api.elevenlabs.io` | Point this at a data-residency host such as `https://api.eu.residency.elevenlabs.io`. |
| `TRANSPORT` | no | `stdio` | Set to `http` for streamable HTTP. |
| `PORT` | no | `3000` | Port for the HTTP transport. |

### Claude Code

```bash
claude mcp add elevenlabs \
  --env ELEVENLABS_API_KEY=your_key_here \
  --env ELEVENLABS_OUTPUT_DIR=/absolute/path/for/audio \
  -- node /absolute/path/to/elevenlabs-mcp-server/dist/index.js
```

### Claude Desktop / any client that reads a JSON config

```json
{
  "mcpServers": {
    "elevenlabs": {
      "command": "node",
      "args": ["/absolute/path/to/elevenlabs-mcp-server/dist/index.js"],
      "env": {
        "ELEVENLABS_API_KEY": "your_key_here",
        "ELEVENLABS_OUTPUT_DIR": "/absolute/path/for/audio"
      }
    }
  }
}
```

Never commit the key. Pass it through the client's environment configuration.

## Tools

Tools that only read data are free to call. Tools marked **costs credits** consume
your ElevenLabs quota — call them when the user actually asks for the output.

### Voices

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_list_voices` | free | Search the voices on your account. Use it to turn a voice name into a `voice_id`. |
| `elevenlabs_get_voice` | free | Full record for one voice, including stored settings and clone training state. |
| `elevenlabs_search_voice_library` | free | Browse the public voice library. |
| `elevenlabs_add_shared_voice` | slot | Add a library voice to your account. |
| `elevenlabs_create_voice_clone` | costs credits | Instant voice clone from local audio samples. |
| `elevenlabs_delete_voice` | destructive | Permanently delete a voice. |

### Speech

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_text_to_speech` | costs credits | Synthesize speech and save it as an audio file. |
| `elevenlabs_speech_to_text` | costs credits | Transcribe audio or video with Scribe, optionally diarized. |
| `elevenlabs_speech_to_speech` | costs credits | Re-voice an existing recording, keeping the original delivery. |

### Audio and music

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_text_to_sound_effects` | costs credits | Generate a sound effect or ambience from a description. |
| `elevenlabs_compose_music` | costs credits | Generate an original music track. |
| `elevenlabs_isolate_audio` | costs credits | Strip background noise and music from a recording. |
| `elevenlabs_forced_alignment` | costs credits | Align a known transcript to audio for word-level timings. |

### Voice design

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_design_voice` | costs credits | Invent candidate voices from a description and save previews. |
| `elevenlabs_save_designed_voice` | slot | Keep one candidate as a permanent voice. |

### Account and history

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_list_models` | free | List models and their capabilities and limits. |
| `elevenlabs_get_subscription` | free | Tier, character quota and voice slot usage. |
| `elevenlabs_list_history` | free | Past generations with their text, voice and character cost. |
| `elevenlabs_download_history_audio` | free | Re-download audio from a past generation. |

### Dubbing

| Tool | Cost | What it does |
| --- | --- | --- |
| `elevenlabs_create_dub` | costs credits | Start a dubbing job from a file or URL. Asynchronous. |
| `elevenlabs_get_dub_status` | free | Poll a dubbing job until its status is `dubbed`. |
| `elevenlabs_download_dub` | free | Download the finished dub. |

## Examples

**Narrate a script with a specific voice.** Ask for a voice by description; the client
calls `elevenlabs_list_voices` with `{"search": "calm british narrator"}`, then
`elevenlabs_text_to_speech` with the `voice_id` it found and your text. The reply carries
the path of the saved MP3.

**Transcribe an interview with speakers labelled.**
`elevenlabs_speech_to_text` with `{"file_path": "/audio/interview.mp3", "diarize": true}`
returns the transcript plus the list of detected speakers. Add `"include_words": true`
when you need per-word timings for subtitles.

**Invent a voice and keep it.** `elevenlabs_design_voice` with a `voice_description`
writes one audio preview per candidate and returns a `generated_voice_id` for each.
Pass the id of the one you like to `elevenlabs_save_designed_voice` to add it to
your account.

## Behaviour worth knowing

- **Audio goes to disk, not into the conversation.** Every generation tool returns
  `file_path` and `size_bytes`. `file_name` must be a bare name; paths that would escape
  the output directory are rejected.
- **Responses are capped.** Long listings and transcripts are shortened to stay within
  25,000 characters, and the response says how much was dropped and how to page through
  the rest.
- **Errors come back as tool results, not protocol failures**, with a message that names
  the likely cause: an invalid key, an exhausted plan limit, a wrong id, a rate limit.
- **`markdown` or `json`.** Read-only tools accept `response_format`; `markdown` is the
  default and `json` returns the raw fields.

## Development

```bash
npm run build      # compile to dist/
npm run typecheck  # types only
npm test           # build, then run the smoke tests
npm run dev        # watch mode
```

The tests in `test/` drive the built server over stdio with a real MCP client against a
mock ElevenLabs API (`test/mockApi.mjs`), so they never call the real service and need
no API key.

### HTTP transport

```bash
TRANSPORT=http PORT=3000 ELEVENLABS_API_KEY=... node dist/index.js
```

It binds to `127.0.0.1` only and rejects cross-origin browser requests, which protects a
locally bound server from DNS rebinding. Each request gets its own stateless transport.

## License

MIT
