#pragma once

// The Classic sampler. Releases that hold it back build with 0; such builds
// advertise no sampler capability and reject sampler sounds.
#ifndef HEXBOARD_ENABLE_SAMPLER
#define HEXBOARD_ENABLE_SAMPLER 1
#endif

// Sequencer porting is intentionally opt-in until the upstream feature is complete.
#ifndef HEXBOARD_ENABLE_SEQUENCER
#define HEXBOARD_ENABLE_SEQUENCER 0
#endif
