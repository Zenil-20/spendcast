const express = require('express');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const {
    getOverlap,
    checkCandidate,
    getProjection,
    getHealth,
    getProfile,
    saveProfile,
    listAlerts,
    updateAlert
} = require('./../controller/AnalyticsController');

router.get('/portfolio/overlap', requireAuth, getOverlap);
router.post('/portfolio/overlap/candidate', requireAuth, checkCandidate);
router.get('/portfolio/projection', requireAuth, getProjection);
router.get('/portfolio/health', requireAuth, getHealth);
router.get('/portfolio/profile', requireAuth, getProfile);
router.put('/portfolio/profile', requireAuth, saveProfile);
router.get('/alerts', requireAuth, listAlerts);
router.patch('/alerts/:id', requireAuth, updateAlert);

module.exports = router;
