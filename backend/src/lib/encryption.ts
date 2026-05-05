import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const KEY_HEX = process.env.MIKENL_ENCRYPTION_KEY ?? "";

function getKey(): Buffer | null {
    if (!KEY_HEX || KEY_HEX.length !== 64) return null;
    return Buffer.from(KEY_HEX, "hex");
}

export function encryptApiKey(plain: string): string {
    const key = getKey();
    if (!key) return plain; // no key configured — store as-is
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALG, key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
    if (!stored.startsWith("enc:")) return stored; // not encrypted — return as-is
    const key = getKey();
    if (!key) return stored;
    const parts = stored.split(":");
    if (parts.length !== 4) return stored;
    const [, ivHex, tagHex, dataHex] = parts;
    try {
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        const data = Buffer.from(dataHex, "hex");
        const decipher = createDecipheriv(ALG, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString("utf8") + decipher.final("utf8");
    } catch {
        return stored; // decryption failed — return raw (handles old unencrypted values)
    }
}
