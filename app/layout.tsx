import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burner Board",
  description: "A private task triage desk for Notion and Todoist.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
