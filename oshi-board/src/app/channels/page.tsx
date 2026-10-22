import type { Metadata } from "next";
import { ChannelsView } from "@/components/channels/ChannelsView";

export const metadata: Metadata = { title: "フォロー管理" };

export default function ChannelsPage() {
  return <ChannelsView />;
}
