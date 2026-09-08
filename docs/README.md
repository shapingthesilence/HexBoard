# Documentation

Choose a guide by what you need to do.

## Playing And Editing

| Guide | Use it for |
| --- | --- |
| [User manual](user-manual.md) | Hardware, playing, menus, defaults, saving, updates, and recovery |
| [HexBoard Sync guide](web-app-guide.md) | Browser connection, editing, previews, libraries, and backups |
| [MPE setup](mpe-microtonal-setup.md) | Matching external MIDI receivers, bend ranges, and channels |
| [Sequencer manuals](sequencer/README.txt) | Optional sequencer controls, playback, files, and USB Backup |

These guides describe observable behavior and meaningful choices. Keep source
ownership, scheduling, transfer internals, and developer verification out of them.
Describe screen details only when needed to find a control or understand its use.

## Developing And Integrating

| Reference | Owns |
| --- | --- |
| [Repository README](../README.md) | Overview, repository layout, build setup, and flashing entry point |
| [Developer guide](developer-guide.md) | Firmware architecture, ownership, runtime, settings/storage, risks, and edit recipes |
| [Delegated control](delegated-control.md) | Host takeover protocol and runtime gates |
| [Preset sync](preset-sync-sysex.md) | Implemented transfer protocol, capabilities, and object schemas |
| [Web development](../web/README.md) | App source ownership, development, deployment, and integration constraints |
| [Factory library](../factory-library/README.md) | Authoring factory content and generating images |
| [Sequencer requirements](sequencer/requirements/README.txt) | Current behavior contracts with stable requirement IDs |
| [Sequencer layouts](sequencer/layouts/README.txt) | Interaction and screen-layout references |

Keep detailed facts with their owner and link from other guides. Protocol
references describe wire and object contracts; the developer guide describes
runtime implementation. Existing import compatibility belongs in the relevant
schema reference, without a migration narrative.

## Proposed Designs

[Architecture proposals](architecture-proposals.md) describe unimplemented
refactors for review. [Preset-sync extensions](preset-sync-proposals.md) contain
unimplemented protocol designs. Neither is a supported product contract.

Repository contribution and verification rules live in [AGENTS.md](../AGENTS.md).
