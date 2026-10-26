const mongoose = require("mongoose");

function notFound(req, res) {
    res.status(404).json({
        success: false,
        error: `Route not found: ${req.method} ${req.originalUrl}`
    });
}

// Express 5 forwards errors from async handlers here, so controllers do not
// need their own try/catch.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    let status = 500;
    let message = "Something went wrong. Please try again.";

    if (err.name === "HttpError") {
        status = err.status;
        message = err.message;
    } else if (err.type === "entity.parse.failed") {
        status = 400;
        message = "Request body is not valid JSON.";
    } else if (err instanceof mongoose.Error.ValidationError) {
        status = 400;
        message = Object.values(err.errors).map(item => item.message).join(" ");
    } else if (err instanceof mongoose.Error.CastError) {
        status = 400;
        message = `Invalid value for ${err.path}.`;
    } else if (err instanceof mongoose.Error.VersionError) {
        status = 409;
        message = "This record was changed by another request. Please retry.";
    } else if (err.code === 11000) {
        status = 409;
        message = "A record with these details already exists.";
    }

    if (status >= 500) {
        console.error("Unhandled error:", err);
    }

    res.status(status).json({ success: false, error: message });
}

module.exports = {
    notFound,
    errorHandler
};
