// Classic worker: MediaPipe's WASM loader uses importScripts.
self.exports = {};
self.importScripts("/mediapipe/vision_bundle.js");
const { FilesetResolver, HandLandmarker } = self.exports;
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const files = await FilesetResolver.forVisionTasks(
        data.base + "/mediapipe",
      );
      detector = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: data.base + "/mediapipe/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
      });
      self.postMessage({ type: "ready" });
    } catch {
      self.postMessage({
        type: "error",
        message:
          "Hand gestures unavailable on this browser. Product scanning still works.",
      });
    }
  }
  if (data.type === "frame") {
    try {
      const result = detector.detectForVideo(data.image, data.time);
      self.postMessage({
        type: "hands",
        landmarks: result.landmarks,
        time: data.time,
      });
    } catch (error) {
      self.postMessage({
        type: "inference-error",
        message: String(error.message),
        time: data.time,
      });
    } finally {
      data.image.close();
    }
  }
};
