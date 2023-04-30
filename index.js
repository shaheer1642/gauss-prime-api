const http = require('http');
const { api } = require('./api/api');
require('./websocket/socket')

const server = http.createServer(api);
server.listen(process.env.PORT, () => {
    console.log('Server is listening to port',process.env.PORT);
});

// restart after 24.5h
setTimeout(() => {
    process.exit() 
}, 88200000);