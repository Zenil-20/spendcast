// Fails fast at startup when required configuration is missing or unsafe.
function validateEnv() {
    const missing = ["MONGO_URI", "JWT_SECRET"].filter(name => !process.env[name]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }

    if (process.env.JWT_SECRET.length < 32) {
        throw new Error("JWT_SECRET must be at least 32 characters long.");
    }

    if (process.env.ENABLE_TEST_CLOCK === "true" && process.env.NODE_ENV === "production") {
        console.warn("ENABLE_TEST_CLOCK is ignored because NODE_ENV is production.");
    }
}

module.exports = validateEnv;
