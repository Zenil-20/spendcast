const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const HttpError = require("../utils/httpError");
const { getNow } = require("../utils/clock");
const { normalizeTimeZone } = require("../utils/time");
const { normalizeCurrency } = require("../utils/money");
const { hashPassword, verifyPassword } = require("../utils/password");
const { readBody, readText } = require("../utils/validation");
const { formatSettings } = require("../services/userSettings");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Checked when the email is unknown, so the response time does not reveal
// which emails are registered.
const dummyHashPromise = hashPassword(crypto.randomUUID());

function issueToken(userId) {
    return jwt.sign({}, process.env.JWT_SECRET, {
        subject: String(userId),
        expiresIn: process.env.JWT_EXPIRES_IN || "1h",
        algorithm: "HS256"
    });
}

function formatUser(user, now) {
    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        ...formatSettings(user, now)
    };
}

function readPassword(value) {
    if (typeof value !== "string"
        || value.length < MIN_PASSWORD_LENGTH
        || value.length > MAX_PASSWORD_LENGTH) {
        throw new HttpError(400, `password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
    }

    return value;
}

function readEmail(value) {
    const email = readText(value, "email", { max: 254 }).toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
        throw new HttpError(400, "email must be a valid email address.");
    }

    return email;
}

// Registers a user. Timezone and currency apply immediately for a new account.
async function register(req, res) {
    const body = readBody(req);
    const now = getNow(req);
    const name = readText(body.name, "name", { max: 100 });
    const email = readEmail(body.email);
    const password = readPassword(body.password);
    const timezone = normalizeTimeZone(body.timezone);
    const currency = normalizeCurrency(body.currency);

    if (!timezone) {
        throw new HttpError(400, "timezone must be a valid IANA timezone, e.g. Asia/Kolkata or America/New_York.");
    }

    if (!currency) {
        throw new HttpError(400, "currency must be a valid ISO 4217 code, e.g. INR, USD, EUR.");
    }

    const user = await User.create({
        name,
        email,
        passwordHash: await hashPassword(password),
        settings: { timezone, currency }
    }).catch(error => {
        if (error.code === 11000) {
            throw new HttpError(409, "An account with this email already exists.");
        }

        throw error;
    });

    res.status(201).json({
        success: true,
        token: issueToken(user._id),
        user: formatUser(user, now)
    });
}

async function login(req, res) {
    const body = readBody(req);
    const now = getNow(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    const user = email
        ? await User.findOne({ email }).select("+passwordHash")
        : null;

    const passwordMatches = await verifyPassword(
        password,
        user ? user.passwordHash : await dummyHashPromise
    );

    if (!user || !passwordMatches) {
        throw new HttpError(401, "Invalid email or password.");
    }

    res.status(200).json({
        success: true,
        token: issueToken(user._id),
        user: formatUser(user, now)
    });
}

async function getCurrentUser(req, res) {
    const user = await User.findById(req.user.id);

    if (!user) {
        throw new HttpError(401, "User account not found.");
    }

    res.status(200).json({
        success: true,
        user: formatUser(user, getNow(req))
    });
}

module.exports = {
    register,
    login,
    getCurrentUser
};
