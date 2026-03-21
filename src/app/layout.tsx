import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SideNav } from "./side-nav";
import { MainContent } from "./main-content";
import { UploadProvider } from "./upload-context";

export const metadata: Metadata = {
  title: "Kennion Program Manager",
  description: "Client-centric program management system",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bob-bg text-bob-text min-h-screen flex">
        <UploadProvider>
          <SideNav />
          <MainContent>{children}</MainContent>
        </UploadProvider>
      </body>
    </html>
  );
}
