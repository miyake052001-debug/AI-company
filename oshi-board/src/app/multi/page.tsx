import type { Metadata } from "next";
import { MultiView } from "@/components/multi/MultiView";

export const metadata: Metadata = { title: "マルチビュー" };

export default function MultiPage() {
  return <MultiView />;
}
