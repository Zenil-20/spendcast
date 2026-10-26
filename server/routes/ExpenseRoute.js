const express = require('express');
const router = express.Router();

const requireAuth = require('./../middleware/auth');
const {
    createExpense,
    listExpenses,
    deleteExpense,
    forecastMonthlyExpenditure
} = require('./../controller/ExpenseController');
const {
    createRecurringExpense,
    listRecurringExpenses,
    updateRecurringExpense
} = require('./../controller/RecurringExpenseController');

router.post('/CreateExpenses', requireAuth, createExpense);
router.get('/expenses', requireAuth, listExpenses);
router.delete('/expenses/:id', requireAuth, deleteExpense);
router.post('/recurring-expenses', requireAuth, createRecurringExpense);
router.get('/recurring-expenses', requireAuth, listRecurringExpenses);
router.patch('/recurring-expenses/:id', requireAuth, updateRecurringExpense);
router.get('/forecast', requireAuth, forecastMonthlyExpenditure);

module.exports = router;
