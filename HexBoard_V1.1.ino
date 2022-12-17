// Hardware Information:
// Generic RP2040 running at 133MHz with 16MB of flash
// https://github.com/earlephilhower/arduino-pico
// (Additional boards manager URL: https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json)
// Tools > USB Stack > (Adafruit TinyUSB)
// Sketch > Export Compiled Binary
//
// Brilliant resource for dealing with hexagonal coordinates. https://www.redblobgames.com/grids/hexagons/
// Might be useful for animations and stuff like that.

// Menu library documentation https://github.com/Spirik/GEM

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <MIDI.h>
#include <Adafruit_NeoPixel.h>
#define GEM_DISABLE_GLCD
#include <GEM_u8g2.h>
#include <Wire.h>
#include <Rotary.h>

// USB MIDI object //
Adafruit_USBD_MIDI usb_midi;
// Create a new instance of the Arduino MIDI Library,
// and attach usb_midi as the transport.
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI);

// LED SETUP //
#define LED_PIN 22
#define LED_COUNT 140
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_RGB + NEO_KHZ800);
int defaultBrightness = 50;
int dimBrightness = 15;
int pressedBrightness = 180;


// ENCODER SETUP //
#define ROTA 20  // Rotary encoder A
#define ROTB 21  // Rotary encoder B
Rotary rotary = Rotary(ROTA, ROTB);
const int encoderClick = 24;
int encoderState = 0;
int encoderLastState = 1;
int8_t encoder_val = 0;
uint8_t encoder_state;

// Create an instance of the U8g2 graphics library.
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R2, /* reset=*/U8X8_PIN_NONE);

//
// Button matrix and LED locations
// Portrait orientation top view:
//            9   8   7   6   5   4   3   2   1
//         20  19  18  17  16  15  14  13  12  11
//           29  28  27  26  25  24  23  22  21
//         40  39  38  37  36  35  34  33  32  31
//           49  48  47  46  45  44  43  42  41
//         60  59  58  57  56  55  54  53  52  51
//   10      69  68  67  66  65  64  63  62  61
// 30      80  79  78  77  76  75  74  73  72  71
//   50      89  88  87  86  85  84  83  82  81
// 70     100 99  98  97  96  95  94  93  92  91
//   90     109 108 107 106 105 104 103 102 101
//110     120 119 118 117 116 115 114 113 112 111
//  130     129 128 127 126 125 124 123 122 121
//        140 139 138 137 136 135 134 133 132 131

// DIAGNOSTICS //
// 1 = Full button test (1 and 0)
// 2 = Button test (button number)
// 3 = MIDI output test
int diagnostics = 0;

// BUTTON MATRIX PINS //
const byte columns[] = { 14, 15, 13, 12, 11, 10, 9, 8, 7, 6 };  // Column pins in order from right to left
const int m1p = 4;                                              // Multiplexing chip control pins
const int m2p = 5;
const int m4p = 2;
const int m8p = 3;
// 16 & 17 reserved for lights.
const byte columnCount = sizeof(columns);          // The number of columns in the matrix
const byte rowCount = 14;                          // The number of rows in the matrix
const byte elementCount = columnCount * rowCount;  // The number of elements in the matrix

// Since MIDI only uses 7 bits, we can give greater values special meanings.
// (see commandPress)
const int CMDB_1 = 128;
const int CMDB_2 = 129;
const int CMDB_3 = 130;
const int CMDB_4 = 131;
const int CMDB_5 = 132;
const int CMDB_6 = 133;
const int CMDB_7 = 134;
const int UNUSED = 255;

// LED addresses for CMD buttons.
const byte cmdBtn1 = 10 - 1;
const byte cmdBtn2 = 30 - 1;
const byte cmdBtn3 = 50 - 1;
const byte cmdBtn4 = 70 - 1;
const byte cmdBtn5 = 90 - 1;
const byte cmdBtn6 = 110 - 1;
const byte cmdBtn7 = 130 - 1;

// MIDI NOTE LAYOUTS //
#define ROW_FLIP(x, ix, viii, vii, vi, v, iv, iii, ii, i) i, ii, iii, iv, v, vi, vii, viii, ix, x
//hacky macro because I (Jared) messed up the board layout - I'll do better next time! xD

// MIDI note layout tables
const byte wickiHaydenLayout[elementCount] = {
  ROW_FLIP(CMDB_1, 90, 92, 94, 96, 98, 100, 102, 104, 106),
  ROW_FLIP(83, 85, 87, 89, 91, 93, 95, 97, 99, 101),
  ROW_FLIP(CMDB_2, 78, 80, 82, 84, 86, 88, 90, 92, 94),
  ROW_FLIP(71, 73, 75, 77, 79, 81, 83, 85, 87, 89),
  ROW_FLIP(CMDB_3, 66, 68, 70, 72, 74, 76, 78, 80, 82),
  ROW_FLIP(59, 61, 63, 65, 67, 69, 71, 73, 75, 77),
  ROW_FLIP(CMDB_4, 54, 56, 58, 60, 62, 64, 66, 68, 70),
  ROW_FLIP(47, 49, 51, 53, 55, 57, 59, 61, 63, 65),
  ROW_FLIP(CMDB_5, 42, 44, 46, 48, 50, 52, 54, 56, 58),
  ROW_FLIP(35, 37, 39, 41, 43, 45, 47, 49, 51, 53),
  ROW_FLIP(CMDB_6, 30, 32, 34, 36, 38, 40, 42, 44, 46),
  ROW_FLIP(23, 25, 27, 29, 31, 33, 35, 37, 39, 41),
  ROW_FLIP(CMDB_7, 18, 20, 22, 24, 26, 28, 30, 32, 34),
  ROW_FLIP(11, 13, 15, 17, 19, 21, 23, 25, 27, 29)
};
const byte harmonicTableLayout[elementCount] = {
  ROW_FLIP(CMDB_1, 83, 76, 69, 62, 55, 48, 41, 34, 27),
  ROW_FLIP(86, 79, 72, 65, 58, 51, 44, 37, 30, 23),
  ROW_FLIP(CMDB_2, 82, 75, 68, 61, 54, 47, 40, 33, 26),
  ROW_FLIP(85, 78, 71, 64, 57, 50, 43, 36, 29, 22),
  ROW_FLIP(CMDB_3, 81, 74, 67, 60, 53, 46, 39, 32, 25),
  ROW_FLIP(84, 77, 70, 63, 56, 49, 42, 35, 28, 21),
  ROW_FLIP(CMDB_4, 80, 73, 66, 59, 52, 45, 38, 31, 24),
  ROW_FLIP(83, 76, 69, 62, 55, 48, 41, 34, 27, 20),
  ROW_FLIP(CMDB_5, 79, 72, 65, 58, 51, 44, 37, 30, 23),
  ROW_FLIP(82, 75, 68, 61, 54, 47, 40, 33, 26, 19),
  ROW_FLIP(CMDB_6, 78, 71, 64, 57, 50, 43, 36, 29, 22),
  ROW_FLIP(81, 74, 67, 60, 53, 46, 39, 32, 25, 18),
  ROW_FLIP(CMDB_7, 77, 70, 63, 56, 49, 42, 35, 28, 21),
  ROW_FLIP(80, 73, 66, 59, 52, 45, 38, 31, 24, 17)
};
const byte gerhardLayout[elementCount] = {
  ROW_FLIP(CMDB_1, 74, 73, 72, 71, 70, 69, 68, 67, 66),
  ROW_FLIP(71, 70, 69, 68, 67, 66, 65, 64, 63, 62),
  ROW_FLIP(CMDB_2, 67, 66, 65, 64, 63, 62, 61, 60, 59),
  ROW_FLIP(64, 63, 62, 61, 60, 59, 58, 57, 56, 55),
  ROW_FLIP(CMDB_3, 60, 59, 58, 57, 56, 55, 54, 53, 52),
  ROW_FLIP(57, 56, 55, 54, 53, 52, 51, 50, 49, 48),
  ROW_FLIP(CMDB_4, 53, 52, 51, 50, 49, 48, 47, 46, 45),
  ROW_FLIP(50, 49, 48, 47, 46, 45, 44, 43, 42, 41),
  ROW_FLIP(CMDB_5, 46, 45, 44, 43, 42, 41, 40, 39, 38),
  ROW_FLIP(43, 42, 41, 40, 39, 38, 37, 36, 35, 34),
  ROW_FLIP(CMDB_6, 39, 38, 37, 36, 35, 34, 33, 32, 31),
  ROW_FLIP(36, 35, 34, 33, 32, 31, 30, 29, 28, 27),
  ROW_FLIP(CMDB_7, 32, 31, 30, 29, 28, 27, 26, 25, 24),
  ROW_FLIP(29, 28, 27, 26, 25, 24, 23, 22, 21, 20)
};
const byte *currentLayout = wickiHaydenLayout;

const unsigned int pitches[128] = {
  16,17,18,19,21,22,23,25,26,28,29,31,                         // Octave 0
  33,35,37,39,41,44,46,49,52,55,58,62,                         // Octave 1
   65, 69, 73, 78, 82, 87, 93, 98,104,110,117,123,             // Octave 2
  131,139,147,156,165,175,185,196,208,220,233,247,             // Octave 3
  262,277,294,311,330,349,370,392,415,440,466,494,             // Octave 4
  523,554,587,622,659,698,740,784,831,880,932,988,             // Octave 5
  1047,1109,1175,1245,1319,1397,1480,1568,1661,1760,1865,1976, // Octave 6
  2093,2217,2349,2489,2637,2794,2960,3136,3322,3520,3729,3951, // Octave 7
  4186,4435,4699,4978,5274,5588,5920,6272,6645,7040,7459,7902, // Octave 8
  8372,8870,9397,9956,10548,11175,11840,12544,13290,14080,14917,15804, //9
  16744, // C10
  17740, // C#10
  18795, // D10
  19912, // D#10
  21096, // E10
  22350, // F10
  23680  // F#10
};
#define TONEPIN 23

// Global time variables
unsigned long currentTime;    // Program loop consistent variable for time in milliseconds since power on
const byte debounceTime = 2;  // Global digital button debounce time in milliseconds

// Variables for holding digital button states and activation times
byte activeButtons[elementCount];               // Array to hold current note button states
byte previousActiveButtons[elementCount];       // Array to hold previous note button states for comparison
unsigned long activeButtonsTime[elementCount];  // Array to track last note button activation time for debounce

// MENU SYSTEM SETUP //
// Create menu page object of class GEMPage. Menu page holds menu items (GEMItem) and represents menu level.
// Menu can have multiple menu pages (linked to each other) with multiple menu items each
GEMPage menuPageMain("HexBoard MIDI Controller");
GEMPage menuPageLayout("Layout");

GEMItem menuItemLayout("Layout", menuPageLayout);
void wickiHayden();  //Forward declarations
void harmonicTable();
void gerhard();
GEMItem menuItemWickiHayden("Wicki-Hayden", wickiHayden);
GEMItem menuItemHarmonicTable("Harmonic Table", harmonicTable);
GEMItem menuItemGerhard("Gerhard", gerhard);

void setLayoutLEDs();  //Forward declaration
byte key = 0;
SelectOptionByte selectKeyOptions[] = { { "C", 0 }, { "C#", 1 }, { "D", 2 }, { "D#", 3 }, { "E", 4 }, { "F", 5 }, { "F#", 6 }, { "G", 7 }, { "G#", 8 }, { "A", 9 }, { "A#", 10 }, { "B", 11 } };
GEMSelect selectKey(sizeof(selectKeyOptions) / sizeof(SelectOptionByte), selectKeyOptions);
GEMItem menuItemKey("Key:", key, selectKey, setLayoutLEDs);

byte scale = 0;
SelectOptionByte selectScaleOptions[] = { { "NONE", 0 }, { "Major", 1 }, { "HarMin", 2 }, { "MelMin", 3 }, { "NatMin", 4 }, { "NONE", 5 }, { "NONE", 6 }, { "NONE", 7 }, { "NONE", 8 }, { "NONE", 9 }, { "NONE", 10 }, { "NONE", 11 } };
GEMSelect selectScale(sizeof(selectScaleOptions) / sizeof(SelectOptionByte), selectScaleOptions);
GEMItem menuItemScale("Scale:", scale, selectScale, setLayoutLEDs);

int transpose = 0;
SelectOptionInt selectTransposeOptions[] = {
  { "-12", -12 }, { "-11", -11 }, { "-10", -10 }, { "-9", -9 }, { "-8", -8 }, { "-7", -7 }, { "-6", -6 }, { "-5", -5 }, { "-4", -4 }, { "-3", -3 }, { "-2", -2 }, { "-1", -1 }, { "0", 0 }, { "+1", 1 }, { "+2", 2 }, { "+3", 3 }, { "+4", 4 }, { "+5", 5 }, { "+6", 6 }, { "+7", 7 }, { "+8", 8 }, { "+9", 9 }, { "+10", 10 }, { "+11", 11 }, { "+12", 12 }
};
GEMSelect selectTranspose(sizeof(selectTransposeOptions) / sizeof(SelectOptionByte), selectTransposeOptions);
void validateTranspose();  // Forward declaration
GEMItem menuItemTranspose("Transpose:", transpose, selectTranspose, validateTranspose);

//bool highlightScale = true;  // whether the black keys should be dimmer  REMOVING THIS SOON
//GEMItem menuItemHighlightScale("Scale Light:", highlightScale, setLayoutLEDs);



// Create menu object of class GEM_u8g2. Supply its constructor with reference to u8g2 object we created earlier
byte menuItemHeight = 10;
byte menuPageScreenTopOffset = 10;
byte menuValuesLeftOffset = 86;
GEM_u8g2 menu(u8g2, GEM_POINTER_ROW, GEM_ITEMS_COUNT_AUTO, menuItemHeight, menuPageScreenTopOffset, menuValuesLeftOffset);


// MIDI channel assignment
byte midiChannel = 1;  // Current MIDI channel (changed via user input)


// Velocity levels
byte midiVelocity = 100;  // Default velocity

bool buzzer = 0;
// END SETUP SECTION
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

void setup() {

#if defined(ARDUINO_ARCH_MBED) && defined(ARDUINO_ARCH_RP2040)
  // Manual begin() is required on core without built-in support for TinyUSB such as mbed rp2040
  TinyUSB_Device_Init(0);
#endif
  usb_midi.setStringDescriptor("HexBoard MIDI");
  // Initialize MIDI, and listen to all MIDI channels
  // This will also call usb_midi's begin()
  MIDI.begin(MIDI_CHANNEL_OMNI);

  Wire.setSDA(16);
  Wire.setSCL(17);

  pinMode(encoderClick, INPUT_PULLUP);

  Serial.begin(115200);  // Set serial to make uploads work without bootsel button

  // Set pinModes for the digital button matrix.
  for (int pinNumber = 0; pinNumber < columnCount; pinNumber++)  // For each column pin...
  {
    pinMode(columns[pinNumber], INPUT_PULLUP);  // set the pinMode to INPUT_PULLUP (+3.3V / HIGH).
  }
  pinMode(m1p, OUTPUT);  // Setting the row multiplexer pins to output.
  pinMode(m2p, OUTPUT);
  pinMode(m4p, OUTPUT);
  pinMode(m8p, OUTPUT);

  strip.begin();             // INITIALIZE NeoPixel strip object
  strip.show();              // Turn OFF all pixels ASAP
  strip.setBrightness(255);  // Set BRIGHTNESS (max = 255)
  setCMD_LEDs();
  strip.setPixelColor(cmdBtn1, strip.ColorHSV(65536 / 12, 255, defaultBrightness));
  setLayoutLEDs();

  u8g2.begin();  //Menu and graphics setup
  menu.init();
  setupMenu();
  menu.drawMenu();

  // wait until device mounted, maybe
  for (int i=0; i<5 && !TinyUSBDevice.mounted();i++) delay(1);

  // Print diagnostic troubleshooting information to serial monitor
  diagnosticTest();
}

void setup1() {  //Second core exclusively runs encoder
  //pinMode(ROTA, INPUT_PULLUP);
  //pinMode(ROTB, INPUT_PULLUP);
  //encoder_init();
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// START LOOP SECTION
void loop() {
  // Store the current time in a uniform variable for this program loop
  currentTime = millis();

  // Read and store the digital button states of the scanning matrix
  readDigitalButtons();

  // Act on those buttons
  playNotes();

  // Held buttons
  heldButtons();

  // Do the LEDS
  strip.show();

  // Read any new MIDI messages
  MIDI.read();

  // Read menu functions
  if (menu.readyForKey()) {
    encoderState = digitalRead(encoderClick);
    if (encoderState > encoderLastState) {
      menu.registerKeyPress(GEM_KEY_OK);
    }
    encoderLastState = encoderState;
    if (encoder_val < 0) {
      menu.registerKeyPress(GEM_KEY_UP);
      encoder_val = 0;
    }
    if (encoder_val > 0) {
      menu.registerKeyPress(GEM_KEY_DOWN);
      encoder_val = 0;
    }
  }
}

void loop1() {
  rotate();
  //readEncoder();
}
// END LOOP SECTION
// ------------------------------------------------------------------------------------------------------------------------------------------------------------


// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// START FUNCTIONS SECTION

void diagnosticTest() {
  if (diagnostics > 0) {
    Serial.println("Zach was here");
  }
}

void commandPress(byte command) {
  if (command == CMDB_1) {
    midiVelocity = 100;
    setCMD_LEDs();
    strip.setPixelColor(cmdBtn1, strip.ColorHSV(65536 / 12, 255, defaultBrightness));
    strip.setBrightness(255);  // Set BRIGHTNESS (max = 255)
  }
  if (command == CMDB_2) {
    midiVelocity = 60;
    setCMD_LEDs();
    strip.setPixelColor(cmdBtn2, strip.ColorHSV(65536 / 3, 255, defaultBrightness));
    strip.setBrightness(127);  // Set BRIGHTNESS (max = 255)
  }
  if (command == CMDB_3) {
    midiVelocity = 20;
    setCMD_LEDs();
    strip.setPixelColor(cmdBtn3, strip.ColorHSV(65536 / 2, 255, defaultBrightness));
    strip.setBrightness(63);  // Set BRIGHTNESS (max = 255)
  }
  if (command == CMDB_4) {
  }
  if (command == CMDB_5) {
  }
  if (command == CMDB_6) {
  }
  if (command == CMDB_7) {
    buzzer = !buzzer;
    strip.setPixelColor(cmdBtn7, strip.ColorHSV(65536 / 2, 255, 2*defaultBrightness*buzzer));
  }
}
void commandRelease(byte command) {
}

// BUTTONS //
void readDigitalButtons() {
  if (diagnostics == 1) {
    Serial.println();
  }
  // Button Deck
  for (int rowIndex = 0; rowIndex < rowCount; rowIndex++)  // Iterate through each of the row pins on the multiplexing chip.
  {
    digitalWrite(m1p, rowIndex & 1);
    digitalWrite(m2p, (rowIndex & 2) >> 1);
    digitalWrite(m4p, (rowIndex & 4) >> 2);
    digitalWrite(m8p, (rowIndex & 8) >> 3);
    for (byte columnIndex = 0; columnIndex < columnCount; columnIndex++)  // Now iterate through each of the column pins that are connected to the current row pin.
    {
      byte columnPin = columns[columnIndex];                              // Hold the currently selected column pin in a variable.
      pinMode(columnPin, INPUT_PULLUP);                                   // Set that row pin to INPUT_PULLUP mode (+3.3V / HIGH).
      byte buttonNumber = columnIndex + (rowIndex * columnCount);         // Assign this location in the matrix a unique number.
      delayMicroseconds(10);                                              // Delay to give the pin modes time to change state (false readings are caused otherwise).
      previousActiveButtons[buttonNumber] = activeButtons[buttonNumber];  // Track the "previous" variable for comparison.
      byte buttonState = digitalRead(columnPin);                          // (don't)Invert reading due to INPUT_PULLUP, and store the currently selected pin state.
      if (buttonState == LOW) {
        if (diagnostics == 1) {
          Serial.print("1");
        } else if (diagnostics == 2) {
          Serial.println(buttonNumber);
        }
        if (!previousActiveButtons[buttonNumber]) {
          // newpress time
          activeButtonsTime[buttonNumber] = millis();
        }
        // TODO: Implement debounce?
        activeButtons[buttonNumber] = 1;
      } else {
        // Otherwise, the button is inactive, write a 0.
        if (diagnostics == 1) {
          Serial.print("0");
        }
        activeButtons[buttonNumber] = 0;
      }
      // Set the selected column pin back to INPUT mode (0V / LOW).
      pinMode(columnPin, INPUT);
    }
  }
}

void playNotes() {
  for (int i = 0; i < elementCount; i++)  // For all buttons in the deck
  {
    if (activeButtons[i] != previousActiveButtons[i])  // If a change is detected
    {
      if (activeButtons[i] == 1)  // If the button is active (newpress)
      {
        if (currentLayout[i] < 128) {
          strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, pressedBrightness));
          noteOn(midiChannel, (currentLayout[i] + transpose) % 128, midiVelocity);
        } else {
          commandPress(currentLayout[i]);
        }
      } else {
        // If the button is inactive (released)
        if (currentLayout[i] < 128) {
          setLayoutLED(i);
          noteOff(midiChannel, (currentLayout[i] + transpose) % 128, 0);
        } else {
          commandRelease(currentLayout[i]);
        }
      }
    }
  }
}

void heldButtons() {
  for (int i = 0; i < elementCount; i++) {
    if (activeButtons[i]) {
      //if (
    }
  }
}

// Return the first note that is currently held.
byte getHeldNote() {
  for (int i = 0; i < elementCount; i++) {
    if (activeButtons[i]) {
      if (currentLayout[i] < 128) {
        return (currentLayout[i] + transpose) % 128;
      }
    }
  }
  return 128;
}

// MIDI AND OTHER OUTPUTS //
// Send Note On
void noteOn(byte channel, byte pitch, byte velocity) {
  MIDI.sendNoteOn(pitch, velocity, channel);
  if (diagnostics == 3) {
    Serial.print(pitch);
    Serial.print(", ");
    Serial.print(velocity);
    Serial.print(", ");
    Serial.println(channel);
  }
  if (buzzer) {
      tone(TONEPIN, pitches[pitch], 1000);
  }
}
// Send Note Off
void noteOff(byte channel, byte pitch, byte velocity) {
  MIDI.sendNoteOff(pitch, velocity, channel);
  noTone(TONEPIN);
  if(buzzer) {
    byte anotherPitch = getHeldNote();
    if (anotherPitch < 128) {
      tone(TONEPIN, pitches[anotherPitch], 1000);
    }
  }
}

// LEDS //
void setCMD_LEDs() {
  strip.setPixelColor(cmdBtn1, strip.ColorHSV(65536 / 12, 255, dimBrightness));
  strip.setPixelColor(cmdBtn2, strip.ColorHSV(65536 / 3, 255, dimBrightness));
  strip.setPixelColor(cmdBtn3, strip.ColorHSV(65536 / 2, 255, dimBrightness));
  strip.setPixelColor(cmdBtn4, strip.ColorHSV(0, 255, defaultBrightness));
  strip.setPixelColor(cmdBtn5, strip.ColorHSV(0, 255, defaultBrightness));
  strip.setPixelColor(cmdBtn6, strip.ColorHSV(0, 255, defaultBrightness));
  strip.setPixelColor(cmdBtn7, strip.ColorHSV(0, 255, defaultBrightness));
}

void setLayoutLEDs() {
  for (int i = 0; i < elementCount; i++) {
    if (currentLayout[i] <= 127) {
      setLayoutLED(i);
    }
  }
}
void setLayoutLED(int i) {
  strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, defaultBrightness));
  // Scale highlighting
  if (scale == 0) {  //NONE
    switch ((currentLayout[i] - key + transpose) % 12) {
      default: break;  // No changes since there is no scale selected
    }
  }
  if (scale == 1) {  //Major
    switch ((currentLayout[i] - key + transpose) % 12) {
      // If it is one of the dark keys, fall through to case 10.
      case 1:
      case 3:
      case 6:
      case 8:
      case 10: strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, dimBrightness)); break;
      // Otherwise it was a highlighted key. Do nothing
      default: break;
    }
  }
  if (scale == 2) {  //HarMin
    switch ((currentLayout[i] - key + transpose) % 12) {
      // If it is one of the dark keys, fall through to case 10.
      case 1:
      case 4:
      case 6:
      case 9:
      case 10: strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, dimBrightness)); break;
      // Otherwise it was a highlighted key. Do nothing
      default: break;
    }
  }
  if (scale == 3) {  //MelMin
    switch ((currentLayout[i] - key + transpose) % 12) {
      // If it is one of the dark keys, fall through to case 10.
      case 1:
      case 4:
      case 6:
      case 8:
      case 10: strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, dimBrightness)); break;
      // Otherwise it was a highlighted key. Do nothing
      default: break;
    }
  }
  if (scale == 4) {  //NatMin
    switch ((currentLayout[i] - key + transpose) % 12) {
      // If it is one of the dark keys, fall through to case 10.
      case 1:
      case 4:
      case 6:
      case 9:
      case 11: strip.setPixelColor(i, strip.ColorHSV(((currentLayout[i] - key + transpose) % 12) * 5006, 255, dimBrightness)); break;
      // Otherwise it was a highlighted key. Do nothing
      default: break;
    }
  }
}

// ENCODER //
// rotary encoder pin change interrupt handler
void readEncoder() {
  encoder_state = (encoder_state << 4) | (digitalRead(ROTB) << 1) | digitalRead(ROTA);
  Serial.println(encoder_val);
  switch (encoder_state) {
    case 0x23: encoder_val++; break;
    case 0x32: encoder_val--; break;
    default: break;
  }
}
void rotate() {
  unsigned char result = rotary.process();
  if (result == DIR_CW) {
    encoder_val++;
  } else if (result == DIR_CCW) {
    encoder_val--;
  }
}
// rotary encoder init
void encoder_init() {
  // enable pin change interrupts
  attachInterrupt(digitalPinToInterrupt(ROTA), readEncoder, RISING);
  attachInterrupt(digitalPinToInterrupt(ROTB), readEncoder, RISING);
  encoder_state = (digitalRead(ROTB) << 1) | digitalRead(ROTA);
  interrupts();
}

// MENU //
void setupMenu() {
  // Add menu items to Main menu page
  menuPageMain.addMenuItem(menuItemLayout);
  menuPageMain.addMenuItem(menuItemKey);
  menuPageMain.addMenuItem(menuItemScale);
  //menuPageMain.addMenuItem(menuItemHighlightScale); REMOVING SOON
  menuPageMain.addMenuItem(menuItemTranspose);
  // Add menu items to Layout Select page
  menuPageLayout.addMenuItem(menuItemWickiHayden);
  menuPageLayout.addMenuItem(menuItemHarmonicTable);
  menuPageLayout.addMenuItem(menuItemGerhard);
  // Specify parent menu page for the Settings menu page
  menuPageLayout.setParentMenuPage(menuPageMain);

  // Add menu page to menu and set it as current
  menu.setMenuPageCurrent(menuPageMain);
}

void wickiHayden() {
  currentLayout = wickiHaydenLayout;
  setLayoutLEDs();
  menu.setMenuPageCurrent(menuPageMain);
  menu.drawMenu();
}
void harmonicTable() {
  currentLayout = harmonicTableLayout;
  setLayoutLEDs();
  menu.setMenuPageCurrent(menuPageMain);
  menu.drawMenu();
}
void gerhard() {
  currentLayout = gerhardLayout;
  setLayoutLEDs();
  menu.setMenuPageCurrent(menuPageMain);
  menu.drawMenu();
}


// Validation routine of transpose variable
void validateTranspose() {
  //Need to add some code here to make sure transpose doesn't get out of hand
  /*something like
  if ((transpose + LOWEST NOTE IN ARRAY) < 0) {
    transpose = 0;
  } */
  setLayoutLEDs();
}

// END FUNCTIONS SECTION
