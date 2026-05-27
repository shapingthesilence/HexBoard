import { useMemo, useState } from "react";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { ObjectType } from "../protocol/constants.ts";
import { formatHex } from "./format.ts";

interface ProfileSyncProps {
  transport: MidiTransport;
}

const profiles = [
  "Boot/Auto-Save Slot",
  "Slot 1",
  "Slot 2",
  "Slot 3",
  "Slot 4",
  "Slot 5",
  "Slot 6",
  "Slot 7",
  "Slot 8"
];

export function ProfileSync({ transport }: ProfileSyncProps) {
  const client = useMemo(() => new PresetSyncClient(transport), [transport]);
  const [lastFrame, setLastFrame] = useState("No frames sent");
  const [status, setStatus] = useState("Ready");

  async function sendHello() {
    const frame = await client.sendHello();
    setLastFrame(formatHex(frame));
    setStatus("HELLO_REQ sent");
  }

  async function readProfile(handle: number) {
    const frame = await client.sendReadRequest(ObjectType.DeviceProfile, handle);
    setLastFrame(formatHex(frame));
    setStatus(`READ_REQ sent for profile ${handle}`);
  }

  return (
    <section className="workspace">
      <aside className="panel stack">
        <h2>Session</h2>
        <div className="status">{status}</div>
        <button className="primary" type="button" onClick={sendHello}>
          Send Hello
        </button>
      </aside>

      <div className="panel stack">
        <h2>Profiles</h2>
        <ul className="list">
          {profiles.map((profile, index) => (
            <li className="listItem" key={profile}>
              <div>
                <strong>{profile}</strong>
                <span>Handle {index}</span>
              </div>
              <button type="button" onClick={() => readProfile(index)}>
                Read
              </button>
            </li>
          ))}
        </ul>
        <pre className="dataPreview">{lastFrame}</pre>
      </div>
    </section>
  );
}

