import { Canvas, Image, matchFont, Rect, Text, useImage } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { COPY } from "../lib/copy";

/**
 * Local Skia preview of the capture, visibly marked "preview" (§8.4b). It is never shared:
 * only the marked file rendered by the worker is.
 */
export function PreviewBadge({ uri, aspect = 4 / 3 }: { uri: string; aspect?: number }) {
  const { width } = useWindowDimensions();
  const image = useImage(uri);
  const h = Math.round(width / aspect);
  const font = useMemo(() => matchFont({ fontSize: 28, fontWeight: "bold" }), []);
  const label = COPY.share.previewBadge.toUpperCase();
  const textW = font.measureText(label).width;
  return (
    <Canvas style={{ width, height: h }} accessibilityLabel={COPY.share.previewBadge}>
      {image ? <Image image={image} x={0} y={0} width={width} height={h} fit="cover" /> : null}
      <Rect x={0} y={h / 2 - 28} width={width} height={44} color="rgba(0,0,0,0.45)" />
      <Text x={(width - textW) / 2} y={h / 2 + 4} text={label} font={font} color="white" />
    </Canvas>
  );
}
