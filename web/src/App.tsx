import { useCallback, useEffect, useMemo, useState } from "react";
import { DeviceConnect, useDeviceConnection } from "./views/DeviceConnect.tsx";
import { SynthPresetLibrary } from "./views/SynthPresetLibrary.tsx";
import { TuningLayoutEditor } from "./views/TuningLayoutEditor.tsx";
import { Learn } from "./views/Learn.tsx";
import { MockMidiTransport } from "./midi/mockTransport.ts";
import type { MidiTransport } from "./midi/types.ts";
import type { HelloResponsePayload } from "./protocol/index.ts";

import { initialLocation, saveLocation, storedLocation, type AppLocation, type ViewKey } from "./navigation.ts";
type ThemeMode = "light" | "dark";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "learn", label: "Learn" },
  {
    key: "layouts",
    label: "Tunings & Layouts"
  },
  {
    key: "synth",
    label: "Synth Editor"
  },
];

const themeStorageKey = "hexboard-sync-theme";

function loadStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Use the system theme when browser storage is unavailable. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [location, setLocation] = useState<AppLocation>(initialLocation);
  const activeView = location.view;
  const navigate = useCallback((next: AppLocation, replace = false) => {
    saveLocation(next, replace);
    setLocation(next);
  }, []);
  useEffect(() => {
    saveLocation(location, true);
    const restore = () => {
      const next = initialLocation();
      saveLocation(next, true);
      setLocation(next);
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  const [transport, setTransport] = useState<MidiTransport>(() => new MockMidiTransport());
  const [deviceHello, setDeviceHello] = useState<HelloResponsePayload | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Not connected");
  const [theme, setTheme] = useState<ThemeMode>(() => loadStoredTheme());
  const connection = useDeviceConnection({
    onTransportChange: setTransport,
    onHelloChange: setDeviceHello,
    connectionLabel,
    onConnectionLabelChange: setConnectionLabel
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem(themeStorageKey, theme); } catch { /* Optional preference. */ }
  }, [theme]);

  const content = useMemo(() => {
    switch (activeView) {
      case "learn":
        return <Learn connectionControl={<DeviceConnect connection={connection} placement="lesson" />} navigation={location.view === "learn" ? location : undefined} onNavigate={navigate} transport={transport} deviceHello={deviceHello} connected={deviceHello !== null && !(transport instanceof MockMidiTransport)} />;
      case "layouts":
        return <TuningLayoutEditor transport={transport} deviceHello={deviceHello} />;
      case "synth":
        return <SynthPresetLibrary transport={transport} />;
    }
  }, [location, deviceHello, transport, navigate, connection]);
  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brandBlock">
          <span aria-hidden="true" className="brandMark"><span /></span>
          <div>
            <span className="eyebrow">Companion app</span>
            <h1>HexBoard Sync</h1>
          </div>
        </div>
        <nav className="tabs" aria-label="Main views">
          {views.map((view) => (
            <button
              key={view.key}
              className={view.key === activeView ? "active" : ""}
              onClick={() => navigate(storedLocation(view.key) ?? (view.key === "learn" ? { view: "learn", page: "practice" } : { view: view.key }))}
              type="button"
            >
              {view.label}
            </button>
          ))}
        </nav>
        <div className="topBarActions">
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
            className="themeToggle"
            title={`Use ${theme === "dark" ? "light" : "dark"} appearance`}
            type="button"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            <span aria-hidden="true" className="themeToggleIcon">{theme === "dark" ? "☾" : "☀"}</span>
          </button>
          <DeviceConnect connection={connection} showStatus={activeView !== "learn" || connection.connected} />
        </div>
      </header>
      <main>
        {content}
      </main>
    </div>
  );
}
