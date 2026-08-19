/** Tools for finding, inspecting and managing voices. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requestJson } from "../services/client.js";
import { appendFields, compact, guard, render, responseFormatSchema } from "../services/format.js";
import { loadInputFile } from "../services/files.js";
import { inputFileSchema, voiceIdSchema } from "../schemas/common.js";
import type {
  AddVoiceResponse,
  SharedVoice,
  SharedVoicesResponse,
  Voice,
  VoicesSearchResponse,
} from "../types.js";

/** Keeps voice records small so long listings stay readable in context. */
function summarizeVoice(voice: Voice): Record<string, unknown> {
  return compact({
    voice_id: voice.voice_id,
    name: voice.name,
    category: voice.category,
    description: voice.description,
    labels: voice.labels && Object.keys(voice.labels).length ? voice.labels : undefined,
    preview_url: voice.preview_url,
  });
}

function renderVoiceLines(voice: Record<string, unknown>): string[] {
  const lines = [`## ${voice["name"] ?? "(unnamed)"} (${voice["voice_id"]})`];
  if (voice["category"]) lines.push(`- **Category**: ${voice["category"]}`);
  const labels = voice["labels"] as Record<string, string> | undefined;
  if (labels) {
    lines.push(
      `- **Labels**: ${Object.entries(labels)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`,
    );
  }
  if (voice["description"]) lines.push(`- **Description**: ${voice["description"]}`);
  lines.push("");
  return lines;
}

const listVoicesSchema = z
  .object({
    search: z
      .string()
      .max(200)
      .optional()
      .describe("Free-text filter matched against name, description, labels and category"),
    voice_type: z
      .enum(["personal", "community", "default", "workspace", "non-default", "non-community", "saved"])
      .optional()
      .describe("Restricts results by how the voice was obtained"),
    category: z
      .enum(["premade", "cloned", "generated", "professional"])
      .optional()
      .describe("Restricts results by voice category"),
    voice_ids: z
      .array(z.string().min(1))
      .max(100)
      .optional()
      .describe("Look up specific voices by id instead of searching"),
    language: z.array(z.string().min(1)).optional().describe("Filter by the voice's language labels"),
    gender: z.string().optional().describe("Filter by the voice's gender label"),
    age: z.string().optional().describe("Filter by the voice's age label"),
    accent: z.string().optional().describe("Filter by the voice's accent label"),
    use_cases: z.array(z.string().min(1)).optional().describe("Filter by the voice's use-case labels"),
    sort: z.enum(["created_at_unix", "name"]).optional().describe("Field to sort by"),
    sort_direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum voices to return (1-100)"),
    next_page_token: z
      .string()
      .optional()
      .describe("Token from a previous response's next_page_token, to fetch the following page"),
    include_total_count: z
      .boolean()
      .default(false)
      .describe("Include total_count in the response. Costs extra time; has_more is enough to paginate"),
    response_format: responseFormatSchema,
  })
  .strict();

const getVoiceSchema = z
  .object({
    voice_id: voiceIdSchema,
    include_settings: z
      .boolean()
      .default(true)
      .describe("Include the voice's stored stability/similarity/style settings"),
    response_format: responseFormatSchema,
  })
  .strict();

const searchLibrarySchema = z
  .object({
    search: z.string().max(200).optional().describe("Free-text filter over shared voice names and descriptions"),
    category: z
      .enum(["professional", "famous", "high_quality"])
      .optional()
      .describe("Restricts results to a shared-voice category"),
    gender: z.string().optional().describe("Filter by gender label, e.g. 'female'"),
    age: z.string().optional().describe("Filter by age label, e.g. 'young'"),
    accent: z.string().optional().describe("Filter by accent label, e.g. 'british'"),
    language: z.string().optional().describe("Filter by ISO 639-1 language code, e.g. 'en'"),
    use_cases: z.array(z.string().min(1)).optional().describe("Filter by use-case labels"),
    featured: z.boolean().optional().describe("Only return voices featured by ElevenLabs"),
    sort: z.string().optional().describe("Sort order, e.g. 'trending' or 'cloned_by_count'"),
    page: z.number().int().min(0).default(0).describe("Zero-based page index"),
    page_size: z.number().int().min(1).max(100).default(20).describe("Voices per page (1-100)"),
    response_format: responseFormatSchema,
  })
  .strict();

const addSharedVoiceSchema = z
  .object({
    public_user_id: z
      .string()
      .min(1)
      .describe("public_owner_id of the shared voice, from elevenlabs_search_voice_library"),
    voice_id: z.string().min(1).describe("voice_id of the shared voice to add"),
    new_name: z.string().min(1).max(100).describe("Name to save the voice under in your workspace"),
  })
  .strict();

const createVoiceCloneSchema = z
  .object({
    name: z.string().min(1).max(100).describe("Name for the new voice"),
    file_paths: z
      .array(inputFileSchema)
      .min(1, "at least one sample is required")
      .max(25)
      .describe("Local audio samples of the speaker. Clean, single-speaker recordings work best"),
    description: z
      .string()
      .max(500)
      .optional()
      .describe("Free-text description stored with the voice"),
    labels: z
      .record(z.string())
      .optional()
      .describe("Metadata labels, e.g. {\"accent\": \"british\", \"use_case\": \"narration\"}"),
    remove_background_noise: z
      .boolean()
      .default(false)
      .describe("Strip background noise from the samples before cloning"),
  })
  .strict();

const deleteVoiceSchema = z
  .object({
    voice_id: voiceIdSchema,
  })
  .strict();

export function registerVoiceTools(server: McpServer): void {
  server.registerTool(
    "elevenlabs_list_voices",
    {
      title: "List ElevenLabs Voices",
      description: `List and search the voices available to your ElevenLabs account, including premade voices, your clones and voices saved from the library.

This is the tool to use to turn a voice name into the voice_id that the speech tools require. It reads existing voices only; it never creates or deletes one, and it is free to call.

Args:
  - search (string, optional): free-text filter over name, description, labels and category
  - voice_type ('personal'|'community'|'default'|'workspace'|'non-default'|'non-community'|'saved', optional)
  - category ('premade'|'cloned'|'generated'|'professional', optional)
  - voice_ids (string[], optional): look up specific voices instead of searching, max 100
  - language (string[]), gender, age, accent (string), use_cases (string[]): label filters
  - sort ('created_at_unix'|'name'), sort_direction ('asc'|'desc')
  - page_size (number): 1-100, default 20
  - next_page_token (string, optional): from a previous response
  - include_total_count (boolean): default false
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "count": number,             // voices in this response
    "total_count": number,       // only when include_total_count is true
    "voices": [
      {
        "voice_id": string,
        "name": string,
        "category": string,      // e.g. "premade", "cloned"
        "description": string,   // optional
        "labels": object,        // optional, e.g. {"accent": "british"}
        "preview_url": string    // optional sample audio URL
      }
    ],
    "has_more": boolean,
    "next_page_token": string    // pass back as next_page_token when has_more is true
  }

Examples:
  - "What voices do I have?" -> {}
  - "Find a calm British narrator" -> { "search": "calm british narrator" }
  - "List only my own cloned voices" -> { "voice_type": "personal", "category": "cloned" }
  - Don't use for: browsing voices you have not added yet (use elevenlabs_search_voice_library)

Error Handling:
  - "authentication failed" means ELEVENLABS_API_KEY is missing or invalid
  - An empty voices array means no voice matched; broaden or drop the filters`,
      inputSchema: listVoicesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof listVoicesSchema>) => {
      const data = await requestJson<VoicesSearchResponse>("v2/voices", {
        query: compact({
          search: params.search,
          voice_type: params.voice_type,
          category: params.category,
          voice_ids: params.voice_ids,
          language: params.language,
          gender: params.gender,
          age: params.age,
          accent: params.accent,
          use_cases: params.use_cases,
          sort: params.sort,
          sort_direction: params.sort_direction,
          page_size: params.page_size,
          next_page_token: params.next_page_token,
          include_total_count: params.include_total_count,
        }),
      });

      const voices = (data.voices ?? []).map(summarizeVoice);
      const payload = compact({
        count: voices.length,
        total_count: params.include_total_count ? data.total_count : undefined,
        voices,
        has_more: data.has_more ?? false,
        next_page_token: data.next_page_token ?? undefined,
      });

      return render(
        params.response_format,
        payload,
        (current) => {
          const list = current["voices"] as Array<Record<string, unknown>>;
          if (!list.length) {
            return params.search
              ? `No voices matched '${params.search}'. Try a broader search, or browse the public library with elevenlabs_search_voice_library.`
              : "No voices found for this account.";
          }
          const header = params.search ? `# Voices matching '${params.search}'` : "# Voices";
          const lines = [header, "", `Showing ${list.length} voice(s).`, ""];
          for (const voice of list) lines.push(...renderVoiceLines(voice));
          if (current["has_more"]) {
            lines.push(`More results available — call again with next_page_token='${current["next_page_token"]}'.`);
          }
          return lines.join("\n");
        },
        "voices",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_get_voice",
    {
      title: "Get ElevenLabs Voice Details",
      description: `Fetch the full record for one voice, including its stored voice settings and, for cloned voices, its fine-tuning state.

Read-only and free to call. Use it before generating speech when you want to know a voice's default stability/similarity settings, or to confirm a clone has finished training.

Args:
  - voice_id (string): the voice to fetch
  - include_settings (boolean): include stored voice settings, default true
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "voice_id": string,
    "name": string,
    "category": string,
    "description": string,          // optional
    "labels": object,               // optional
    "preview_url": string,          // optional
    "settings": {                   // present when include_settings is true
      "stability": number,
      "similarity_boost": number,
      "style": number,
      "use_speaker_boost": boolean,
      "speed": number
    },
    "fine_tuning_state": object,    // optional, per-model training state for clones
    "verified_languages": [ { "language": string, "accent": string } ]
  }

Examples:
  - "What are the default settings for this voice?" -> { "voice_id": "JBFqnCBsd6RMkjVDRZzb" }
  - "Has my clone finished training?" -> { "voice_id": "<clone id>" }
  - Don't use for: searching by name (use elevenlabs_list_voices)

Error Handling:
  - "not found" means the voice_id does not exist or is not visible to this account`,
      inputSchema: getVoiceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof getVoiceSchema>) => {
      const voice = await requestJson<Voice>(`v1/voices/${encodeURIComponent(params.voice_id)}`, {
        query: { with_settings: params.include_settings },
      });

      const payload = compact({
        ...summarizeVoice(voice),
        settings: params.include_settings ? voice.settings ?? undefined : undefined,
        fine_tuning_state: voice.fine_tuning?.state,
        verified_languages: voice.verified_languages?.length ? voice.verified_languages : undefined,
      });

      return render(params.response_format, payload, (current) => {
        const lines = [`# ${current["name"] ?? "(unnamed)"} (${current["voice_id"]})`, ""];
        lines.push(...renderVoiceLines(current).slice(1));
        const settings = current["settings"] as Record<string, unknown> | undefined;
        if (settings) {
          lines.push("### Stored settings");
          for (const [key, value] of Object.entries(settings)) lines.push(`- **${key}**: ${value}`);
          lines.push("");
        }
        const fineTuning = current["fine_tuning_state"] as Record<string, string> | undefined;
        if (fineTuning) {
          lines.push("### Fine-tuning state");
          for (const [model, state] of Object.entries(fineTuning)) lines.push(`- **${model}**: ${state}`);
        }
        return lines.join("\n");
      });
    }),
  );

  server.registerTool(
    "elevenlabs_search_voice_library",
    {
      title: "Search the Public Voice Library",
      description: `Browse the shared ElevenLabs voice library — voices published by other users that you can add to your own workspace.

Read-only and free to call. The voices it returns are NOT usable for speech generation until you add them with elevenlabs_add_shared_voice, which needs both the voice_id and the public_owner_id returned here.

Args:
  - search (string, optional): free-text filter
  - category ('professional'|'famous'|'high_quality', optional)
  - gender, age, accent, language (string, optional): label filters; language is ISO 639-1
  - use_cases (string[], optional)
  - featured (boolean, optional): only ElevenLabs-featured voices
  - sort (string, optional): e.g. 'trending'
  - page (number): zero-based page index, default 0
  - page_size (number): 1-100, default 20
  - response_format ('markdown'|'json'): default 'markdown'

Returns:
  {
    "count": number,
    "voices": [
      {
        "voice_id": string,
        "public_owner_id": string,   // required by elevenlabs_add_shared_voice
        "name": string,
        "category": string,
        "description": string,
        "gender": string, "age": string, "accent": string, "language": string,
        "use_case": string,
        "cloned_by_count": number,
        "preview_url": string
      }
    ],
    "has_more": boolean,
    "next_page": number             // pass as page when has_more is true
  }

Examples:
  - "Find a trending Spanish male voice" -> { "language": "es", "gender": "male", "sort": "trending" }
  - "Show me famous voices" -> { "category": "famous" }
  - Don't use for: voices already in your account (use elevenlabs_list_voices)

Error Handling:
  - An empty voices array means no shared voice matched; drop some filters`,
      inputSchema: searchLibrarySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof searchLibrarySchema>) => {
      const data = await requestJson<SharedVoicesResponse>("v1/shared-voices", {
        query: compact({
          search: params.search,
          category: params.category,
          gender: params.gender,
          age: params.age,
          accent: params.accent,
          language: params.language,
          use_cases: params.use_cases,
          featured: params.featured,
          sort: params.sort,
          page: params.page,
          page_size: params.page_size,
        }),
      });

      const voices = (data.voices ?? []).map((voice: SharedVoice) =>
        compact({
          voice_id: voice.voice_id,
          public_owner_id: voice.public_owner_id,
          name: voice.name,
          category: voice.category,
          description: voice.description,
          gender: voice.gender,
          age: voice.age,
          accent: voice.accent,
          language: voice.language,
          use_case: voice.use_case,
          cloned_by_count: voice.cloned_by_count,
          preview_url: voice.preview_url,
        }),
      );

      const hasMore = data.has_more ?? false;
      const payload = compact({
        count: voices.length,
        voices,
        has_more: hasMore,
        next_page: hasMore ? params.page + 1 : undefined,
      });

      return render(
        params.response_format,
        payload,
        (current) => {
          const list = current["voices"] as Array<Record<string, unknown>>;
          if (!list.length) return "No shared voices matched those filters.";
          const lines = ["# Public voice library", "", `Showing ${list.length} voice(s).`, ""];
          for (const voice of list) {
            lines.push(`## ${voice["name"]} (${voice["voice_id"]})`);
            lines.push(`- **Owner**: ${voice["public_owner_id"]}`);
            const traits = ["gender", "age", "accent", "language", "use_case"]
              .map((key) => (voice[key] ? `${key}=${voice[key]}` : undefined))
              .filter(Boolean);
            if (traits.length) lines.push(`- **Traits**: ${traits.join(", ")}`);
            if (voice["cloned_by_count"]) lines.push(`- **Added by**: ${voice["cloned_by_count"]} users`);
            if (voice["description"]) lines.push(`- **Description**: ${voice["description"]}`);
            lines.push("");
          }
          if (current["has_more"]) {
            lines.push(`More results available — call again with page=${current["next_page"]}.`);
          }
          return lines.join("\n");
        },
        "voices",
      );
    }),
  );

  server.registerTool(
    "elevenlabs_add_shared_voice",
    {
      title: "Add a Shared Voice to Your Account",
      description: `Add a voice from the public library to your workspace so it can be used for speech generation.

This modifies your account: it consumes one of your voice slots. Find the ids with elevenlabs_search_voice_library first. Adding the same voice twice fails rather than duplicating it.

Args:
  - public_user_id (string): public_owner_id from elevenlabs_search_voice_library
  - voice_id (string): voice_id of the shared voice
  - new_name (string): the name to save it under in your workspace

Returns:
  { "voice_id": string, "name": string, "added": true }

Examples:
  - "Add that narrator to my account as 'Narrator'" ->
    { "public_user_id": "<owner id>", "voice_id": "<voice id>", "new_name": "Narrator" }
  - Don't use for: cloning your own recordings (use elevenlabs_create_voice_clone)

Error Handling:
  - "permission denied" usually means your plan's voice slots are full — free a slot with elevenlabs_delete_voice
  - "not found" means the voice is no longer shared, or the owner id is wrong`,
      inputSchema: addSharedVoiceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof addSharedVoiceSchema>) => {
      const data = await requestJson<{ voice_id: string }>(
        `v1/voices/add/${encodeURIComponent(params.public_user_id)}/${encodeURIComponent(params.voice_id)}`,
        { method: "POST", json: { new_name: params.new_name } },
      );
      const payload = { voice_id: data.voice_id ?? params.voice_id, name: params.new_name, added: true };
      return render(
        "markdown",
        payload,
        () => `Added '${params.new_name}' to your account as voice_id ${payload.voice_id}.`,
      );
    }),
  );

  server.registerTool(
    "elevenlabs_create_voice_clone",
    {
      title: "Clone a Voice from Audio Samples",
      description: `Create an instant voice clone from local audio samples.

COST WARNING: cloning consumes a voice slot on your plan and may incur charges. Only call this when the user explicitly asks for a clone, and confirm you have permission to clone the speaker.

Quality depends on the samples: use clean, single-speaker recordings totalling at least a minute of speech.

Args:
  - name (string): name for the new voice
  - file_paths (string[]): 1-25 local audio files
  - description (string, optional): stored with the voice
  - labels (object, optional): e.g. {"accent": "british", "use_case": "narration"}
  - remove_background_noise (boolean): default false

Returns:
  {
    "voice_id": string,               // use this with elevenlabs_text_to_speech
    "name": string,
    "samples_uploaded": number,
    "requires_verification": boolean  // true when ElevenLabs needs identity verification first
  }

Examples:
  - "Clone my voice from these recordings" ->
    { "name": "My voice", "file_paths": ["/audio/sample1.mp3", "/audio/sample2.mp3"] }
  - Don't use for: adding a library voice (use elevenlabs_add_shared_voice)

Error Handling:
  - "No file at ..." means a path is wrong — pass absolute paths
  - "permission denied" usually means your voice slots are full or your plan does not allow cloning`,
      inputSchema: createVoiceCloneSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof createVoiceCloneSchema>) => {
      const form = new FormData();
      appendFields(form, {
        name: params.name,
        description: params.description,
        labels: params.labels,
        remove_background_noise: params.remove_background_noise,
      });
      for (const filePath of params.file_paths) {
        const file = await loadInputFile(filePath);
        form.append("files", file.blob, file.name);
      }

      const data = await requestJson<AddVoiceResponse>("v1/voices/add", {
        method: "POST",
        form,
      });

      const payload = {
        voice_id: data.voice_id,
        name: params.name,
        samples_uploaded: params.file_paths.length,
        requires_verification: data.requires_verification ?? false,
      };

      return render(
        "markdown",
        payload,
        () =>
          [
            `Cloned '${params.name}' from ${params.file_paths.length} sample(s).`,
            `Voice id: ${data.voice_id}`,
            payload.requires_verification
              ? "This voice requires identity verification before it can be used."
              : "The voice is ready to use with elevenlabs_text_to_speech.",
          ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "elevenlabs_delete_voice",
    {
      title: "Delete a Voice",
      description: `Permanently delete a voice from your ElevenLabs account, freeing its voice slot.

DESTRUCTIVE and irreversible: a deleted clone cannot be recovered without re-uploading the original samples. Only call this when the user explicitly asks to delete a specific voice, and confirm the voice_id first with elevenlabs_get_voice.

Args:
  - voice_id (string): the voice to delete

Returns:
  { "voice_id": string, "deleted": true }

Examples:
  - "Delete the clone I made yesterday" -> { "voice_id": "<clone id>" } after confirming with elevenlabs_list_voices
  - Don't use for: premade voices, which belong to ElevenLabs and cannot be deleted

Error Handling:
  - "not found" means the voice is already gone or belongs to another account
  - "permission denied" means the voice is not owned by you (e.g. a premade voice)`,
      inputSchema: deleteVoiceSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async (params: z.infer<typeof deleteVoiceSchema>) => {
      await requestJson<unknown>(`v1/voices/${encodeURIComponent(params.voice_id)}`, {
        method: "DELETE",
      });
      const payload = { voice_id: params.voice_id, deleted: true };
      return render("markdown", payload, () => `Deleted voice ${params.voice_id}.`);
    }),
  );
}
