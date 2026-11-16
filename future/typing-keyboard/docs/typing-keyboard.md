# Deferred typing-keyboard documentation

The typing-keyboard feature is intentionally excluded from the current 2.0
firmware, factory image, companion web app, and public documentation. Its
implementation and source assets remain in the sibling `firmware/`,
`factory-library/`, `web/`, and `tests/` directories here for a later release.

When reintroduced, restore its USB HID mode, `TypingPreset` object type and
capability, three profile settings (`TypingLayout`, `TypingColors`, and
`TypingAnimation`), factory `/typing/*.hkb` content, and the web editor as one
versioned feature. Recheck persisted settings size/version and all protocol,
factory, web, and device tests together.
