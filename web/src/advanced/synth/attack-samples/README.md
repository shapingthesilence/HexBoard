# Wavetable attack recordings

Six sounds from Kenney’s [Impact Sounds](https://kenney.nl/assets/impact-sounds),
licensed CC0 1.0. Original license included as `LICENSE.txt`. The official download
was unavailable; the unchanged OGGs were obtained from the pinned public mirror
recorded in `sources.json`, checked against its Git blobs and SHA-256 digests.

`npm run generate:attack-samples` decodes the vendored OGGs, mixes to mono,
removes leading silence, filters/resamples to 16 kHz, trims to at most 256 ms,
then uses the same DC removal, normalization and fades as the import editor.
Generated PCM and provenance live in `factory-attacks.json`. Source files are
kept for reproducible offline generation; neither decoder nor source OGGs enter
the audio firmware or runtime bundle. Only one selected clip occupies board SRAM.
