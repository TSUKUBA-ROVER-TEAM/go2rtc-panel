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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Disconnected");
  const [reconnectCount, setReconnectCount] = useState(0);
  const [latency, setLatency] = useState<number>(0);

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

  const triggerReconnect = () => {
    if (reconnectTimeoutRef.current) return;
    setStatus("Retrying in 2s...");
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectCountRef.current += 1; // Use ref to avoid closure issues in effect
      setReconnectCount((c) => c + 1);
      reconnectTimeoutRef.current = null;
    }, 2000);
  };

  // Latency Killer & Monitor
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const interval = setInterval(() => {
      if (video.paused || video.readyState < 3) return;

      const buffered = video.buffered;
      if (buffered.length > 0) {
        const end = buffered.end(buffered.length - 1);
        const diff = end - video.currentTime;
        setLatency(diff);

        // Latency Killer: If latency > 0.5s, skip to end
        if (diff > 0.5) {
          console.log(`Latency Killer: skipping from ${video.currentTime} to ${end}`);
          video.currentTime = end;
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const reconnectCountRef = useRef(0);

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

        const updateConnectionStatus = () => {
          const iceState = pc.iceConnectionState;
          const connState = pc.connectionState;
          setStatus(`ICE: ${iceState} / CONN: ${connState}`);

          if (iceState === "failed" || connState === "failed") {
            triggerReconnect();
          }
        };

        pc.oniceconnectionstatechange = updateConnectionStatus;
        pc.onconnectionstatechange = updateConnectionStatus;

        // Add transceivers for audio and video to receive
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        let endpoint = config.url;
        if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1);

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
        triggerReconnect();
      }
    }

    setupWebRTC();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [config.url, config.stream, reconnectCount]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", backgroundColor: "#000", overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          color: "#fff",
          background: "rgba(0,0,0,0.5)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: "12px",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{status}</span>
          <span style={{ color: latency > 0.5 ? "#ffaa00" : "#aaffaa", fontSize: "10px" }}>
            Delay: {latency.toFixed(2)}s
          </span>
          <button
            onClick={() => setReconnectCount((c) => c + 1)}
            style={{
              background: "#444",
              border: "none",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: 2,
              cursor: "pointer",
              fontSize: "10px",
            }}
          >
            Reconnect
          </button>
        </div>
        {error && <div style={{ color: "#ff8888", maxWidth: "200px" }}>Error: {error}</div>}
      </div>
      {!config.url && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#aaa",
            textAlign: "center",
          }}
        >
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