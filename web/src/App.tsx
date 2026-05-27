import { useMemo, useState } from "react";
import { DeviceConnect } from "./views/DeviceConnect.tsx";
import { ProfileSync } from "./views/ProfileSync.tsx";
import { SynthPresetLibrary } from "./views/SynthPresetLibrary.tsx";
import { TuningLayoutEditor } from "./views/TuningLayoutEditor.tsx";
import { MockMidiTransport } from "./midi/mockTransport.ts";
import type { MidiTransport } from "./midi/types.ts";

type ViewKey = "connect" | "profiles" | "layouts" | "synth";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "connect", label: "Device" },
  { key: "profiles", label: "Profiles" },
  { key: "layouts", label: "Tunings & Layouts" },
  { key: "synth", label: "Synth Presets" }
];

export function App() {
  const [activeView, setActiveView] = useState<ViewKey>("connect");
  const [transport, setTransport] = useState<MidiTransport>(() => new MockMidiTransport());
  const [connectionLabel, setConnectionLabel] = useState("Mock device");

  const content = useMemo(() => {
    switch (activeView) {
      case "connect":
        return (
          <DeviceConnect
            transport={transport}
            onTransportChange={setTransport}
            connectionLabel={connectionLabel}
            onConnectionLabelChange={setConnectionLabel}
          />
        );
      case "profiles":
        return <ProfileSync transport={transport} />;
      case "layouts":
        return <TuningLayoutEditor />;
      case "synth":
        return <SynthPresetLibrary transport={transport} />;
    }
  }, [activeView, connectionLabel, transport]);

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <h1>HexBoard Sync</h1>
          <p>{connectionLabel}</p>
        </div>
        <nav className="tabs" aria-label="Main views">
          {views.map((view) => (
            <button
              key={view.key}
              className={view.key === activeView ? "active" : ""}
              onClick={() => setActiveView(view.key)}
              type="button"
            >
              {view.label}
            </button>
          ))}
        </nav>
      </header>
      {content}
    </main>
  );
}
