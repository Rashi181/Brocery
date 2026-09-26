export function cameraPixelsToJpeg(pixels, width, height) {
  const raw = document.createElement("canvas");
  raw.width = width;
  raw.height = height;
  const rawContext = raw.getContext("2d");
  if (!rawContext) throw new Error("2D canvas unavailable");
  rawContext.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.buffer), width, height),
    0,
    0,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(1080, width);
  canvas.height = Math.max(1, Math.round((height * canvas.width) / width));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  // Convert WebGL's bottom-left origin to the canvas's top-left origin.
  context.translate(0, canvas.height);
  context.scale(1, -1);
  context.drawImage(raw, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function readCameraPixels(gl, framebuffer, texture, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  // Three.js uses WebGL2: leave the drawing framebuffer untouched.
  const previousFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  const previousPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  const parameters = [
    gl.PACK_ALIGNMENT,
    gl.PACK_ROW_LENGTH,
    gl.PACK_SKIP_PIXELS,
    gl.PACK_SKIP_ROWS,
  ];
  const previousPack = parameters.map((parameter) =>
    gl.getParameter(parameter),
  );
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.READ_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Camera framebuffer incomplete: " + status);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    parameters.forEach((parameter, i) =>
      gl.pixelStorei(parameter, i === 0 ? 1 : 0),
    );
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR)
      throw new Error("Camera read failed: GL " + error);
    return pixels;
  } finally {
    // Release the browser-owned camera texture before this XR frame ends.
    gl.framebufferTexture2D(
      gl.READ_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      null,
      0,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousFramebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPackBuffer);
    parameters.forEach((parameter, i) =>
      gl.pixelStorei(parameter, previousPack[i]),
    );
  }
}
