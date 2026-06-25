#include "SequencerPlaybackMenu.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerPlaybackSettings.h"
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

void playbackTempoChanged() {
  normalizePlaybackSettings();
  handlePlaybackSettingsChanged(false);
}

void playbackStepCountChanged() {
  normalizePlaybackSettings();
  handlePlaybackSettingsChanged(false);
}

void playbackDirectionChanged() {
  normalizePlaybackSettings();
  handlePlaybackSettingsChanged(true);
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

}  // namespace

void setupPlaybackSettingsMenu(GEMPage& sequencerMenuPage) {
  if (playbackMenuInstalled) {
    return;
  }

  GEMPage& page = playbackSettingsPage(sequencerMenuPage);
  GEMItem& steps = stepCountItem();
  GEMItem& direction = directionItem();
  GEMItem& tempo = tempoItem();

  steps.setPreviewCallback(previewPlaybackStepCount);
  direction.setPreviewCallback(previewPlaybackDirection);
  tempo.setPreviewCallback(previewPlaybackTempo);

  page.addMenuItem(steps);
  page.addMenuItem(direction);
  page.addMenuItem(tempo);
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
