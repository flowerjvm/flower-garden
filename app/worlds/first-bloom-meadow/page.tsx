import type { Metadata } from "next";
import { FirstBloomMeadow } from "@/worlds/first-bloom-meadow/web/FirstBloomMeadow";

export const metadata: Metadata = {
  title: "Flower Garden · First Bloom Meadow",
  description:
    "실제 Flower Runtime의 Engine, Worker, Flow, Step, StepResult를 네 번의 Worker tick으로 배우는 첫 번째 3D 월드.",
};

export default function FirstBloomMeadowPage() {
  return <FirstBloomMeadow />;
}
