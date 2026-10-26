const express = require('express');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const {
    getSettings,
    updateSettings,
    getBudget,
    setBudget
} = require('./../controller/UserController');

router.get('/settings', requireAuth, getSettings);
router.put('/settings', requireAuth, updateSettings);
router.get('/budget', requireAuth, getBudget);
router.put('/budget', requireAuth, setBudget);

module.exports = router;
