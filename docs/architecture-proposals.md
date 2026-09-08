# Architecture Proposals

These are proposed refactors, not implemented behavior or measured performance
results. They target ownership boundaries where new features currently require
coordinated edits across several modules. Keep existing storage formats and
protocol behavior during extraction; any semantic change needs separate review.

## 1. Give Settings Application Its Own Owner

**Evidence:** [menu/MenuAndDisplay.cpp](../src/firmware/menu/MenuAndDisplay.cpp) owns `syncSettingsToRuntime()`, setting
callbacks, geometry refresh hooks, menu construction, and display behavior.
`storage/SettingKeys.inc.h` already owns ordered keys/defaults, and
`synth/SynthSettingsRuntime.cpp` already separates some synth synchronization.

**Proposal:** Move settings decoding and application to an app-level settings
service. Menu callbacks, profile loading, and preset sync should call that
service with typed changes. Subsystems own validation and effects for their
settings; menus own labels, visibility, and editing controls. Preserve
`SettingKeys.inc.h` as the sole ordered persistence definition.

Represent requested effects explicitly: routing, layout, scale, pitch, colors,
synth, and display. Apply them in dependency order and avoid repeating effects
already covered by a broader refresh. Keep note release and safety actions
immediate; only batch recomputation that is safe to delay within the operation.

**Benefit:** New settings no longer need a second runtime implementation for
non-menu callers. Grouped edits can avoid redundant pitch and LED work.
**Cost:** An incorrect effect dependency can leave stale pitches or colors.
Avoid an unrestricted event bus or heap-allocated callback graph.

**First slice:** Extract `syncSettingsToRuntime()` while preserving call order,
then route one setting family through a typed API and remove its old callbacks'
duplicated effects. Compare resulting settings, pitches, routing, and LED caches
for menu changes and profile loads. Count refresh calls and measure worst-case
Core 0 loop time before claiming a speedup.

## 2. Centralize Display And Input Ownership

**Evidence:** `app/Runtime.cpp` separately checks preset transfer, missing
wavetable notice, delegated mode, flash-save visibility, sequencer, command wheel,
and played-note state. [menu/DisplayTransport.cpp](../src/firmware/menu/DisplayTransport.cpp) already owns asynchronous
frame transport and navigation readiness; it does not own which screen wins.
Overlays and menu code each carry restoration and screensaver policy.

**Proposal:** Add a fixed-size display coordinator on Core 0. Each surface
requests a defined priority and lifetime; the coordinator decides the current
surface, encoder destination, wake behavior, and restoration target. Render the
selected surface through the existing display transport. Keep urgent panic and
note release outside UI arbitration.

**Benefit:** Adding a surface requires one ownership definition instead of
another collection of visibility checks. Coalescing can avoid drawing surfaces
that will immediately be replaced.
**Cost:** Existing preemption and wake behavior must be captured explicitly;
a generic push/pop stack alone cannot handle expired or invalid restoration
owners. Transport completion and display ownership remain separate concerns.

**First slice:** Put only command-wheel and played-note arbitration behind the
coordinator, replacing their mutual checks. Verify transitions among sleeping
menu, held notes, wheel expiry, and encoder wake. Then include modal surfaces.
Measure redraw count, encoder-to-visible latency, and note-service latency
under concurrent input; preserve asynchronous DMA and its IRQ ownership.

## 3. Separate Geometry Storage, Decoding, And Runtime Commit

**Evidence:** [storage/PresetSyncGeometry.cpp](../src/firmware/storage/PresetSyncGeometry.cpp) owns HGB validation, catalog
iteration, profile-reference resolution, TLV decoding, and mutation of tuning,
layout, scale, color, and button runtime state. Its
`loadUserGeometryBundleFromTuningSlot()` repeatedly finds and applies linked
records. The tuning and layout apply paths both call `applyLayout()`; later
records can fail after earlier runtime mutations.

**Proposal:** Split three concrete responsibilities: a geometry store for files
and metadata, a codec/validator for object bodies, and a model-owned loader that
prepares a complete selection before committing it. Menu selection and host
preview should use the same runtime application boundary. Keep persistent HGB
writes atomic and individual protocol previews supported as they are today.

Read the selected bundle in one metadata pass where practical, retaining only
the offsets needed for its active records. Decode and validate into bounded
candidate state, then commit and refresh derived data once. Define held-note
handling at that commit boundary, preserving existing note-release identity.

**Benefit:** Less repeated file traversal and recomputation; fewer ways for menu,
profile, and host application to disagree or leave a partial selection.
**Cost:** Candidate state needs a measured RAM budget. Do not duplicate an entire
maximum-sized bundle or all catalogs in RAM. Cross-message atomic host preview
would require a separate protocol extension; this refactor alone cannot promise it.

**First slice:** Extract pure geometry validation with valid, malformed, and
missing-dependency fixtures. Introduce prepare/commit for on-device bundle
selection, removing the sequential mutation path. Check that failure preserves
the previous playable selection, and compare filesystem reads, peak heap, and
refresh counts at maximum supported tuning size.

## 4. Make Preset Transfer And Flash Lifetimes Explicit

**Evidence:** [storage/PresetSync.h](../src/firmware/storage/PresetSync.h) exposes mutable read/write transfer structs
alongside wire constants, codecs, storage helpers, and runtime APIs. Write state
uses independent `active`, `ended`, `streamRawToFile`, and
`flashSafeMuteActive` flags. Transfer cleanup spans `PresetSync.cpp` and
`PresetSyncProtocol.cpp`; several stores pair flash-safe begin/end calls.

**Proposal:** Give a transfer session explicit states and a single cleanup path
for commit, abort, timeout, disconnect handling, and error. Keep public entry
points small, move transfer internals to a private header, and separate object
adapters from framing and transport progression. A flash-write lease should be
owned by the session for streamed writes; a local scope guard can cover writes
completed within one call. Preserve the existing coordinator's nesting behavior.

**Benefit:** New object types reuse transfer lifecycle and cleanup instead of
adding another flag-dependent path. Flash muting and temporary-file ownership
become reviewable in one place.
**Cost:** This is mainly a reliability and extensibility improvement. It does
not remove the RP2040 flash-write interruption or justify moving filesystem work
onto the audio core.

**First slice:** Encapsulate existing cancellation and test every failure exit
before changing progression. Validate duplicate/out-of-order chunks, CRC failure,
commit failure, abort, and timeout; verify temporary-file cleanup, one final
ACK/NACK outcome, and restored audio/UI ownership on hardware.

## 5. Separate Web Editor State From Device Operations

**Evidence:** [TuningLayoutEditor.tsx](../web/src/views/TuningLayoutEditor.tsx) and
[SynthPresetLibrary.tsx](../web/src/views/SynthPresetLibrary.tsx) each combine editing, library operations,
connection effects, and transfer UI. `editor/drafts.ts` is already shared, but
persists the complete draft state with `JSON.stringify()` and synchronous
`localStorage.setItem()` whenever that state changes.

**Proposal:** Keep musical editing/transforms in testable state reducers,
extract library and device-operation services, and leave views responsible for
presentation. Give each operation a connection/session identity so stale async
completions cannot update a new connection or newly opened draft. Reuse
`presetSyncClient.ts` for wire progression instead of adding another transport.

Profile draft serialization during dragging and large tuning edits. If it is
material, coalesce writes by dirty draft with explicit flush points for switching
items, export, and page lifecycle. Preserve discard baselines and visible save
failures; specify any durability tradeoff before delaying persistence.

**Benefit:** Device ACK/commit, dependency checks, and replacement workflows
have a reusable owner. Smaller state boundaries make additional object editors
easier to add. Reduced serialization is a possible browser responsiveness gain.
**Cost:** Splitting JSX alone does not reduce runtime work. Debounced persistence
can lose the most recent edits if the browser terminates before a flush.

**First slice:** Extract one complete tuning save operation, including dependency
validation, ACK handling, refresh, and active-record application. Remove the
in-view duplicate. Test disconnect/reconnect, draft switches during a transfer,
NACK, destination replacement, and save/discard behavior. Measure long browser
tasks and persistence frequency before changing draft durability.

## Suggested Order And Acceptance

Start with settings ownership, then display arbitration. Follow with geometry
prepare/commit and transfer lifecycle. The web extraction can be scheduled
independently. Each slice must replace its old path; temporary adapters need a
clear removal boundary so the refactor does not become another layer of patches.

Keep the existing synth API, fixed voice limits, bounded buffers, RAM hot tables,
metadata-only catalogs, and host-built factory images. Do not begin with an RTOS,
a global event bus, a full-catalog cache, or an audio renderer rewrite without a
measured constraint requiring one.

For firmware slices, run `make` and affected hardware checks, including the
sequencer build when shared behavior changes. Compare worst-case Core 0 service
latency, audio underruns, peak RAM, and input latency under dense MIDI, large
catalogs, display activity, and transfers. Report both benefits and regressions;
file size and reduced line count are not performance measurements.
