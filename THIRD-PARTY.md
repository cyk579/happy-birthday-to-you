# Third-party resources: camera gesture recognition

The camera feature uses Google MediaPipe Tasks Vision and its pretrained
Gesture Recognizer task bundle. Runtime files and the model are stored locally;
no npm installation or build step is needed for GitHub Pages deployment.
The files listed here were copied without modification. Existing music and font
credits remain in their respective files under `assets/`.

## MediaPipe Tasks Vision 0.10.21

- Package: `@mediapipe/tasks-vision`, fixed version **0.10.21**.
- Publisher/author in the package: `mediapipe@google.com`.
- Registry metadata: <https://registry.npmjs.org/@mediapipe/tasks-vision/0.10.21>
- Fixed source archive: <https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz>
- The unmodified package metadata is preserved at
  [`vendor/mediapipe/package.json`](vendor/mediapipe/package.json); it explicitly
  declares `"license": "Apache-2.0"`.
- Full upstream license and notices:
  [`vendor/mediapipe/LICENSE`](vendor/mediapipe/LICENSE), copied from
  <https://github.com/google-ai-edge/mediapipe/blob/cad7f3ab99ebf175947e40c5252c642612aae927/LICENSE>
  (the repository's `v0.10.21` revision).

The npm archive integrity was checked against the registry's SHA-512 value:

```text
sha512-TuhKH+credq4zLksGbYrnvJ1aLIWMc5r0UHwzxzql4BHECJwIAoBR61ZrqwGOW6ZmSBIzU1t4VtKj8hbxFaKeA==
```

Version `0.10.22` is not a published stable npm version; this project uses
`0.10.21` explicitly. ESM and the SIMD/non-SIMD WebAssembly loaders and binaries
are included. CommonJS, TypeScript declarations, source maps and the package's
example README are omitted because the deployed page does not need them.
Both WASM variants are retained for browser compatibility; `FilesetResolver`
selects one variant and does not load both for a normal initialization.

## Gesture Recognizer model

- Publisher: Google / MediaPipe.
- Model: **Gesture Recognizer**, **float16**, fixed model version **1**.
- Local file: [`assets/models/gesture_recognizer.task`](assets/models/gesture_recognizer.task).
- Fixed download URL:
  <https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task>
- Official task documentation:
  <https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer>
- Official model card:
  <https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf>
- Full upstream license and notices are also preserved at
  [`assets/models/LICENSE`](assets/models/LICENSE).

Model licensing is supported by the MediaPipe project's published clarification,
separately from the npm code license. In the official repository's discussion
of palm/hand solutions and Gesture Recognizer, project collaborator `kuaashish`
states:

> MediaPipe models are available for commercial use under the Apache License 2.0,
> as outlined in the mediapipe/LICENSE.

Source: <https://github.com/google-ai-edge/mediapipe/issues/5242#issuecomment-2008701980>.
The discussion's follow-up explicitly refers to Gesture Recognizer, Palm
Detection and Hand Landmark. The model card describes the model and its intended
uses; it does not contain a separate embedded license declaration. This document
therefore cites the project's licensing clarification rather than attributing a
license statement to the model card.

Apache License 2.0, section 2, grants rights to reproduce, prepare derivative
works, publicly display/perform, sublicense and distribute the work in source
or object form. Redistribution must comply with section 4, including providing
the license and retaining applicable notices. Preserve this document and the
included license files when sharing or publishing these resources. No
endorsement by Google or the MediaPipe authors is implied.

The task bundle includes hand detection, hand landmarks, a gesture embedding
model and a canned gesture classifier. `Victory` is a built-in category. Pinching
and motion controls can be derived by the application from the returned hand
landmarks; the model does not have a built-in `Pinch` category.

## Local import and loading paths

For an application module at the project root:

```js
import {
  FilesetResolver,
  GestureRecognizer,
} from './vendor/mediapipe/vision_bundle.mjs';

const vision = await FilesetResolver.forVisionTasks(
  new URL('./vendor/mediapipe/wasm', import.meta.url).href,
);
const recognizer = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: new URL(
      './assets/models/gesture_recognizer.task', import.meta.url,
    ).href,
  },
  runningMode: 'VIDEO',
  numHands: 1,
});
```

The official JavaScript guide is at
<https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer/web_js>.
These module-relative paths also work under a GitHub Pages repository subpath.
Camera access still requires HTTPS (or localhost) and the visitor's permission.

## File sizes and checksums

The six runtime/model files total **27,942,266 bytes (26.65 MiB)**. A normal SIMD
initialization fetches one loader/binary pair, the ESM bundle and the model,
about **18,289,491 bytes (17.44 MiB)** before HTTP compression and caching.

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `vendor/mediapipe/vision_bundle.mjs` | 137735 | `40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c` |
| `vendor/mediapipe/wasm/vision_wasm_internal.js` | 204284 | `4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb` |
| `vendor/mediapipe/wasm/vision_wasm_internal.wasm` | 9574032 | `f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7` |
| `vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js` | 204137 | `927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f` |
| `vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm` | 9448638 | `3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4` |
| `assets/models/gesture_recognizer.task` | 8373440 | `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482` |

The ESM export/import and local `FilesetResolver` paths were checked. The model
archive passed its ZIP integrity check. These checks verify resource packaging;
they are not a claim of camera accuracy or performance on every device.
