# Converting Theengs/decoder devices

I have created a skill called [theengs_decoder](theengs_decoder/SKILL.md) to automatically transcribe sensor decoders into sensor-ble format - your might have to copy it to $HOME/claude/skills/theengs-decoder/SKILL.md to have Claude Code find it.

I just cloned https://github.com/theengs/decoder.git#development into the sensor-ble repo (it is gitignored)

Here is a [demo session transcribing the Otodata Tank Sensor](.docs/ai-logs/2026-05-10_141106_command-messagetheengs_decodercomman_1796e478.md).

this was one-shotted with the prompt:

> /theengs_decoder /theengs_decoder decoder/src/devices/OTOD_json.h

Test cases which match the device are extracted from [test_ble.cpp](https://github.com/theengs/decoder/blob/development/tests/BLE/test_ble.cpp) and added as test vectors, see [rc1010.js ](devices/rc1010.js) - the first three test cases come from there.

Matching advertisements from sensorlogs/*.json are added as test vectors too (last two test cases).