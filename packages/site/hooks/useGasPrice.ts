import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { DEFAULT_GAS_PRICE } from "@fhevm/shared";

/**
 * Hook for fetching current gas price from the network
 */
export function useGasPrice(
  chainId: number | undefined,
  ethersReadonlyProvider: ethers.ContractRunner | undefined
) {
  return useQuery({
    queryKey: ["gasPrice", chainId, ethersReadonlyProvider],
    queryFn: async () => {
      if (!ethersReadonlyProvider) {
        // Fallback to chain-specific default gas price if no provider
        return chainIdFallback(chainId);
      }

      try {
        // Check if the provider has getGasPrice method (it's a Provider, not just ContractRunner)
        if (
          "getGasPrice" in ethersReadonlyProvider &&
          typeof ethersReadonlyProvider.getGasPrice === "function"
        ) {
          const gasPrice = await ethersReadonlyProvider.getGasPrice();
          return gasPrice;
        } else {
          // Fallback to chain-specific default gas price if provider doesn't support getGasPrice
          console.warn(
            "Provider doesn't support getGasPrice, using chain-specific fallback"
          );
          return chainIdFallback(chainId);
        }
      } catch (error) {
        console.warn(
          "Failed to fetch gas price from network, using chain-specific fallback:",
          error
        );
        // Fallback to chain-specific default gas price
        return chainIdFallback(chainId);
      }
    },
    staleTime: 1000 * 30, // Consider gas price stale after 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute
    refetchOnWindowFocus: true,
  });
}

function chainIdFallback(chainId: number | undefined) {
  // Hardhat default chain ID is 31337
  if (chainId === 31337) {
    return ethers.parseUnits("1", "gwei");
  }
  // Default fallback for other networks
  return DEFAULT_GAS_PRICE;
}
