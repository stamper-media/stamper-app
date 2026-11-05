import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Network from "expo-network";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { getRuntime } from "../lib/runtime";

export default function RootLayout() {
  const [client] = useState(() => new QueryClient());
  useEffect(() => {
    // Drain the offline queue at start and whenever connectivity returns (DESIGN §7.5).
    getRuntime()
      .then((rt) => rt.drain())
      .catch(() => undefined);
    const sub = Network.addNetworkStateListener((s) => {
      if (s.isConnected)
        getRuntime()
          .then((rt) => rt.drain())
          .catch(() => undefined);
    });
    return () => sub.remove();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="enrol" options={{ title: "Set up" }} />
        <Stack.Screen name="stamp/[captureId]" options={{ title: "Stamp" }} />
        <Stack.Screen name="verify/[code]" options={{ title: "Verify" }} />
        <Stack.Screen name="v/[code]" options={{ title: "Verify" }} />
      </Stack>
    </QueryClientProvider>
  );
}
