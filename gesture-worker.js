// A classic worker allows MediaPipe's WASM loader to use importScripts.
// Frames stay in this worker and are closed immediately after local inference.
let recognizer;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      const {FilesetResolver, GestureRecognizer} = await import('./vendor/mediapipe/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href);
      recognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL('./assets/models/gesture_recognizer.task', self.location.href).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: .6,
        minHandPresenceConfidence: .6,
        minTrackingConfidence: .6,
      });
      self.postMessage({type: 'ready'});
    } catch (error) {
      self.postMessage({type: 'error', message: error.message || 'Recognition could not start'});
    }
  } else if (data.type === 'frame') {
    try {
      if (!recognizer) throw new Error('Recognition is not ready');
      const result = recognizer.recognizeForVideo(data.bitmap, data.timestamp);
      const category = result.gestures[0]?.[0];
      self.postMessage({type: 'result', timestamp: data.timestamp,
        landmarks: result.landmarks[0] || [],
        gesture: category?.categoryName || 'None', score: category?.score || 0});
    } catch (error) {
      self.postMessage({type: 'error', message: error.message || 'Recognition failed'});
    } finally {
      data.bitmap.close();
    }
  }
};
