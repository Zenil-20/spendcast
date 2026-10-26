const jwt = require("jsonwebtoken");
const HttpError = require("../utils/httpError");

// Requires a valid "Authorization: Bearer <token>" header and sets req.user.
// The user id always comes from the token, never from the URL or body, so a
// user can only read and change their own data.
function requireAuth(req, res, next) {
    const header = req.get("Authorization") || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
        return next(new HttpError(401, "Authentication required."));
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"]
        });

        req.user = { id: payload.sub };
        return next();
    } catch {
        return next(new HttpError(401, "Invalid or expired token."));
    }
}

module.exports = requireAuth;
