import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { ApiError, validation_error } from "../../shared/errors.js";

// Club icon processing. Same rules as event covers: sharp decodes the image and
// reports the real format; the declared MIME type and file name are never
// trusted and never reach the file system. Icons are square 256 px WebP files
// stored beside the covers as `<key>.icon.webp`, a name the cover sweep ignores.

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_SIDE = 128;
const SIZE = 256;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const KEY_PATTERN = /^[0-9a-f]{32}$/;

function icon_upload() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 2, parts: 4 },
  });
  const single = upload.single("file");
  return (req, res, next) => {
    single(req, res, (error) => {
      if (!error) return next();
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("PAYLOAD_TOO_LARGE", "Club icons can be at most 2 MB."));
      }
      if (error.name === "MulterError") {
        return next(validation_error({ file: "Upload one image as the 'file' field." }));
      }
      next(error);
    });
  };
}

// Decodes, checks and renders the icon in memory.
async function render_icon(buffer) {
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
  if (width < MIN_SIDE || height < MIN_SIDE) {
    throw validation_error({ file: `Use an image at least ${MIN_SIDE} by ${MIN_SIDE} pixels.` });
  }
  try {
    // rotate() applies EXIF orientation; sharp drops all metadata by default,
    // so EXIF, XMP, ICC and GPS are not written. Transparency is kept.
    return await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "That image could not be read.");
  }
}

function icon_path(dir, key) {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid icon key.");
  return path.join(dir, `${key}.icon.webp`);
}

// Writes the icon under a fresh random key via a temporary name and a rename,
// so a reader never sees a partial file.
async function store_icon(dir, buffer) {
  const rendered = await render_icon(buffer);
  await mkdir(dir, { recursive: true });
  const key = randomBytes(16).toString("hex");
  const final = icon_path(dir, key);
  const temporary = `${final}.tmp`;
  try {
    await writeFile(temporary, rendered, { flag: "wx", mode: 0o640 });
    await rename(temporary, final);
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(final, { force: true });
    throw error;
  }
  return { key };
}

// Called after the database change commits.
async function delete_icon_file(dir, key) {
  if (!key || !KEY_PATTERN.test(key)) return;
  await rm(icon_path(dir, key), { force: true });
}

// Daily worker sweep: removes icon files no club references. Files younger than
// `min_age_ms` are kept, since their transaction may still commit.
async function sweep_orphan_icons(dir, referenced_keys, { min_age_ms = 3_600_000, now = Date.now() } = {}) {
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
    const match = /^([0-9a-f]{32})\.icon\.webp(\.tmp)?$/.exec(name);
    if (!match || referenced.has(match[1])) continue;
    const full = path.join(dir, name);
    const { mtimeMs } = await stat(full);
    if (now - mtimeMs < min_age_ms) continue;
    await rm(full, { force: true });
    removed += 1;
  }
  return removed;
}

function icon_dto(club_id, row) {
  if (!row.icon_key) return null;
  const stamp = new Date(`${String(row.icon_updated_at).replace(" ", "T")}Z`);
  return {
    url: `/api/v1/clubs/${club_id}/icon?v=${row.icon_key}`,
    width: SIZE,
    height: SIZE,
    updated_at: stamp.toISOString(),
  };
}

export { KEY_PATTERN, MAX_BYTES, delete_icon_file, icon_dto, icon_path, icon_upload, render_icon, store_icon, sweep_orphan_icons };
