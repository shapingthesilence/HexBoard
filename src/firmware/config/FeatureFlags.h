#pragma once

// The Classic sampler is held back until it is polished; builds without it
// advertise no sampler capability and reject sampler sounds.
#ifndef HEXBOARD_ENABLE_SAMPLER
#define HEXBOARD_ENABLE_SAMPLER 0
#endif

// Sequencer porting is intentionally opt-in until the upstream feature is complete.
#ifndef HEXBOARD_ENABLE_SEQUENCER
#define HEXBOARD_ENABLE_SEQUENCER 0
#endif
