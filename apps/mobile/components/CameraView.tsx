import { CameraView as ExpoCameraView, useCameraPermissions } from "expo-camera";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type CameraLike, choosePhysicalLens } from "../lib/capture";
import { COPY } from "../lib/copy";

export type CameraHandle = CameraLike & { lens: string | undefined; facing: "back" | "front" };

/** Live in-app camera only (no picker, no import); prefers a single physical lens (§7.1). */
export const CameraView = forwardRef<
  CameraHandle,
  { mode: "picture" | "video"; facing?: "back" | "front" }
>(function CameraView({ mode, facing = "back" }, ref) {
  const [permission, request] = useCameraPermissions();
  const inner = useRef<ExpoCameraView>(null);
  const [lens, setLens] = useState<string | undefined>();
  const [refused, setRefused] = useState(false);

  useImperativeHandle(
    ref,
    (): CameraHandle => ({
      lens,
      facing,
      takePictureAsync: async (o) => {
        const cam = inner.current;
        if (!cam) throw new Error("camera not ready");
        return cam.takePictureAsync(o);
      },
      recordAsync: async (o) => {
        const cam = inner.current;
        if (!cam) throw new Error("camera not ready");
        return cam.recordAsync(o);
      },
      getAvailableLensesAsync: async () => inner.current?.getAvailableLensesAsync() ?? [],
    }),
    [lens, facing],
  );

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>{COPY.camera.permission}</Text>
        <Pressable accessibilityRole="button" onPress={request} style={styles.button}>
          <Text style={styles.buttonText}>{COPY.camera.grant}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <ExpoCameraView
        ref={inner}
        style={styles.fill}
        mode={mode}
        facing={facing}
        selectedLens={lens}
        onAvailableLensesChanged={({ lenses }) => {
          if (lenses.length === 0) return;
          try {
            setLens(choosePhysicalLens(lenses, lens));
            setRefused(false);
          } catch {
            setRefused(true);
          }
        }}
      />
      {refused ? <Text style={[styles.text, styles.banner]}>{COPY.camera.refusedLens}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  text: { fontSize: 16, textAlign: "center" },
  banner: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    color: "white",
    backgroundColor: "#b00020",
    padding: 8,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#1f6feb",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: "white", fontWeight: "600" },
});
