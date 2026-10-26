const express = require('express');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const { listGoals, previewGoal, createGoal, updateGoal, deleteGoal } = require('./../controller/GoalController');

router.get('/goals', requireAuth, listGoals);
router.post('/goals/preview', requireAuth, previewGoal);
router.post('/goals', requireAuth, createGoal);
router.patch('/goals/:id', requireAuth, updateGoal);
router.delete('/goals/:id', requireAuth, deleteGoal);

module.exports = router;
