const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:999,
    queueLimit: 0
};

let pool;

async function createPool() {
    if (!pool) {
        try {
            pool = mysql.createPool(dbConfig);
            const connection = await pool.getConnection();
            connection.release();
            console.log('Successfully connected to MySQL database');
        } catch (error) {
            console.error('Error creating MySQL connection pool:');
            handleDatabaseError(error);
            throw error;
        }
    }
    return pool;
}
function handleDatabaseError(error) {
    switch (error.code) {
        case 'ER_ACCESS_DENIED_ERROR':
            console.error('Access denied. Please check your database credentials in the .env file.');
            break;
        case 'ECONNREFUSED':
            console.error('Connection refused. Please check if the database server is running and the host is correct.');
            break;
        case 'ER_BAD_DB_ERROR':
            console.error('Database not found. Please check if the database name in your .env file is correct.');
            break;
        default:
            console.error('An unexpected error occurred:', error.message);
    }
}

async function initDatabase() {
    try {
        pool = await createPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS Points (
                user_id VARCHAR(255) PRIMARY KEY,
                points INT DEFAULT 0,
                daily_points INT DEFAULT 0,
                last_point_date DATE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS Users (
                user_id VARCHAR(255) PRIMARY KEY,
                verification_prompted BOOLEAN DEFAULT FALSE,
                verified BOOLEAN DEFAULT FALSE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS PointsHistory (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(255),
                points_earned INT,
                parent_forum_id VARCHAR(255), 
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX (user_id),
                INDEX (timestamp),
                INDEX (parent_forum_id) 
            )
        `);
        console.log('Database initialized successfully (with PointsHistory.parent_forum_id)');
    } catch (error) {
        console.error('Error initializing database:', error);

        if (error.code !== 'ER_DUP_FIELDNAME' && !error.message.includes("Duplicate column name 'parent_forum_id'")) {
            if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.message.includes("already exists")) {
                try {
                    await pool.query('ALTER TABLE PointsHistory ADD COLUMN parent_forum_id VARCHAR(255) NULL DEFAULT NULL, ADD INDEX (parent_forum_id)');
                } catch (alterError) {
                    console.error('Error adding parent_forum_id column to existing table:', alterError);
                    if (alterError.code !== 'ER_DUP_FIELDNAME' && !alterError.message.includes("Duplicate column name 'parent_forum_id'")) {
                        throw error;
                    } else {
                        console.log("Column 'parent_forum_id' already exists (detected during alter attempt).");
                    }
                }
            } else {
                throw error;
            }
        } else {
            console.log("Column 'parent_forum_id' already exists (detected during create attempt).");
        }
    }
}

async function resetDailyPoints() {
    const now = new Date();
    const resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0); // 3 AM GMT+3
    if (now >= resetTime) {
        const today = now.toISOString().split('T')[0];
        await pool.query('UPDATE Points SET daily_points = 0, last_point_date = ? WHERE DATE(last_point_date) < ?', [today, today]);
    }
}

async function addPoint(userId, parentForumId, points = 1) { // Added parentForumId parameter
    try {
        await resetDailyPoints();
        const verified = await getVerificationStatus(userId);
        const [userPoints] = await pool.query('SELECT points, daily_points, last_point_date FROM Points WHERE user_id = ?', [userId]);
        let currentPoints = 0;
        let dailyPoints = 0;
        let lastPointDate = null;
        if (userPoints.length > 0) {
            currentPoints = userPoints[0].points;
            dailyPoints = userPoints[0].daily_points;
            lastPointDate = userPoints[0].last_point_date;
        }
        const today = new Date().toISOString().split('T')[0];
        const lastPointDateString = lastPointDate ? new Date(lastPointDate).toISOString().split('T')[0] : null;

        if (lastPointDateString !== today) {
            dailyPoints = 0;
        }
        const maxDailyPoints = 4;
        const remainingDailyPoints = maxDailyPoints - dailyPoints;

        if (remainingDailyPoints <= 0) {
            return { success: false, reason: 'daily_limit' };
        }
        const pointsToAdd = Math.min(points, remainingDailyPoints);
        const newDailyPoints = dailyPoints + pointsToAdd;
        let query;
        let queryParams;
        if (verified) {
            query = 'INSERT INTO Points (user_id, points, daily_points, last_point_date) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE points = points + ?, daily_points = ?, last_point_date = ?';
            queryParams = [userId, currentPoints + pointsToAdd, newDailyPoints, today, pointsToAdd, newDailyPoints, today];
        } else {
            if (currentPoints >= 814) {
                return { success: false, reason: 'max_points' };
            }
            query = 'INSERT INTO Points (user_id, points, daily_points, last_point_date) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE points = LEAST(points + ?, 814), daily_points = ?, last_point_date = ?';
            queryParams = [userId, Math.min(currentPoints + pointsToAdd, 814), newDailyPoints, today, pointsToAdd, newDailyPoints, today];
        }
        await pool.query(query, queryParams);
        await pool.query('INSERT INTO PointsHistory (user_id, points_earned, parent_forum_id) VALUES (?, ?, ?)', [userId, pointsToAdd, parentForumId]);

        const updatedPoints = await getPoints(userId);
        return {
            success: true,
            updatedPoints,
            remainingDailyPoints: maxDailyPoints - newDailyPoints
        };
    } catch (error) {
        console.error('Error adding points:', error);
        throw error;
    }
}

async function getPoints(userId) {
    try {
        const [rows] = await pool.query('SELECT points FROM Points WHERE user_id = ?', [userId]);
        return rows.length > 0 ? rows[0].points : 0;
    } catch (error) {
        console.error('Error getting points:', error);
        throw error;
    }
}

async function addPointsNoLimit(userId, points) {
    try {
        console.log(`Starting addPointsNoLimit function for user ${userId} with ${points} point(s)`);
        const initialVerificationStatus = await getVerificationStatus(userId);
        console.log(`Initial verification status for user ${userId}: ${initialVerificationStatus}`);
        const [userPoints] = await pool.query('SELECT points FROM Points WHERE user_id = ?', [userId]);
        let currentPoints = userPoints.length > 0 ? userPoints[0].points : 0;
        const newPoints = currentPoints + points;
        const query = 'INSERT INTO Points (user_id, points) VALUES (?, ?) ON DUPLICATE KEY UPDATE points = ?';
        const queryParams = [userId, newPoints, newPoints];
        const [result] = await pool.query(query, queryParams);
        let automaticallyVerified = false;
        if (!initialVerificationStatus && newPoints >= 814) {
            await setVerificationStatus(userId, true);
            await setVerificationPromptStatus(userId, true);
            console.log(`User ${userId} automatically verified as helper due to points >= 814`);
            console.log(`Verification prompt status set to true for user ${userId}`);
            automaticallyVerified = true;
        }
        const success = result.affectedRows > 0;
        console.log(`Points added successfully: ${success}`);
        console.log(`Automatically verified: ${automaticallyVerified}`);

        return { success, automaticallyVerified, newPoints };
    } catch (error) {
        console.error('Error adding points (no limit):', error);
        throw error;
    }
}
async function getVerificationPromptStatus(userId) {
    try {
        const [rows] = await pool.query('SELECT verification_prompted FROM Users WHERE user_id = ?', [userId]);
        return rows.length > 0 ? rows[0].verification_prompted : false;
    } catch (error) {
        console.error('Error getting verification prompt status:', error);
        throw error;
    }
}

async function setVerificationPromptStatus(userId, status) {
    try {
        await pool.query('INSERT INTO Users (user_id, verification_prompted) VALUES (?, ?) ON DUPLICATE KEY UPDATE verification_prompted = ?', [userId, status, status]);
    } catch (error) {
        console.error('Error setting verification prompt status:', error);
        throw error;
    }
}

async function getVerificationStatus(userId) {
    try {
        const [rows] = await pool.query('SELECT verified FROM Users WHERE user_id = ?', [userId]);
        return rows.length > 0 ? rows[0].verified : false;
    } catch (error) {
        console.error('Error getting verification status:', error);
        throw error;
    }
}

async function setVerificationStatus(userId, status) {
    try {
        await pool.query('INSERT INTO Users (user_id, verified) VALUES (?, ?) ON DUPLICATE KEY UPDATE verified = ?', [userId, status, status]);
        if (status) {
            await pool.query('INSERT INTO Points (user_id, points) VALUES (?, 0) ON DUPLICATE KEY UPDATE points = points', [userId]);
        }

        console.log(`Verification status for user ${userId} set to ${status}`);
        return true;
    } catch (error) {
        console.error('Error setting verification status:', error);
        throw error;
    }
}

async function getTopHelpers(limit = 100) {
    try {
        const [rows] = await pool.query(`
            SELECT user_id, points
            FROM Points
            ORDER BY points DESC
            LIMIT ?
        `, [limit]);
        return rows;
    } catch (error) {
        console.error('Error getting op helpers:', error);
        throw error;
    }
}

async function removePoints(userId, pointsToRemove) {
    try {
        const currentPoints = await getPoints(userId);
        const newPoints = Math.max(0, currentPoints - pointsToRemove);
        await pool.query('UPDATE Points SET points = ? WHERE user_id = ?', [newPoints, userId]);
        const verified = await getVerificationStatus(userId);
        if (verified && newPoints < 814) {
            await setVerificationStatus(userId, false);
            await pool.query('UPDATE Users SET verification_prompted = 0 WHERE user_id = ?', [userId]);
        }
        return newPoints;
    } catch (error) {
        console.error('Error removing points:', error);
        throw error;
    }
}

async function getWeeklyPoints(limit = 100) {
    try {
        const [rows] = await pool.query(`
            SELECT user_id, SUM(points_earned) as points
            FROM PointsHistory
            WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
            GROUP BY user_id
            ORDER BY points DESC
            LIMIT ?
        `, [limit]);
        return rows;
    } catch (error) {
        console.error('Error getting weekly points:', error);
        throw error;
    }
}

async function getMonthlyPoints(limit = 100) {
    try {
        const [rows] = await pool.query(`
            SELECT user_id, SUM(points_earned) as points
            FROM PointsHistory
            WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
            GROUP BY user_id
            ORDER BY points DESC
            LIMIT ?
        `, [limit]);
        return rows;
    } catch (error) {
        console.error('Error getting monthly points:', error);
        throw error;
    }
}

async function getChannelHelpStats(userIds, timeframe = 'all') {
    if (!userIds || userIds.length === 0) {
        return [];
    }

    try {
        let timeCondition = '';
        if (timeframe === 'weekly') {
            timeCondition = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)';
        } else if (timeframe === 'monthly') {
            timeCondition = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        }

        const schoolForumId = process.env.HELP_SCHOOL_FORUM_ID;
        const universityForumId = process.env.HELP_UNIVERSITY_FORUM_ID;

        const placeholders = userIds.map(() => '?').join(',');

        const query = `
            SELECT
                user_id,
                SUM(CASE WHEN parent_forum_id = ? THEN 1 ELSE 0 END) as school_thanks,
                SUM(CASE WHEN parent_forum_id = ? THEN 1 ELSE 0 END) as university_thanks
            FROM PointsHistory
            WHERE user_id IN (${placeholders}) ${timeCondition}
            GROUP BY user_id
        `;
        const params = [schoolForumId, universityForumId, ...userIds];
        const [rows] = await pool.query(query, params);
        const statsMap = new Map(rows.map(row => [row.user_id, {
            school_thanks: parseInt(row.school_thanks, 10) || 0,
            university_thanks: parseInt(row.university_thanks, 10) || 0
        }]));
        const results = userIds.map(userId => ({
            user_id: userId,
            school_thanks: statsMap.get(userId)?.school_thanks || 0,
            university_thanks: statsMap.get(userId)?.university_thanks || 0,
        }));

        return results;

    } catch (error) {
        console.error('Error getting channel help stats:', error);
        throw error;
    }
}

async function getTopHelpersByChannelActivity(timeframe = 'all', limit = 100) {
    try {
        let timeCondition = '';
        if (timeframe === 'weekly') {
            timeCondition = 'WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)';
        } else if (timeframe === 'monthly') {
            timeCondition = 'WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        }

        const query = `
            SELECT user_id, COUNT(*) as points
            FROM PointsHistory
            ${timeCondition}
            GROUP BY user_id
            ORDER BY points DESC
            LIMIT ?
        `;

        const [rows] = await pool.query(query, [limit]);
        return rows;
    } catch (error) {
        console.error(`Error getting top helpers by channel activity (${timeframe}):`, error);
        throw error;
    }
}


module.exports = {
    pool,
    initDatabase,
    addPoint,
    getPoints,
    getVerificationPromptStatus,
    setVerificationPromptStatus,
    getVerificationStatus,
    setVerificationStatus,
    addPointsNoLimit,
    getTopHelpers,
    removePoints,
    getWeeklyPoints,
    getMonthlyPoints,
    getChannelHelpStats,
    getTopHelpersByChannelActivity,
};
