import type { Metadata } from "next";
import AdminPanel from "@/frontend/components/AdminPanel";

export const metadata: Metadata = {
  title: "Quản trị · The Last Candle",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminPanel />;
}
