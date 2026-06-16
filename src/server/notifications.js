const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3');

let lastNotificationId = null;
let dbCopyPath = path.join(os.tmpdir(), 'magical_newton_wpndb.db');
let notificationInterval = null;
let broadcastCallback = null;

function getWpnDbPath() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
}

function extractTextsFromXml(xml) {
  const texts = [];
  const textRegex = /<text[^>]*>([^<]+)<\/text>/g;
  let match;
  while ((match = textRegex.exec(xml)) !== null) {
    // Unescape XML entities
    let text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    texts.push(text);
  }
  return texts;
}

function checkNotifications() {
  const dbPath = getWpnDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return;

  try {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return; // Ignore open errors silently
      
      db.get('SELECT Id, Payload FROM Notification ORDER BY Id DESC LIMIT 1', (err, row) => {
        if (!err && row && row.Payload) {
          if (lastNotificationId === null) {
            // Initial run, just set the id
            lastNotificationId = row.Id;
          } else if (row.Id > lastNotificationId) {
            lastNotificationId = row.Id;
            
            // New notification! Parse it.
            const xml = row.Payload.toString('utf8');
            const texts = extractTextsFromXml(xml);
            
            if (texts.length > 0 && broadcastCallback) {
              const title = texts[0];
              const body = texts.slice(1).join('\n');
              
              broadcastCallback({
                type: 'system-notification',
                title: title,
                body: body
              });
            }
          }
        }
        db.close();
      });
    });
  } catch (err) {
    // File lock or other error, skip this tick
  }
}

function start(broadcastFn) {
  if (notificationInterval) return;
  broadcastCallback = broadcastFn;
  
  // Set initial lastNotificationId
  checkNotifications();
  
  // Poll every 1 second
  notificationInterval = setInterval(checkNotifications, 1000);
  console.log('[notifications] Started Windows notification listener');
}

function stop() {
  if (notificationInterval) {
    clearInterval(notificationInterval);
    notificationInterval = null;
  }
  broadcastCallback = null;
}

module.exports = {
  start,
  stop
};
