const { app, desktopCapturer } = require('electron');
app.whenReady().then(async () => {
  try {
    console.log('Started');
    const start = Date.now();
    for(let i=0; i<10; i++) {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    }
    console.log('10 frames took', Date.now() - start, 'ms');
  } catch (e) {
    console.error(e);
  }
  app.quit();
});
