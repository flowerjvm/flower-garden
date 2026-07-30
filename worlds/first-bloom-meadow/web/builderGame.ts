import type {
  FirstBloomBlueprint,
  FirstBloomStepId,
} from "../../../web/runtime/types";

export type FirstBloomPartId =
  | "worker"
  | "flow"
  | FirstBloomStepId;

export interface FirstBloomPart {
  id: FirstBloomPartId;
  kind: "WORKER" | "FLOW" | "STEP";
  label: string;
  runtimeLabel: string;
  icon: string;
  color: "gold" | "leaf" | "soil" | "sprout" | "bloom";
}

export interface FirstBloomDraft {
  workerPlaced: boolean;
  flowPlaced: boolean;
  stepSlots: Array<FirstBloomStepId | null>;
}

export interface FirstBloomDraftCheck {
  ready: boolean;
  missing: string[];
  placedCount: number;
  totalCount: number;
}

export const FIRST_BLOOM_PARTS: readonly FirstBloomPart[] = [
  {
    id: "worker",
    kind: "WORKER",
    label: "Worker",
    runtimeLabel: "first-bloom-worker",
    icon: "⚙",
    color: "gold",
  },
  {
    id: "flow",
    kind: "FLOW",
    label: "Flow",
    runtimeLabel: "first-flow",
    icon: "◆",
    color: "leaf",
  },
  {
    id: "bloom",
    kind: "STEP",
    label: "꽃 피우기",
    runtimeLabel: "bloom",
    icon: "✿",
    color: "bloom",
  },
  {
    id: "grow-stem",
    kind: "STEP",
    label: "줄기 키우기",
    runtimeLabel: "grow-stem",
    icon: "♧",
    color: "sprout",
  },
  {
    id: "prepare-soil",
    kind: "STEP",
    label: "흙 준비",
    runtimeLabel: "prepare-soil",
    icon: "▦",
    color: "soil",
  },
  {
    id: "wait-for-sunlight",
    kind: "STEP",
    label: "햇빛 기다리기",
    runtimeLabel: "wait-for-sunlight",
    icon: "☀",
    color: "bloom",
  },
] as const;

export const FIRST_BLOOM_STEP_IDS: readonly FirstBloomStepId[] = [
  "prepare-soil",
  "wait-for-sunlight",
  "grow-stem",
  "bloom",
] as const;

export function createEmptyFirstBloomDraft(): FirstBloomDraft {
  return {
    workerPlaced: false,
    flowPlaced: false,
    stepSlots: [null, null, null, null],
  };
}

export function isFirstBloomPartPlaced(
  draft: FirstBloomDraft,
  partId: FirstBloomPartId,
): boolean {
  if (partId === "worker") return draft.workerPlaced;
  if (partId === "flow") return draft.flowPlaced;
  return draft.stepSlots.includes(partId);
}

export function placeFirstBloomPart(
  draft: FirstBloomDraft,
  partId: FirstBloomPartId,
  preferredSlot?: number,
): FirstBloomDraft {
  if (isFirstBloomPartPlaced(draft, partId)) return draft;
  if (partId === "worker") return { ...draft, workerPlaced: true };
  if (partId === "flow") return { ...draft, flowPlaced: true };

  const slot =
    preferredSlot !== undefined &&
    preferredSlot >= 0 &&
    preferredSlot < draft.stepSlots.length &&
    draft.stepSlots[preferredSlot] === null
      ? preferredSlot
      : draft.stepSlots.findIndex((candidate) => candidate === null);
  if (slot < 0) return draft;

  const stepSlots = [...draft.stepSlots];
  stepSlots[slot] = partId;
  return { ...draft, stepSlots };
}

export function removeFirstBloomPart(
  draft: FirstBloomDraft,
  partId: FirstBloomPartId,
): FirstBloomDraft {
  if (partId === "worker") return { ...draft, workerPlaced: false };
  if (partId === "flow") return { ...draft, flowPlaced: false };
  return {
    ...draft,
    stepSlots: draft.stepSlots.map((stepId) =>
      stepId === partId ? null : stepId,
    ),
  };
}

export function moveFirstBloomStep(
  draft: FirstBloomDraft,
  fromIndex: number,
  toIndex: number,
): FirstBloomDraft {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= draft.stepSlots.length ||
    toIndex >= draft.stepSlots.length ||
    fromIndex === toIndex ||
    draft.stepSlots[fromIndex] === null
  ) {
    return draft;
  }

  const stepSlots = [...draft.stepSlots];
  [stepSlots[fromIndex], stepSlots[toIndex]] = [
    stepSlots[toIndex],
    stepSlots[fromIndex],
  ];
  return { ...draft, stepSlots };
}

export function checkFirstBloomDraft(
  draft: FirstBloomDraft,
): FirstBloomDraftCheck {
  const missing: string[] = [];
  if (!draft.workerPlaced) missing.push("Worker");
  if (!draft.flowPlaced) missing.push("Flow");
  const missingSteps = draft.stepSlots.filter((stepId) => stepId === null)
    .length;
  if (missingSteps > 0) missing.push(`Step ${missingSteps}개`);

  return {
    ready: missing.length === 0,
    missing,
    placedCount:
      Number(draft.workerPlaced) +
      Number(draft.flowPlaced) +
      draft.stepSlots.filter(
        (stepId): stepId is FirstBloomStepId => stepId !== null,
      ).length,
    totalCount: 6,
  };
}

/**
 * This only serializes the player's layout. It deliberately does not know a
 * winning Step order; the actual Flower Runtime executes and judges it.
 */
export function createFirstBloomBlueprint(
  draft: FirstBloomDraft,
): FirstBloomBlueprint {
  const check = checkFirstBloomDraft(draft);
  if (!check.ready) {
    throw new Error(`Incomplete Flower build: ${check.missing.join(", ")}`);
  }

  return {
    schemaVersion: "1.0.0",
    workerId: "first-bloom-worker",
    flowType: "first-flow",
    stepIds: draft.stepSlots.filter(
      (stepId): stepId is FirstBloomStepId => stepId !== null,
    ),
  };
}

export function firstBloomPart(
  partId: FirstBloomPartId,
): FirstBloomPart {
  const part = FIRST_BLOOM_PARTS.find(
    (candidate) => candidate.id === partId,
  );
  if (!part) throw new Error(`Unknown First Bloom part: ${partId}`);
  return part;
}
