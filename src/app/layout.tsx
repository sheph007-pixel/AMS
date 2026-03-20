import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "./side-nav";

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
        <main className="flex-1 ml-[72px] min-h-screen">
          <div className="max-w-6xl mx-auto px-8 py-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
