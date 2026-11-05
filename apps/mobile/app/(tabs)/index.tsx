import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { type CameraHandle, CameraView } from "../../components/CameraView";
import { CaptureRefusedError } from "../../lib/capture";
import { capturePhotoFlow, captureVideoFlow } from "../../lib/captureFlow";
import { COPY } from "../../lib/copy";
import { type Enrolment, getEnrolment } from "../../lib/enrol";
import { getRecordLocationPref, setRecordLocationPref } from "../../lib/location";

export default function CameraScreen() {
  const router = useRouter();
  const cam = useRef<CameraHandle>(null);
  const [mode, setMode] = useState<"picture" | "video">("picture");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null | undefined>(undefined);
  // opt-in per capture, off by default; the device remembers the last choice (DESIGN §11.3)
  const [recordLocation, setRecordLocation] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getEnrolment().then(setEnrolment, () => setEnrolment(null));
      getRecordLocationPref().then(setRecordLocation, () => setRecordLocation(false));
    }, []),
  );

  const toggleLocation = async (on: boolean) => {
    setLocationNote(null);
    setRecordLocation(on);
    const r = await setRecordLocationPref(on);
    setRecordLocation(r.on);
    if (r.denied) setLocationNote(COPY.location.permissionOff);
  };

  const shoot = async () => {
    const c = cam.current;
    if (!c || busy) return;
    setError(null);
    if (mode === "video" && recording) {
      // stopRecording resolves the pending recordAsync inside captureVideoFlow
      (c as unknown as { stopRecording?: () => void }).stopRecording?.();
      return;
    }
    try {
      if (mode === "picture") setBusy(true);
      else setRecording(true);
      const opts = { recordLocation };
      const id =
        mode === "picture" ? await capturePhotoFlow(c, opts) : await captureVideoFlow(c, opts);
      router.push(`/stamp/${id}`);
    } catch (e) {
      setError(
        e instanceof CaptureRefusedError
          ? COPY.camera.refusedLens
          : String((e as Error).message ?? e),
      );
    } finally {
      setBusy(false);
      setRecording(false);
    }
  };

  if (enrolment === undefined) return <ActivityIndicator style={styles.fill} />;
  if (enrolment === null) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>{COPY.camera.notEnrolled}</Text>
        <Link href="/enrol" style={styles.link}>
          {COPY.enrol.start}
        </Link>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <CameraView ref={cam} mode={mode} />
      <View style={styles.top}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{COPY.location.toggle}</Text>
          <Switch
            accessibilityLabel={COPY.location.toggle}
            value={recordLocation}
            onValueChange={(on) => void toggleLocation(on)}
            disabled={busy || recording}
          />
        </View>
        {recordLocation ? <Text style={styles.toggleNote}>{COPY.location.hint}</Text> : null}
        {locationNote ? <Text style={styles.toggleNote}>{locationNote}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMode("picture")}
          disabled={recording}
        >
          <Text style={[styles.mode, mode === "picture" && styles.active]}>
            {COPY.camera.photo}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={shoot}
          style={styles.shutter}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.shutterText}>{recording ? COPY.camera.stop : ""}</Text>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setMode("video")} disabled={recording}>
          <Text style={[styles.mode, mode === "video" && styles.active]}>{COPY.camera.video}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  text: { fontSize: 16, textAlign: "center" },
  link: { marginTop: 16, fontSize: 17, color: "#1f6feb", fontWeight: "600" },
  top: { position: "absolute", top: 48, left: 16, right: 16 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  toggleLabel: { color: "white", fontSize: 15, fontWeight: "600" },
  toggleNote: {
    marginTop: 4,
    color: "white",
    fontSize: 13,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 6,
    padding: 6,
  },
  error: {
    marginTop: 8,
    color: "white",
    backgroundColor: "#b00020",
    padding: 8,
  },
  bar: {
    position: "absolute",
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  mode: { color: "white", fontSize: 16, opacity: 0.6 },
  active: { opacity: 1, fontWeight: "700" },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterText: { color: "white", fontWeight: "700" },
});
