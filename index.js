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

    socket.on("hubapp/getPublicChat", () => {
        console.log('[Endpoint log] hubapp/getPublicChat called')
        db.query(`select * from hubapp_messages`).then(res => {
          const arr = []
          res.rows.forEach(row => {
            arr.push(row.message)
          })
          socket.emit('hubapp/receivedPublicChat', {
              code: 200,
              response: arr
          })
        }).catch(err => {
            console.log(err)
            socket.emit('hubapp/receivedPublicChat', {
                code: 500,
                response: `[DB Error] ${JSON.stringify(err)}`
            })
        })
    });
    
    socket.on("hubapp/createPublicMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPublicMessage called')

      db.query(`INSERT INTO hubapp_messages (message) VALUES ('${data.message}')`).then(res => {
      }).catch(err => {
          console.log(err)
      })
    });
    
    db.on('notification', notification => {
      console.log('db notification')
      console.log(JSON.parse(notification.payload))
      if (notification.channel == 'hubapp_messages_insert') {
        socket.emit('hubapp/receivedNewPublicMessage', {
          code: 200,
          response: JSON.parse(notification.payload).message
        })
      }
    })
});

setInterval(() => {
    //io.emit('test_emit','test')
}, 1000);

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});