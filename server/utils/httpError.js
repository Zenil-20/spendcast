// Error with an HTTP status. Thrown from controllers and turned into a JSON
// response by the error handler middleware.
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "HttpError";
        this.status = status;
    }
}

module.exports = HttpError;
