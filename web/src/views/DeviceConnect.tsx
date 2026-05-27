import { useEffect, useMemo, useState } from "react";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type { MidiPortSummary, MidiTransport, WebMidiAccess } from "../midi/types.ts";
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

export function DeviceConnect({
  transport,
  onTransportChange,
  connectionLabel,
  onConnectionLabelChange
}: DeviceConnectProps) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [ports, setPorts] = useState<MidiPortSummary[]>([]);
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
      const midiAccess = await requestPresetSyncMidiAccess();
      const output = Array.from(midiAccess.outputs.values())[0];
      const input = Array.from(midiAccess.inputs.values()).find((candidate) => candidate.id === output?.id)
        ?? Array.from(midiAccess.inputs.values())[0];
      if (!output) {
        setStatus("No MIDI output ports found");
        return;
      }
      setAccess(midiAccess);
      setPorts(listMidiPorts(midiAccess));
      const webTransport = new WebMidiTransport(output, input);
      onTransportChange(webTransport);
      onConnectionLabelChange(`Web MIDI: ${webTransport.label}`);
      setStatus("Web MIDI transport active");
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
        <button className="primary" type="button" onClick={connectWebMidi}>
          Connect Web MIDI
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

