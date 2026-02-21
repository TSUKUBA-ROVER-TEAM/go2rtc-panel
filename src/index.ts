import { ExtensionContext } from "@foxglove/extension";
import { initGo2RTCPanel } from "./Go2RTCPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "go2rtc-panel",
    initPanel: initGo2RTCPanel,
  });
}