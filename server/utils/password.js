const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH);

    return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
    const [, saltHex, keyHex] = storedHash.split("$");
    const key = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);

    return crypto.timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

module.exports = {
    hashPassword,
    verifyPassword
};
