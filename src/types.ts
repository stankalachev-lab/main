/** Shapes of the ElevenLabs API payloads this server consumes. */

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

export interface Voice {
  voice_id: string;
  name?: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
  is_owner?: boolean;
  settings?: VoiceSettings | null;
  fine_tuning?: { state?: Record<string, string> } | null;
  verified_languages?: Array<{ language?: string; accent?: string | null }> | null;
}

export interface VoicesSearchResponse {
  voices?: Voice[];
  has_more?: boolean;
  total_count?: number;
  next_page_token?: string | null;
}

export interface SharedVoice {
  voice_id: string;
  public_owner_id: string;
  name?: string;
  category?: string;
  description?: string | null;
  gender?: string | null;
  age?: string | null;
  accent?: string | null;
  language?: string | null;
  locale?: string | null;
  use_case?: string | null;
  descriptive?: string | null;
  preview_url?: string | null;
  cloned_by_count?: number;
  free_users_allowed?: boolean;
}

export interface SharedVoicesResponse {
  voices?: SharedVoice[];
  has_more?: boolean;
  last_sort_id?: string | null;
}

export interface ModelLanguage {
  language_id?: string;
  name?: string;
}

export interface Model {
  model_id: string;
  name?: string;
  description?: string;
  can_do_text_to_speech?: boolean;
  can_do_voice_conversion?: boolean;
  can_use_style?: boolean;
  can_use_speaker_boost?: boolean;
  can_be_finetuned?: boolean;
  serves_pro_voices?: boolean;
  requires_alpha_access?: boolean;
  maximum_text_length_per_request?: number;
  languages?: ModelLanguage[];
}

export interface Subscription {
  tier?: string;
  status?: string;
  character_count?: number;
  character_limit?: number;
  next_character_count_reset_unix?: number | null;
  voice_slots_used?: number;
  voice_limit?: number;
  professional_voice_slots_used?: number;
  professional_voice_limit?: number;
  can_extend_character_limit?: boolean;
  allowed_to_extend_character_limit?: boolean;
  currency?: string | null;
  billing_period?: string | null;
  max_voice_add_edits?: number | null;
  voice_add_edit_counter?: number | null;
}

export interface User {
  user_id?: string;
  first_name?: string | null;
  is_new_user?: boolean;
  can_use_delayed_payment_methods?: boolean;
  subscription?: Subscription;
}

export interface HistoryItem {
  history_item_id: string;
  request_id?: string | null;
  voice_id?: string | null;
  voice_name?: string | null;
  model_id?: string | null;
  text?: string | null;
  date_unix?: number;
  character_count_change_from?: number;
  character_count_change_to?: number;
  content_type?: string;
  state?: string;
  source?: string | null;
}

export interface HistoryResponse {
  history?: HistoryItem[];
  last_history_item_id?: string | null;
  has_more?: boolean;
  scanned_until?: number;
}

export interface TranscriptionWord {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string | null;
}

export interface TranscriptionResponse {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: TranscriptionWord[];
  additional_formats?: Array<{
    requested_format?: string;
    file_extension?: string;
    content_type?: string;
    is_base64_encoded?: boolean;
    content?: string;
  }> | null;
}

export interface VoicePreview {
  audio_base_64: string;
  generated_voice_id: string;
  media_type: string;
  duration_secs?: number;
  language?: string | null;
}

export interface VoiceDesignResponse {
  previews?: VoicePreview[];
  text?: string;
}

export interface AddVoiceResponse {
  voice_id: string;
  requires_verification?: boolean;
}

export interface ForcedAlignmentWord {
  text?: string;
  start?: number;
  end?: number;
  loss?: number;
}

export interface ForcedAlignmentResponse {
  characters?: ForcedAlignmentWord[];
  words?: ForcedAlignmentWord[];
  loss?: number;
}

export interface DubbingResponse {
  dubbing_id: string;
  name?: string;
  status?: string;
  source_language?: string | null;
  target_languages?: string[];
  error?: string | null;
  media_metadata?: { content_type?: string; duration?: number } | null;
  expected_duration_sec?: number;
}
