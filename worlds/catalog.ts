import firstBloomManifest from "./first-bloom-meadow/world.manifest.json";
import verdantSignalManifest from "./verdant-signal-garden/world.manifest.json";

export interface WorldCatalogEntry {
  manifest: typeof firstBloomManifest | typeof verdantSignalManifest;
  href: string;
  coverImage: string;
  chapter: string;
  summary: string;
  difficulty: string;
  estimatedMinutes: string;
  scenarioLabel: string;
  prerequisites: readonly string[];
  concepts: readonly string[];
  learningHighlights: readonly string[];
  accent: "bloom" | "signal";
}

export interface CurriculumRoadmapEntry {
  order: number;
  title: string;
  chapter: string;
  concepts: string;
  description: string;
}

/**
 * Flower Garden's compile-time world registry.
 *
 * A world becomes selectable only after its manifest, route, projection, and
 * runtime-backed mission are registered here. This gives the catalog a
 * plugin-like extension point without loading untrusted remote code.
 */
export const WORLD_CATALOG = [
  {
    manifest: firstBloomManifest,
    href: "/worlds/first-bloom-meadow",
    coverImage: "/worlds/first-bloom-meadow-cover.webp",
    chapter: "CORE EXECUTION",
    summary:
      "Worker, Flow, Step을 직접 조립하고 Bloom 이벤트를 보내 꽃을 피웁니다.",
    difficulty: "입문",
    estimatedMinutes: "5–8분",
    scenarioLabel: "1 builder mission",
    prerequisites: [],
    concepts: ["Engine", "Worker", "Flow", "Step", "StepResult"],
    learningHighlights: [
      "Worker와 Flow를 놓고 Step 순서를 직접 만듭니다.",
      "잘못 조립하면 실제 StepResult.FAIL에서 멈춥니다.",
      "대기 중인 Step에 사람이 Bloom 이벤트를 보냅니다.",
    ],
    accent: "bloom",
  },
  {
    manifest: verdantSignalManifest,
    href: "/worlds/verdant-signal-garden",
    coverImage: "/worlds/verdant-signal-garden-cover.webp",
    chapter: "WAITING & RACES",
    summary:
      "Signal과 30초 Timeout을 직접 배치하고, 다음 tick에서 실제 Flower가 선택한 경로를 추적합니다.",
    difficulty: "입문+",
    estimatedMinutes: "8–12분",
    scenarioLabel: "1 mission · 3 scenarios",
    prerequisites: ["first-bloom-meadow"],
    concepts: ["Event", "Signal", "StepContext", "ManualClock", "StepResult"],
    learningHighlights: [
      "Signal은 Step을 깨우고, StepResult가 경로를 결정합니다.",
      "시간 변경과 Worker tick이 서로 다른 명령임을 경험합니다.",
      "둘이 동시에 참일 때 Flow의 명시적 정책을 근거와 함께 봅니다.",
    ],
    accent: "signal",
  },
] as const satisfies readonly WorldCatalogEntry[];

export const CURRICULUM_ROADMAP = [
  {
    order: 3,
    title: "Checkpoint Grove",
    chapter: "DURABILITY",
    concepts: "Checkpoint · Resume · Recovery",
    description: "저장 직후 전원을 끄고, 무엇이 복원되고 무엇이 재실행되는지 확인합니다.",
  },
  {
    order: 4,
    title: "Worker Harbor",
    chapter: "OPERATIONS",
    concepts: "Graceful Stop · Immediate Stop · Lanes",
    description: "작업 중인 Worker를 멈추며 신규 수락과 진행 중 작업의 경계를 배웁니다.",
  },
  {
    order: 5,
    title: "Retry Workshop",
    chapter: "RELIABILITY",
    concepts: "Retry · Idempotency · External Effects",
    description: "실행은 됐지만 기록되지 않은 명령을 안전하게 복구하는 법을 실험합니다.",
  },
  {
    order: 6,
    title: "Flow Atelier",
    chapter: "DESIGN",
    concepts: "Flow · Guards · DSL · Evidence",
    description: "Step과 경로를 공간에 배치하고 검증 가능한 Flower 설계로 변환합니다.",
  },
] as const satisfies readonly CurriculumRoadmapEntry[];
