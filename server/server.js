require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();

const connectDB = require('./config/db');
const validateEnv = require('./config/env');
const authRouter = require('./routes/AuthRoute');
const userRouter = require('./routes/UserRoute');
const expenseRouter = require('./routes/ExpenseRoute');
const mutualFundRouter = require('./routes/MutualFundRoute');
const goalRouter = require('./routes/GoalRoute');
const analyticsRouter = require('./routes/AnalyticsRoute');
const { startNavScheduler } = require('./services/navStore');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const PORT = process.env.PORT || 6969;

app.disable('x-powered-by');

// Middleware to parse JSON requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register routers
app.use('/api/v1', authRouter);
app.use('/api/v1', userRouter);
app.use('/api/v1', expenseRouter);
app.use('/api/v1', mutualFundRouter);
app.use('/api/v1', goalRouter);
app.use('/api/v1', analyticsRouter);

// The React client (../client), once built with `npm run build`, is served
// from the same origin, so no CORS setup is needed. Unknown non-API paths
// return index.html so client-side routes like /expenses work on reload.
const clientDist = path.join(__dirname, '..', 'client', 'dist');

if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/') || !req.accepts('html')) {
            return next();
        }

        res.sendFile(path.join(clientDist, 'index.html'));
    });
}

// The simple single-page dashboard (view/index.html) at /simple
app.use('/simple', express.static(path.join(__dirname, 'view')));

// Unknown routes and errors must be registered after all routers
app.use(notFound);
app.use(errorHandler);

// Start server after MongoDB connects
const startServer = async () => {
    try {
        validateEnv();
        await connectDB();

        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

        // Daily NAV refresh at 00:05 IST (with retries at 06:00 and 09:00).
        startNavScheduler();
    } catch (error) {
        console.error('Failed to start server:', error.message);
        process.exit(1);
    }
};

startServer();
