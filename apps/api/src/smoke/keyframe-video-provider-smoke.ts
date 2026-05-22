import {
  buildKeyframePrompts,
  defaultKeyframeFrameCount,
  getKeyframeVideoProviderStatus,
  parseKeyframeVideoConfig
} from "../infrastructure/providers/keyframe-video-provider.js";

function main(): void {
  smokeConfigDefaults();
  smokeConfigClamp();
  smokePromptPlan();
  smokeProviderStatus();

  console.log("keyframe video provider smoke checks passed");
}

function smokeConfigDefaults(): void {
  const config = parseKeyframeVideoConfig({});
  expect(config.width === 3840, "default width is 4K UHD");
  expect(config.height === 2160, "default height is 4K UHD");
  expect(config.fps === 24, "default FPS is 24");
  expect(config.ffmpegPath === "ffmpeg", "default FFmpeg path is ffmpeg");
  expect(config.interpolation === "ffmpeg", "default interpolation uses FFmpeg minterpolate");
  expect(config.frameCountOverride === undefined, "frame count override is optional");
}

function smokeConfigClamp(): void {
  const low = parseKeyframeVideoConfig({ KEYFRAME_VIDEO_FRAME_COUNT: "1", KEYFRAME_VIDEO_FPS: "3" });
  expect(low.frameCountOverride === 2, "frame count override clamps up to 2");
  expect(low.fps === 12, "FPS clamps up to 12");

  const high = parseKeyframeVideoConfig({ KEYFRAME_VIDEO_FRAME_COUNT: "500", KEYFRAME_VIDEO_FPS: "500" });
  expect(high.frameCountOverride === 60, "frame count override clamps down to 60");
  expect(high.fps === 60, "FPS clamps down to 60");

  expect(defaultKeyframeFrameCount(5) === 6, "5 second default uses 6 keyframes");
  expect(defaultKeyframeFrameCount(10) === 12, "10 second default uses 12 keyframes");
  expect(defaultKeyframeFrameCount(20) === 24, "20 second default uses 24 keyframes");
  expect(defaultKeyframeFrameCount(30) === 36, "30 second default uses 36 keyframes");
}

function smokePromptPlan(): void {
  const prompts = buildKeyframePrompts({
    prompt: "A red motorcycle crossing a rainy neon bridge",
    durationSeconds: 10,
    frameCount: 12
  });

  expect(prompts.length === 12, "prompt planner returns requested keyframe count");
  expect(prompts[0].prompt.includes("landscape 16:9"), "keyframe prompts enforce landscape 16:9");
  expect(prompts[0].prompt.includes("A red motorcycle crossing a rainy neon bridge"), "keyframe prompts preserve source prompt");
  expect(prompts[0].timestampSeconds === 0, "first keyframe starts at 0 seconds");
  expect(prompts[prompts.length - 1].timestampSeconds === 10, "last keyframe lands on requested duration");
}

function smokeProviderStatus(): void {
  const missing = getKeyframeVideoProviderStatus({
    VIDEO_PROVIDER_KIND: "keyframe-image"
  });
  expect(missing.id === "keyframe-image", "status id identifies keyframe provider");
  expect(missing.configured === false, "missing OpenAI key is not configured");
  expect(missing.supportsTextToVideo === false, "missing OpenAI key does not advertise text support");
  expect(missing.supportsImageToVideo === false, "keyframe provider does not support image-to-video in v1");

  const configured = getKeyframeVideoProviderStatus({
    VIDEO_PROVIDER_KIND: "keyframe-image",
    OPENAI_API_KEY: "test-keyframe-api-key",
    OPENAI_IMAGE_MODEL: "gpt-image-2"
  });
  expect(configured.configured === true, "OpenAI key configures keyframe provider");
  expect(configured.supportsTextToVideo === true, "configured provider supports text-to-video");
  expect(configured.supportsImageToVideo === false, "configured provider still rejects image-to-video");
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();
