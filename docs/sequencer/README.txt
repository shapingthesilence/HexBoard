HEXBOARD SEQUENCER DOCUMENTATION

This folder contains the Sequencer-mode documentation set.

Subfolders

- `manuals/`
  Sequencer quick and detailed manuals.
- `requirements/`
  Sequencer requirements-style behavior references.
- `layouts/`
  Sequencer screen and menu layout references.

Notes

- These files are maintained separately from the Keyboard docs on purpose.

How to update these docs

- `manuals/`
  Update the quick and detailed user-facing behavior descriptions.
- `requirements/`
  Update intended behavior contracts. Keep an existing requirement ID when the
  concept is unchanged.
- `layouts/`
  Update screen and menu sketches when visible OLED or menu behavior changes.

Also update general docs such as `README.md`, `docs/user-manual.md`, and
`docs/developer-guide.md` when a Sequencer change affects top-level build
behavior, navigation, architecture, or shared firmware behavior.
