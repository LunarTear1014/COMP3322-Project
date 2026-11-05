import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt_async = promisify(scrypt);
const key_length = 64;

async function hash_password(password) {
  const salt = randomBytes(16);
  const key = await scrypt_async(password, salt, key_length);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function verify_password(password, stored_hash) {
  const [salt_hex, key_hex] = stored_hash.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt_hex) || !/^[a-f0-9]{128}$/.test(key_hex)) {
    return false;
  }

  const salt = Buffer.from(salt_hex, "hex");
  const expected_key = Buffer.from(key_hex, "hex");
  const actual_key = await scrypt_async(password, salt, key_length);
  return timingSafeEqual(actual_key, expected_key);
}

export { hash_password, verify_password };
