import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelContract",
  description:
    "Stable machine-readable contracts for unstable AI-provider documentation",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
