#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

// @layout
/*
    This section defines the different
    preset note layout options.
*/
/*
    This class provides the seed values
    needed to implement a given isomorphic
    note layout. From it, the map of buttons
    to note frequencies can be calculated.

    A layout is tied to a specific tuning.
*/
class layoutDef {
public:
  std::string name;    // limit is 17 characters for GEM menu
  bool isPortrait;     // legacy metadata used to seed DeviceRotation when the layout is selected.
  byte hexMiddleC;     // instead of "what note is button 1", "what button is the middle"
  int8_t acrossSteps;  // defined this way to be compatible with original v1.1 firmare
  int8_t dnLeftSteps;  // defined this way to be compatible with original v1.1 firmare
  byte tuning;         // index of the tuning that this layout is designed for
};
/*
    Isomorphic layouts are defined by
    establishing where the center of the
    layout is, and then the number of tuning
    steps to go up or down for the hex button
    across or down diagonally.
  */

// NOTE: Aside from adding new layouts,
// I have also rearranged them for personal use:
// - Wicki-Hayden first, if it manages to map all notes;
// - Compressed Janko second, if it maps all notes;
// - Full Janko otherwise;
// You might want to arrange them as seems fit for release,
// including all other layouts as I didn't put them in any particular order
layoutDef layoutOptions[] = {
  { "Wicki-Hayden", 1, 64, 2, -7, TUNING_12EDO },
  { "Harmonic Table", 0, 75, -7, 3, TUNING_12EDO },
  { "Gerhard", 0, 65, -1, -3, TUNING_12EDO },
  { "Janko", 0, 65, 1, -2, TUNING_12EDO },
  { "Bosanquet-Wilson", 0, 65, -1, -1, TUNING_12EDO },
  { "Compressed Janko", 0, 65, -1, -2, TUNING_12EDO },
  { "Compr. Bosanquet", 0, 65, 1, -3, TUNING_12EDO },
  { "Accordion C-sys.", 1, 75, 2, -3, TUNING_12EDO },
  { "Accordion B-sys.", 1, 64, 1, -3, TUNING_12EDO },
  { "Chromatic", 0, 75, 12, -1, TUNING_12EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_12EDO },

  { "Wicki-Hayden", 1, 64, 2, -7, TUNING_12EDO_ZETA },
  { "Harmonic Table", 0, 75, -7, 3, TUNING_12EDO_ZETA },
  { "Janko", 0, 65, 1, -2, TUNING_12EDO_ZETA },
  { "Bosanquet-Wilson", 0, 65, -1, -1, TUNING_12EDO_ZETA },
  { "Compressed Janko", 0, 65, -1, -2, TUNING_12EDO_ZETA },
  { "Compr. Bosanquet", 0, 65, 1, -3, TUNING_12EDO_ZETA },
  { "Gerhard", 0, 65, -1, -3, TUNING_12EDO_ZETA },
  { "Accordion C-sys.", 1, 75, 2, -3, TUNING_12EDO_ZETA },
  { "Accordion B-sys.", 1, 64, 1, -3, TUNING_12EDO_ZETA },
  { "Chromatic", 0, 75, 12, -1, TUNING_12EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_12EDO_ZETA },

  { "Compressed Janko", 0, 65, -1, -3, TUNING_17EDO },
  { "Compr. Bosanquet", 0, 65, 1, -4, TUNING_17EDO },
  { "Janko", 0, 65, 2, -3, TUNING_17EDO },
  { "Bosanquet-Wilson", 0, 65, -2, -1, TUNING_17EDO },
  { "Neutral Thirds A", 0, 65, -1, -2, TUNING_17EDO },
  { "Neutral Thirds B", 0, 65, 1, -3, TUNING_17EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_17EDO },

  { "Wicki-Hayden", 1, 65, 3, -11, TUNING_19EDO },
  { "Compressed Janko", 0, 65, -2, -3, TUNING_19EDO },
  { "Compr. Bosanquet", 0, 65, 2, -5, TUNING_19EDO },
  { "Janko", 0, 65, 1, -3, TUNING_19EDO },
  { "Bosanquet-Wilson", 0, 65, -1, -2, TUNING_19EDO },
  { "Harmonic Table", 0, 75, -11, 5, TUNING_19EDO },
  { "Kleismic", 0, 65, -1, -4, TUNING_19EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_19EDO },

  { "Compressed Janko", 0, 65, -1, -4, TUNING_22EDO },
  { "Compr. Bosanquet", 0, 65, 1, -5, TUNING_22EDO },
  { "Janko", 0, 65, 3, -4, TUNING_22EDO },
  { "Bosanquet-Wilson", 0, 65, -3, -1, TUNING_22EDO },
  { "Wicki-Hayden", 1, 64, 4, -13, TUNING_22EDO },
  { "Porcupine", 0, 65, 1, -4, TUNING_22EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_22EDO },

  { "Janko", 0, 65, 1, -4, TUNING_24EDO },              // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 65, -1, -3, TUNING_24EDO },  // Maybe call it "1/4 tone Bosanquet"?
  { "Full Gamut", 1, 75, 1, -9, TUNING_24EDO },

  { "Compressed Janko", 0, 65, -3, -5, TUNING_31EDO },
  { "Compr. Bosanquet", 0, 65, 3, -8, TUNING_31EDO },
  { "Janko", 0, 65, 2, -5, TUNING_31EDO },
  { "Bosanquet-Wilson", 0, 65, -2, -3, TUNING_31EDO },
  { "Wicki-Hayden", 1, 64, 5, -18, TUNING_31EDO },
  { "5X -13Y", 1, 64, 5, -13, TUNING_31EDO },  // Unnamed layout, between Wicki-Hayd. and compressed Janko
  { "Harmonic Table", 0, 75, -18, 8, TUNING_31EDO },
  { "Double Bosanquet", 0, 65, -1, -4, TUNING_31EDO },
  { "Anti-Double Bos.", 0, 65, 1, -5, TUNING_31EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_31EDO },

  { "Compressed Janko", 0, 65, -3, -5, TUNING_31EDO_ZETA },
  { "Compr. Bosanquet", 0, 65, 3, -8, TUNING_31EDO_ZETA },
  { "Janko", 0, 65, 2, -5, TUNING_31EDO_ZETA },
  { "Bosanquet-Wilson", 0, 65, -2, -3, TUNING_31EDO_ZETA },
  { "Wicki-Hayden", 1, 64, 5, -18, TUNING_31EDO_ZETA },
  { "5X -13Y", 1, 64, 5, -13, TUNING_31EDO_ZETA },  // Unnamed layout, between Wicki-Hayd. and compressed Janko
  { "Harmonic Table", 0, 75, -18, 8, TUNING_31EDO_ZETA },
  { "Double Bosanquet", 0, 65, -1, -4, TUNING_31EDO_ZETA },
  { "Anti-Double Bos.", 0, 65, 1, -5, TUNING_31EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_31EDO_ZETA },

  { "Compressed Janko", 0, 65, -3, -7, TUNING_41EDO },
  { "Compr. Bosanquet", 0, 65, 3, -10, TUNING_41EDO },
  { "Janko", 0, 65, 4, -7, TUNING_41EDO },
  { "Bosanquet-Wilson", 0, 65, -4, -3, TUNING_41EDO },  // forty-one #1
  { "Harmonic Table", 0, 75, -24, 11, TUNING_41EDO },
  { "Wicki-Hayden", 1, 64, 7, -24, TUNING_41EDO },
  { "Gerhard", 0, 65, 3, -10, TUNING_41EDO },  // forty-one #2
  { "Baldy", 0, 65, -1, -6, TUNING_41EDO },
  { "Rodan", 1, 65, -1, -7, TUNING_41EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_41EDO },  // forty-one #3

  { "Janko", 0, 65, 3, -7, TUNING_43EDO },
  { "Bosanquet-Wilson", 0, 65, -3, -4, TUNING_43EDO },
  { "Wicki-Hayden", 1, 64, 7, -25, TUNING_43EDO },
  { "Harmonic Table", 0, 75, -25, 11, TUNING_43EDO },
  { "Full Gamut", 0, 75, 1, -9, TUNING_43EDO },

  { "Janko", 0, 65, 5, -8, TUNING_46EDO },
  { "Bosanquet-Wilson", 0, 65, -5, -3, TUNING_46EDO },
  { "Harmonic Table", 0, 75, -27, 12, TUNING_46EDO },
  { "Echidnic", 0, 65, 5, -9, TUNING_46EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_46EDO },

  { "Janko", 0, 65, 5, -9, TUNING_53EDO },
  { "Bosanquet-Wilson", 0, 65, -5, -4, TUNING_53EDO },
  { "Harmonic Table", 0, 75, -31, 14, TUNING_53EDO },
  { "Wicki-Hayden", 1, 64, 9, -31, TUNING_53EDO },
  { "Kleismic A", 0, 65, -8, -3, TUNING_53EDO },
  { "Kleismic B", 0, 65, -5, -3, TUNING_53EDO },
  { "Buzzard", 0, 65, -9, -1, TUNING_53EDO },
  { "Compressed Janko", 1, 65, -4, -9, TUNING_53EDO },
  { "Compr. Bosanquet", 1, 65, 4, -13, TUNING_53EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_53EDO },

  { "Janko", 0, 64, 3, -10, TUNING_58EDO },           // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 64, 3, 7, TUNING_58EDO },  // Maybe call it "Quartertone Bosanquet"?
  { "Hemififths", 0, 64, 4, -7, TUNING_58EDO },
  { "Hemififths Mirror.", 0, 64, -4, -3, TUNING_58EDO },
  { "Chromatic", 0, 64, -7, -5, TUNING_58EDO },
  { "Harmonic Table", 0, 75, -34, 15, TUNING_58EDO },
  { "Septimal H.T.", 0, 75, -34, 13, TUNING_58EDO },
  { "Diaschismic", 0, 64, 4, -9, TUNING_58EDO },
  { "4X -19Y", 0, 64, 4, -19, TUNING_58EDO },    // unnamed layout, efficient for major 7ths, 9s, #11s and so on
  { "-27X 10Y", 1, 64, -27, 10, TUNING_58EDO },  // weird but efficient layout
  { "Wicki-Hayd.(29EDO)", 1, 64, 10, -34, TUNING_58EDO },
  { "Bos.Wilson (29EDO)", 0, 65, -6, -4, TUNING_58EDO },
  { "Janko      (29EDO)", 0, 65, 6, -10, TUNING_58EDO },  // 29 EDO subset, each for two rings of fifths
  { "Tridec.H.T.(29EDO)", 0, 75, -34, 14, TUNING_58EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_58EDO },

  { "Janko", 0, 64, 3, -10, TUNING_58EDO_ZETA },           // Maybe call it "Quartertone Janko"?
  { "Bosanquet-Wilson", 0, 64, 3, 7, TUNING_58EDO_ZETA },  // Maybe call it "1/4 tone Bosanquet"?
  { "Hemififths", 0, 64, 4, -7, TUNING_58EDO_ZETA },
  { "Hemififths Mirror.", 0, 64, -4, -3, TUNING_58EDO_ZETA },
  { "Chromatic", 0, 64, -7, -5, TUNING_58EDO_ZETA },
  { "Harmonic Table", 0, 75, -34, 15, TUNING_58EDO_ZETA },
  { "Septimal H.T.", 0, 75, -34, 13, TUNING_58EDO_ZETA },
  { "Diaschismic", 0, 64, 4, -9, TUNING_58EDO_ZETA },
  { "4X -19Y", 0, 64, 4, -19, TUNING_58EDO_ZETA },    // unnamed layout, efficient for major 7ths, 9s, #11s and so on
  { "-27X 10Y", 1, 64, -27, 10, TUNING_58EDO_ZETA },  // weird but efficient layout
  { "Wicki-Hayd.(29EDO)", 1, 64, 10, -34, TUNING_58EDO_ZETA },
  { "Bos.Wilson (29EDO)", 0, 65, -6, -4, TUNING_58EDO_ZETA },
  { "Janko      (29EDO)", 0, 65, 6, -10, TUNING_58EDO_ZETA },  // 29 EDO subset, each for two rings of fifths
  { "Tridec.H.T.(29EDO)", 0, 75, -34, 14, TUNING_58EDO_ZETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_58EDO_ZETA },

  { "Harmonic Table", 0, 75, -42, 19, TUNING_72EDO },
  { "-30X 19Y", 0, 75, -30, 19, TUNING_72EDO },  // unnamed layout. Like harmonic table but with fourths instead of fifths
  { "Miracle Mapping", 0, 65, -7, -2, TUNING_72EDO },
  { "Sept.H.T.(36EDO)", 0, 75, -42, 16, TUNING_72EDO },  // 36 EDO subset
  { "Expanded Janko", 0, 65, -1, -6, TUNING_72EDO },
  { "Full Gamut", 1, 65, 1, -9, TUNING_72EDO },

  { "Harmonic Table", 0, 75, -42, 19, TUNING_72EDO_ZETA },
  { "-30X 19Y", 0, 75, -30, 19, TUNING_72EDO_ZETA },  // unnamed layout. Like harmonic table but with fourths instead of fifths
  { "Miracle Mapping", 0, 65, -7, -2, TUNING_72EDO_ZETA },
  { "Sept.H.T.(36EDO)", 0, 75, -42, 16, TUNING_72EDO_ZETA },  // 36 EDO subset
  { "Expanded Janko", 0, 65, -1, -6, TUNING_72EDO_ZETA },
  { "Full Gamut", 1, 65, 1, -9, TUNING_72EDO_ZETA },

  { "Janko", 0, 65, 9, -14, TUNING_80EDO },             // Janko mapping is still too large to map all notes (same for 87 EDO)
  { "Bosanquet-Wilson", 0, 65, -9, -5, TUNING_80EDO },  // Same for Bosanquet-Wilson. Still usable
  { "Compressed Janko", 0, 65, -5, -14, TUNING_80EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_80EDO },  // So far this is the only one layout that maps every note

  { "Harmonic Table", 0, 75, -51, 23, TUNING_87EDO },
  { "Janko (good 3/2)", 0, 65, 5, -14, TUNING_87EDO },
  { "Bos.W.(good 3/2)", 0, 65, -5, -9, TUNING_87EDO },
  { "Wic.Hayd.nooctave", 1, 64, 14, -51, TUNING_87EDO },  // perfect thirds at the cost of losing an octave
  { "Wic.Hayd. Pyth.", 1, 64, 15, -51, TUNING_87EDO },    // pythagorean thirds, octave is preserved, note variety decreased
  { "Janko (Good 4/3)", 0, 65, 6, -14, TUNING_87EDO },    // Less efficient but allows perfect chord inversions
  { "Bos.W.(Good 4/3)", 0, 65, -6, -8, TUNING_87EDO },
  { "Bos.W.(26EDO)", 0, 65, -9, -6, TUNING_87EDO },
  { "Janko (26EDO)", 0, 65, 9, -15, TUNING_87EDO },
  { "Full Gamut", 1, 75, 1, -9, TUNING_87EDO },

  { "Standard", 0, 65, -2, -1, TUNING_BP },
  { "Full Gamut", 1, 65, 1, -9, TUNING_BP },

  { "Harmonic Table", 0, 75, -9, 5, TUNING_ALPHA },
  { "Compressed", 0, 65, -2, -1, TUNING_ALPHA },
  { "Full Gamut", 1, 65, 1, -9, TUNING_ALPHA },

  { "Wicki-Hayden", 1, 65, 3, -11, TUNING_BETA },  // Carlos Beta has the same mappings as 19 EDO
  { "Compressed Janko", 0, 65, -2, -3, TUNING_BETA },
  { "Compr. Bosanquet", 0, 65, 2, -5, TUNING_BETA },
  { "Janko", 0, 65, 1, -3, TUNING_BETA },
  { "Bosanquet-Wilson", 0, 65, -1, -2, TUNING_BETA },
  { "Harmonic Table", 0, 75, -11, 5, TUNING_BETA },
  { "Kleismic", 0, 65, -1, -4, TUNING_BETA },
  { "Full Gamut", 1, 75, 1, -9, TUNING_BETA },

  { "Harmonic Table", 0, 75, -20, 9, TUNING_GAMMA },  // Same mappings as for 34 EDO
  { "Compressed", 0, 65, -2, -1, TUNING_GAMMA },      // Difficult to map, has two rings of fifths
  { "Full Gamut", 1, 65, 1, -9, TUNING_GAMMA }
};
const byte layoutCount = sizeof(layoutOptions) / sizeof(layoutDef);

#endif  // HEXBOARD_FIRMWARE_UNITY
