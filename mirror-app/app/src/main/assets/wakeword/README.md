# Wake-word models (bundled in the app)

These are the microWakeWord models by Kevin Ahrendt, as shipped inside the `pymicro-wakeword` 2.5.0 package (Open Home
Foundation, Apache-2.0, see `LICENSE-Apache-2.0.txt`). They are the same models ESPHome voice devices use. They were copied
into the app on Nov 19, 2026 so the mirror never downloads anything to listen for a wake word.

| File | Phrase | Languages | Cutoff | SHA-256 |
|---|---|---|---|---|
| okay_nabu.tflite | Okay Nabu | en nl fr de it es sv | 0.85 | d89128c4d16a72de429119fb2254ce46649553c2a24f5dd840175c80d7b9d094 |
| hey_jarvis.tflite | Hey Jarvis | en | 0.97 | 21a7976add39ee24ec96c63d96b7aaa18e24d1d9824b963e451da8feb4b78b77 |
| hey_mycroft.tflite | Hey Mycroft | en | 0.95 | c2a9b6ed51182db72e014781d5a4ece1929dc232a40b5b4be384f0295f0e1571 |

Each model takes 3 frames of 40 audio features (int8, scale 0.10196, zero point -128) and gives one probability (uint8, scale
1/256). The app averages the last 5 probabilities and wakes when the average is above the cutoff (as pymicro-wakeword does).
`WakeLogicTest` checks that the table in `WakeLogic.MODELS` matches the JSON files here.
