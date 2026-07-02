import { useEffect, useMemo, useState } from "react";
import { DeviceConnect } from "./views/DeviceConnect.tsx";
import { ProfileSync } from "./views/ProfileSync.tsx";
import { SynthPresetLibrary } from "./views/SynthPresetLibrary.tsx";
import { TuningLayoutEditor } from "./views/TuningLayoutEditor.tsx";
import { MockMidiTransport } from "./midi/mockTransport.ts";
import type { MidiTransport } from "./midi/types.ts";
import type { HelloResponsePayload } from "./protocol/index.ts";

type ViewKey = "synth" | "profiles" | "layouts";
type ThemeMode = "light" | "dark";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "layouts", label: "Tunings & Layouts" },
  { key: "synth", label: "Synth Editor" },
  { key: "profiles", label: "Profiles" }
];

const themeStorageKey = "hexboard-sync-theme";

function loadStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [activeView, setActiveView] = useState<ViewKey>("layouts");
  const [transport, setTransport] = useState<MidiTransport>(() => new MockMidiTransport());
  const [deviceHello, setDeviceHello] = useState<HelloResponsePayload | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Mock device");
  const [theme, setTheme] = useState<ThemeMode>(() => loadStoredTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const content = useMemo(() => {
    switch (activeView) {
      case "profiles":
        return <ProfileSync transport={transport} />;
      case "layouts":
        return <TuningLayoutEditor transport={transport} deviceHello={deviceHello} />;
      case "synth":
        return <SynthPresetLibrary transport={transport} />;
    }
  }, [activeView, deviceHello, transport]);

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
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-pressed={theme === "dark"}
          className="themeToggle"
          type="button"
          onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
        >
          <span aria-hidden="true" className="themeToggleIcon">{theme === "dark" ? "☾" : "☀"}</span>
        </button>
        <DeviceConnect
          onTransportChange={setTransport}
          onHelloChange={setDeviceHello}
          connectionLabel={connectionLabel}
          onConnectionLabelChange={setConnectionLabel}
        />
      </header>
      {content}
    </main>
  );
}
