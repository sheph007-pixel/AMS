import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SideNav } from "./side-nav";
import { MainContent } from "./main-content";
import { UploadProvider } from "./upload-context";

export const metadata: Metadata = {
  title: "Kennion AMS",
  description: "Kennion Agency Management System — Production tracking, benefits administration, and financial reporting",
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
