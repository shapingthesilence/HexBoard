HEXBOARD SEQUENCER REQUIREMENTS

Purpose

These files describe the intended current behavior of Sequencer mode in a
requirements-style format.

They are meant to complement:

- docs/sequencer/manuals/sequencer_quick_manual.txt
- docs/sequencer/manuals/sequencer_manual.txt
- docs/sequencer/layouts/*.txt

The manuals describe how the sequencer is used.
The layout files describe what important screens look like.
The requirements files describe what the system shall do.

How to use these files

- Check these contracts against code; code is authoritative when they disagree.
- Update them when Sequencer behavior changes in a meaningful way.
- Keep them written in terms of current behavior, not old behavior.
- Prefer updating an existing requirement instead of creating a duplicate.
- Do not reuse old IDs for new meanings.

Status

Use Active for implemented behavior. Keep unimplemented proposals separate from
current contracts. Delete obsolete requirements without reusing their IDs.

Recommended file roles

- requirements_template.txt
  Base requirement block format.
- sequencer_overview_requirements.txt
  Overall scope, purpose, and core system behavior.
- controls_and_workflows_requirements.txt
  Buttons, encoder behavior, and editing workflows.
- playback_and_timing_requirements.txt
  Tempo, step count, directions, length, velocity, and transport behavior.
- storage_and_files_requirements.txt
  Save/load, naming, folders, browser behavior, and file persistence.
- screens_and_overlays_requirements.txt
  OLED overlays and visual presentation requirements.
- menus_and_settings_requirements.txt
  Sequencer menu structure and menu-driven settings.
- technical_limits_requirements.txt
  Current limits and defined boundaries.

ID format

IDs are grouped by area, for example:

- SEQ-CORE-001
- SEQ-CTRL-010
- SEQ-PLAY-022
- SEQ-FILE-031
- SEQ-UI-044
- SEQ-MENU-051
- SEQ-LIMIT-060

Guidelines

- If a requirement changes but is still the same concept, keep the same ID and
  update its text.
- Delete removed requirements; do not reuse their IDs for different concepts.
- If a requirement is brand new, give it a new ID.
