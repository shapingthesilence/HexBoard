#pragma once

// Sequencer porting is intentionally opt-in until the upstream feature is complete.
#ifndef HEXBOARD_ENABLE_SEQUENCER
#define HEXBOARD_ENABLE_SEQUENCER 0
#endif

// Boot-stage diagnostics are opt-in and must not change release startup.
#ifndef HEXBOARD_BOOT_DIAGNOSTICS
#define HEXBOARD_BOOT_DIAGNOSTICS 0
#endif

#ifndef HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE
#define HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE 0
#endif

#if HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE && !HEXBOARD_BOOT_DIAGNOSTICS
#error "HEXBOARD_BOOT_DIAGNOSTIC_SKIP_STORAGE requires HEXBOARD_BOOT_DIAGNOSTICS"
#endif
