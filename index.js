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
const {convertUpper} = require('./modules/functions')

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
    console.log('connected clients',new Date(),Object.keys(clients).length)
    if (!socket.handshake.query.session_key)
      return
    clients[socket.id] = socket

    // check if user was previously logged in
    setTimeout(() => {
      checkUserLogin(socket.handshake.query.session_key)
    }, 500);

    socket.on('disconnect', () => {
      console.log('a user disconnected');
      console.log('connected clients',new Date(),Object.keys(clients).length)
      delete clients[socket.id]
      socket.removeAllListeners()
    });

    socket.addListener("hubapp/getPublicChat", () => {
      console.log('[Endpoint log] hubapp/getPublicChat called')
      db.query(`
        SELECT * FROM hubapp_messages_channels WHERE discord_ids @> '"ALL"';
        SELECT * FROM hubapp_users;
      `).then(res => {
        const user_data = {}
        res[1].rows.forEach(row => user_data[row.discord_id] = row)
        const arr = []
        res[0].rows[0].messages.forEach(message => {
          arr.push({
            discord_id: message.discord_id,
            discord_username: user_data[message.discord_id].discord_username,
            ign: user_data[message.discord_id].forums_username,
            avatar: user_data[message.discord_id].discord_avatar,
            message: message.message,
            timestamp: message.timestamp
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

    socket.addListener("hubapp/privateChatMarkAsRead", (data) => {
      console.log('[Endpoint log] hubapp/privateChatMarkAsRead called')
      db.query(`
        UPDATE hubapp_messages_channels SET last_read_message = jsonb_set(last_read_message, '{${data.discord_id_1}}', '${new Date().getTime()}') 
        WHERE discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"';
      `).then(res => {
        socket.emit("hubapp/privateChatMarkedAsRead", {
          code: 200,
          response: data
        })
      }).catch(console.error)
    })

    socket.addListener("hubapp/publicChatMarkAsRead", (data) => {
      console.log('[Endpoint log] hubapp/publicChatMarkAsRead called')
      db.query(`
        UPDATE hubapp_messages_channels SET last_read_message = jsonb_set(last_read_message, '{${data.discord_id}}', '${new Date().getTime()}') 
        WHERE discord_ids @> '"ALL"';
      `).then(res => {
        socket.emit("hubapp/publicChatMarkedAsRead", {
          code: 200,
          response: data
        })
      }).catch(console.error)
    })

    socket.addListener("hubapp/getPrivateChat", (data) => {
      console.log('[Endpoint log] hubapp/getPrivateChat called')
      console.log(data)
      db.query(`
        INSERT INTO hubapp_messages_channels (discord_ids,last_read_message) SELECT '${JSON.stringify([data.discord_id_1,data.discord_id_2])}','{"${data.discord_id_1}":${new Date().getTime()},"${data.discord_id_2}":${new Date().getTime()}}'
        WHERE NOT EXISTS(SELECT * FROM hubapp_messages_channels where discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"');
        SELECT * FROM hubapp_messages_channels WHERE discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"';
      `).then(res => {
        const channel = res[1].rows[0];
        db.query(`
          SELECT * FROM hubapp_users WHERE discord_id = ${data.discord_id_1} OR discord_id = ${data.discord_id_2} OR discord_id = 111111111111111111;
        `).then(res => {
          const user_data = {}
          res.rows.forEach(row => user_data[row.discord_id] = row)
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

    socket.addListener("hubapp/getChatsList", (data) => {
      console.log('[Endpoint log] hubapp/getChatsList called')
      db.query(`
        SELECT * FROM hubapp_messages_channels
        WHERE discord_ids @> '"${data.discord_id}"' OR discord_ids @> '"ALL"'
        ORDER BY last_update_timestamp DESC;
        SELECT * FROM hubapp_users;
      `).then(res => {
        const user_data = {}
        res[1].rows.forEach(row => user_data[row.discord_id] = row)
        const arr = []
        res[0].rows.forEach(row => {
          var unread_messages = 0;
          row.messages.forEach(message => message.timestamp > row.last_read_message[data.discord_id] && message.discord_id != data.discord_id ? unread_messages++:true)
          if (row.discord_ids.includes('ALL')) {
            arr.push({
              discord_id: null,
              name: 'Public Chat',
              avatar: `https://static.vecteezy.com/system/resources/thumbnails/000/450/102/small/Basic_Ui__28154_29.jpg`,
              last_update_timestamp: row.last_update_timestamp,
              unread_messages: unread_messages
            })
          } else {
            const target_discord_id = ((row.discord_ids.filter(function(e) { return e !== data.discord_id }))[0]).toString()
            console.log(target_discord_id)
            arr.push({
              discord_id: user_data[target_discord_id].discord_id,
              name: user_data[target_discord_id].discord_username,
              avatar: `https://cdn.discordapp.com/avatars/${user_data[target_discord_id].discord_id}/${user_data[target_discord_id].discord_avatar}.png`,
              last_update_timestamp: row.last_update_timestamp,
              unread_messages: unread_messages
            })
          }
        })
        console.log(arr)
        socket.emit('hubapp/receivedChatsList', {
            code: 200,
            response: arr
        })
      }).catch(err => {
        console.log(err)
        socket.emit('hubapp/receivedChatsList', {
            code: 500,
            response: `[DB Error] ${JSON.stringify(err)}`
        })
      })
    });
    
    socket.addListener("hubapp/createPublicMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPublicMessage called')
      if (!data || !data.discord_id)
        return;
      db.query(`
        UPDATE hubapp_messages_channels
        SET messages = messages || '[${JSON.stringify({message: data.message.replace(/\'/g,`''`), discord_id: data.discord_id, timestamp: new Date().getTime()})}]'::jsonb,
        last_update_timestamp = ${new Date().getTime()}
        WHERE discord_ids @> '"ALL"';`
      ).catch(console.error)
    });

    socket.addListener("hubapp/createPrivateMessage", (data) => {
      console.log('[Endpoint log] hubapp/createPrivateMessage called')
      if (!data || (!data.discord_id_1 && !data.discord_id_2))
        return;
      db.query(`
        UPDATE hubapp_messages_channels
        SET messages = messages || '[${JSON.stringify({message: data.message.replace(/\'/g,`''`), discord_id: data.discord_id_1, timestamp: new Date().getTime()})}]'::jsonb,
        last_update_timestamp = ${new Date().getTime()}
        WHERE discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"';`
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

db.on('notification', (notification) => {
  console.log('db notification')
  console.log(notification.payload)
  console.log(notification.channel)
  const payload = JSONbig.parse(notification.payload);

  if (notification.channel == 'hubapp_messages_channels_update') {
    if (payload.discord_ids.includes('ALL')) {
      if (payload.new_last_message.timestamp != payload.old_last_message.timestamp) {
        console.log('new public message')
        const message = payload.new_last_message
        db.query(`
          SELECT * FROM hubapp_users WHERE discord_id = ${message.discord_id}
        `).then(res => {
          const user_data = res.rows[0]
          io.emit('hubapp/receivedNewPublicMessage', {
            code: 200,
            response: {
              discord_id: message.discord_id,
              discord_username: user_data.discord_username,
              ign: user_data.forums_username,
              avatar: user_data.discord_avatar,
              message: message.message,
              timestamp: message.timestamp
            }
          })
        }).catch(console.error)
      }
    } else {
      if (payload.new_last_message.timestamp != payload.old_last_message.timestamp) {
        console.log('new private message')
        db.query(`
          SELECT * FROM hubapp_users WHERE discord_id = ${payload.discord_ids[0]} OR discord_id = ${payload.discord_ids[1]} OR discord_id = 111111111111111111
        `).then(res => {
          const message = payload.new_last_message
          const user_data = {}
          res.rows.forEach(row => user_data[row.discord_id] = row)
          for (const socket in clients) {
            if (JSON.stringify(user_data).match(clients[socket].handshake.query.session_key)) {
              clients[socket].emit('hubapp/receivedNewPrivateMessage', {
                code: 200,
                response: {
                  discord_id: message.discord_id,
                  discord_username: user_data[message.discord_id].discord_username,
                  ign: user_data[message.discord_id].forums_username,
                  avatar: user_data[message.discord_id].discord_avatar,
                  message: message.message,
                  channel: payload.discord_ids,
                  timestamp: message.timestamp
                }
              })
            }
          }
          
        }).catch(console.error)
      }
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

  if (notification.channel == 'tradebot_filled_users_orders_insert') {
    db.query(`
      SELECT * FROM items_list WHERE id='${payload.item_id}';
    `).then(res => {
      const item_data = res.rows[0]
      db.query(`
        SELECT * FROM tradebot_users_list WHERE discord_id = ${payload.order_owner} OR discord_id = ${payload.order_filler};
      `).then(res => {
        const user_data = {}
        res.rows.forEach(row => user_data[row.discord_id] = row)
        db.query(`
          INSERT INTO hubapp_messages_channels (discord_ids,last_read_message) SELECT '${JSON.stringify([payload.order_owner,payload.order_filler])}','{"${payload.order_owner}":${new Date().getTime()},"${payload.order_filler}":${new Date().getTime()}}'
          WHERE NOT EXISTS(SELECT * FROM hubapp_messages_channels where discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"');
          UPDATE hubapp_messages_channels
          SET messages = messages || '[${JSON.stringify({message: `A trade has been opened!
          
${convertUpper(item_data.item_url)}

${payload.order_type == 'wts' ? 
`Seller: ${user_data[payload.order_owner].ingame_name}
Buyer: ${user_data[payload.order_filler].ingame_name}
`:
`Seller: ${user_data[payload.order_filler].ingame_name}
Buyer: ${user_data[payload.order_owner].ingame_name}
`}
Price: ${payload.user_price}p`, discord_id: '111111111111111111', timestamp: new Date().getTime()})}]'::jsonb,
          last_update_timestamp = ${new Date().getTime()}
          WHERE discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"';
        `).catch(console.error)
      })
    }).catch(console.error)


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