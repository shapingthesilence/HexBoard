# HexBoard Sync User Guide

## Returning to Your Place

The app remembers your last main tab, Learn section, course, and lesson in this
browser. Opening the base website address restores that location. Returning to
Learn from another main tab also restores your last Learn location.

Main modes and Learn sections have short bookmarkable URLs: `#/layouts`,
`#/synth`, `#/learn/practice`, `#/learn/courses`, and `#/learn/progress`.
A Courses link restores your last course and lesson in this browser. `#/learn`
opens your last Learn section; the base website address opens your last-used
mode. Browser Back and Forward move between modes and Learn sections. Individual
courses and lessons are saved locally rather than included in the URL.

Switching tabs or putting the laptop to sleep pauses lesson playback. Your page
and lesson remain selected, including after a browser reload. Start playback
again when ready, and reconnect HexBoard if needed. In-progress attempts and
active device sessions are not resumed automatically. Dialogs and temporary
practice controls are not included in the URL.

If the board disconnects during a lesson, a connection panel appears above the
keyboard with **Reconnect HexBoard**. Plug the board back in and use that button;
connection errors and any device selection appear in the same panel. Your course,
lesson, and course layout stay selected. Once connected, use **Start · hints**
or **Start · no hints** to restart the attempt. You can also connect from this
panel when opening a lesson without a board.

## Learning Your First Scale

Open **Learn** to practice scales. It starts with the bundled **12 EDO (Normal)**
tuning and major scale. Wicki-Hayden, Harmonic Table, and Gerhard are available
without downloading anything. Choose **Start on HexBoard** and release all
hardware keys before starting. When disconnected, an on-screen test is available
under **Test without a HexBoard**.

Use **Scale practice**, **Courses**, and **Progress** to navigate.
Start/Stop and Hints sit above the key map. Choose a scale to preview its exact
exercise pitches immediately, including every duplicate key in the selected
register. Other notes stay dimly colored. **Display & sound** and
**Library & help** expand when needed.

### Loading from HexBoard

Connecting loads only the tuning names. Choose a tuning under **On HexBoard**
to read its definition, palette, and layout/scale names. Choose a layout to read
that layout and its key assignments; choose a scale to read its degrees. Learn
never downloads the full library or a complete tuning bundle from the device.
Previously read items are cached for this connection, including across visits
to Learn. **Library & help → Refresh tuning names** clears that cache and returns to 12-EDO; use
it after changing the device library. Disconnected or failed reads are reported
and can be retried. Selections load before practice begins.

Device loading requires firmware advertising scoped geometry lists. Older
firmware can still use bundled/imported tunings with supported learning
sessions; the app explains when an update is needed. Learn reads stored
content and does not change device presets, scales, or settings.

Sound comes from the browser during the lesson. **Hear example**
demonstrates the pattern. Play notes in order; you can hold one while pressing the next.
**Color mode** can change during practice: Rainbow, Custom, Alt, Fifths, Piano,
Alt Piano, Filament, or Diatonic. Colors use the selected tuning and root.
Custom uses its stored degree palette and selected layout's per-key colors.
The next pitch becomes much brighter with a solid outline; any matching key
counts. Held keys brighten and have a dashed outline on screen. Function keys are hidden. Absolute brightness comes from the HexBoard’s saved
hardware setting. **Contrast** changes the brightness of background keys
relative to targets; lower contrast keeps more of the pitch colors visible.
The default is 50%; saved contrast preferences are retained.
Targets use full Learn brightness before the board’s normal processing.
Contrast is saved as your browser preference, separate from courses.

Choose a **Pattern**: ascending, descending, up and down, down and up,
or **Skip one scale tone** (thirds in a seven-tone scale). Round trips play the
turning note once. Runs cover one period of the chosen scale.

- **Free timing** waits for correct answers and counts extra
  attempts. Timing starts with the first correct attack and stops at the last
  correct attack, excluding the final held note. The final correct attack completes the run. The last run's time and extra attempts remain visible.
- **Metronome** offers 40–180 BPM and four high count-in
  clicks before every run. A correct press immediately highlights the next
  note; play it on its assigned click. If you miss, the cue advances when that
  beat's window closes. Each run shows a score out of 100, a grade, misses,
  and extra attempts. A
  complete pattern also shows its first-to-last attack time. The score rewards
  correct notes close to their assigned beat and penalizes misses and extras.
  Use speakers or wired headphones for consistent timing; device/browser
  latency still affects the result.

**Repeat runs** starts another free run on your next first note,
or another beat run after the next count-in. Turn it off before starting for
single runs with repeat buttons. Stop to change the pattern, mode, tempo, or
layout. Hints and contrast remain adjustable during practice.
Demonstrations are available in at-your-own-pace mode. Results last only for
this visit. Course progress is saved separately, as described below.

Under **Library & help → Import tuning bundle**, open JSON exported from the editor. EDO,
equal-step, and Scala cents-table tunings are supported, including non-octave
periods. Audio plays the actual fractional pitches without rounding to MIDI
semitones. Choose a **Root** and **Register**. For microtonal
labels, `[0]` means the register around the tuning's degree zero, `[-1]` the
period below it, and `[1]` the period above; the stored reference sets frequency.
This register number need not be a Western octave number.

Layouts honor rotation, mirroring, disabled keys, pitch overrides, and direct
MIDI assignments. Command and one-button chord keys are unavailable for scale
answers. Missing pitches block starting; change the register, scale, root, or
layout to fit the board. Pitches outside the browser lesson's MIDI-equivalent
0–127 range are unavailable. Live device transpose and dynamic just-intonation
retuning are not imported; practice uses the stored static tuning definition.
Imported bundles last for this visit to Learn.

The lesson uses its selected layout; saved device settings are not replaced.
The web map rotates with the layout, and current firmware temporarily rotates
the board's OLED to match. The saved OLED orientation returns on exit.
Normal instrument playing and controls return after **Stop** in Scale practice,
or after leaving Learn or hiding the browser tab. Moving between
lessons or Learn sections keeps the connection active. Lesson changes stop
old audio and wait for all held keys to be released before the next run. Sessions have no heartbeat
or automatic timeout. If the browser crashes or disconnects before exit is
delivered, hold the encoder for about five seconds. Release the encoder and
all keys, then start another lesson; restarting the board is not part of the
normal recovery workflow. Update the app and firmware together for version-2
sessions.

### Courses and Progress

Under **Courses**, start with **1 · First Steps on HexBoard**. The four included
courses build from a first note to shape translation, rhythmic phrases, and major-scale fluency;
see [Built-in course paths](#built-in-course-paths) below. Choose a lesson from
the always-visible **Your course path**, or use **Next lesson** after finishing. Reading pages use
**Continue**. Course introductions appear before the first lesson.
Each practice lesson explains what to listen for and what to play.
**Hear example** is available before starting a run. Untimed board practice
resumes after the example. Timed lessons wait so you can read the instructions
and listen at your own pace. Press orange **Start · hints** or yellow
**Start · no hints** when ready; the metronome then begins a four-click count-in. If
you listen after finishing a lesson, the completed result remains on screen
and **Next lesson** stays available.
When HexBoard is connected, **Start Course on HexBoard** opens a board session
from the introduction, including when the first lesson is a reading page. A
reading page opened directly has **Start on HexBoard**. In a course session,
four of the seven side buttons are used, with an unused button between actions:

| Button | Action |
| --- | --- |
| 1, blue | Next lesson after finishing, or Continue on a reading page |
| 3, cyan | Hear example |
| 5, yellow | Start or repeat without hints |
| 7, orange | Start or repeat with hints |

Unavailable actions go dark. Next / Continue lights only when its matching web
button is available. The compact side-button guide in Learn follows the physical
stagger and shows the unused buttons as blank spaces. Its labeled buttons are
clickable and keyboard accessible: use them to hear examples, start/repeat with
or without hints, and advance. Starting from an exercise also opens the HexBoard
session when needed. Courses use these controls instead of a separate transport
bar and hints checkbox. A repeat after Step or
slower timed practice moves to the lesson's goal tempo. Moving between lessons
keeps the session open. Untimed practice starts after all held playable keys are
released; timed lessons wait for a Start press. Reading pages keep the session open.
The built-in courses use standard 12-EDO and include all three starter layouts.
User-authored courses and Scale practice can use other tunings.
Equivalent-pitch buttons count unless an authored route exercise requires keys.

Single-note lessons allow overlapping notes. Chord lessons require all listed
pitches held together, with unrelated notes released. Keep shared notes held
when changing chords. On screen, click a key to hold it and click again to
release it. On HexBoard, press and release normally.

Moving to another lesson turns hints on again.
**Repeat without hints** restarts the exercise with the target cue and exercise strip hidden. The key labels
and tuning colors remain visible. **Progress** saves completed attempts, best
mistake count, and independent completion for each lesson and layout in this
browser. An **Independent** star means a complete run with zero mistakes and no
hints or demonstration during that run; it is not a claim of lasting mastery.
**Export progress** creates a backup; **Restore progress** merges a backup
without removing newer achievements. No account or device writes are required.

**Play synth** in Scale practice lets you explore the selected tuning/layout without starting a
lesson or recording a score. It uses a connected HexBoard when available;
otherwise, click the screen keys. You can also keep playing after a lesson ends.
Use **Stop** to end synth play. Changing lessons still requires releasing held
physical keys before the new lesson starts.

When hints are on and the author supplied finger assignments, the same two-hand
visualization used in the editor appears below the course board. It follows the
current target; a finger assigned to exactly one pitch takes that note's color.
A finger shared by multiple pitches uses a neutral highlight. Held notes from
an earlier chord dim when the target advances, while common tones remain lit.

### Built-in course paths

The included pathway has four courses:

| Course | What you play |
| --- | --- |
| **1 · First Steps on HexBoard** | 12 exercises and a welcome page: first notes, Au clair de la lune, octaves, duplicate pitches, and a phrase of Ode to Joy |
| **2 · Moving Around an Isomorphic Keyboard** | 17 untimed exercises, an introduction, and free exploration: intervals, duplicate positions, and familiar Au clair / Twinkle phrases moved to another key |
| **3 · Rhythm Fundamentals** | 24 exercises and three pages: pulse, quarters/eighths, rests, 3/4, syncopation, simultaneous notes, prepared triplets/6/8, and familiar melody phrases |
| **4 · Major Scale and Scale-Degree Fluency** | 24 exercises, three pages, and free exploration: scale groups, degrees 1–7, musical patterns, Joy to the World's descending scale, and Twinkle in D major |

Aim for one section in a short visit, then finish with a tune you enjoy.
Recall a familiar phrase before listening at the start of your next visit.
Course 4 introduces degree numbers as positions in the scale; they are different
from finger numbers. It builds C major before moving the same relationships to
D major, and teaches the new route without a clock before its final performance.

Start with one layout and keep it while learning a phrase. The courses suggest
compact routes for Wicki-Hayden, Harmonic Table, and Gerhard. Matching duplicates
still count. Duplicate-discovery and route-choice exercises light matching
buttons equally. A translated pattern can recommend a different duplicate;
one pitch does not have one permanently assigned button across the curriculum.

First Steps introduces duplicates before intervals or timing. C♯, E♭, and F
have duplicates on all three starter layouts; some pitches, including C4 on
Wicki-Hayden, occur only once. An octave is a different pitch, not an exact
substitute in these exercises.

Timed goals are 60–70 quarter notes per minute. **Practice tempo** offers
20–300 BPM; its bottom **Step** position waits for correct notes without a
metronome and skips rests. **Hear example** uses the goal BPM in Step mode.
Slower practice receives feedback, but timed completion requires reaching the
authored goal and passing score. These courses assess attacks, not releases;
follow written rests and long notes by listening as well as watching the score.
In 6/8, group eighth notes into two larger pulses; the click still counts quarter
notes and the count-in remains four clicks.
With hints on, the on-screen hexagon outlines begin shrinking two quarter-note
beats before each note and reach its key when the note is due.

First Steps asks for one final passing performance; the other three final
checkpoints request two consecutive clean runs. Rehearse with hints,
then use **Repeat without hints** on the board or in Learn after a
run. Independent completion is tracked separately; guidance does not prevent
ordinary completion. Key labels and colors remain when hints are off.

**Your course path** stays open in its own box. Scroll inside the box
to find a lesson without pushing the controls below it down the page. The selected
lesson stays in view as you advance. The outline shows completion for the selected
layout, groups lessons into sections, and distinguishes reading, exploration,
completed practice, and Independent stars. Reading and unscored exploration do
not count against the exercise total. Choose any lesson in the path to revisit it;
**Next lesson** advances after a run. A course introduction offers **Continue** at
the first unfinished exercise when that layout has progress.

On laptop windows at least 1000 pixels wide and 600 pixels tall, course
exercises fit the available screen height. Start, example, and lesson navigation
stay visible, with the course list scrolling inside its own box. **Lesson
settings** groups layout, display, sound, and course management; its summary
shows the selected layout. Open it when you need to change a setting.
**Practice tempo** stays visible above the key map, beside the lesson status.
The slider shows the goal BPM beside its current value and marks the target on
the track. It is locked during a run; adjust it before starting or after
finishing.

Lesson instructions stay above the key preview in a compact reading panel sized
to the longest built-in lesson at the available width. Its height stays the same
between lessons. Longer imported text can scroll inside the panel; the timed
start reminder stays visible above the board. Recommended fingers sit beside
the keyboard on laptops. Run scores and required-key details appear below it;
repeat and next-lesson actions remain visible after completion. Narrower or
shorter windows use the stacked layout and may need page scrolling.

A newly completed lesson receives a brief checkmark overlay and soft chime.
Earning independence adds a star and a different chime. The overlay clears after
about five seconds without requiring a click. Results and repeat/next actions
remain below the preview, and the course path keeps earned checkmarks and stars.
Repeating an already earned achievement does not replay the reward. Slow
rehearsals, unfinished clean-run
requirements, and exploration do not produce a completion award. Under **Display
& sound**, turn off **Achievement sounds** to keep only the visual feedback.
Reduced-motion preferences disable the celebration animation. Rewards use browser
audio and stop when you stop, change lessons, leave Learn, or hide the tab.

Course instructions refer to the physical HexBoard. When disconnected,
**Test without a HexBoard → Try on screen** is available for testing lesson
behavior with clickable keys. It is secondary to the normal learning workflow.

All built-in courses support **Make a copy** and **Export course**. Use a copy
to change teaching content or button choices. Built-ins cannot be edited or
deleted directly. More courses are planned; the [curriculum inventory](curriculum.md)
distinguishes included material from future authoring work.

### Creating and Sharing Courses

Open **Courses → Manage courses**, below **Library & help**, for **Create course**, **Make a copy**,
**Edit course**, **Export course**, and **Import shared course**. Authoring
controls stay outside the normal lesson view. Courses are saved in this browser;
export a backup or share the `.hexcourse.json` file with another player.

In the editor, open **Course Settings**. Tuning and layout choices are on that same page.
The selection window overlays the editor. Choose **Browser library** or
**Connected HexBoard library**, select a tuning, check the supported layouts,
and optionally require one layout. Click **Use selected layouts** to copy those
definitions into the course. Lessons use their authored notes rather than a
selected scale; one internal scale definition remains in the exported bundle
only for tuning-file compatibility. Other layouts loaded elsewhere in Learn are not added.
The exported course includes those tuning, palette, scale, and layout
definitions, including custom key assignments. Recipients can play immediately
even if the definitions are absent from their HexBoard. Importing never
replaces device data.

**Record** above the piano roll turns your HexBoard into the authoring input. Release all
keys before starting. In **Lesson Settings**, choose **Melody** to capture every note press (overlap is
fine), or **Chords** to group notes until you release the whole chord. Choose
**Metronome** timing and a tempo first to hear clicks and capture beat lengths.
**Snap** defaults to eighth notes; choose quarter, sixteenth, or triplet notes
in the shared toolbar above the piano roll to match the phrase.
Step spacing supports straight and triplet divisions, up to eight quarter notes. **Stop recording**
replaces the current lesson's steps with the captured phrase. The actual keys
become preferred keys, with duplicates initially accepted. Add pauses as rest
steps and adjust beat lengths afterward. Encoder hold, hiding the tab, or a
lost connection stops recording and keeps captured notes in the open draft.
Edits autosave into a recovery draft. **Save course** updates the saved course.

For small songs or segments, add one lesson per manageable phrase. Each step
can contain a note, a chord, or a timed rest. New lessons and added steps start blank. In standard 12-EDO,
the text box in **Phrase tools** can replace them
in one action. For example:

```text
C4 D4:0.5 E4:0.5 G4:2 -:1 [C4 E4 G4]:2
```

This plays C, two shorter notes, G for two beats, a one-beat rest, and a C major
chord. A missing length means one beat. **Hear example** in the player auditions
the phrase at your selected practice tempo, including its note holds.

The editor centers on three actions:

1. **Place a note** in the piano roll with a double-click or Command/Ctrl-click.
   Drag to change pitch or position; drag the right edge to change length.
   Select a note and press Backspace or Delete to remove it. Deletion leaves
   silence and keeps later notes in place. Simultaneous notes form a chord.
2. **Choose a key** on the board directly below the roll. Only matching pitches
   can be assigned. The preferred key lights as the target; non-recommended duplicates retain ordinary background color and brightness. Keys are guidance by default. Enable
   **Require recommended keys throughout this lesson** in **Lesson Settings**
   to make all assigned keys mandatory. Switch layout tabs to author each layout's cues.
3. **Choose a finger** by clicking either hand. Numbers run from 1 (thumb) to
   5 (little finger). This is advice; the board cannot detect the player's finger.

The roll adds room as the phrase grows or you scroll toward its end. The compact X and Y sliders above it adjust beat spacing and pitch-row height independently. Choose
quarter-, eighth-, or sixteenth-note snapping, including triplets (straight eighth notes by default). Drag empty space to select several notes and drag a selected note to move the group. Command/Ctrl+C copies the selection; Command/Ctrl+V attaches a copy to the cursor until you click to place it. Escape cancels. Each layout’s button, hand, and finger recommendations are copied too. Transposing a pasted group moves its recommended buttons by one shared board displacement per layout, preserving the shape. Buttons that cannot fit are cleared; hand/finger advice remains. Switching layout tabs keeps the same pitches visible in the piano roll, clamping only at its range limits.
Free-timing lessons use the same roll with quarter-note steps; moving or deleting
notes closes silent gaps, and note lengths stay at one quarter note.
You do not need to add steps
before placing notes. Blank timed steps are rests; blank free-timing steps
must be filled or removed before saving. Each saved practice lesson needs a played note.

Set a lesson's meter in the compact toolbar above the piano roll. It defaults
to 4/4 and controls the roll's bar guides; for example, 6/8 contains six eighth
notes per bar. Tempo always counts quarter notes per minute, and practice keeps
its four-quarter-note count-in and quarter-note clicks.

Clicking or creating a piano-roll note plays a short preview. Dragging to a different pitch previews that pitch; horizontal dragging does not repeatedly retrigger it.

**Play** above the piano roll auditions the phrase with a moving playhead and sounding board
keys. **Stop** stops it immediately. The same compact toolbar owns BPM, meter,
and the snap grid used by both recording and piano-roll edits. Playback includes chords, rests,
microtonal pitches, and holds that overlap later notes. Free-timing lessons use
even quarter notes at 80 BPM for preview. Holds affect playback by default. Enable **Grade note releases and durations**
in **Lesson Settings** to assess articulation too, then choose a forgiving
release tolerance in beats (default 0.25). Early, late, or missing releases
prevent completion. On-screen duration practice uses one click to hold and
another to release. Step practice remains untimed. The player uses approaching hexagonal outlines on the
key map to show when to play. Each outline starts two quarter-note beats before its
target time; upcoming outlines can overlap for faster notes and chords.

To allow flexible answers, select a step and use **Accepted answers** below the
roll. Choose **Any listed voicing** for a set such as `[C4 E4 G4] [E4 G4 C5]`,
or **Pitch classes in a range** for any inversion or any C within a chosen range.
The roll still supplies the demonstration. A changed pitch group clears its
answer rule; check it again after editing or recording a replacement phrase.
When grading duration, note lengths follow the authored alternative voice order
(or pitch-class order). Shared chord tones must be rearticulated; write a single
long note for a sustained voice.

For creative activities, select **Free play / exploration** in **Lesson Settings**.
Set the duration, pitch range, optional scale classes, and optional highlighted
chord tones. Enable **Repeating accompaniment** for a chord loop or a single
sustained drone. Learners can play their own ideas until the timer ends, with no
target sequence or grade. Outside notes remain audible with gentle feedback.
Stopping or leaving the activity also stops its accompaniment. **Guided practice ·
no grade** is still available for unscored practice of a fixed phrase.

Timed lessons have an authored **Goal tempo** and learner-selected **Practice
tempo** (20–300 BPM). Slower runs receive normal timing scores, but completion
requires reaching the goal tempo, satisfying every step, and scoring at least
the authored passing score (75 by default). Hints-off, mistake-free passing runs can also earn Independent. Progress
retains best passing score and highest passed tempo. Only changes to a lesson’s
graded exercise invalidate its results; changing prose, playback holds, or
other lessons preserves them.

The always-visible **Course outline** can drag lessons between sections or move a whole section. **+ Add lesson** inserts directly below the active lesson, inherits its section, and opens **Lesson Settings**. Use each lesson’s **…** menu to duplicate or delete it. Rename the active lesson in the title field above the piano roll. In **Lesson Settings**, **Section** accepts an existing section or a new name, and **Markdown page** creates introductions or explanations with no grade or completion requirement. **Course introduction** in **Course Settings** accepts Markdown too and appears first when a learner selects the course, with a green **Start Course** button. Markdown pages have no separate lesson explanation. Supported formatting includes headings, lists, quotes, code, emphasis, and web links.

**Lesson layout** in Lesson Settings can require one of the course’s included layouts. Otherwise the learner can switch between allowed layouts during practice; switching restarts the run, waits for held hardware keys to be released, and uses the new layout’s cues. Include only one layout in Course Settings to limit the entire course to it.

Applying a tuning that cannot represent existing lesson pitches shows **Incompatible Tuning: Clear Notes/Buttons/Fingers?**. **Revert** is focused by default and preserves the course. **Clear** asks for confirmation again before clearing practice notes and their button/finger assignments. Titles and Markdown pages remain, and Undo can restore the draft.

**Lesson Settings** also contains the optional grading controls: guided practice can run without a grade; timed lessons can require a passing score such as 90. **Require recommended keys throughout this lesson** applies the physical-key requirement to all assigned notes. Turn off **Track independence** when completing once is sufficient. **Require clean repetitions** adds a consecutive-run requirement. A failed run, stopping, changing lessons/layouts, or changing hints resets that streak. Tempo and repetition fields may be cleared while typing; leaving a blank or out-of-range field restores their prior values.

**Preview as learner** tests the current draft—even when its active lesson has no notes yet—and returns to the editor without saving learner progress. **Layout compatibility** in **Course Settings** appears only when something needs attention. Its highlighted summary and a warning on the Course Settings button flag missing notes or button assignments without blocking saving. Choose a layout in **Transpose layout** and set its offset in tuning steps. The saved number is the offset from its original course mapping; set it to zero to restore that mapping. Lesson pitches stay fixed.

Course and draft storage uses IndexedDB in this browser. **Manage courses**
lists courses with only an unsaved draft, along with deletion and shared-file import/export. Opening a saved course for editing prompts you to resume its recovery draft or discard it and edit the saved version. The editor
has Undo/Redo, lesson duplication/reordering, step reordering, and note-order
controls. **Close** warns about unsaved edits and offers to keep the draft,
discard it, or keep editing. Export a draft backup before clearing browser data.
A saved course and its recovery draft are separate; importing an update keeps
existing drafts. For a matching course ID, choose **Update existing**, **Keep
both**, or **Cancel import**. Updates preserve compatible lesson progress.
Exported course files omit learner progress; back it up in **Progress**.

## Connecting and Editing

A browser-based HexBoard Sync app lets you edit and sync tunings, layouts,
colors, custom key assignments, synth presets, and user wavetables.

Device connection requires a Web MIDI-capable browser, usually Chrome or Edge, and must be
opened from `localhost` or a secure HTTPS address. Connect HexBoard by USB and
select `Connect HexBoard` in the top bar. While not connected, you can edit
and save browser drafts and import or export files. If several compatible boards are
available, choose one from the device selector.

Editing uses normal page scrolling: libraries, sidebars, and controls move with
the page. Synth save actions stay available as you edit. On laptop windows at
least 1000 pixels wide and 600 pixels tall, Learn keeps its key map and playback
controls in the workspace. Progress scrolls the lesson list while keeping course
selection and backup controls available. Smaller windows allow page scrolling;
narrow windows stack the panels.

## Tunings, Layouts, And Colors

In the tuning/layout editor, you can create EDO tunings, equal-step tunings,
Scala `.scl` imports, vector layouts, scales, custom scale-degree colors, and
per-button pitch, color, direct-MIDI, or chord overrides. Choose a tuning in
`Library` to open the tuning library over the editor. Choose a bundle to close
the library and edit it, or use **Close library** or Escape to return to the
current bundle. Switch freely between `Tuning`, `Layout`, and `Scale & color`.
Open **Name & folder** to rename or move the tuning. The board shows your changes
as you edit. The whole board fits the available window height. The button editor
appears below the preview and opens without shrinking it; scroll the page to edit
a key. Sync and save
actions sit next to the bundle name and its save/connection status, below the
section buttons, and scroll with the page. Valid, in-range numeric edits
update the preview as you type. Empty, incomplete, or out-of-range drafts remain
editable without changing the preview, then restore or clamp when you leave the
field. Names and descriptions likewise apply their
length and fallback rules only after you leave the field. Note labels are
edited individually in the note-label grid or together under `Edit labels as text`.
In `Scale & color`, click the note chips to include or exclude degrees. All Notes
is protected; create a scale to choose a subset of notes. Reorder layouts and
scales to choose which loads first with the tuning; All Notes can be reordered
but cannot be edited or deleted. The `Pitch anchor` statement groups the anchored
tuning degree, frequency, and scientific-pitch MIDI key, for example
`A4 = 440 Hz · A (degree 9)`. Changing the anchored degree retunes
the labeled notes without renaming or rotating them. `Default key` appears
separately under `Scale defaults` and chooses the scale key selected when the
tuning is first loaded. The app does not infer note names or reference positions
from the tuning size.
The compact board mode selector highlights one active mode: `Select` edits
keys, `Paint` applies a color by clicking or dragging, and `Pick color` copies
a key’s color and returns to Paint. Hover a mode for a short explanation.
Undo and Redo sit beside Save to Browser and apply to layout transforms and
paint strokes. Painting selects
`Custom` color mode and can target individual keys or scale-degree colors.
Painting a scale degree clears matching per-key color overrides in the active
layout. Turn on `Key numbers` when you need hardware key numbers.

Use `Key inspector` to choose a tuned note, a fixed MIDI note/channel, a chord
of up to four tones, or `Off`. Chord intervals can use tuning steps or MIDI
semitones. You can override pitch and color independently; `Advanced pitch
details` shows the derived tuning information. `Reset all key overrides`
restores the selected key to its layout and palette.

Shift-click selects a range; Control-click or Command-click toggles individual
keys. The primary key is gold and other selected keys are green. The primary
key is also the center for transforms. `Deselect All` clears the selection.

`Device rotation` changes the board's displayed orientation. Use the layout
transform controls for transposition, 60-degree rotation, and mirroring.
`Whole layout` moves the layout and its overrides together; `Selected keys`
changes only the selection's overrides. Mirrors follow the displayed board
orientation. Overrides moved beyond the visible board are retained and can
return with later transforms or undo. Undo/redo also covers painting, with one
continuous brush stroke treated as one action.

Both editors keep drafts in this browser when you switch items or reload the
page. `Save to Browser` updates the saved library item; `Discard draft` returns
to the saved or originally opened version. Library copies and exports use the
saved item. The editor’s export action includes its current draft. Browser
storage is local to this browser; export files for a portable backup.

## Previewing And Saving

`Preview on HexBoard` applies the current edit without saving it permanently.
`Live preview` keeps compatible edits audible on the connected instrument.
The status distinguishes browser drafts, saved browser items, and device saves.
`Save to HexBoard` saves the complete tuning, then applies its active
layout, scale, colors, and key assignments so the preview and device
menu agree. The saved tuning appears in the on-device `Tuning`, `Layout`, and
`Scales` browsers. HexBoard stores up to 64 complete tunings; each includes its
palette and linked layouts and scales. Tuning division and scale-cycle lengths
may be from 1 through 1024. Each tuning may contain up to 32 layouts and 32
scales.

The editor's `Color mode` selector is saved with each tuning and is
applied when that tuning loads. The supplied `12 EDO (Normal)` tuning defaults
to `Rainbow`.

## Tuning Libraries

In Library, click a tuning name to edit it, or drag tuning rows to reorder them. `Copy to HexBoard` and
`Copy to Browser` copy a tuning between libraries. The item’s more-actions menu
contains rename, move, copy, export, and delete. `Export File` saves a
portable tuning file to the computer, and older exported tuning files remain
importable. Uploads and downloads show progress while the transfer is active.
If HexBoard has no usable stored tunings, the app shows a
built-in rescue-tuning notice instead of presenting that read-only rescue as an
editable library item.

`Rename / Move` updates a tuning in place in either library. The app
shows the final folder and name before saving. If that destination is occupied,
it identifies the tuning that will be replaced and requires confirmation;
deletion happens only after the renamed tuning has saved. Direct `Delete`
actions also require confirmation.

Selection boxes provide the same batch workflow as the synth preset library.
Select the tunings shown by the current folder filter, then copy them together
to the other library or export them as one tuning-library file. `Import
Files` accepts several individual tuning files and bulk tuning-library files in
one selection. A single warning summarizes any destination tunings that a batch
copy or import will replace.

Library folder rows begin with the visually distinct system views `All` and
`Root`, followed by user folders. New folders belong to the
computer library and stay available between sessions. An empty computer folder
can be deleted from the `Folders` menu; move or delete its tunings first when it
is not empty. HexBoard folders are derived from the saved items on the device,
so a device folder disappears automatically after its last item is moved or
deleted.

## Synth Presets And Wavetables

In the synth editor, you can manage synth presets and user wavetables. Presets
can be saved on the computer, uploaded to HexBoard, downloaded from HexBoard,
exported/imported as JSON, edited, erased, and organized into folders.
Use **Presets** and **Wavetables** inside the **Synth Library** panel to switch
between the two libraries. `New sound` starts a preset. Opening a preset restores its draft, if
one exists. Name, folder, and favorite controls share the top bar with
**Save to Browser** and **Save to HexBoard**. Choose **New folder…** from the
top Folder menu to create a browser folder and select it for the current draft.
Use `/` in the name for subfolders; saving the sound remains a separate action.
The sound’s more-actions menu contains export, `Load current HexBoard sound`,
and `Discard draft`; `Other drafts` resumes unfinished sounds. Connecting does
not replace your open sound. Previewing or saving to HexBoard requires a connection.

Playback spans the editor above the oscillator and volume envelope, which sit
side by side on wider laptops. Find `Vibrato speed` in the oscillator section.
Mod wheel and LFO controls form the next row, followed by the two modulation
envelopes. Narrower windows stack these groups. All sound controls remain
visible on one scrollable page.
The wavetable graph follows the selected frame. The volume envelope graph
shows the shape of the sound, with compressed time spacing to keep short stages
visible. Slider values appear beside their labels with times, rates, and
percentages. Scroll the page to reach the lower groups; save actions stay at the
top of the editor while scrolling.
Choose `Off` as a modulation target to bypass it while keeping its settings.
After Poly warp, the Mod wheel target menu offers the five volume-envelope
parameters. Wheel depth raises the saved value toward 4 seconds (times) or
100% (Sustain), scaled by Mod wheel amount. All envelope time sliders include
3 ms between 0 and 5 ms; previously saved times retain their meaning.
Both arp modes expose `Note length` (1–100% of a step). `Poly arpeggiator`
plays one note per step with overlapping release tails; the regular arpeggiator
uses a single voice with a brief fade between notes.
Wavetables can be imported from Serum/Vital `.wav` files or HexBoard
`.hexwav` files, uploaded, downloaded, exported, renamed, moved, and selected
for the open preset. Short HexBoard wavetable files are expanded to fit the
instrument automatically.

Preset and wavetable libraries use the same `All` and `Root` system views.
The `Folders` menu creates and deletes empty computer folders; folders persist
between browser sessions. The built-in `Basic Shapes` fallback appears in
`Root` like the other root-level wavetables. New wavetable imports start in
`Root` unless another folder is selected.

`HexBoard Wavetables` is refreshed from the connected device; if a preset
references a computer-only wavetable, previewing or saving that preset to HexBoard requires
uploading the same-name wavetable or selecting an alternate first. Wavetable
names are unique across folders, and `Basic Shapes` is reserved for the
built-in fallback.

Expand **Test keyboard** in the preset editor to hear the current patch through
your browser. It starts hidden and opens a compact piano layout with raised
black keys and typing-key labels. Hold the onscreen keys or their labeled typing
keys; use Octave, Mod, Preview Vol, or Chord to test the sound. Stop, hiding the
keyboard, and leaving the browser window stop playback. Editing text does not
trigger notes. Typing and onscreen notes use 12 EDO independently of the device's
tuning layout.

To play the browser preview from hardware, choose **Connected HexBoard** under
**MIDI input**, then click **Enable MIDI preview**. HexBoard must send notes over
USB MIDI; its current tuning and layout determine the notes. To use another MIDI
controller, click **Find MIDI controllers**, allow browser MIDI access, select
its input, and enable preview. This also works without connecting a HexBoard.
The current editor draft sounds through your computer, including edits you have
not sent or saved to the board. The board may still play its own internal sound;
turn that off on the board if you want to hear only the browser preview.

Velocity, sustain pedal (CC64), modulation wheel (CC1), and per-channel pitch
bend are supported. Match **Pitch bend ± semitones** to your controller: ordinary
MIDI defaults to 2, while HexBoard's factory MPE Bend is 48. If you change MPE
Bend on the board, match it here too. Received MIDI bend-range messages (RPN 0)
set each channel's range automatically. See [MPE setup](mpe-microtonal-setup.md)
for HexBoard's output choices. The Octave control affects typing and onscreen
notes only.

Stop clears sounding notes while leaving MIDI preview enabled for the next
attack. Hiding the test keyboard or leaving the Synth tab disables MIDI preview.
Changing inputs or disconnecting the selected input also stops MIDI notes;
enable preview again after reconnecting. Losing browser focus or hiding the
page clears notes and ignores MIDI until you return. Hardware preview needs a
browser with Web MIDI support, such as Chrome or Edge, on HTTPS or localhost.

The preview uses the selected wavetable and synth settings to approximate the
instrument's sound, including envelopes, modulation, drive, and playback mode.
Your speakers and HexBoard's piezo will sound different. No connection is needed
for Basic Shapes or wavetables available on the computer; download device-only
wavetables before auditioning them. Browser audition does not send notes or
write presets to HexBoard.

## Transfer Feedback

Large transfers, such as full preset saves or wavetable imports, show their
direction and progress on HexBoard. Audio and controls may pause briefly while
HexBoard saves the transferred item. Individual live synth edits do not show a
transfer screen or mute the audio.

For onboard controls and recovery, see the [user manual](user-manual.md).
For app development, see the [web README](../web/README.md).
