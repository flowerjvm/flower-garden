import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Flower Garden · First Bloom Meadow";
const description =
  "실제 Flower Runtime의 Flow, Step, StepResult를 3D 정원에서 실행하며 배우는 마이크로월드.";

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = firstForwardedValue(
    requestHeaders.get("x-forwarded-host"),
  );
  const directHost = firstForwardedValue(requestHeaders.get("host"));
  const candidateHost = forwardedHost ?? directHost;
  const host =
    candidateHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(candidateHost)
      ? candidateHost
      : "localhost:3000";
  const forwardedProtocol = firstForwardedValue(
    requestHeaders.get("x-forwarded-proto"),
  );
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  const origin = `${protocol}://${host}`;
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title,
    description,
    applicationName: "Flower Garden",
    keywords: [
      "Flower Runtime",
      "Flow",
      "Step",
      "StepResult",
      "workflow learning",
    ],
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Flower Garden",
      url: origin,
      images: [
        {
          url: socialImage,
          width: 1728,
          height: 909,
          alt: "Flower Garden의 voxel 정원과 The First Flow",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e7ebd8",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
