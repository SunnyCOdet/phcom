const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error("Failed to open:", err);
    } else {
        console.log("Successfully opened directly!");
        db.get('SELECT Id FROM Notification ORDER BY Id DESC LIMIT 1', (err, row) => {
            console.log("Latest ID:", row);
            db.close();
        });
    }
});
