import type { Metadata } from "next";
import bothAtDeadline from "@/contracts/fixtures/verdant-both-at-deadline.trace.json";
import signalAt29s from "@/contracts/fixtures/verdant-signal-at-29s.trace.json";
import timeoutThenLateSignal from "@/contracts/fixtures/verdant-timeout-then-late-signal.trace.json";
import { VerdantSignalGarden } from "@/worlds/verdant-signal-garden/web/VerdantSignalGarden";

export const metadata: Metadata = {
  title: "Flower Garden · Verdant Signal Garden",
  description:
    "실제 Flower Runtime의 Signal과 30초 Timeout을 예측하고 ManualClock, Worker tick, StepResult의 근거까지 확인하는 두 번째 3D 월드.",
};

export default function VerdantSignalGardenPage() {
  return (
    <VerdantSignalGarden
      recordedBundles={{
        "signal-at-29s": signalAt29s,
        "timeout-then-late-signal": timeoutThenLateSignal,
        "both-at-deadline": bothAtDeadline,
      }}
    />
  );
}
