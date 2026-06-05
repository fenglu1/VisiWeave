import { VIDEO_DURATION_PRESETS } from "../domain/contracts.js";
import { parseVideoGeneratePayload } from "../server/http/validation.js";

function main(): void {
  expect(VIDEO_DURATION_PRESETS.includes(15), "video duration presets include 15 seconds");

  const parsed = parseVideoGeneratePayload({
    prompt: "A city street slowly filling with rain reflections",
    mode: "text_to_video",
    durationSeconds: 15,
    aspectRatio: "16:9"
  });

  expect(parsed.ok, "video generation payload accepts 15 second duration");
  if (parsed.ok) {
    expect(parsed.value.durationSeconds === 15, "parsed payload preserves 15 second duration");
  }

  console.log("video duration presets smoke checks passed");
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();
