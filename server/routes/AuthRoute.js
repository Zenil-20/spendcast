const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const { register, login, getCurrentUser } = require('./../controller/AuthController');
const { getOptions } = require('./../controller/UserController');

// Slows down password guessing: 20 attempts per 15 minutes per IP address.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: 'Too many attempts. Please try again in a few minutes.' }
});

router.post('/auth/register', authLimiter, register);
router.post('/auth/login', authLimiter, login);
router.get('/auth/me', requireAuth, getCurrentUser);
router.get('/options', getOptions);

module.exports = router;
