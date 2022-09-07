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
const JSONbig = require('json-bigint');

app.get('/', (req, res) => {
  res.he
  res.send('Hello, this is the API for Gauss Prime. Nothing fancy to show on the web-page');
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
        INSERT INTO hubapp_users (discord_id, discord_username, discord_discriminator, discord_email, discord_verified, discord_avatar, forums_auth_token, session_key,registered_timestamp)
        VALUES (${userData.id},'${userData.username}','${userData.discriminator}','${userData.email}',${userData.verified},'${userData.avatar}','${uuid.v1().split('-')[0]}', '${session_key}',${new Date().getTime()})
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
        ORDER BY hubapp_messages.timestamp
      `).then(res => {
        const arr = []
        res.rows.forEach(row => {
          arr.push({
            discord_id: row.discord_id,
            discord_username: row.discord_username,
            ign: row.forums_username,
            message: row.message,
            avatar: row.discord_avatar,
            timestamp: row.timestamp
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

    socket.addListener("hubapp/getPrivateChat", (data) => {
      console.log('[Endpoint log] hubapp/getPrivateChat called')
      console.log(data)
      db.query(`
        INSERT INTO hubapp_users_dm_channels (discord_ids) SELECT '[${data.discord_id_1},${data.discord_id_2}]' 
        WHERE NOT EXISTS(SELECT * FROM hubapp_users_dm_channels where discord_ids @> '${data.discord_id_1}' AND discord_ids @> '${data.discord_id_2}');
        SELECT * FROM hubapp_users_dm_channels WHERE discord_ids @> '${data.discord_id_1}' AND discord_ids @> '${data.discord_id_2}';
      `).then(res => {
        const channel = res[1].rows[0];
        db.query(`
          SELECT discord_id, discord_username, forums_username, discord_avatar FROM hubapp_users WHERE discord_id = ${data.discord_id_1} OR discord_id = ${data.discord_id_2}
        `).then(res => {
          console.log(res.rows)
          const user_data = {}
          user_data[res.rows[0].discord_id] = {...res.rows[0]}
          user_data[res.rows[1].discord_id] = {...res.rows[1]}
          const arr = []
          channel.messages.forEach(message => {
            arr.push({
              discord_id: message.discord_id,
              discord_username: user_data[message.discord_id].discord_username,
              ign: user_data[message.discord_id].forums_username,
              avatar: user_data[message.discord_id].discord_avatar,
              message: message.message,
              timestamp: message.timestamp
            })
          })
          socket.emit('hubapp/receivedPrivateChat', {
              code: 200,
              response: arr
          })
        }).catch(console.error)
      }).catch(err => {
        console.log(err)
        socket.emit('hubapp/receivedPrivateChat', {
            code: 500,
            response: `[DB Error] ${JSON.stringify(err)}`
        })
      })
    });

    socket.addListener("hubapp/getChatUsersList", (data) => {
      console.log('[Endpoint log] hubapp/getPublicChat called')
      db.query(`
        SELECT * FROM hubapp_users_dm_channels
        JOIN hubapp_users ON hubapp_users.discord_id = TO_NUMBER((array_remove((translate(hubapp_users_dm_channels.discord_ids::json::text, '[]','{}')::text[]),'${data.discord_id}'))[1],'999999999999999999999999')
        WHERE discord_ids @> '${data.discord_id}'
        ORDER BY hubapp_users_dm_channels.last_update_timestamp DESC;
      `).then(res => {
        const arr = []
        res.rows.forEach(row => {
          arr.push({
            discord_id: row.discord_id,
            name: row.discord_username,
            avatar: `https://cdn.discordapp.com/avatars/${row.discord_id}/${row.discord_avatar}.png`,
            last_update_timestamp: row.last_update_timestamp,
          })
        })
        console.log(arr)
        socket.emit('hubapp/receivedChatUsersList', {
            code: 200,
            response: arr
        })
      }).catch(err => {
          console.log(err)
          socket.emit('hubapp/receivedChatUsersList', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
          })
      })
    });
    
    socket.addListener("hubapp/createPublicMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPublicMessage called')
      if (!data || !data.discord_id)
        return;
      db.query(`INSERT INTO hubapp_messages (discord_id,message,timestamp) VALUES (${data.discord_id},'${data.message.replace(/\'/g,`''`)}',${new Date().getTime()})`).catch(console.error)
    });

    socket.addListener("hubapp/createPrivateMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPrivateMessage called')
      if (!data || (!data.discord_id_1 && !data.discord_id_2))
        return;
      db.query(`
        UPDATE hubapp_users_dm_channels
        SET messages = messages || '[${JSON.stringify({message: data.message.replace(/\'/g,`''`), timestamp: new Date().getTime(), discord_id: data.discord_id_1})}]'::jsonb,
        last_update_timestamp = ${new Date().getTime()}
        WHERE discord_ids @> '${data.discord_id_1}' AND discord_ids @> '${data.discord_id_2}';`
      ).catch(console.error)
    });
    
    socket.addListener("hubapp/recruitmentSquads/getAll", () => {
      console.log('[Endpoint log] hubapp/recruitmentSquads/getAll called')
      db.query(`
        SELECT * FROM hub_recruitbot_squads
        ORDER BY timestamp
      `).then(res => {
        var recruitment_squads = {
          relics: [],
          farming: [],
          progression: [],
          bosses: []
        }
        res.rows.forEach(row => {
          recruitment_squads[row.category].push(row)
        })
        socket.emit('hubapp/recruitmentSquads/receivedAll', {
            code: 200,
            response: recruitment_squads
        })
      }).catch(err => {
          console.log(err)
          socket.emit('hubapp/recruitmentSquads/receivedAll', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
          })
      })
    });

    socket.addListener("hubapp/trades/getAll", () => {
      console.log('[Endpoint log] hubapp/trades/getAll called')
      db.query(`
        SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.user_price, tradebot_users_orders.user_rank, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.visibility=true
        ORDER BY tradebot_users_orders.update_timestamp
      `).then(res => {
        const trades = {
          itemTrades: res.rows,
          lichTrades: [],
          rivenTrades: []
        }
        socket.emit('hubapp/trades/receivedAll', {
            code: 200,
            response: trades
        })
      }).catch(err => {
          console.log(err)
          socket.emit('hubapp/trades/receivedAll', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
          })
      })
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
  console.log(notification.payload)
  const payload = JSONbig.parse(notification.payload);
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
            discord_id: res.rows[0].discord_id,
            discord_username: res.rows[0].discord_username,
            ign: res.rows[0].forums_username,
            message: res.rows[0].message,
            avatar: res.rows[0].discord_avatar,
            timestamp: res.rows[0].timestamp
          }
        })
      }
    }).catch(console.error)
  }


  if (notification.channel == 'hubapp_users_dm_channels_update') {
    if ((payload[0].messages.length - 1) == payload[1].messages.length) {
      console.log('new message')
      db.query(`
        SELECT discord_id, discord_username, forums_username, discord_avatar FROM hubapp_users WHERE discord_id = ${payload[0].discord_ids[0]} OR discord_id = ${payload[0].discord_ids[1]}
      `).then(res => {
        const message = payload[0].messages[payload[0].messages.length-1]
        const user_data = {}
        user_data[res.rows[0].discord_id] = {...res.rows[0]}
        user_data[res.rows[1].discord_id] = {...res.rows[1]}
        io.emit('hubapp/receivedNewPrivateMessage', {
            code: 200,
            response: {
              discord_id: message.discord_id,
              discord_username: user_data[message.discord_id].discord_username,
              ign: user_data[message.discord_id].forums_username,
              avatar: user_data[message.discord_id].discord_avatar,
              message: message.message,
              timestamp: message.timestamp
            }
        })
      }).catch(console.error)
    }
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

  if (notification.channel == 'hub_recruitbot_squads_insert') {
    io.emit('hubapp/recruitmentSquads/insertSquad', {
      code: 200,
      response: payload
    })
  }
  if (notification.channel == 'hub_recruitbot_squads_update') {
    io.emit('hubapp/recruitmentSquads/updateSquad', {
      code: 200,
      response: payload
    })
  }
  if (notification.channel == 'hub_recruitbot_squads_delete') {
    io.emit('hubapp/recruitmentSquads/deleteSquad', {
      code: 200,
      response: payload
    })
  }

  if (notification.channel == 'tradebot_users_orders_insert') {
    db.query(`
      SELECT
      tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
      tradebot_users_orders.order_type, tradebot_users_orders.user_price, tradebot_users_orders.user_rank, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
      items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
      FROM tradebot_users_orders
      JOIN tradebot_users_list ON
      tradebot_users_orders.discord_id = tradebot_users_list.discord_id
      JOIN items_list ON
      tradebot_users_orders.item_id = items_list.id
      WHERE tradebot_users_orders.discord_id=${payload.discord_id} AND tradebot_users_orders.item_id='${payload.item_id}' AND tradebot_users_orders.user_rank= '${payload.user_rank}' AND tradebot_users_orders.visibility=TRUE
    `).then(res => {
      console.log(JSON.stringify(res.rows))
      if (res.rowCount == 1) {
        io.emit('hubapp/trades/insertItem', {
          code: 200,
          response: res.rows[0]
        })
      } else {
        io.emit('hubapp/trades/insertItem', {
          code: 500,
          response: `[DB Error] Zero rows returned when querying`
        })
      }
    }).catch(err => {
        console.log(err)
        io.emit('hubapp/trades/insertItem', {
            code: 500,
            response: `[DB Error] ${JSON.stringify(err)}`
        })
    })
  }
  if (notification.channel == 'tradebot_users_orders_update') {
    if (payload[0].visibility == true && payload[1].visibility == false) {
      console.log('an item became visible')
      db.query(`
        SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.user_price, tradebot_users_orders.user_rank, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.discord_id=${payload[0].discord_id} AND tradebot_users_orders.item_id='${payload[0].item_id}' AND tradebot_users_orders.user_rank= '${payload[0].user_rank}' AND tradebot_users_orders.visibility=TRUE
      `).then(res => {
        console.log(JSON.stringify(res.rows))
        if (res.rowCount == 1) {
          io.emit('hubapp/trades/insertItem', {
            code: 200,
            response: res.rows[0]
          })
        } else {
          io.emit('hubapp/trades/insertItem', {
            code: 500,
            response: `[DB Error] Zero rows returned when querying`
          })
        }
      }).catch(err => {
          console.log(err)
          io.emit('hubapp/trades/insertItem', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
          })
      })
    } else if (payload[0].visibility == false && payload[1].visibility == true) {
      console.log('an item became invisible')
      io.emit('hubapp/trades/deleteItem', {
        code: 200,
        response: payload[1]
      })
    } else if (payload[0].visibility == true && payload[1].visibility == true) {
      console.log('an item has been updated')
      // get list of updated keys
      const changed_keys = []
      for (const key of Object.keys(payload[0])) {
        if (payload[0][key] != payload[1][key]) 
          changed_keys.push(key)
      }
      db.query(`
        SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.user_price, tradebot_users_orders.user_rank, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.discord_id=${payload[0].discord_id} AND tradebot_users_orders.item_id='${payload[0].item_id}' AND tradebot_users_orders.user_rank= '${payload[0].user_rank}' AND tradebot_users_orders.visibility=TRUE
      `).then(res => {
        console.log(JSON.stringify(res.rows))
        if (res.rowCount == 1) {
          io.emit('hubapp/trades/updateItem', {
            code: 200,
            response: {...res.rows[0], changed_keys: changed_keys}
          })
        } else {
          io.emit('hubapp/trades/updateItem', {
            code: 500,
            response: `[DB Error] Zero rows returned when querying`
          })
        }
      }).catch(err => {
          console.log(err)
          io.emit('hubapp/trades/updateItem', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
          })
      })
    }
  }
  if (notification.channel == 'tradebot_users_orders_delete') {
    io.emit('hubapp/trades/deleteItem', {
      code: 200,
      response: payload
    })
  }
})

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});