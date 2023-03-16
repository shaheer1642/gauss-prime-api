require('./api/api')
require('./websocket/socket')

// restart after 24.5h
setTimeout(() => {
    process.exit()
}, 88200000);