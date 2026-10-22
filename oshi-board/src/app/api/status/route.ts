import { NextResponse, connection } from "next/server";
import { providerStatus } from "@/lib/server/providers";

/** GET /api/status — どのAPIキーが設定されているか（キーの中身は返さない） */
export async function GET() {
  await connection();
  return NextResponse.json(providerStatus(), { headers: { "Cache-Control": "no-store" } });
}
