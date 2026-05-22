export interface KeyframePrompt {
  index: number;
  timestampSeconds: number;
  prompt: string;
}

interface BuildKeyframePromptInput {
  prompt: string;
  durationSeconds: number;
  frameCount: number;
}

const MOTION_BEATS = [
  "opening establishing frame, subject clearly introduced, cinematic wide shot",
  "gentle forward camera movement, environment begins to show motion",
  "side tracking composition, subject advances across the scene",
  "closer hero angle, subject details remain consistent",
  "dynamic pass-by moment, background motion cues are visible",
  "subtle camera turn, parallax in foreground and background",
  "peak action beat, strongest sense of movement",
  "smooth deceleration, subject remains sharp and recognizable",
  "ending frame, resolved composition, cinematic hold"
];

export function buildKeyframePrompts(input: BuildKeyframePromptInput): KeyframePrompt[] {
  const frameCount = Math.max(2, input.frameCount);
  const sourcePrompt = input.prompt.trim();

  return Array.from({ length: frameCount }, (_, index) => {
    const progress = frameCount === 1 ? 0 : index / (frameCount - 1);
    const beat = motionBeatForProgress(progress);
    const timestampSeconds = Math.round(progress * input.durationSeconds * 100) / 100;

    return {
      index,
      timestampSeconds,
      prompt: [
        sourcePrompt,
        "",
        `Keyframe ${index + 1} of ${frameCount} at ${timestampSeconds}s: ${beat}.`,
        "Maintain identical subject identity, wardrobe, materials, colors, lighting style, location, camera language, and overall art direction across all keyframes.",
        "Compose as landscape 16:9, horizontal cinematic frame, no borders, no captions, no UI, no text overlays.",
        "High detail 4K video keyframe, natural temporal continuity with adjacent frames."
      ].join("\n")
    };
  });
}

function motionBeatForProgress(progress: number): string {
  const index = Math.min(MOTION_BEATS.length - 1, Math.floor(progress * MOTION_BEATS.length));
  return MOTION_BEATS[index] ?? MOTION_BEATS[MOTION_BEATS.length - 1];
}
