import { PanelExtensionContext, SettingsTreeAction, SettingsTreeNodes } from "@foxglove/extension";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type Config = {
  url: string;
  stream: string;
};

const DEFAULT_CONFIG: Config = {
  url: "http://localhost:1984",
  stream: "cam1",
};

function Go2RTCPanel({ context }: { context: PanelExtensionContext }) {
  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...partialConfig };
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Disconnected");

  // Save config changes when config state updates
  useEffect(() => {
    context.saveState(config);
  }, [config, context]);

  // Handle settings panel actions
  const settingsActionHandler = (action: SettingsTreeAction) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      setConfig((prev) => {
        const newConfig = { ...prev };
        if (path[0] === "general" && path[1] === "url") {
          newConfig.url = value as string;
        } else if (path[0] === "general" && path[1] === "stream") {
          newConfig.stream = value as string;
        }
        return newConfig;
      });
    }
  };

  const settingsTree: SettingsTreeNodes = useMemo(() => {
    return {
      general: {
        label: "go2rtc Settings",
        fields: {
          url: { input: "string", value: config.url, label: "go2rtc URL" },
          stream: { input: "string", value: config.stream, label: "Stream Name" },
        },
      },
    };
  }, [config]);

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsTree]);

  // WebRTC Setup
  useEffect(() => {
    async function setupWebRTC() {
      if (!config.url || !config.stream) {
        setStatus("Waiting for config");
        return;
      }

      setStatus("Connecting...");
      setError(null);

      // Clean up previous connection if any
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        pc.ontrack = (event) => {
          if (videoRef.current) {
            videoRef.current.srcObject = event.streams[0]!;
          }
        };

        pc.oniceconnectionstatechange = () => {
          setStatus(`ICE: ${pc.iceConnectionState}`);
        };

        // Add transceivers for audio and video to receive
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        let endpoint = config.url;
        if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

        const response = await fetch(`${endpoint}/api/webrtc?src=${config.stream}`, {
          method: "POST",
          body: pc.localDescription?.sdp,
        });

        if (!response.ok) {
          throw new Error(`Failed to connect to go2rtc: ${response.statusText}`);
        }

        const answerSdp = await response.text();
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
        setStatus("Connected");
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Error");
      }
    }

    setupWebRTC();

    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [config.url, config.stream]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", backgroundColor: "#000", overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
      <div style={{
        position: "absolute",
        top: 8,
        left: 8,
        color: "#fff",
        background: "rgba(0,0,0,0.5)",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: "12px",
        pointerEvents: "none",
        zIndex: 10
      }}>
        {status} {error && ` - Error: ${error}`}
      </div>
      {!config.url && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          color: "#aaa",
          textAlign: "center"
        }}>
          Please configure go2rtc URL and Stream in panel settings.
        </div>
      )}
    </div>
  );
}

export function initGo2RTCPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<Go2RTCPanel context={context} />);

  return () => {
    root.unmount();
  };
}