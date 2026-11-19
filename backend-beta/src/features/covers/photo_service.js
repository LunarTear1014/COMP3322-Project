import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { ApiError, validation_error } from "../../shared/errors.js";

// Club photo processing. Same rules as event covers and club icons: sharp
// decodes the image and reports the real format; the declared MIME type and
// file name are never trusted and never reach the file system. Each photo is
// stored as two WebP renditions, `<key>.photo.card.webp` and
// `<key>.photo.full.webp`, names the cover and icon sweeps ignore.

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const RENDITIONS = { card: { width: 600, height: 400 }, full: { width: 1200, height: 800 } };
const KEY_PATTERN = /^[0-9a-f]{32}$/;

function photo_upload() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 4, parts: 6 },
  });
  const single = upload.single("file");
  return (req, res, next) => {
    single(req, res, (error) => {
      if (!error) return next();
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("PAYLOAD_TOO_LARGE", "Club photos can be at most 5 MB."));
      }
      if (error.name === "MulterError") {
        return next(validation_error({ file: "Upload one image as the 'file' field." }));
      }
      next(error);
    });
  };
}

// Validates the form field that accompanies the file.
function parse_photo_fields(body = {}) {
  const alt = typeof body.alt === "string" ? body.alt.trim() : "";
  if (!alt || [...alt].length > 200) throw validation_error({ alt: "Describe the image in 1 to 200 characters." });
  return { alt };
}

// Decodes, checks and renders both WebP files in memory.
async function render_photo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw validation_error({ file: "Choose an image to upload." });
  }
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG, PNG or WebP image.");
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG, PNG or WebP image.");
  }
  // EXIF orientation 5-8 swaps the displayed width and height.
  const rotated = metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    throw validation_error({ file: `Use an image at least ${MIN_WIDTH} by ${MIN_HEIGHT} pixels.` });
  }
  const output = {};
  try {
    for (const [name, size] of Object.entries(RENDITIONS)) {
      // rotate() applies EXIF orientation; sharp drops all metadata by default,
      // so EXIF, XMP, ICC and GPS are not written to the output.
      output[name] = await sharp(buffer, { failOn: "error" })
        .rotate()
        .resize(size.width, size.height, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer();
    }
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "That image could not be read.");
  }
  return output;
}

function photo_path(dir, key, size) {
  if (!KEY_PATTERN.test(key) || !Object.hasOwn(RENDITIONS, size)) throw new Error("Invalid photo key or size.");
  return path.join(dir, `${key}.photo.${size}.webp`);
}

// Writes both renditions under a fresh random key via temporary names and
// renames, so a reader never sees a partial file.
async function store_photo(dir, buffer) {
  const rendered = await render_photo(buffer);
  await mkdir(dir, { recursive: true });
  const key = randomBytes(16).toString("hex");
  const written = [];
  try {
    for (const [size, data] of Object.entries(rendered)) {
      const final = photo_path(dir, key, size);
      const temporary = `${final}.tmp`;
      await writeFile(temporary, data, { flag: "wx", mode: 0o640 });
      await rename(temporary, final);
      written.push(final);
    }
  } catch (error) {
    await Promise.all(written.map((file) => rm(file, { force: true })));
    throw error;
  }
  return { key };
}

// Called after the database change commits.
async function delete_photo_files(dir, key) {
  if (!key || !KEY_PATTERN.test(key)) return;
  await Promise.all(Object.keys(RENDITIONS).map((size) => rm(photo_path(dir, key, size), { force: true })));
}

// Daily worker sweep: removes photo files no club references. Files younger
// than `min_age_ms` are kept, since their transaction may still commit.
async function sweep_orphan_photos(dir, referenced_keys, { min_age_ms = 3_600_000, now = Date.now() } = {}) {
  const referenced = new Set(referenced_keys);
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names) {
    const match = /^([0-9a-f]{32})\.photo\.(card|full)\.webp(\.tmp)?$/.exec(name);
    if (!match || referenced.has(match[1])) continue;
    const full = path.join(dir, name);
    const { mtimeMs } = await stat(full);
    if (now - mtimeMs < min_age_ms) continue;
    await rm(full, { force: true });
    removed += 1;
  }
  return removed;
}

function photo_dto(club_id, row) {
  if (!row.photo_key) return null;
  const stamp = new Date(`${String(row.photo_updated_at).replace(" ", "T")}Z`);
  const v = row.photo_key;
  return {
    card_url: `/api/v1/clubs/${club_id}/photo/card?v=${v}`,
    full_url: `/api/v1/clubs/${club_id}/photo/full?v=${v}`,
    alt: row.photo_alt,
    width: 1200,
    height: 800,
    updated_at: Number.isNaN(stamp.getTime()) ? null : stamp.toISOString(),
  };
}

export {
  KEY_PATTERN,
  MAX_BYTES,
  RENDITIONS,
  delete_photo_files,
  parse_photo_fields,
  photo_dto,
  photo_path,
  photo_upload,
  render_photo,
  store_photo,
  sweep_orphan_photos,
};
