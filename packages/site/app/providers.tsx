"use client";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MetaMaskProvider } from "@/hooks/metamask/useMetaMaskProvider";
import { InMemoryStorageProvider } from "@/hooks/useInMemoryStorage";
import { MetaMaskEthersSignerProvider } from "@/hooks/metamask/useMetaMaskEthersSigner";
import { CDMProvider } from "@/hooks/useCDMContext";
import { Toaster } from "sonner";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

type Props = {
  children: ReactNode;
};

export function Providers({ children }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <MetaMaskProvider>
        <MetaMaskEthersSignerProvider
          initialMockChains={{
            31337: "http://localhost:8545",
          }}
        >
          <InMemoryStorageProvider>
            <CDMProvider>{children}</CDMProvider>
          </InMemoryStorageProvider>
        </MetaMaskEthersSignerProvider>
      </MetaMaskProvider>
    </QueryClientProvider>
  );
}
