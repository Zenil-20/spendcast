// Sends Spendcast emails. Configuration comes from the environment, which
// server.js loads from .env at startup.
const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
    if (transporter) {
        return transporter;
    }

    const {
        EMAIL_SERVICE,
        EMAIL_HOST,
        EMAIL_PORT,
        EMAIL_SECURE,
        EMAIL_USER,
        EMAIL_PASS
    } = process.env;

    // Allow development and test environments to run without email credentials.
    if (!EMAIL_USER || !EMAIL_PASS) {
        return null;
    }

    const config = {
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    };

    // Prefer explicit SMTP configuration for transactional providers.
    if (EMAIL_HOST) {
        config.host = EMAIL_HOST;
        config.port = Number(EMAIL_PORT || 587);
        config.secure =
            EMAIL_SECURE === "true" ||
            (EMAIL_SECURE === undefined && config.port === 465);
    } else if (EMAIL_SERVICE) {
        config.service = EMAIL_SERVICE;
    } else {
        throw new Error(
            "Configure EMAIL_SERVICE or EMAIL_HOST in the environment"
        );
    }

    transporter = nodemailer.createTransport(config);
    return transporter;
}

// Send an email notification or report.
// body: plain-text version
// html: optional HTML version
async function sendEmail(to, subject, body, html) {
    if (
        typeof to !== "string" ||
        !to.trim() ||
        typeof subject !== "string" ||
        !subject.trim() ||
        typeof body !== "string" ||
        !body.trim()
    ) {
        throw new Error(
            "Recipient, subject, and non-empty text body are required"
        );
    }

    const mailer = getTransporter();

    if (!mailer) {
        console.log(
            "[Spendcast] Email skipped: EMAIL_USER or EMAIL_PASS is missing."
        );

        return {
            success: false,
            skipped: true,
            reason: "Email credentials are not configured"
        };
    }

    const message = {
        from: `"Spendcast" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text: body
    };

    if (typeof html === "string" && html.trim()) {
        message.html = html;
    }

    try {
        const info = await mailer.sendMail(message);

        console.log(
            `[Spendcast] Email accepted by provider: ${info.messageId}`
        );

        return {
            success: true,
            skipped: false,
            messageId: info.messageId
        };
    } catch (error) {
        console.error("[Spendcast] Email delivery failed:", error.message);

        throw new Error("Unable to send Spendcast email", {
            cause: error
        });
    }
}

module.exports = sendEmail;
