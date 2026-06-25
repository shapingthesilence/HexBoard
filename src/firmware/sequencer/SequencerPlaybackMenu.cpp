#include "SequencerPlaybackMenu.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerStorage.h"
#include "SequencerTransport.h"

namespace sequencer {
namespace {

bool playbackMenuInstalled = false;

GEMPage& playbackSettingsPage(GEMPage& parentPage) {
  static GEMPage page("Playback Settings", parentPage);
  return page;
}

GEMItem& playbackSettingsLink(GEMPage& parentPage) {
  static GEMItem item("Playback Settings", playbackSettingsPage(parentPage));
  return item;
}

GEMPage& midiSyncPage(GEMPage& playbackPage) {
  static GEMPage page("MIDI Sync", playbackPage);
  return page;
}

GEMItem& midiSyncLink(GEMPage& playbackPage) {
  static GEMItem item("MIDI Sync", midiSyncPage(playbackPage));
  return item;
}

const GEMSpinnerBoundariesByte stepCountBoundaries = {
  1,
  kActiveStepCountMin,
  kActiveStepCountMax
};
GEMSpinner stepCountSpinner(stepCountBoundaries, GEM_LOOP);

const GEMSpinnerBoundariesByte tempoBoundaries = {
  1,
  kPlaybackTempoMin,
  kPlaybackTempoMax
};
GEMSpinner tempoSpinner(tempoBoundaries, GEM_LOOP);

SelectOptionByte directionOptions[] = {
  { "Forward", kDirectionForward },
  { "Backward", kDirectionBackward },
  { "Ping-Pong", kDirectionPingPong },
  { "Random", kDirectionRandom },
  { "Brownian", kDirectionBrownian },
  { "Drunk", kDirectionDrunk }
};
GEMSelect directionSelect(sizeof(directionOptions) / sizeof(SelectOptionByte), directionOptions);

SelectOptionByte tapPreviewOptions[] = {
  { "Off", kTapPreviewOff },
  { "On", kTapPreviewOn }
};
GEMSelect tapPreviewSelect(sizeof(tapPreviewOptions) / sizeof(SelectOptionByte), tapPreviewOptions);

SelectOptionByte playTypeOptions[] = {
  { "MIDI", kPlayTypeMidi },
  { "OB Synth", kPlayTypeObSynth }
};
GEMSelect playTypeSelect(sizeof(playTypeOptions) / sizeof(SelectOptionByte), playTypeOptions);

SelectOptionByte monophonicOptions[] = {
  { "Off", kMonophonicModeOff },
  { "On", kMonophonicModeOn }
};
GEMSelect monophonicSelect(sizeof(monophonicOptions) / sizeof(SelectOptionByte), monophonicOptions);

SelectOptionByte clockSourceOptions[] = {
  { "Internal", kClockSourceInternal },
  { "External MIDI", kClockSourceExternalMidi }
};
GEMSelect clockSourceSelect(sizeof(clockSourceOptions) / sizeof(SelectOptionByte), clockSourceOptions);

SelectOptionByte sendClockOptions[] = {
  { "Off", kSendClockOff },
  { "On", kSendClockOn }
};
GEMSelect sendClockSelect(sizeof(sendClockOptions) / sizeof(SelectOptionByte), sendClockOptions);

SelectOptionByte sendTransportOptions[] = {
  { "Off", kSendTransportOff },
  { "On", kSendTransportOn }
};
GEMSelect sendTransportSelect(sizeof(sendTransportOptions) / sizeof(SelectOptionByte), sendTransportOptions);

void playbackTempoChanged() {
  normalizePlaybackSettings();
  markSequenceDirty();
  handlePlaybackSettingsChanged(false);
}

void playbackStepCountChanged() {
  normalizePlaybackSettings();
  markSequenceDirty();
  handlePlaybackSettingsChanged(false);
}

void playbackDirectionChanged() {
  normalizePlaybackSettings();
  markSequenceDirty();
  handlePlaybackSettingsChanged(true);
}

void tapPreviewChanged() {
  normalizePlaybackSettings();
  stopPreviewNotes();
  markOverlayDirty();
}

void playTypeChanged() {
  normalizePlaybackSettings();
  markSequenceDirty();
}

void monophonicModeChanged() {
  normalizePlaybackSettings();
  persistMonophonicModeToProfile();
}

void clockSourceChanged() {
  normalizePlaybackSettings();
  handlePlaybackSettingsChanged(false);
  persistClockSourceToProfile();
}

void sendClockChanged() {
  normalizePlaybackSettings();
  handleMidiSyncSendSettingsChanged();
}

void sendTransportChanged() {
  normalizePlaybackSettings();
  handleMidiSyncSendSettingsChanged();
}

void playbackTempoMenuCallback(GEMCallbackData /*callbackData*/) {
  playbackTempoChanged();
}

void playbackStepCountMenuCallback(GEMCallbackData /*callbackData*/) {
  playbackStepCountChanged();
}

void playbackDirectionMenuCallback(GEMCallbackData /*callbackData*/) {
  playbackDirectionChanged();
}

void tapPreviewMenuCallback(GEMCallbackData /*callbackData*/) {
  tapPreviewChanged();
  persistTapPreviewToProfile();
}

void playTypeMenuCallback(GEMCallbackData /*callbackData*/) {
  playTypeChanged();
}

void monophonicModeMenuCallback(GEMCallbackData /*callbackData*/) {
  monophonicModeChanged();
}

void clockSourceMenuCallback(GEMCallbackData /*callbackData*/) {
  clockSourceChanged();
}

void sendClockMenuCallback(GEMCallbackData /*callbackData*/) {
  sendClockChanged();
  persistSendClockToProfile();
}

void sendTransportMenuCallback(GEMCallbackData /*callbackData*/) {
  sendTransportChanged();
  persistSendTransportToProfile();
}

void previewPlaybackTempo(GEMPreviewCallbackData previewData) {
  playbackTempoMutable() = previewData.previewValByte;
  playbackTempoChanged();
}

void previewPlaybackStepCount(GEMPreviewCallbackData previewData) {
  activeStepCountMutable() = previewData.previewValByte;
  playbackStepCountChanged();
}

void previewPlaybackDirection(GEMPreviewCallbackData previewData) {
  playbackDirectionMutable() = previewData.previewValByte;
  playbackDirectionChanged();
}

void previewTapPreview(GEMPreviewCallbackData previewData) {
  tapPreviewMutable() = previewData.previewValByte;
  tapPreviewChanged();
}

void previewPlayType(GEMPreviewCallbackData previewData) {
  playTypeMutable() = previewData.previewValByte;
  playTypeChanged();
}

void previewMonophonicMode(GEMPreviewCallbackData previewData) {
  monophonicModeMutable() = previewData.previewValByte;
  normalizePlaybackSettings();
}

void previewClockSource(GEMPreviewCallbackData previewData) {
  clockSourceMutable() = previewData.previewValByte;
  normalizePlaybackSettings();
}

void previewSendClock(GEMPreviewCallbackData previewData) {
  sendClockMutable() = previewData.previewValByte;
  normalizePlaybackSettings();
}

void previewSendTransport(GEMPreviewCallbackData previewData) {
  sendTransportMutable() = previewData.previewValByte;
  normalizePlaybackSettings();
}

GEMItem& stepCountItem() {
  static GEMItem item("Steps", activeStepCountMutable(), stepCountSpinner, playbackStepCountMenuCallback);
  return item;
}

GEMItem& directionItem() {
  static GEMItem item("Direction", playbackDirectionMutable(), directionSelect, playbackDirectionMenuCallback);
  return item;
}

GEMItem& tempoItem() {
  static GEMItem item("Tempo", playbackTempoMutable(), tempoSpinner, playbackTempoMenuCallback);
  return item;
}

GEMItem& clockSourceItem() {
  static GEMItem item("Clock Source", clockSourceMutable(), clockSourceSelect, clockSourceMenuCallback);
  return item;
}

GEMItem& sendClockItem() {
  static GEMItem item("Send Clock", sendClockMutable(), sendClockSelect, sendClockMenuCallback);
  return item;
}

GEMItem& sendTransportItem() {
  static GEMItem item("Send Transport", sendTransportMutable(), sendTransportSelect, sendTransportMenuCallback);
  return item;
}

GEMItem& tapPreviewItem() {
  static GEMItem item("Tap Preview", tapPreviewMutable(), tapPreviewSelect, tapPreviewMenuCallback);
  return item;
}

GEMItem& playTypeItem() {
  static GEMItem item("Play Type", playTypeMutable(), playTypeSelect, playTypeMenuCallback);
  return item;
}

GEMItem& playbackDividerItem() {
  static GEMItem item("----------");
  return item;
}

GEMItem& monophonicModeItem() {
  static GEMItem item("Monophonic", monophonicModeMutable(), monophonicSelect, monophonicModeMenuCallback);
  return item;
}

}  // namespace

void setupPlaybackSettingsMenu(GEMPage& sequencerMenuPage) {
  if (playbackMenuInstalled) {
    return;
  }

  GEMPage& page = playbackSettingsPage(sequencerMenuPage);
  GEMPage& syncPage = midiSyncPage(page);
  GEMItem& steps = stepCountItem();
  GEMItem& direction = directionItem();
  GEMItem& tempo = tempoItem();
  GEMItem& clock = clockSourceItem();
  GEMItem& sendClock = sendClockItem();
  GEMItem& sendTransport = sendTransportItem();
  GEMItem& sync = midiSyncLink(page);
  GEMItem& output = playTypeItem();
  GEMItem& preview = tapPreviewItem();
  GEMItem& divider = playbackDividerItem();
  GEMItem& mono = monophonicModeItem();

  steps.setPreviewCallback(previewPlaybackStepCount);
  direction.setPreviewCallback(previewPlaybackDirection);
  tempo.setPreviewCallback(previewPlaybackTempo);
  clock.setPreviewCallback(previewClockSource);
  sendClock.setPreviewCallback(previewSendClock);
  sendTransport.setPreviewCallback(previewSendTransport);
  output.setPreviewCallback(previewPlayType);
  preview.setPreviewCallback(previewTapPreview);
  mono.setPreviewCallback(previewMonophonicMode);

  page.addMenuItem(steps);
  page.addMenuItem(direction);
  page.addMenuItem(tempo);
  page.addMenuItem(output);
  page.addMenuItem(sync);
  page.addMenuItem(preview);
  page.addMenuItem(divider);
  page.addMenuItem(mono);
  syncPage.addMenuItem(clock);
  syncPage.addMenuItem(sendClock);
  syncPage.addMenuItem(sendTransport);
  sequencerMenuPage.addMenuItem(playbackSettingsLink(sequencerMenuPage));
  playbackMenuInstalled = true;
}

}  // namespace sequencer
#else
namespace sequencer {

void setupPlaybackSettingsMenu(GEMPage& /*sequencerMenuPage*/) {
}

}  // namespace sequencer
#endif
