import { useMemo, useState } from "react";
import { DeviceConnect } from "./views/DeviceConnect.tsx";
import { ProfileSync } from "./views/ProfileSync.tsx";
import { SynthPresetLibrary } from "./views/SynthPresetLibrary.tsx";
import { TuningLayoutEditor } from "./views/TuningLayoutEditor.tsx";
import { MockMidiTransport } from "./midi/mockTransport.ts";
import type { MidiTransport } from "./midi/types.ts";

type ViewKey = "synth" | "profiles" | "layouts";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "synth", label: "Synth Presets" },
  { key: "profiles", label: "Profiles" },
  { key: "layouts", label: "Tunings & Layouts" }
];

export function App() {
  const [activeView, setActiveView] = useState<ViewKey>("synth");
  const [transport, setTransport] = useState<MidiTransport>(() => new MockMidiTransport());
  const [connectionLabel, setConnectionLabel] = useState("Mock device");

  const content = useMemo(() => {
    switch (activeView) {
      case "profiles":
        return <ProfileSync transport={transport} />;
      case "layouts":
        return <TuningLayoutEditor />;
      case "synth":
        return <SynthPresetLibrary transport={transport} />;
    }
  }, [activeView, transport]);

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brandBlock">
          <h1>HexBoard Sync</h1>
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
        <DeviceConnect
          onTransportChange={setTransport}
          connectionLabel={connectionLabel}
          onConnectionLabelChange={setConnectionLabel}
        />
      </header>
      {content}
    </main>
  );
}
