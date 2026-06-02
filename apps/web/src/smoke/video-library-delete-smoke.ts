import type { VideoLibraryItem } from "@gpt-image-canvas/shared";
import {
  canDeleteVideoItem,
  STALE_IN_PROGRESS_DELETE_AFTER_MS
} from "../features/video/VideoLibraryPage";

const nowMs = Date.UTC(2026, 5, 1, 12, 0, 0);

expect(canDeleteVideoItem(videoItem({ status: "queued", createdAt: new Date(nowMs - STALE_IN_PROGRESS_DELETE_AFTER_MS + 1).toISOString() }), nowMs) === false, "new queued videos stay protected");
expect(canDeleteVideoItem(videoItem({ status: "running", createdAt: new Date(nowMs - STALE_IN_PROGRESS_DELETE_AFTER_MS + 1).toISOString() }), nowMs) === false, "new running videos stay protected");
expect(canDeleteVideoItem(videoItem({ status: "queued", createdAt: new Date(nowMs - STALE_IN_PROGRESS_DELETE_AFTER_MS).toISOString() }), nowMs) === true, "stale queued videos are deletable");
expect(canDeleteVideoItem(videoItem({ status: "running", createdAt: new Date(nowMs - STALE_IN_PROGRESS_DELETE_AFTER_MS - 1).toISOString() }), nowMs) === true, "stale running videos are deletable");
expect(canDeleteVideoItem(videoItem({ status: "succeeded", createdAt: new Date(nowMs).toISOString() }), nowMs) === true, "terminal videos remain deletable");

console.log("video library delete smoke checks passed");

function videoItem(patch: Pick<VideoLibraryItem, "createdAt" | "status">): VideoLibraryItem {
  return {
    aspectRatio: "16:9",
    createdAt: patch.createdAt,
    durationSeconds: 5,
    effectivePrompt: "A quiet studio",
    generationId: "generation-test",
    mode: "text_to_video",
    outputId: "output-test",
    prompt: "A quiet studio",
    provider: "grok-imagine",
    status: patch.status
  } as VideoLibraryItem;
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
