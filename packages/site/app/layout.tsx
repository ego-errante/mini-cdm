import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { LuDatabaseZap } from "react-icons/lu";

export const metadata: Metadata = {
  title: "Mini CDM - Confidential Data Marketplace",
  description: "Confidential Data Marketplace - Mini CDM",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`text-foreground antialiased`}>
        <div className="fixed inset-0 w-full h-full z-[-20] min-w-[850px]"></div>
        <main className="flex flex-col lg:max-w-screen-lg mx-auto pb-20 lg:min-w-[850px]">
          <nav className="flex w-full px-6 h-fit py-8 justify-between items-center">
            <div className="flex items-center gap-1">
              <LuDatabaseZap className="size-10" />
              <span className="text-2xl font-bold">CDM</span>
            </div>
          </nav>
          <Providers>{children}</Providers>
        </main>
      </body>
    </html>
  );
}
