import type { Metadata } from "next";
import "./globals.css";

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
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-gray-900">
              AMS
            </a>
            <div className="flex gap-6">
              <a href="/" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                Clients
              </a>
              <a href="/import" className="text-sm font-medium text-gray-700 hover:text-gray-900">
                Import
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
