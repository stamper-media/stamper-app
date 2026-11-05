import { normaliseCode, verifyUrl } from "@stamper/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { getConfig } from "../../lib/config";
import { COPY } from "../../lib/copy";

/** Universal/App Link target: opens the web verify page in the in-app browser. */
export default function VerifyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const n = normaliseCode(String(code ?? ""));
    if (!n.ok) {
      setError(n.reason);
      return;
    }
    WebBrowser.openBrowserAsync(verifyUrl(n.code9, getConfig().publicOrigin))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => router.canGoBack() && router.back());
  }, [code, router]);
  return <Text style={styles.text}>{error ?? COPY.verify.opening}</Text>;
}

const styles = StyleSheet.create({ text: { padding: 24, fontSize: 16 } });
