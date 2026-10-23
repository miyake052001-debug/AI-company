import type { Metadata } from "next";
import { ClipsView } from "@/components/clips/ClipsView";

export const metadata: Metadata = { title: "切り抜き" };

export default function ClipsPage() {
  return <ClipsView />;
}
