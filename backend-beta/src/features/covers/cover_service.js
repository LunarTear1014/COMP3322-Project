import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { ApiError, validation_error } from "../../shared/errors.js";

// Event cover processing (change refresh-clubspace-visual-design, event-covers).
// The image is decoded by sharp, which reports the real format; the declared
// MIME type and file name are never trusted and never reach the file system.

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 800;
const ALLOWED_FORMATS = new Set(["jpeg", "webp"]);
const RENDITIONS = { card: { width: 600, height: 400 }, full: { width: 1200, height: 800 } };
const KEY_PATTERN = /^[0-9a-f]{32}$/;

// Memory storage with the 5 MB cap enforced while streaming (before decoding).
function cover_upload() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 4, parts: 6 },
  });
  const single = upload.single("file");
  return (req, res, next) => {
    single(req, res, (error) => {
      if (!error) return next();
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("PAYLOAD_TOO_LARGE", "Covers can be at most 5 MB."));
      }
      if (error.name === "MulterError") {
        return next(validation_error({ file: "Upload one image as the 'file' field." }));
      }
      next(error);
    });
  };
}

// Validates form fields that accompany the file (alt, expected_version).
function parse_cover_fields(body = {}) {
  const fields = {};
  const alt = typeof body.alt === "string" ? body.alt.trim() : "";
  if (!alt || [...alt].length > 200) fields.alt = "Describe the image in 1 to 200 characters.";
  const version = typeof body.expected_version === "string" && /^[1-9]\d{0,9}$/.test(body.expected_version)
    ? Number(body.expected_version) : null;
  if (version === null) fields.expected_version = "Send the event's current version.";
  if (Object.keys(fields).length) throw validation_error(fields);
  return { alt, expected_version: version };
}

// Decodes, checks and renders the two WebP files in memory.
async function render_cover(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw validation_error({ file: "Choose an image to upload." });
  }
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG or WebP image.");
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG or WebP image.");
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

function new_key() {
  return randomBytes(16).toString("hex");
}

function file_path(cover_dir, key, size) {
  if (!KEY_PATTERN.test(key) || !Object.hasOwn(RENDITIONS, size)) {
    throw new Error("Invalid cover key or size.");
  }
  return path.join(cover_dir, `${key}.${size}.webp`);
}

// Writes both renditions under a fresh random key. Files are written to a
// temporary name and renamed, so a reader never sees a partial file.
async function store_cover(cover_dir, buffer) {
  const rendered = await render_cover(buffer);
  await mkdir(cover_dir, { recursive: true });
  const key = new_key();
  const written = [];
  try {
    for (const [size, data] of Object.entries(rendered)) {
      const final = file_path(cover_dir, key, size);
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
async function delete_cover_files(cover_dir, key) {
  if (!key || !KEY_PATTERN.test(key)) return;
  await Promise.all(Object.keys(RENDITIONS).map((size) => rm(file_path(cover_dir, key, size), { force: true })));
}

// Daily worker sweep: removes files whose key no event references. Files
// younger than `min_age_ms` are kept, since their transaction may still commit.
async function sweep_orphan_covers(cover_dir, referenced_keys, { min_age_ms = 3_600_000, now = Date.now() } = {}) {
  const referenced = new Set(referenced_keys);
  const { stat } = await import("node:fs/promises");
  let removed = 0;
  let names;
  try {
    names = await readdir(cover_dir);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  for (const name of names) {
    const match = /^([0-9a-f]{32})\.(card|full)\.webp(\.tmp)?$/.exec(name);
    if (!match || referenced.has(match[1])) continue;
    const full = path.join(cover_dir, name);
    const { mtimeMs } = await stat(full);
    if (now - mtimeMs < min_age_ms) continue;
    await rm(full, { force: true });
    removed += 1;
  }
  return removed;
}

function cover_dto(event_id, row) {
  if (!row.cover_key) return null;
  const stamp = new Date(`${String(row.cover_updated_at).replace(" ", "T")}Z`);
  const v = row.cover_key;
  return {
    card_url: `/api/v1/events/${event_id}/cover/card?v=${v}`,
    full_url: `/api/v1/events/${event_id}/cover/full?v=${v}`,
    alt: row.cover_alt,
    width: 1200,
    height: 800,
    updated_at: stamp.toISOString(),
  };
}

export {
  KEY_PATTERN,
  MAX_BYTES,
  RENDITIONS,
  cover_dto,
  cover_upload,
  delete_cover_files,
  file_path,
  parse_cover_fields,
  render_cover,
  store_cover,
  sweep_orphan_covers,
};
