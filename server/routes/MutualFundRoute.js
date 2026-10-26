const express = require('express');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const {
    searchFunds,
    getFund,
    previewInvestment,
    createInvestment,
    updateInvestment,
    deleteInvestment,
    getInvestment,
    getHolding,
    deleteHolding,
    getFundSeries,
    getHarvest,
    getChartPresets,
    saveChartPresets,
    getPortfolio
} = require('./../controller/MutualFundController');

router.get('/mf/search', requireAuth, searchFunds);
router.get('/mf/schemes/:code', requireAuth, getFund);
router.post('/investments/preview', requireAuth, previewInvestment);
router.post('/investments', requireAuth, createInvestment);
router.get('/investments/:id', requireAuth, getInvestment);
router.patch('/investments/:id', requireAuth, updateInvestment);
router.delete('/investments/:id', requireAuth, deleteInvestment);
router.get('/holdings/:code', requireAuth, getHolding);
router.delete('/holdings/:code', requireAuth, deleteHolding);
router.get('/portfolio/series', requireAuth, getFundSeries);
router.get('/portfolio/harvest', requireAuth, getHarvest);
router.get('/portfolio/chart-presets', requireAuth, getChartPresets);
router.put('/portfolio/chart-presets', requireAuth, saveChartPresets);
router.get('/portfolio', requireAuth, getPortfolio);

module.exports = router;
