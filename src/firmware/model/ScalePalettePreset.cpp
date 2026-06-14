#include "ScalePalettePreset.h"

// @scales
scaleDef scaleOptions[] = {
  { "None", ALL_TUNINGS, { 0 } },
  // 12 EDO
  { "Major", TUNING_12EDO, { 2, 2, 1, 2, 2, 2, 1 } },
  { "Minor, Natural", TUNING_12EDO, { 2, 1, 2, 2, 1, 2, 2 } },
  { "Minor, Melodic", TUNING_12EDO, { 2, 1, 2, 2, 2, 2, 1 } },
  { "Minor, Harmonic", TUNING_12EDO, { 2, 1, 2, 2, 1, 3, 1 } },
  { "Pentatonic, Major", TUNING_12EDO, { 2, 2, 3, 2, 3 } },
  { "Pentatonic, Minor", TUNING_12EDO, { 3, 2, 2, 3, 2 } },
  { "Blues", TUNING_12EDO, { 3, 1, 1, 1, 1, 3, 2 } },
  { "Double Harmonic", TUNING_12EDO, { 1, 3, 1, 2, 1, 3, 1 } },
  { "Phrygian", TUNING_12EDO, { 1, 2, 2, 2, 1, 2, 2 } },
  { "Phrygian Dominant", TUNING_12EDO, { 1, 3, 1, 2, 1, 2, 2 } },
  { "Dorian", TUNING_12EDO, { 2, 1, 2, 2, 2, 1, 2 } },
  { "Lydian", TUNING_12EDO, { 2, 2, 2, 1, 2, 2, 1 } },
  { "Lydian Dominant", TUNING_12EDO, { 2, 2, 2, 1, 2, 1, 2 } },
  { "Mixolydian", TUNING_12EDO, { 2, 2, 1, 2, 2, 1, 2 } },
  { "Locrian", TUNING_12EDO, { 1, 2, 2, 1, 2, 2, 2 } },
  { "Whole Tone", TUNING_12EDO, { 2, 2, 2, 2, 2, 2 } },
  { "Octatonic", TUNING_12EDO, { 2, 1, 2, 1, 2, 1, 2, 1 } },
  // 17 EDO; for more: https://en.xen.wiki/w/17edo#Scales
  { "Diatonic", TUNING_17EDO, { 3, 3, 1, 3, 3, 3, 1 } },
  { "Pentatonic", TUNING_17EDO, { 3, 3, 4, 3, 4 } },
  { "Harmonic", TUNING_17EDO, { 3, 2, 3, 2, 2, 2, 3 } },
  { "Husayni Maqam", TUNING_17EDO, { 2, 2, 3, 3, 2, 1, 1, 3 } },
  { "Blues", TUNING_17EDO, { 4, 3, 1, 1, 1, 4, 3 } },
  { "Hydra", TUNING_17EDO, { 3, 3, 1, 1, 2, 3, 2, 1, 1 } },
  // 19 EDO; for more: https://en.xen.wiki/w/19edo#Scales
  { "Diatonic", TUNING_19EDO, { 3, 3, 2, 3, 3, 3, 2 } },
  { "Pentatonic", TUNING_19EDO, { 3, 3, 5, 3, 5 } },
  { "Semaphore", TUNING_19EDO, { 3, 1, 3, 1, 3, 3, 1, 3, 1 } },
  { "Negri", TUNING_19EDO, { 2, 2, 2, 2, 2, 1, 2, 2, 2, 2 } },
  { "Sensi", TUNING_19EDO, { 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1 } },
  { "Kleismic", TUNING_19EDO, { 1, 3, 1, 1, 3, 1, 1, 3, 1, 3, 1 } },
  { "Magic", TUNING_19EDO, { 3, 1, 1, 1, 3, 1, 1, 1, 3, 1, 1, 1, 1 } },
  { "Kind-of Blues", TUNING_19EDO, { 4, 4, 1, 2, 4, 4 } },
  // 22 EDO; for more: https://en.xen.wiki/w/22edo_modes
  { "Diatonic", TUNING_22EDO, { 4, 4, 1, 4, 4, 4, 1 } },
  { "Pentatonic", TUNING_22EDO, { 4, 4, 5, 4, 5 } },
  { "Orwell", TUNING_22EDO, { 3, 2, 3, 2, 3, 2, 3, 2, 2 } },
  { "Porcupine", TUNING_22EDO, { 4, 3, 3, 3, 3, 3, 3 } },
  { "Pajara", TUNING_22EDO, { 2, 2, 3, 2, 2, 2, 3, 2, 2, 2 } },
  // 24 EDO; for more: https://en.xen.wiki/w/24edo_scales
  { "Diatonic 12", TUNING_24EDO, { 4, 4, 2, 4, 4, 4, 2 } },
  { "Diatonic Soft", TUNING_24EDO, { 3, 5, 2, 3, 5, 4, 2 } },
  { "Diatonic Neutral", TUNING_24EDO, { 4, 3, 3, 4, 3, 4, 3 } },
  { "Pentatonic (12)", TUNING_24EDO, { 4, 4, 6, 4, 6 } },
  { "Pentatonic (Haba)", TUNING_24EDO, { 5, 5, 5, 5, 4 } },
  { "Invert Pentatonic", TUNING_24EDO, { 6, 3, 6, 6, 3 } },
  { "Rast Maqam", TUNING_24EDO, { 4, 3, 3, 4, 4, 2, 1, 3 } },
  { "Bayati Maqam", TUNING_24EDO, { 3, 3, 4, 4, 2, 1, 3, 4 } },
  { "Hijaz Maqam", TUNING_24EDO, { 2, 6, 2, 4, 2, 1, 3, 4 } },
  { "8-EDO", TUNING_24EDO, { 3, 3, 3, 3, 3, 3, 3, 3 } },
  { "Wyschnegradsky", TUNING_24EDO, { 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1 } },
  // 31 EDO; for more: https://en.xen.wiki/w/31edo#Scales
  { "Diatonic", TUNING_31EDO, { 5, 5, 3, 5, 5, 5, 3 } },
  { "Chromatic", TUNING_31EDO, { 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3 } },
  { "Pentatonic", TUNING_31EDO, { 5, 5, 8, 5, 8 } },
  { "Harmonic", TUNING_31EDO, { 5, 5, 4, 4, 4, 3, 3, 3 } },
  { "Mavila", TUNING_31EDO, { 5, 3, 3, 3, 5, 3, 3, 3, 3 } },
  { "Quartal", TUNING_31EDO, { 2, 2, 7, 2, 2, 7, 2, 7 } },
  { "Orwell", TUNING_31EDO, { 4, 3, 4, 3, 4, 3, 4, 3, 3 } },
  { "Neutral", TUNING_31EDO, { 4, 4, 4, 4, 4, 4, 4, 3 } },
  { "Miracle", TUNING_31EDO, { 4, 3, 3, 3, 3, 3, 3, 3, 3, 3 } },
  // 31 EDO ZETA PEAK;
  { "Diatonic", TUNING_31EDO_ZETA, { 5, 5, 3, 5, 5, 5, 3 } },
  { "Chromatic", TUNING_31EDO_ZETA, { 3, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3 } },
  { "Pentatonic", TUNING_31EDO_ZETA, { 5, 5, 8, 5, 8 } },
  { "Harmonic", TUNING_31EDO_ZETA, { 5, 5, 4, 4, 4, 3, 3, 3 } },
  { "Mavila", TUNING_31EDO_ZETA, { 5, 3, 3, 3, 5, 3, 3, 3, 3 } },
  { "Quartal", TUNING_31EDO_ZETA, { 2, 2, 7, 2, 2, 7, 2, 7 } },
  { "Orwell", TUNING_31EDO_ZETA, { 4, 3, 4, 3, 4, 3, 4, 3, 3 } },
  { "Neutral", TUNING_31EDO_ZETA, { 4, 4, 4, 4, 4, 4, 4, 3 } },
  { "Miracle", TUNING_31EDO_ZETA, { 4, 3, 3, 3, 3, 3, 3, 3, 3, 3 } },
  // 41 EDO; for more: https://en.xen.wiki/w/41edo#Scales_and_modes
  { "Diatonic", TUNING_41EDO, { 7, 7, 3, 7, 7, 7, 3 } },
  { "Pentatonic", TUNING_41EDO, { 7, 7, 10, 7, 10 } },
  { "Pure Major", TUNING_41EDO, { 7, 6, 4, 7, 6, 7, 4 } },
  { "5-limit Chromatic", TUNING_41EDO, { 4, 3, 4, 2, 4, 3, 4, 4, 2, 4, 3, 4 } },
  { "7-limit Chromatic", TUNING_41EDO, { 3, 4, 2, 4, 4, 3, 4, 2, 4, 3, 3, 4 } },
  { "Harmonic", TUNING_41EDO, { 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 3 } },
  { "Middle East-ish", TUNING_41EDO, { 7, 5, 7, 5, 5, 7, 5 } },
  { "Thai", TUNING_41EDO, { 6, 6, 6, 6, 6, 6, 5 } },
  { "Slendro", TUNING_41EDO, { 8, 8, 8, 8, 9 } },
  { "Pelog / Mavila", TUNING_41EDO, { 8, 5, 5, 8, 5, 5, 5 } },
  // 53 EDO
  { "Diatonic", TUNING_53EDO, { 9, 9, 4, 9, 9, 9, 4 } },
  { "Pentatonic", TUNING_53EDO, { 9, 9, 13, 9, 13 } },
  { "Rast Makam", TUNING_53EDO, { 9, 8, 5, 9, 9, 4, 4, 5 } },
  { "Usshak Makam", TUNING_53EDO, { 7, 6, 9, 9, 4, 4, 5, 9 } },
  { "Hicaz Makam", TUNING_53EDO, { 5, 12, 5, 9, 4, 9, 9 } },
  { "Orwell", TUNING_53EDO, { 7, 5, 7, 5, 7, 5, 7, 5, 5 } },
  { "Sephiroth", TUNING_53EDO, { 6, 5, 5, 6, 5, 5, 6, 5, 5, 5 } },
  { "Smitonic", TUNING_53EDO, { 11, 11, 3, 11, 3, 11, 3 } },
  { "Slendric", TUNING_53EDO, { 7, 3, 7, 3, 7, 3, 7, 3, 7, 3, 3 } },
  { "Semiquartal", TUNING_53EDO, { 9, 2, 9, 2, 9, 2, 9, 2, 9 } },
  // 72 EDO
  { "Diatonic", TUNING_72EDO, { 12, 12, 6, 12, 12, 12, 6 } },
  { "Pentatonic", TUNING_72EDO, { 12, 12, 18, 12, 18 } },
  { "Ben Johnston", TUNING_72EDO, { 6, 6, 6, 5, 5, 5, 9, 8, 4, 4, 7, 7 } },
  { "18-EDO", TUNING_72EDO, { 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4 } },
  { "Miracle", TUNING_72EDO, { 5, 2, 5, 2, 5, 2, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2 } },
  { "Marvolo", TUNING_72EDO, { 5, 5, 5, 5, 5, 5, 5, 2, 5, 5, 5, 5, 5, 5 } },
  { "Catakleismic", TUNING_72EDO, { 4, 7, 4, 4, 4, 7, 4, 4, 4, 7, 4, 4, 4, 7, 4 } },
  { "Palace", TUNING_72EDO, { 10, 9, 11, 12, 10, 9, 11 } },
  // BP
  { "Lambda", TUNING_BP, { 2, 1, 2, 1, 2, 1, 2, 1, 1 } },
  // Alpha
  { "Super Meta Lydian", TUNING_ALPHA, { 3, 2, 2, 2 } },
  // Beta
  { "Super Meta Lydian", TUNING_BETA, { 3, 3, 3, 2 } },
  // Gamma
  { "Super Meta Lydian", TUNING_GAMMA, { 6, 5, 5, 4 } }
};
extern const byte scaleCount = sizeof(scaleOptions) / sizeof(scaleDef);

// @palettes
/*
    This section defines the code needed
    to determine colors for each hex.
  */
/*
    LED colors are defined in the code
    on a perceptual basis. Instead of
    calculating RGB codes, the program
    uses an artist's color wheel approach.

    For value / brightness, two sets of
    named constants are defined. The BRIGHT_
    series (see the defaults section above)
    corresponds to the overall
    level of lights from the HexBoard, from
    dim to maximum. The VALUE_ series
    is used to differentiate light and dark
    colors in a palette. The BRIGHT and VALUE
    are multiplied together (and normalized)
    to get the output brightness.
  */
/*
    Palettes are defined by creating
    a set of colors, and then making
    an array of numbers that map the
    intervals of that tuning to the
    chosen colors. It's like paint
    by numbers! Note that the indexes
    start with 1, because the arrays are
    padded with 0 for entries after
    those intialized.
  */
paletteDef palette[] = {
  // 12 EDO
  { { { HUE_NONE, SAT_BW, 64 }, { 200, 60, VALUE_SHADE }, { HUE_BLUE, SAT_VIVID, VALUE_SHADE }, { 230, 240, VALUE_NORMAL }, { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL }, { 270, SAT_VIVID, VALUE_NORMAL } }, { 6, 1, 2, 1, 2, 2, 1, 4, 1, 2, 1, 2 } },
  // 17 EDO
  { { { HUE_NONE, SAT_BW, VALUE_NORMAL }, { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }, { HUE_RED, SAT_VIVID, VALUE_NORMAL } }, { 1, 2, 3, 1, 2, 3, 1, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1 } },
  // 19 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  #
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  b
      ,
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL }  // enh
    },
    { 1, 2, 3, 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 4 } },
  // 22 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  // ^
      ,
      { HUE_MAGENTA, SAT_VIVID, VALUE_NORMAL }  // mid
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // v
    },
    { 1, 2, 3, 4, 1, 2, 3, 4, 1, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1 } },
  // 24 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_LIME, SAT_DULL, VALUE_SHADE }  //  +
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL }  //  #/b
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_SHADE }  //  d
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  // enh
    },
    { 1, 2, 3, 4, 1, 2, 3, 4, 1, 5, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 5 } },
  // 31 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  +
      ,
      { HUE_YELLOW, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_RED, SAT_DULL, VALUE_SHADE }  //  enh E+ Fb
      ,
      { HUE_INDIGO, SAT_DULL, VALUE_SHADE }  //  enh E# Fd
    },
    { 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 6, 7, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 6, 7 } },
  // 41 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  ^
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  +
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7,
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 6, 7 } },
  // 43 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_DULL, VALUE_NORMAL }  //  ^
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  //  +
      ,
      { HUE_CYAN, SAT_DULL, VALUE_SHADE }  //  b
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  //  #
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  d
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7,
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 6, 7 } },
  // 53 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_ORANGE, SAT_VIVID, VALUE_NORMAL }  //  ^
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  //  L
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // bv
      ,
      { HUE_GREEN, SAT_VIVID, VALUE_SHADE }  // b
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_SHADE }  // #
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // #^
      ,
      { HUE_PURPLE, SAT_DULL, VALUE_NORMAL }  //  7
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_SHADE }  //  v
    },
    { 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 9 } },
  // 72 EDO
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_GREEN, SAT_DULL, VALUE_SHADE }  // ^
      ,
      { HUE_RED, SAT_DULL, VALUE_SHADE }  // L
      ,
      { HUE_PURPLE, SAT_DULL, VALUE_SHADE }  // +/d
      ,
      { HUE_BLUE, SAT_DULL, VALUE_SHADE }  // 7
      ,
      { HUE_YELLOW, SAT_DULL, VALUE_SHADE }  // v
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_SHADE }  // #/b
    },
    { 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6,
      7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6 } },
  // BOHLEN PIERCE
  { { { HUE_NONE, SAT_BW, VALUE_NORMAL }, { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }, { HUE_RED, SAT_VIVID, VALUE_NORMAL } }, { 1, 2, 3, 1, 2, 3, 1, 1, 2, 3, 1, 2, 3 } },
  // ALPHA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // d
      ,
      { HUE_LIME, SAT_VIVID, VALUE_NORMAL }  // +
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // enharmonic
      ,
      { HUE_CYAN, SAT_VIVID, VALUE_NORMAL }  // b
    },
    { 1, 2, 3, 4, 1, 2, 3, 5, 6 } },
  // BETA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_INDIGO, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // b
      ,
      { HUE_MAGENTA, SAT_DULL, VALUE_NORMAL }  // enharmonic
    },
    { 1, 2, 3, 1, 4, 1, 2, 3, 1, 2, 3 } },
  // GAMMA
  { {
      { HUE_NONE, SAT_BW, VALUE_NORMAL }  // n
      ,
      { HUE_RED, SAT_VIVID, VALUE_NORMAL }  // b
      ,
      { HUE_BLUE, SAT_VIVID, VALUE_NORMAL }  // #
      ,
      { HUE_YELLOW, SAT_VIVID, VALUE_NORMAL }  // n^
      ,
      { HUE_PURPLE, SAT_VIVID, VALUE_NORMAL }  // b^
      ,
      { HUE_GREEN, SAT_VIVID, VALUE_NORMAL }  // #^
    },
    { 1, 4, 2, 5, 3, 6, 1, 4, 1, 4, 2, 5, 3, 6, 1, 4, 2, 5, 3, 6 } },
};

// @presets
/*
    This section of the code defines
    a "preset" as a collection of
    parameters that control how the
    hexboard is operating and playing.

    In the long run this will serve as
    a foundation for saving and loading
    preferences / settings through the
    file system.
  */

presetDef current = {
  "Default",     // name
  TUNING_12EDO,  // tuning
  0,             // default to the first layout, wicki hayden
  0,             // default to using no scale (chromatic)
  -9,            // default to the key of C, which in 12EDO is -9 steps from A.
  0              // default to no transposition
};

byte displayRotationFromDeviceRotation(byte rotation) {
  return (DEVICE_DISPLAY_UPRIGHT_OFFSET + 4 - (rotation % 4)) % 4;
}

byte defaultDeviceRotationForLayout(bool isPortrait) {
  return isPortrait ? DEVICE_ROTATION_PORTRAIT : DEVICE_ROTATION_LANDSCAPE;
}
