#include "SynthAudio.h"

#include "../app/RuntimeDefaults.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/SynthWavetableMenu.h"
#include "../storage/Settings.h"

void syncSynthSettingsToRuntime() {
  byte previousPlaybackMode = playbackMode;
  playbackMode = normalizeSynthPlaybackMode(settingValue(SettingKey::PlaybackMode));
  settings[static_cast<uint8_t>(SettingKey::PlaybackMode)] = playbackMode;
  if (playbackMode != previousPlaybackMode) {
    resetSynthFreqs();
  }
  currWave = settingValue(SettingKey::Waveform);
  synthWavetablePosition = settingValue(SettingKey::SynthWavetablePosition);
  if (!currentSynthWavetableReferenceValid) {
    selectSynthWavetableForWaveform(currWave, true);
    settings[static_cast<uint8_t>(SettingKey::SynthWavetablePosition)] =
      synthWavetablePosition;
  }
  loadSelectedSynthWavetable();
  updateCurrentSynthWavetableMenuLabel();

  synthDrive = settingValue(SettingKey::SynthDrive);
  if (synthDrive > SYNTH_DRIVE_DIRTY) {
    synthDrive = SYNTH_DRIVE_OFF;
  }
  synthModTarget = settingValue(SettingKey::SynthModTarget);
  synthModAmount = settingValue(SettingKey::SynthModAmount);
  synthVibratoSpeed = settingValue(SettingKey::SynthVibratoSpeed);
  synthLfoTarget = settingValue(SettingKey::SynthLfoTarget);
  synthLfoAmount = settingValue(SettingKey::SynthLfoAmount);
  synthLfoWave = settingValue(SettingKey::SynthLfoWave);
  synthLfoSpeed = settingValue(SettingKey::SynthLfoSpeed);

  arpeggiatorDivision = settingValue(SettingKey::ArpeggiatorDivision);
  if (arpeggiatorDivision == 0) {
    arpeggiatorDivision = 1;
  }
  arpeggiatorDirection = settingValue(SettingKey::ArpeggiatorDirection);
  updateArpeggiatorDirection();
  synthBPM = settingValue(SettingKey::SynthBPM);
  if (synthBPM == 0) {
    synthBPM = 1;
  }
  synthPortamentoTimeIndex = settingValue(SettingKey::SynthPortamentoTimeIndex);
  updateSynthPortamentoSettings();

  envelopeAttackIndex = settingValue(SettingKey::EnvelopeAttackIndex);
  envelopeHoldIndex = settingValue(SettingKey::EnvelopeHoldIndex);
  envelopeDecayIndex = settingValue(SettingKey::EnvelopeDecayIndex);
  envelopeSustainLevel = settingValue(SettingKey::EnvelopeSustainLevel);
  envelopeReleaseIndex = settingValue(SettingKey::EnvelopeReleaseIndex);

  effectEnvelopeAttackIndex[0] =
    settingValue(SettingKey::EffectEnvelopeAttackIndex);
  effectEnvelopeHoldIndex[0] =
    settingValue(SettingKey::EffectEnvelopeHoldIndex);
  effectEnvelopeDecayIndex[0] =
    settingValue(SettingKey::EffectEnvelopeDecayIndex);
  effectEnvelopeSustainLevel[0] =
    settingValue(SettingKey::EffectEnvelopeSustainLevel);
  effectEnvelopeReleaseIndex[0] =
    settingValue(SettingKey::EffectEnvelopeReleaseIndex);
  effectEnvelopeTarget[0] = settingValue(SettingKey::EffectEnvelopeTarget);
  effectEnvelopeAmount[0] = settingValue(SettingKey::EffectEnvelopeAmount);

  effectEnvelopeTarget[1] = settingValue(SettingKey::EffectEnvelope2Target);
  effectEnvelopeAmount[1] = settingValue(SettingKey::EffectEnvelope2Amount);
  effectEnvelopeAttackIndex[1] =
    settingValue(SettingKey::EffectEnvelope2AttackIndex);
  effectEnvelopeHoldIndex[1] =
    settingValue(SettingKey::EffectEnvelope2HoldIndex);
  effectEnvelopeDecayIndex[1] =
    settingValue(SettingKey::EffectEnvelope2DecayIndex);
  effectEnvelopeSustainLevel[1] =
    settingValue(SettingKey::EffectEnvelope2SustainLevel);
  effectEnvelopeReleaseIndex[1] =
    settingValue(SettingKey::EffectEnvelope2ReleaseIndex);

  updateSynthModulationParams();
  updateEnvelopeParamsFromSettings();
  updateEffectEnvelopeParamsFromSettings();
  updateArpeggiatorTiming();
  updateSynthMenuVisibility();
}
