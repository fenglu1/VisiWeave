import type { GenerationRecord } from "./generation.js";

export interface ProjectState {
  id: string;
  name: string;
  snapshot: unknown | null;
  history: GenerationRecord[];
  updatedAt: string;
}
