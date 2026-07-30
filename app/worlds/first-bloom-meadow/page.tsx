import type { Metadata } from "next";
import { FirstBloomMeadow } from "@/worlds/first-bloom-meadow/web/FirstBloomMeadow";

export const metadata: Metadata = {
  title: "Flower Garden · First Bloom Meadow",
  description:
    "Worker, Flow, Step을 직접 조립하고 Bloom 이벤트로 실제 Flower Flow를 움직이는 첫 번째 3D 월드.",
};

export default function FirstBloomMeadowPage() {
  return <FirstBloomMeadow />;
}
