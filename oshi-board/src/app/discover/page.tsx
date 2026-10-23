import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover/DiscoverView";

export const metadata: Metadata = { title: "見つける" };

export default function DiscoverPage() {
  return <DiscoverView />;
}
