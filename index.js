const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const {db} = require('./modules/db_connection')

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on("client_test_emit", (data) => {
    console.log('socket sent data')
  });
});
io.on('disconnected', (socket) => {
  console.log('a user disconnected');
});

io.on("client_test_emit", (data) => {
    console.log('client test emit',data);
});

setInterval(() => {
    //io.emit('test_emit','test')
}, 1000);

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});

/*const express = require('express')
const {db} = require('./modules/db_connection')
const app = express()

app.use(express.json())
app.get('/', async (req, res) => {
    console.log('express call')
    res.status(200).send('Hello World!');
})

app.get('/lich_list', async (callReq, callRes) => {
    console.log('express call get lich_list')
    await db.query(`select * from lich_list`).then(res => {
      callRes.status(200).send(JSON.stringify(res.rows));
    }).catch(err => {
      console.log(err)
      callRes.status(200).send(JSON.stringify(err));
    })
})

app.post('/hubapp/createMessage', async (callReq, callRes) => {
    console.log('express call post /hubapp/createMessage')
    console.log(callReq.body)
    if (!callReq.body || !callReq.body.message) {
        callRes.status(401).send('empty message in query');
        return;
    }
    await db.query(`INSERT INTO hubapp_messages (message) VALUES ('${callReq.body.message}')`).then(res => {
      callRes.status(200).send('added message to the table')
    }).catch(err => {
      console.log(err)
      callRes.status(502).send(`[DB Error] ${JSON.stringify(err)}`);
    })
})

app.listen(process.env.PORT, () => {
  console.log(`Express running on port ${process.env.PORT}.`)
})
*/