import { Tabs } from "expo-router";
import { COPY } from "../../lib/copy";

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: COPY.tabs.camera, headerShown: false }} />
      <Tabs.Screen name="gallery" options={{ title: COPY.tabs.gallery }} />
      <Tabs.Screen name="settings" options={{ title: COPY.tabs.settings }} />
    </Tabs>
  );
}
