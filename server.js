// api/index.js
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

// Initialize express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// For Vercel, we'll use an in-memory database since we can't write to filesystem
const db = new sqlite3.Database(":memory:", (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to SQLite in-memory database.");
        setupDatabase();
    }
});

// Setup Database
const setupDatabase = () => {
    db.serialize(() => {
        db.run(
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                total_clicks INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0
            )`
        );

        db.run(
            `CREATE TABLE IF NOT EXISTS boosts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                boost_type TEXT,
                active_until TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )`
        );

        db.run(
            `CREATE TABLE IF NOT EXISTS logs (
                user_id TEXT,
                action TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        );
    });
};

// API Routes
const apiRouter = express.Router();

// Health check endpoint
apiRouter.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// Register User
apiRouter.post("/register", (req, res) => {
    const { userId, username } = req.body;
    if (!userId) {
        return res.status(400).send("Missing userId");
    }

    db.run(
        `INSERT INTO users (id, username) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username`,
        [userId, username || null],
        function (err) {
            if (err) {
                return res.status(500).send("Error registering user.");
            }
            res.json({ message: `User ${userId} registered successfully.` });
        }
    );
});

// Click Endpoint
apiRouter.post("/click", (req, res) => {
    const { userId, clickReward } = req.body;
    if (!userId || !clickReward) {
        return res.status(400).send("Missing userId or clickReward");
    }

    db.run(
        `UPDATE users 
         SET total_clicks = total_clicks + 1, total_tokens = total_tokens + ?
         WHERE id = ?`,
        [clickReward, userId],
        function (err) {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error.");
            }
            res.json({ message: `Added ${clickReward} tokens for user ${userId}.` });
        }
    );
});

// Claim Tokens Endpoint
apiRouter.post("/claim-tokens", (req, res) => {
    const { userId, tokens } = req.body;
    if (!userId || !tokens) {
        return res.status(400).send("Missing userId or tokens");
    }

    db.get(
        `SELECT total_tokens FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error.");
            }
            if (!row || row.total_tokens < tokens) {
                return res.status(400).send("Insufficient tokens.");
            }

            db.run(
                `UPDATE users SET total_tokens = total_tokens - ? WHERE id = ?`,
                [tokens, userId],
                function (err) {
                    if (err) {
                        console.error(err.message);
                        return res.status(500).send("Error updating tokens.");
                    }
                    res.json({ message: `User ${userId} claimed ${tokens} tokens.` });
                }
            );
        }
    );
});

// Purchase Boost Endpoint
apiRouter.post("/buy-boost", (req, res) => {
    const { userId, boostType, price, duration } = req.body;
    if (!userId || !boostType || !price || !duration) {
        return res.status(400).send("Missing required fields");
    }

    db.get(
        `SELECT total_tokens FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error.");
            }
            if (!row || row.total_tokens < price) {
                return res.status(400).send("Insufficient tokens.");
            }

            const activeUntil = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString(); // Duration in hours
            db.run(
                `UPDATE users SET total_tokens = total_tokens - ? WHERE id = ?`,
                [price, userId],
                function (err) {
                    if (err) {
                        console.error(err.message);
                        return res.status(500).send("Error updating tokens.");
                    }

                    db.run(
                        `INSERT INTO boosts (user_id, boost_type, active_until) VALUES (?, ?, ?)`,
                        [userId, boostType, activeUntil],
                        function (err) {
                            if (err) {
                                console.error(err.message);
                                return res.status(500).send("Error activating boost.");
                            }
                            res.json({
                                message: `Boost ${boostType} purchased for user ${userId}.`,
                                activeUntil,
                            });
                        }
                    );
                }
            );
        }
    );
});

// Get Active Boost for User
apiRouter.get("/active-boost/:userId", (req, res) => {
    const { userId } = req.params;

    db.get(
        `SELECT boost_type, active_until FROM boosts 
         WHERE user_id = ? AND active_until > ? 
         ORDER BY active_until DESC LIMIT 1`,
        [userId, new Date().toISOString()],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error.");
            }
            if (!row) {
                return res.status(404).send("No active boost.");
            }
            res.json(row);
        }
    );
});

// Get User Stats
apiRouter.get("/user/:userId", (req, res) => {
    const { userId } = req.params;
    db.get(
        `SELECT id, username, total_clicks, total_tokens FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send("Database error.");
            }
            if (!row) {
                return res.status(404).send("User not found.");
            }
            res.json(row);
        }
    );
});

// Mount API routes
app.use("/api", apiRouter);

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

// Export the Express API
module.exports = app;