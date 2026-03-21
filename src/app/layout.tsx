import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "./side-nav";
import { MainContent } from "./main-content";

export const metadata: Metadata = {
  title: "AMS - Agency Management System",
  description: "Client-centric agency management system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bob-bg text-bob-text min-h-screen flex">
        <SideNav />
        <MainContent>{children}</MainContent>
      </body>
    </html>
  );
}
