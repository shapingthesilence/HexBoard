import { useEffect, useMemo, useState } from "react";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type {
  MidiPortSummary,
  MidiTransport,
  WebMidiAccess,
  WebMidiInput,
  WebMidiOutput
} from "../midi/types.ts";
import {
  WebMidiTransport,
  isWebMidiSupported,
  listMidiPorts,
  requestPresetSyncMidiAccess
} from "../midi/webMidi.ts";
import { MessageType, decodePresetSyncFrame, encodeAckFrame } from "../protocol/index.ts";
import { formatHex } from "./format.ts";

interface DeviceConnectProps {
  transport: MidiTransport;
  onTransportChange: (transport: MidiTransport) => void;
  connectionLabel: string;
  onConnectionLabelChange: (label: string) => void;
}

function portName(port: WebMidiInput | WebMidiOutput | MidiPortSummary): string {
  return port.name ?? port.id;
}

function normalizedPortIdentity(port: WebMidiInput | WebMidiOutput): string {
  return `${port.manufacturer ?? ""} ${port.name ?? port.id}`
    .toLowerCase()
    .replace(/\b(input|output|midi|port)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function findPort<T extends WebMidiInput | WebMidiOutput>(ports: T[], id: string): T | undefined {
  return ports.find((port) => port.id === id);
}

function findMatchingInput(output: WebMidiOutput | undefined, inputs: WebMidiInput[]): WebMidiInput | undefined {
  if (!output) {
    return inputs[0];
  }
  return inputs.find((input) => input.id === output.id)
    ?? inputs.find((input) => portName(input) === portName(output))
    ?? inputs.find((input) => normalizedPortIdentity(input) === normalizedPortIdentity(output))
    ?? inputs.find((input) => normalizedPortIdentity(input).includes(normalizedPortIdentity(output)))
    ?? inputs.find((input) => normalizedPortIdentity(output).includes(normalizedPortIdentity(input)))
    ?? inputs[0];
}

export function DeviceConnect({
  transport,
  onTransportChange,
  connectionLabel,
  onConnectionLabelChange
}: DeviceConnectProps) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [ports, setPorts] = useState<MidiPortSummary[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [lastIncoming, setLastIncoming] = useState<string>("No incoming messages");
  const [status, setStatus] = useState("Mock transport active");

  useEffect(() => {
    return transport.subscribe((bytes) => {
      try {
        const frame = decodePresetSyncFrame(bytes);
        setLastIncoming(`Message 0x${frame.message.toString(16)} transaction ${frame.transactionId}`);
      } catch {
        setLastIncoming(formatHex(bytes));
      }
    });
  }, [transport]);

  const supportLabel = useMemo(() => {
    if (typeof window === "undefined") {
      return "Unavailable outside browser";
    }
    return isWebMidiSupported() ? "Web MIDI available" : "Web MIDI unavailable";
  }, []);

  async function connectWebMidi() {
    try {
      const midiAccess = access ?? await requestPresetSyncMidiAccess();
      const outputs = Array.from(midiAccess.outputs.values());
      const inputs = Array.from(midiAccess.inputs.values());
      const defaultOutput = findPort(outputs, selectedOutputId) ?? outputs[0];
      const defaultInput = findPort(inputs, selectedInputId) ?? findMatchingInput(defaultOutput, inputs);
      const output = defaultOutput;
      const input = selectedInputId === "none" ? undefined : defaultInput;
      if (!output) {
        setStatus("No MIDI output ports found");
        return;
      }
      await output.open?.();
      await input?.open?.();
      setAccess(midiAccess);
      setPorts(listMidiPorts(midiAccess));
      setSelectedOutputId(output.id);
      setSelectedInputId(input?.id ?? "none");
      const webTransport = new WebMidiTransport(output, input);
      onTransportChange(webTransport);
      onConnectionLabelChange(`Web MIDI: ${webTransport.label}`);
      setStatus(input ? "Web MIDI transport active" : "Output connected. Select the HexBoard input port before refreshing device presets.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Web MIDI connection failed");
    }
  }

  function useMockTransport() {
    const mock = new MockMidiTransport();
    onTransportChange(mock);
    onConnectionLabelChange(mock.label);
    setStatus("Mock transport active");
  }

  async function emitMockAck() {
    if (transport instanceof MockMidiTransport) {
      transport.emit(encodeAckFrame(1, MessageType.HelloRequest));
      setStatus("Mock ACK emitted");
    }
  }

  return (
    <section className="workspace">
      <aside className="panel stack">
        <h2>Connection</h2>
        <div className="status">{connectionLabel}</div>
        <div className="status warn">{supportLabel}</div>
        <div className="stack compact">
          <label>
            Output
            <select value={selectedOutputId} onChange={(event) => setSelectedOutputId(event.target.value)}>
              {ports.filter((port) => port.type === "output").map((port) => (
                <option key={port.id} value={port.id}>{portName(port)}</option>
              ))}
            </select>
          </label>
          <label>
            Input
            <select value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
              <option value="">Auto match</option>
              <option value="none">No input</option>
              {ports.filter((port) => port.type === "input").map((port) => (
                <option key={port.id} value={port.id}>{portName(port)}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="primary" type="button" onClick={connectWebMidi}>
          {access ? "Connect Selected Ports" : "Connect Web MIDI"}
        </button>
        <button type="button" onClick={useMockTransport}>
          Use Mock Device
        </button>
        <button type="button" onClick={emitMockAck} disabled={!(transport instanceof MockMidiTransport)}>
          Emit Mock ACK
        </button>
      </aside>

      <div className="panel stack">
        <h2>Ports</h2>
        <div className="status">{status}</div>
        <ul className="list">
          {ports.length === 0 ? (
            <li className="listItem">
              <strong>No Web MIDI ports selected</strong>
              <span>{access ? "No ports reported" : "Mock mode"}</span>
            </li>
          ) : (
            ports.map((port) => (
              <li className="listItem" key={`${port.type}-${port.id}`}>
                <div>
                  <strong>{port.name}</strong>
                  <span>{port.manufacturer ?? "Unknown manufacturer"}</span>
                </div>
                <span>{port.type}</span>
              </li>
            ))
          )}
        </ul>
        <pre className="dataPreview">{lastIncoming}</pre>
      </div>
    </section>
  );
}
