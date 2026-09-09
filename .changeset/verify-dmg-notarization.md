---
"puzzlepkm": patch
---

Check the disk image, not just the app, before publishing a macOS release.

The release guardrail asserted that nothing unsigned or unnotarized could be published, but it only ever assessed the `.app` bundle — while the artifact that actually ships is the DMG. Notarizing an app does not notarize its wrapper: a disk image has to be submitted to Apple in its own right and stapled. So a DMG could pass the check and reach users unnotarized, greeting everyone who downloaded it with a Gatekeeper warning, which is exactly what the guardrail existed to prevent.

`npm run macos:verify` now also assesses the DMG with Gatekeeper and confirms a notarization ticket is stapled to it, failing with the `notarytool` and `stapler` commands needed to put it right.
