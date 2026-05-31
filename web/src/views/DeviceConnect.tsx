import { useState } from "react";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type {
  MidiTransport,
  WebMidiAccess,
  WebMidiInput,
  WebMidiOutput
} from "../midi/types.ts";
import {
  WebMidiTransport,
  isWebMidiSupported,
  requestPresetSyncMidiAccess
} from "../midi/webMidi.ts";
import { PROTOCOL_MAJOR, type HelloResponsePayload } from "../protocol/index.ts";

interface DeviceConnectProps {
  onTransportChange: (transport: MidiTransport) => void;
  connectionLabel: string;
  onConnectionLabelChange: (label: string) => void;
}

interface DiscoveredHexBoard {
  key: string;
  label: string;
  output: WebMidiOutput;
  input: WebMidiInput;
  hello: HelloResponsePayload;
}

const synthPresetCapabilityBit = 1 << 1;
const helloProbeTimeoutMs = 900;

function portName(port: WebMidiInput | WebMidiOutput): string {
  return port.name ?? port.id;
}

function portIdentity(port: WebMidiInput | WebMidiOutput): string {
  return `${port.manufacturer ?? ""} ${port.name ?? port.id}`;
}

function normalizedPortIdentity(port: WebMidiInput | WebMidiOutput): string {
  return portIdentity(port)
    .toLowerCase()
    .replace(/\b(input|output|midi|port)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyHexBoardPort(port: WebMidiInput | WebMidiOutput): boolean {
  return portIdentity(port).toLowerCase().includes("hexboard");
}

function sortHexBoardFirst<T extends WebMidiInput | WebMidiOutput>(ports: T[]): T[] {
  return [...ports].sort((left, right) => Number(isLikelyHexBoardPort(right)) - Number(isLikelyHexBoardPort(left)));
}

function deviceKey(output: WebMidiOutput, input: WebMidiInput): string {
  return `${output.id}::${input.id}`;
}

function matchingInputs(output: WebMidiOutput, inputs: WebMidiInput[]): WebMidiInput[] {
  const likelyInputs = inputs.filter(isLikelyHexBoardPort);
  const candidates = likelyInputs.length > 0 ? likelyInputs : inputs;
  const outputIdentity = normalizedPortIdentity(output);
  const exact = candidates.filter((input) => input.id === output.id || portName(input) === portName(output));
  const normalized = candidates.filter((input) => {
    const inputIdentity = normalizedPortIdentity(input);
    return inputIdentity === outputIdentity || inputIdentity.includes(outputIdentity) || outputIdentity.includes(inputIdentity);
  });
  return Array.from(new Set([...exact, ...normalized, ...candidates]));
}

function isCompatibleHello(hello: HelloResponsePayload): boolean {
  return hello.negotiatedMajor === PROTOCOL_MAJOR
    && (hello.capabilityFlags & synthPresetCapabilityBit) !== 0
    && hello.synthPresetSchemaVersion >= 3;
}

function firmwareLabel(hello: HelloResponsePayload): string {
  return `preset-sync ${hello.negotiatedMajor}.${hello.negotiatedMinor}, synth schema ${hello.synthPresetSchemaVersion}`;
}

export function DeviceConnect({
  onTransportChange,
  connectionLabel,
  onConnectionLabelChange
}: DeviceConnectProps) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [devices, setDevices] = useState<DiscoveredHexBoard[]>([]);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState("");
  const [status, setStatus] = useState("Mock transport active");
  const [busy, setBusy] = useState(false);

  async function probeDevice(output: WebMidiOutput, input: WebMidiInput): Promise<DiscoveredHexBoard | null> {
    await output.open?.();
    await input.open?.();
    const transport = new WebMidiTransport(output, input);
    try {
      const hello = await new PresetSyncClient(transport).requestHello(128, helloProbeTimeoutMs);
      if (!isCompatibleHello(hello)) {
        return null;
      }
      return {
        key: deviceKey(output, input),
        label: portName(output),
        output,
        input,
        hello
      };
    } catch {
      return null;
    }
  }

  async function discoverHexBoards(midiAccess: WebMidiAccess): Promise<DiscoveredHexBoard[]> {
    const outputs = sortHexBoardFirst(Array.from(midiAccess.outputs.values()));
    const inputs = sortHexBoardFirst(Array.from(midiAccess.inputs.values()));
    const discovered: DiscoveredHexBoard[] = [];
    const seen = new Set<string>();

    for (const output of outputs) {
      for (const input of matchingInputs(output, inputs)) {
        const key = deviceKey(output, input);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const device = await probeDevice(output, input);
        if (device) {
          discovered.push(device);
        }
      }
    }

    return discovered;
  }

  async function connectDevice(device: DiscoveredHexBoard) {
    await device.output.open?.();
    await device.input.open?.();
    const webTransport = new WebMidiTransport(device.output, device.input);
    onTransportChange(webTransport);
    onConnectionLabelChange(`HexBoard: ${device.label}`);
    setSelectedDeviceKey(device.key);
    setStatus(`Connected ${device.label} (${firmwareLabel(device.hello)})`);
  }

  async function connectHexBoard() {
    if (!isWebMidiSupported()) {
      setStatus("Web MIDI is unavailable in this browser");
      return;
    }

    setBusy(true);
    try {
      const selectedDevice = devices.find((device) => device.key === selectedDeviceKey);
      if (devices.length > 1 && selectedDevice) {
        await connectDevice(selectedDevice);
        return;
      }

      const midiAccess = access ?? await requestPresetSyncMidiAccess();
      setAccess(midiAccess);
      setStatus("Looking for compatible HexBoard devices...");
      const discovered = await discoverHexBoards(midiAccess);
      setDevices(discovered);

      if (discovered.length === 0) {
        setStatus("No compatible HexBoard found. Connect one HexBoard input and output, then try again.");
        return;
      }

      if (discovered.length === 1) {
        await connectDevice(discovered[0]);
        return;
      }

      setSelectedDeviceKey(discovered[0].key);
      setStatus(`${discovered.length} compatible HexBoards found. Choose one to connect.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "HexBoard connection failed");
    } finally {
      setBusy(false);
    }
  }

  const multipleDevices = devices.length > 1;
  const buttonLabel = multipleDevices && selectedDeviceKey ? "Connect Selected" : "Connect HexBoard";

  return (
    <div className="deviceMenu" aria-label="Device connection">
      <div className="deviceStatus">
        <strong>{connectionLabel}</strong>
        <span>{status}</span>
      </div>
      {multipleDevices ? (
        <select
          aria-label="HexBoard device"
          value={selectedDeviceKey}
          onChange={(event) => setSelectedDeviceKey(event.target.value)}
        >
          {devices.map((device) => (
            <option key={device.key} value={device.key}>
              {device.label}
            </option>
          ))}
        </select>
      ) : null}
      <button className="primary" type="button" onClick={connectHexBoard} disabled={busy}>
        {busy ? "Connecting..." : buttonLabel}
      </button>
    </div>
  );
}
