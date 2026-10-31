import type { Metadata } from "next";
import { OwnerLogin } from "@/components/OwnerLogin";

export const metadata: Metadata = {
  title: "Owner sign-in — PulseAlpha",
  robots: { index: false, follow: false },
};

export default function OwnerPage() {
  return <OwnerLogin />;
}
