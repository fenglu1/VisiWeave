import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  relativePath: text("relative_path").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  cloudProvider: text("cloud_provider"),
  cloudBucket: text("cloud_bucket"),
  cloudRegion: text("cloud_region"),
  cloudObjectKey: text("cloud_object_key"),
  cloudStatus: text("cloud_status"),
  cloudError: text("cloud_error"),
  cloudUploadedAt: text("cloud_uploaded_at"),
  cloudEtag: text("cloud_etag"),
  cloudRequestId: text("cloud_request_id"),
  createdAt: text("created_at").notNull()
});

export const storageConfigs = sqliteTable("storage_configs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  enabled: integer("enabled").notNull(),
  secretId: text("secret_id"),
  secretKey: text("secret_key"),
  bucket: text("bucket"),
  region: text("region"),
  keyPrefix: text("key_prefix"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const providerConfigs = sqliteTable("provider_configs", {
  id: text("id").primaryKey(),
  sourceOrderJson: text("source_order_json").notNull(),
  localApiKey: text("local_api_key"),
  localBaseUrl: text("local_base_url"),
  localImageProviderFormat: text("local_image_provider_format"),
  localModel: text("local_model"),
  localTimeoutMs: integer("local_timeout_ms"),
  imageProviderKind: text("image_provider_kind"),
  videoKind: text("video_kind"),
  videoApiKey: text("video_api_key"),
  videoBaseUrl: text("video_base_url"),
  videoModel: text("video_model"),
  videoTextToVideoUrl: text("video_text_to_video_url"),
  videoImageToVideoUrl: text("video_image_to_video_url"),
  videoStatusUrl: text("video_status_url"),
  videoTimeoutMs: integer("video_timeout_ms"),
  videoPollIntervalMs: integer("video_poll_interval_ms"),
  videoFfmpegPath: text("video_ffmpeg_path"),
  videoWidth: integer("video_width"),
  videoHeight: integer("video_height"),
  videoFps: integer("video_fps"),
  videoInterpolation: text("video_interpolation"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const imageProviderConfigs = sqliteTable("image_provider_configs", {
  kind: text("kind").primaryKey(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  model: text("model"),
  timeoutMs: integer("timeout_ms"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const videoProviderConfigs = sqliteTable("video_provider_configs", {
  kind: text("kind").primaryKey(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  videoModel: text("video_model"),
  textToVideoUrl: text("text_to_video_url"),
  imageToVideoUrl: text("image_to_video_url"),
  statusUrl: text("status_url"),
  timeoutMs: integer("timeout_ms"),
  pollIntervalMs: integer("poll_interval_ms"),
  ffmpegPath: text("ffmpeg_path"),
  width: integer("width"),
  height: integer("height"),
  fps: integer("fps"),
  interpolation: text("interpolation"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const agentLlmConfigs = sqliteTable("agent_llm_configs", {
  id: text("id").primaryKey(),
  apiKey: text("api_key"),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  supportsVision: integer("supports_vision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const codexOAuthTokens = sqliteTable("codex_oauth_tokens", {
  id: text("id").primaryKey(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  email: text("email"),
  accountId: text("account_id"),
  expiresAt: text("expires_at"),
  refreshedAt: text("refreshed_at"),
  unavailableAt: text("unavailable_at"),
  unavailableReason: text("unavailable_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const generationRecords = sqliteTable("generation_records", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  prompt: text("prompt").notNull(),
  effectivePrompt: text("effective_prompt").notNull(),
  presetId: text("preset_id").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  quality: text("quality").notNull(),
  outputFormat: text("output_format").notNull(),
  count: integer("count").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  referenceAssetId: text("reference_asset_id").references(() => assets.id),
  createdAt: text("created_at").notNull()
});

export const generationOutputs = sqliteTable("generation_outputs", {
  id: text("id").primaryKey(),
  generationId: text("generation_id")
    .notNull()
    .references(() => generationRecords.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  assetId: text("asset_id").references(() => assets.id),
  error: text("error"),
  createdAt: text("created_at").notNull()
});

export const generationReferenceAssets = sqliteTable("generation_reference_assets", {
  generationId: text("generation_id")
    .notNull()
    .references(() => generationRecords.id, { onDelete: "cascade" }),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id),
  position: integer("position").notNull(),
  createdAt: text("created_at").notNull()
});

export const videoGenerationRecords = sqliteTable("video_generation_records", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  prompt: text("prompt").notNull(),
  effectivePrompt: text("effective_prompt").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  referenceAssetId: text("reference_asset_id").references(() => assets.id),
  progressPercent: integer("progress_percent").notNull(),
  progressStage: text("progress_stage").notNull(),
  progressMessage: text("progress_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const videoGenerationOutputs = sqliteTable("video_generation_outputs", {
  id: text("id").primaryKey(),
  generationId: text("generation_id")
    .notNull()
    .references(() => videoGenerationRecords.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  assetId: text("asset_id").references(() => assets.id),
  providerJobId: text("provider_job_id"),
  error: text("error"),
  createdAt: text("created_at").notNull()
});

export const generationRelations = relations(generationRecords, ({ many, one }) => ({
  outputs: many(generationOutputs),
  referenceAssets: many(generationReferenceAssets),
  referenceAsset: one(assets, {
    fields: [generationRecords.referenceAssetId],
    references: [assets.id]
  })
}));

export const outputRelations = relations(generationOutputs, ({ one }) => ({
  generation: one(generationRecords, {
    fields: [generationOutputs.generationId],
    references: [generationRecords.id]
  }),
  asset: one(assets, {
    fields: [generationOutputs.assetId],
    references: [assets.id]
  })
}));

export const referenceAssetRelations = relations(generationReferenceAssets, ({ one }) => ({
  generation: one(generationRecords, {
    fields: [generationReferenceAssets.generationId],
    references: [generationRecords.id]
  }),
  asset: one(assets, {
    fields: [generationReferenceAssets.assetId],
    references: [assets.id]
  })
}));

export const videoGenerationRelations = relations(videoGenerationRecords, ({ many, one }) => ({
  outputs: many(videoGenerationOutputs),
  referenceAsset: one(assets, {
    fields: [videoGenerationRecords.referenceAssetId],
    references: [assets.id]
  })
}));

export const videoOutputRelations = relations(videoGenerationOutputs, ({ one }) => ({
  generation: one(videoGenerationRecords, {
    fields: [videoGenerationOutputs.generationId],
    references: [videoGenerationRecords.id]
  }),
  asset: one(assets, {
    fields: [videoGenerationOutputs.assetId],
    references: [assets.id]
  })
}));
