const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const {db} = require('./modules/db_connection')
const axios = require('axios')
const { request } = require('undici');
const uuid = require('uuid');

app.get('/', (req, res) => {
  res.send('Hello, this is the API for Gauss Prime. Nothing fancy to show on the web-page');
});

app.get('/hubapp', (req, res) => {
  //res.send('<html><body><h1>You are being redirected to Hub App web version</h1></body></html>');
  res.redirect('http://182.185.38.39:19006')
});

app.get('/discordOAuth2/authorize', async (req, res) => {
  if (!req.query.state) {
    res.send('<html><body><h1>session_key not found, please try again</h1></body></html>')
    return
  }
  if (!req.query.code) {
    res.send('<html><body><h1>Authorization code not found, please try again</h1></body></html>')
    return
  }
  res.send('<html><body><h1>Authorizing on server side, you may close this window and return to the app</h1></body></html>')
  const session_key = req.query.state
  request('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.BOT_CLIENT_ID,
      client_secret: process.env.BOT_CLIENT_SECRET,
      code: req.query.code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.API_URL}discordOAuth2/authorize`,
      scope: 'identify',
    }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }).then(async tokenResponseData => {
    const oauthData = await getJSONResponse(tokenResponseData.body);
    //console.log(oauthData);
    request('https://discord.com/api/users/@me', {
      headers: {
        authorization: `${oauthData.token_type} ${oauthData.access_token}`,
      },
    }).then(async userResult => {
      const userData = await getJSONResponse(userResult.body);
      console.log(userData)
      if (userData.message && userData.message == '401: Unauthorized')
        return
      db.query(`
        INSERT INTO hubapp_users (discord_id, discord_username, discord_discriminator, discord_email, discord_verified, discord_avatar, forums_auth_token, session_key)
        VALUES (${userData.id},'${userData.username}','${userData.discriminator}','${userData.email}',${userData.verified},'${userData.avatar}','${uuid.v1().split('-')[0]}', '${session_key}')
        ON CONFLICT (discord_id) 
        DO UPDATE SET 
          discord_username = EXCLUDED.discord_username, 
          discord_discriminator = EXCLUDED.discord_discriminator, 
          discord_email=EXCLUDED.discord_email, 
          discord_verified=EXCLUDED.discord_verified, 
          discord_avatar=EXCLUDED.discord_avatar,
          session_key=EXCLUDED.session_key
      `).then(res => {
        console.log('user authorized',userData.username)
        checkUserLogin(session_key)
      }).catch(console.error)
    }).catch(console.error)
  }).catch(console.error)
  async function getJSONResponse(body) {
    let fullBody = '';
  
    for await (const data of body) {
      fullBody += data.toString();
    }
    return JSON.parse(fullBody);
  }
});

var clients = {}

io.on('connection', (socket) => {
    console.log('a user connected',socket.id);
    if (!socket.handshake.query.session_key)
      return
    clients[socket.id] = socket

    // check if user was previously logged in
    setTimeout(() => {
      checkUserLogin(socket.handshake.query.session_key)
    }, 500);

    socket.on('disconnect', () => {
      console.log('a user disconnected');
      delete clients[socket.id]
      socket.removeAllListeners()
    });

    socket.addListener("hubapp/getPublicChat", () => {
      console.log('[Endpoint log] hubapp/getPublicChat called')
      db.query(`
        SELECT * FROM hubapp_messages
        JOIN hubapp_users ON
        hubapp_messages.discord_id = hubapp_users.discord_id
      `).then(res => {
        const arr = []
        res.rows.forEach(row => {
          arr.push({
            user: row.discord_username,
            message: row.message,
          })
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
    
    socket.addListener("hubapp/createPublicMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPublicMessage called')
      if (!data || !data.discord_id)
        return;
      db.query(`INSERT INTO hubapp_messages (discord_id,message) VALUES (${data.discord_id},'${data.message}')`).catch(console.error)
    });
    
});

function checkUserLogin(session_key) {
  db.query(`select * from hubapp_users WHERE session_key = '${session_key}'`).then(res => {
    if (res.rowCount == 1) {
      // find the socket which has the session_key
      for (const socket in clients) {
        if (clients[socket].handshake.query.session_key == session_key) {
          console.log('a user logged in, emitting login event')
          clients[socket].emit('hubapp/discordLoginAuthorized', {
            code: 200,
            response: res.rows[0]
          })
        }
      }
    }
  }).catch(console.error)
}

setInterval(() => {
  console.log('connected clients',new Date(),Object.keys(clients).length)
}, 15000);

db.on('notification', (notification) => {
  console.log('db notification')
  const payload = JSON.parse(notification.payload)
  if (notification.channel == 'hubapp_messages_insert') {
    db.query(`
      SELECT * FROM hubapp_messages
      JOIN hubapp_users ON
      hubapp_messages.discord_id = hubapp_users.discord_id
      WHERE msg_id=${payload.msg_id}
    `).then(res => {
      if (res.rowCount == 1) {
        io.emit('hubapp/receivedNewPublicMessage', {
          code: 200,
          response: {
            user: res.rows[0].discord_username,
            message: res.rows[0].message,
          }
        })
      }
    }).catch(console.error)
  }
  if (notification.channel == 'hubapp_users_update') {
    if (payload[0].forums_username != payload[1].forums_username) {
      console.log('a user has changed their forums username')
      // find the socket which has the session_key
      for (const socket in clients) {
        if (clients[socket].handshake.query.session_key == payload[0].session_key) {
          clients[socket].emit('hubapp/forumsUsernameUpdate', {
            code: 200,
            response: payload[0]
          })
        }
      }
    }
  }
})

setInterval(() => {
    //io.emit('test_emit','test')
}, 1000);

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});