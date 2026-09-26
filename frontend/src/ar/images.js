export async function cropImage(source, box) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const [x, y, w, h] = box || [0, 0, 1, 1];
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * w));
  canvas.height = Math.max(1, Math.round(image.height * h));
  canvas
    .getContext("2d")
    .drawImage(
      image,
      x * image.width,
      y * image.height,
      image.width * w,
      image.height * h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return canvas.toDataURL("image/jpeg", 0.93);
}
export async function fileImage(file) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose an image under 5 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
