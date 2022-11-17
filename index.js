const express = require('express');
const app = express();
const path = require('path')
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const {db} = require('./modules/db_connection')
const axios = require('axios')
const { request } = require('undici');
const uuid = require('uuid');
const JSONbig = require('json-bigint');
const {convertUpper, dynamicSort, dynamicSortDesc} = require('./modules/functions')
const db_modules = require('./modules/db_modules')
const cors = require('cors')
const bodyParser = require('body-parser')
const crypto = require('crypto')

app.use(cors())
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json())

app.use(express.static(path.join(__dirname, 'frontend/build')))

/*
app.use(function (req, res, next) {
  console.log('[app.use]',req.headers)
  //console.log(req.headers)
  //console.log(req.body)
  const allowedOrigins = ['http://localhost:3000','http://localhost:3001', 'https://gauss-prime-api.up.railway.app/'];
  // Website you wish to allow to connectconst origin = req.headers.origin;
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  if (!origin) return next()

  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)  
  res.setHeader('Access-Control-Allow-Credentials', true);  

  // Pass to next layer of middleware
  next();
});
*/

const patreon = require('patreon')
const patreonAPI = patreon.patreon
const patreonOAuthClient = patreon.oauth(process.env.PATREON_CLIENT_ID, process.env.PATREON_CLIENT_SECRET)
app.get('/patreon/oauth', (req,res) => {
  console.log('[/patreon/oauth] called')

  const oauthGrantCode = req.query.code
  const discord_id = req.query.state
  if (!oauthGrantCode || !discord_id) return res.status(400).send('Invalid request')

  console.log('[/patreon/oauth] oauthGrantCode:',oauthGrantCode,'discord_id:',discord_id)

  patreonOAuthClient.getTokens(oauthGrantCode, 'https://gauss-prime-api.up.railway.app/patreon/oauth')
  .then(function(tokensResponse) {
    const patreonAPIClient = patreonAPI(tokensResponse.access_token)
    patreonAPIClient('/current_user').then(patreon_user => {
      const patreon_id = patreon_user.rawJson.data.id
      db.query(`UPDATE tradebot_users_list SET patreon_id=${patreon_id} WHERE discord_id = ${discord_id}`)
      .then(db_res => {
        if (db_res.rowCount == 1) return res.redirect('https://www.patreon.com/join/user?u=82800386')
        else if (db_res.rowCount == 0) return res.status(400).send('ERROR: Could not find your Discord ID in DB')
        else return res.status(500).send('INTERNAL ERROR: Unexpected DB response')
      }).catch(err => {
        console.error(err)
        return res.status(500).send('INTERNAL ERROR: DB error occured')
      })
    }).catch((err) => {
      console.error(err)
      return res.status(500).send('INTERNAL ERROR: Patreon API error occured while getting user profile')
    })
  }).catch((err) => {
    console.error(err)
    return res.status(500).send('INTERNAL ERROR: Patreon API error occured while getting oauth token')
  })
})

app.get('/warframehub/purchase/*', (req,res) => {
  const discord_id = req.query.discord_id
  console.log(discord_id)
  if (!discord_id) return res.status(400).send('discord id not provided')
  res.append('Set-Cookie', 'discord_id=' + discord_id)
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'))
})

app.post('/warframehub/purchase/vip/submit', (req,res) => {
  console.log('[/warframehub/purchase/vip/submit] called')
  const discord_id = req.body.discord_id
  const transaction = req.body.transaction
  if (!discord_id) return res.status(400).send(`discord_id not provided\nPlease contact an Administrator @ WarframeHub with your transaction id: ${transaction.id}`)
  if (!transaction) return res.status(400).send(`transaction object not provided\nPlease contact an Administrator @ WarframeHub with your transaction id: ${transaction.id}`)
  console.log('[/warframehub/purchase/vip/submit]',JSON.stringify(transaction))
  db.query(`
    INSERT INTO wfhub_payment_receipts
    (discord_id,status,amount,currency,receipt_id,type,details,timestamp)
    VALUES
    (${discord_id},'${transaction.purchase_units[0].payments.captures[0].status}',${transaction.purchase_units[0].payments.captures[0].amount.value},'${transaction.purchase_units[0].payments.captures[0].amount.currency_code}','${transaction.purchase_units[0].payments.captures[0].id}','hub_vip_purchase','${JSON.stringify(transaction)}',${new Date().getTime()})
  `).then(dbres => {
    if (dbres.rowCount == 1) return res.status(200).send('successful')
    else return res.status(500).send(`Unexpected DB response\nPlease contact an Administrator @ WarframeHub with your transaction id: ${transaction.id}`)
  }).catch(err => {
    console.log(err)
    return res.status(500).send(`${JSON.stringify(err)}\nPlease contact an Administrator @ WarframeHub with your transaction id: ${transaction.id}`)
  })
})

app.post('/patreon/webhook', (req, res, next) => {
    console.log('[/patreon/webhook] header verification')
    const hash = req.header("x-patreon-signature");
    const crypted = crypto.createHmac("md5", process.env.PATREON_WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest("hex")
    if(crypto.timingSafeEqual(
      Buffer.from(crypted),
      Buffer.from(hash.padEnd(crypted.length))
    )) return next()
    else return res.status(400).send("Invalid Patreon hash");
  }, (req,res) => {
    console.log('[/patreon/webhook] body:',JSON.stringify(req.body))
    res.status(200).send('received');
});

app.post('/paypal/webhook', (req, res) => {
  console.log('[/patreon/webhook] called')
  console.log('[/patreon/webhook] headers',JSON.stringify(req.headers))
  console.log('[/patreon/webhook] body',JSON.stringify(req.body))
  res.status(200).send('received');
});

app.post('/payments/hubvip', (req,res) => {
  console.log('[/payments/hubvip] ',req.body)
  if (req.body.sandbox) {
    createPaymentHubVIPSandbox(req.body.token,req.body.discord_id).then(payment => {
      console.log(payment)
      res.send({
        code: 200,
        status: 'OK'
      })
    }).catch(err => {
      console.log(err)
      res.send({
        code: 500,
        status: 'ERROR'
      })
    })
  } else {
    createPaymentHubVIP(req.body.token,req.body.discord_id).then(payment => {
      console.log(payment)
      res.send({
        code: 200,
        status: 'OK'
      })
    }).catch(err => {
      console.log(err)
      res.send({
        code: 500,
        status: 'ERROR'
      })
    })
  }
})

app.get('/', (req, res) => {
  res.send('Hello, this is the API for Gauss Prime. Nothing fancy to show on the web-page');
});

app.get('/items/fetch', (req, res) => {
  db.query(`SELECT * FROM items_list`).then(items_list => {
    res.send(items_list.rows);
  }).catch(console.error)
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
        VALUES (${userData.id},'${userData.username}','${userData.discriminator}','${userData.email}',${userData.verified},'${userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`:`https://cdn.discordapp.com/attachments/912395290701602866/1019972287975407626/adaptive-icon.png`}','${uuid.v1().split('-')[0]}', '${session_key}',${new Date().getTime()})
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
    console.log('connected clients',new Date(),Object.keys(clients).length)

    // check if user was previously logged in
    setTimeout(() => {
      checkUserLogin(socket.handshake.query.session_key)
    }, 500);

    socket.on('disconnect', () => {
      console.log('a user disconnected');
      delete clients[socket.id]
      console.log('connected clients',new Date(),Object.keys(clients).length)
      socket.removeAllListeners()
    });

    socket.addListener("hubapp/getPublicChat", (data) => {
      console.log('[Endpoint log] hubapp/getPublicChat called')
      db.query(`
        SELECT trade_active, last_trading_session, 
        jsonb_path_query_array(
          messages, 
          '$[$.size() - ${data.end_limit} to $.size() - ${data.start_limit}]'
        ) messages
        FROM hubapp_messages_channels WHERE discord_ids @> '"ALL"';

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
        SELECT trade_active, last_trading_session, trade_receipt_id, trade_type,
        jsonb_path_query_array(
          messages, 
          '$[$.size() - ${data.end_limit} to $.size() - ${data.start_limit}]'
        ) messages
        FROM hubapp_messages_channels WHERE discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"';
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
              attachments: message.attachments || [],
              timestamp: message.timestamp
            })
          })
          socket.emit('hubapp/receivedPrivateChat', {
              code: 200,
              response: {
                trade_active: channel.trade_active,
                last_trading_session: channel.last_trading_session,
                trade_receipt_id: channel.trade_receipt_id,
                trade_type: channel.trade_type,
                chat_arr : arr
              }
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
              avatar: user_data[target_discord_id].discord_avatar,
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
        WHERE discord_ids @> '"${data.discord_id_1}"' AND discord_ids @> '"${data.discord_id_2}"'
        RETURNING *;`
      ).then(res => {
        if (res.rowCount == 1) {
          const channel = res.rows[0]
          if (channel.trade_active) {
            db.query(`
              UPDATE tradebot_filled_users_orders
              SET messages_log = messages_log || '[${JSON.stringify({message: data.message.replace(/\'/g,`''`), discord_id: data.discord_id_1, platform: 'hubapp',timestamp: new Date().getTime()})}]'::jsonb
              WHERE archived = false AND (order_owner = ${data.discord_id_1} OR order_filler = ${data.discord_id_1}) AND (order_owner = ${data.discord_id_2} OR order_filler = ${data.discord_id_2});
            `).catch(console.error)
          }
        }
      })
      .catch(console.error)
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
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.visibility=true
        ORDER BY tradebot_users_orders.update_timestamp;
        SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
        lich_list.weapon_url as item_url, lich_list.icon_url, lich_list.lich_id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN lich_list ON
        tradebot_users_orders.item_id = lich_list.lich_id
        WHERE tradebot_users_orders.visibility=true
        ORDER BY tradebot_users_orders.update_timestamp;
      `).then(res => {
        const trades = {
          itemTrades: res[0].rows,
          lichTrades: res[1].rows,
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

    socket.addListener("hubapp/trades/openTrade", (data) => {
      console.log('[Endpoint log] hubapp/trades/openTrade called',data)
      db.query(`
        SELECT * FROM tradebot_users_orders WHERE discord_id = ${data.target_discord_id} AND item_id = '${data.item_id}'
      `).then(res => {
        if (res.rowCount != 1) {console.log('zero rows returned');return}
        const order_data = res.rows[0]
        db.query(`
          INSERT INTO tradebot_filled_users_orders
          (order_id,receipt_id,filler_channel_id,owner_channel_id,order_owner,order_filler,item_id,order_type,order_rating,user_price,order_data,item_type,trade_timestamp)
          VALUES ('${order_data.order_id}','${uuid.v1()}',${order_data.origin_channel_id},${order_data.origin_channel_id},${order_data.discord_id},${data.current_discord_id},'${order_data.item_id}','${order_data.order_type}','{"${order_data.discord_id}": 0, "${data.current_discord_id}": 0}',${order_data.user_price},'${JSON.stringify(order_data.order_data)}','${order_data.item_type}',${new Date().getTime()})
        `).catch(console.error)
      }).catch(console.error)
    });

    socket.addListener("hubapp/trades/closeTradeSession", (data) => {
      console.log('[Endpoint log] hubapp/trades/closeTradeSession called',data)

      const q_filledOrderTable = data.trade_type == 'item_trade' ? 'tradebot_filled_users_orders':'tradebot_filled_users_lich_orders'
      const q_return = data.trade_type == 'item_trade' ? 'order_owner,order_filler,item_id,order_rating,order_type,user_price,order_status,trade_timestamp':'order_owner,order_filler,lich_id,element,damage,ephemera,lich_name,order_rating,order_type,user_price,order_status,trade_timestamp'
      const suspicious = data.trade_type == 'lich_trade' && order_data.user_price > 1000 ? true:false

      db.query(`
          SELECT * FROM ${q_filledOrderTable} WHERE receipt_id = '${data.trade_receipt_id}' AND archived = false
      `).then(res => {
        if (res.rowCount == 1) {
          const order_data = res.rows[0]
          if (data.status == 'successful' && !suspicious) {
              db.query(`
                UPDATE ${q_filledOrderTable} SET order_status = 'successful', order_rating = jsonb_set(order_rating,'{${order_data.order_owner}}', '5', true), archived = true
                WHERE receipt_id = '${data.trade_receipt_id}';
                UPDATE ${q_filledOrderTable} SET order_rating = jsonb_set(order_rating,'{${order_data.order_filler}}', '5', true), archived = true
                WHERE receipt_id = '${data.trade_receipt_id}'
                RETURNING ${q_return};
              `).then(async res => {
                  if (res[1].rowCount == 1) {
                      db.query(`
                          UPDATE tradebot_users_list
                          SET orders_history = jsonb_set(orders_history, '{payload,999999}', '${JSON.stringify(res[1].rows[0])}', true)
                          WHERE discord_id = ${(order_data.order_owner)} OR discord_id = ${(order_data.order_filler)}
                      `).then(res => {
                        //update plat balance for users
                        var q_ownerPlat = 'plat_gained'
                        var q_fillerPlat = 'plat_spent'
                        if (order_data.order_type == 'wtb') {
                            var q_ownerPlat = 'plat_spent'
                            var q_fillerPlat = 'plat_gained'
                        }
                        db.query(`
                          UPDATE tradebot_users_list SET ${q_ownerPlat} = ${q_ownerPlat} + ${Number(order_data.user_price)}
                          WHERE discord_id = ${(order_data.order_owner)};
                          UPDATE tradebot_users_list SET ${q_fillerPlat} = ${q_fillerPlat} + ${Number(order_data.user_price)}
                          WHERE discord_id = ${(order_data.order_filler)};
                        `).then(res => console.log(`updated plat balance for seller and buyer`)).catch(console.error)
                        //remove order from owner profile
                        db.query(`DELETE FROM ${data.trade_type == 'item_trade' ? 'tradebot_users_orders':'tradebot_filled_users_lich_orders'} WHERE discord_id = ${order_data.order_owner} AND ${data.trade_type == 'item_trade' ? 'item_id':'lich_id'} = '${data.trade_type == 'item_trade' ? order_data.item_id:order_data.lich_id}'`).then(res => console.log(`deleted order ${order_data.item_id} for ${order_data.order_owner}`)).catch(console.error)
                        //-------
                      }).catch(console.error)
                  } else {
                    console.log('res[1].rowCount = ', res[1].rowCount)
                  }
              }).catch(console.error)
          } else if (data.status == 'report' || suspicious) {
              db.query(`
                UPDATE ${q_filledOrderTable} SET reporter_id = ${suspicious ? null:data.discord_id_1}, suspicious = ${suspicious}, archived = true
                WHERE receipt_id = '${data.trade_receipt_id}'
              `).catch(console.error)
          }
        }
      }).catch(console.error)
    });

    socket.addListener("hubapp/trades/addNewItem", (data) => {
      console.log('[Endpoint log] hubapp/trades/addNewItem called',data)


      var price = data.user_price
      var list_low = data.auto_price
      var isMaxed = data.rank == 'maxed' ? true:false

      if (!Number(price)) {
        list_low = true
        price = null
      } else if (price < 0) {
        socket.emit('hubapp/trades/addNewItem', {
          code: 400,
          response: `Price cannot be negative`
        })
        return
      }

      //---------------
      var d_item_url = data.item_name.toLowerCase().replace(/ /g, '_')
      d_item_url = d_item_url.replace(/_p$/,'_prime').replace('_p_','_prime_').replace(/_bp$/,'_blueprint')
      if (d_item_url.match('lith') || d_item_url.match('meso') || d_item_url.match('neo') || d_item_url.match('axi'))
          if (!d_item_url.match('_relic'))
              d_item_url += '_relic'
      console.log('Retrieving Database -> items_list')
      db.query(`SELECT * FROM items_list`)
      .then(async res => {
          var arrItems = []
          var items_list = res.rows

          for (var i=0; i<items_list.length; i++) {
              var element = items_list[i]
              if (element.item_url.match('^' + d_item_url + '\W*')) {
                  if ((new Date().getTime() - items_list[i].update_timestamp) > 86400000) {
                      console.log(`updating item ${items_list[i].item_url} in db`)
                      var status = await db_modules.updateDatabaseItem(items_list,items_list[i])
                      .then(items_list => {
                          for (var j=0; j<items_list.length; j++) {
                              if (items_list[j].id == items_list[i].id) {
                                  items_list[i] = items_list[j]
                                  element = items_list[j]
                                  break
                              }
                          }
                          return true
                      })
                      .catch(() => {
                          console.log("Error updating DB.")
                          
                          socket.emit('hubapp/trades/addNewItem', {
                            code: 500,
                            response: "☠️ Some error occured updating item in db.\nError code:\nContact MrSofty#7926 ☠️"
                          })
                          return false
                      })
                      if (!status)      
                          return
                  }
                  if (element.tags.includes("set")) {
                      arrItems = []
                      arrItems.push(element);
                      break
                  }
                  arrItems.push(element);
              }
          }
          if (arrItems.length==0) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 400,
              response: "⚠️ Item **" + d_item_url + "** either does not exist or is an unsupported item at the moment. ⚠️"
            })
            return
          }
          if (arrItems.length > 1) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 400,
              response: "⚠️ More than one search results detected for the item **" + d_item_url + "**, cannot process this request. Please provide a valid item name ⚠️"
            })
            return
          }
          const item_url = arrItems[0].item_url
          const item_id = arrItems[0].id
          if (!arrItems[0].rank && isMaxed) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 400,
              response: "⚠️ Item **" + d_item_url + "**, does not have a rank ⚠️"
            })
            return
          }
          var item_rank = 'unranked'
          if (isMaxed)
              item_rank = 'maxed'
          const item_name = convertUpper(item_url)
          if (price) {
              if (price != 0) {
                  var open_trade = false
                  var target_order_type = null
                  var tradee = {}
                  tradee.discord_id = data.discord_id
                  var trader = {}
                  trader.discord_id = null
                  trader.ingame_name = null
                  var all_orders = null
                      //----check if wts price is lower than active buy order
                      var status = await db.query(`
                      SELECT * FROM tradebot_users_orders 
                      JOIN tradebot_users_list ON tradebot_users_list.discord_id = tradebot_users_orders.discord_id
                      JOIN items_list ON tradebot_users_orders.item_id = items_list.id
                      WHERE tradebot_users_orders.item_id = '${item_id}' AND tradebot_users_orders.visibility = true AND tradebot_users_orders.order_type = 'wtb'
                      ORDER BY tradebot_users_orders.user_price ${data.order_type == 'wts' ? 'DESC':'ASC'}, tradebot_users_orders.update_timestamp`)
                      .then(res => {
                        if (res.rows.length > 0)
                          all_orders = res.rows
                        return true
                      }).catch(err => {
                          console.log(err)
                          return false
                      })
                      if (!status) {
                        socket.emit('hubapp/trades/addNewItem', {
                          code: 400,
                          response: "☠️ Something went wrong retreiving buy orders\nError code: 502 ☠️"
                        })
                        return
                      }
                      if (all_orders) {
                        if (data.order_type == 'wts') {
                          if (price <= all_orders[0].user_price) {
                            open_trade = true
                            target_order_type = 'wtb'
                            trader.discord_id = all_orders[0].discord_id
                          }
                        } else if (data.order_type == 'wtb') {
                          if (price >= all_orders[0].user_price) {
                              open_trade = true
                              target_order_type = 'wts'
                              trader.discord_id = all_orders[0].discord_id
                          }
                        }
                      }
                  if (open_trade) {
                    if (trader.discord_id != tradee.discord_id) {
                        db.query(`
                          INSERT INTO tradebot_filled_users_orders
                          (order_id,receipt_id,filler_channel_id,owner_channel_id,order_owner,order_filler,item_id,order_type,order_rating,user_price,order_data,item_type,trade_timestamp)
                          VALUES ('${all_orders[0].order_id}','${uuid.v1()}',${all_orders[0].origin_channel_id},${all_orders[0].origin_channel_id},${all_orders[0].discord_id},${data.discord_id},'${all_orders[0].item_id}','${all_orders[0].order_type}','{"${all_orders[0].discord_id}": 0, "${data.discord_id}": 0}',${all_orders[0].user_price},'${JSON.stringify(all_orders[0].order_data)}','item',${new Date().getTime()})
                        `).catch(err => {
                            console.log(err)
                            socket.emit('hubapp/trades/addNewItem', {
                              code: 500,
                              response: `☠️ Error adding filled order in db.\nError code: 504\nPlease contact MrSofty#7926 ☠️`
                            })
                        })
                        return
                    }
                  }
              }
          }
          if (list_low) {
              var status = await db.query(`SELECT * FROM tradebot_users_orders WHERE item_id = '${item_id}' AND visibility = true AND order_type = '${data.order_type}'`)
              .then(res => {
                  var all_orders = res.rows
                  if (res.rows.length > 0) {
                      if (data.order_type == 'wts')
                          all_orders = all_orders.sort(dynamicSort("user_price"))
                      else if (data.order_type == 'wtb')
                          all_orders = all_orders.sort(dynamicSortDesc("user_price"))
                      price = all_orders[0].user_price
                      console.log(all_orders)
                      console.log('auto price is ' + price)
                  }
                  return true
              }).catch(err => {
                  console.log(err)
                  return false
              })
              if (!status) {
                socket.emit('hubapp/trades/addNewItem', {
                  code: 500,
                  response: "☠️ Something went wrong retreiving item lowest price\nError code: 500\nContact MrSofty#7926 ☠️"
                })
                return
              }
          }
          var avg_price = null
          status = await db.query(`SELECT * from items_list WHERE id = '${item_id}'`)
          .then(async res => {
              if (data.order_type == 'wts' && item_rank == 'unranked')
                  if (res.rows[0].sell_price) 
                      avg_price = Math.round(Number(res.rows[0].sell_price))
              if (data.order_type == 'wtb' && item_rank == 'unranked')
                  if (res.rows[0].buy_price)
                      avg_price = Math.round(Number(res.rows[0].buy_price))
              if (data.order_type == 'wts' && item_rank == 'maxed') 
                  if (res.rows[0].maxed_sell_price) 
                      avg_price = Math.round(Number(res.rows[0].maxed_sell_price))
              if (data.order_type == 'wtb' && item_rank == 'maxed')
                  if (res.rows[0].maxed_buy_price)
                      avg_price = Math.round(Number(res.rows[0].maxed_buy_price))
              return true
          }).catch(err => {
              console.log(err)
              return false
          })
          if (!status) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 500,
              response: "☠️ Something went wrong retreiving item avg price\nError code: 500\nContact MrSofty#7926 ☠️"
            })
              return
          }
          if (avg_price == null || avg_price == "null") {
            socket.emit('hubapp/trades/addNewItem', {
              code: 500,
              response: "☠️ Something went wrong retreiving item avg price\nError code: 501\nContact MrSofty#7926 ☠️"
            })
              return
          }
          if (!price) {
              price = avg_price
          }
          if (price > (avg_price*1.2)) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 400,
              response: `⚠️ Your price is a lot **greater than** the average **${data.order_type.replace('wts','sell').replace('wtb','buy')}** price of **${avg_price}** for **${item_name}** ⚠️\nTry lowering it`
            })
              return
          }
          else if (price < (avg_price*0.8)) {
            socket.emit('hubapp/trades/addNewItem', {
              code: 400,
              response: `⚠️ Your price is a lot **lower than** the average **${data.order_type.replace('wts','sell').replace('wtb','buy')}** price of **${avg_price}** for **${item_name}** ⚠️\nTry increasing it`
            })
              return
          }
          db.query(`
              INSERT INTO tradebot_users_orders 
              (order_id,discord_id,item_id,order_type,item_type,user_price,order_data,visibility,platform,update_timestamp,creation_timestamp) 
              VALUES ('${uuid.v1()}',${data.discord_id},'${item_id}','${data.order_type}','item',${price},'${JSON.stringify({rank: item_rank})}',true,'hubapp',${new Date().getTime()},${new Date().getTime()})
              ON CONFLICT (discord_id,item_id) 
              DO UPDATE SET 
              order_type = EXCLUDED.order_type, 
              item_type = EXCLUDED.item_type, 
              user_price = EXCLUDED.user_price, 
              order_data = EXCLUDED.order_data, 
              visibility = EXCLUDED.visibility, 
              origin_channel_id = EXCLUDED.origin_channel_id, 
              origin_guild_id = EXCLUDED.origin_guild_id, 
              platform = EXCLUDED.platform,
              update_timestamp = EXCLUDED.update_timestamp;
          `).then(async res => {
            socket.emit('hubapp/trades/addNewItem', {
              code: 200,
              response: `${convertUpper(item_url)} order has been updated`
            })
          }).catch(err => {
            console.log(err)
            socket.emit('hubapp/trades/addNewItem', {
              code: 500,
              response: `[DB Error] ${JSON.stringify(err)}`
            })
          })
      }).catch(err => {
        console.log(err)
        socket.emit('hubapp/trades/addNewItem', {
          code: 500,
          response: `[DB Error] ${JSON.stringify(err)}`
        })
      })
    });

    socket.addListener("hubapp/trades/removeItem", (data) => {
      console.log('[Endpoint log] hubapp/trades/removeItem called',data)
      db.query(`DELETE FROM tradebot_users_orders WHERE discord_id = ${data.discord_id} AND item_id = '${data.item_id}'`).catch(console.error)
    });

    socket.addListener("hubapp/trades/activateAll", (data) => {
      console.log('[Endpoint log] hubapp/trades/activateAll called',data)
      db.query(`UPDATE tradebot_users_orders SET visibility = true WHERE discord_id = ${data.discord_id}`).catch(console.error)
    });

    socket.addListener("hubapp/trades/closeAll", (data) => {
      console.log('[Endpoint log] hubapp/trades/closeAll called',data)
      db.query(`UPDATE tradebot_users_orders SET visibility = false WHERE discord_id = ${data.discord_id}`).catch(console.error)
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
      if (payload.new_last_message && payload.old_last_message) {
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
                    trade_active: payload.trade_active,
                    last_trading_session: payload.last_trading_session,
                    trade_receipt_id: payload.trade_receipt_id,
                    trade_type: payload.trade_type,
                    chat: {
                      discord_id: message.discord_id,
                      discord_username: user_data[message.discord_id].discord_username,
                      ign: user_data[message.discord_id].forums_username,
                      avatar: user_data[message.discord_id].discord_avatar,
                      message: message.message,
                      channel: payload.discord_ids,
                      timestamp: message.timestamp
                    }
                  }
                })
              }
            }
            
          }).catch(console.error)
        }
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

  if (notification.channel == 'tradebot_filled_users_orders_insert') {
    db.query(
      payload.item_type == 'item' ? 
      `SELECT * FROM items_list WHERE id='${payload.item_id}'`
      : payload.item_type == 'lich' ? 
      `SELECT * FROM lich_list WHERE lich_id='${payload.item_id}'`
      : ''
      ).then(res => {
      const item_data = res.rows[0]
      db.query(`SELECT * FROM tradebot_users_list WHERE discord_id = ${payload.order_owner} OR discord_id = ${payload.order_filler};`)
      .then(res => {
        const user_data = {}
        res.rows.forEach(row => user_data[row.discord_id] = row)
        db.query(`
          INSERT INTO hubapp_messages_channels (discord_ids,last_read_message) SELECT '${JSON.stringify([payload.order_owner,payload.order_filler])}','{"${payload.order_owner}":${new Date().getTime()},"${payload.order_filler}":${new Date().getTime()}}'
          WHERE NOT EXISTS(SELECT * FROM hubapp_messages_channels where discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"');
          UPDATE hubapp_messages_channels
          SET trade_active = true,
          last_trading_session = ${new Date().getTime()},
          trade_receipt_id = '${payload.receipt_id}',
          trade_type = 'item_trade',
          messages = messages || '[${JSON.stringify({message: `A trade has been opened!
          
${convertUpper(payload.item_type == 'item' ? item_data.item_url: payload.item_type == 'lich' ? item_data.weapon_url : '')}

${payload.order_type == 'wts' ? 
`Seller: ${user_data[payload.order_owner].ingame_name}
Buyer: ${user_data[payload.order_filler].ingame_name}
`:
`Seller: ${user_data[payload.order_filler].ingame_name}
Buyer: ${user_data[payload.order_owner].ingame_name}
`}
Price: ${payload.user_price}p

This trading session will be auto-closed in 15 minutes`, attachments: payload.item_type == 'lich' ? [payload.order_data.lich_image_url] : [], discord_id: '111111111111111111', timestamp: new Date().getTime()})}]'::jsonb,
          last_update_timestamp = ${new Date().getTime()}
          WHERE discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"';
        `).catch(console.error)
      }).catch(console.error)
    }).catch(console.error)
    setTimeout(() => {
      db.query(`UPDATE tradebot_filled_users_orders SET archived = true WHERE receipt_id='${payload.receipt_id}';`).catch(console.error)
    }, 900000);
  }

  if (notification.channel == 'tradebot_users_orders_insert') {
    db.query(
      payload.item_type == 'item' ?
      `SELECT
      tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
      tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
      items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
      FROM tradebot_users_orders
      JOIN tradebot_users_list ON
      tradebot_users_orders.discord_id = tradebot_users_list.discord_id
      JOIN items_list ON
      tradebot_users_orders.item_id = items_list.id
      WHERE tradebot_users_orders.order_id='${payload.order_id}' AND tradebot_users_orders.visibility=TRUE`
      : payload.item_type == 'lich' ? 
      `SELECT
      tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
      tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
      lich_list.weapon_url as item_url, lich_list.icon_url, lich_list.lich_id as item_id
      FROM tradebot_users_orders
      JOIN tradebot_users_list ON
      tradebot_users_orders.discord_id = tradebot_users_list.discord_id
      JOIN lich_list ON
      tradebot_users_orders.item_id = lich_list.lich_id
      WHERE tradebot_users_orders.order_id='${payload.order_id}' AND tradebot_users_orders.visibility=TRUE`
      : ''
    ).then(res => {
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
      db.query(
        payload[0].item_type == 'item' ? 
        `SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.order_id='${payload[0].order_id}' AND tradebot_users_orders.visibility=TRUE`
        : payload[0].item_type == 'lich' ? 
        `SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
        lich_list.weapon_url as item_url, lich_list.icon_url, lich_list.lich_id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN lich_list ON
        tradebot_users_orders.item_id = lich_list.lich_id
        WHERE tradebot_users_orders.order_id='${payload[0].order_id}' AND tradebot_users_orders.visibility=TRUE`
        : ''
        ).then(res => {
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
      db.query(
        payload[0].item_type == 'item' ? 
        `SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility,
        items_list.item_url, items_list.tags, items_list.vault_status, items_list.icon_url, items_list.id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN items_list ON
        tradebot_users_orders.item_id = items_list.id
        WHERE tradebot_users_orders.order_id='${payload[0].order_id}' AND tradebot_users_orders.visibility=TRUE`
        : payload[0].item_type == 'lich' ? 
        `SELECT
        tradebot_users_list.discord_id, tradebot_users_list.ingame_name,
        tradebot_users_orders.order_type, tradebot_users_orders.item_type, tradebot_users_orders.user_price, tradebot_users_orders.order_data, tradebot_users_orders.update_timestamp, tradebot_users_orders.visibility, 
        lich_list.weapon_url as item_url, lich_list.icon_url, lich_list.lich_id as item_id
        FROM tradebot_users_orders
        JOIN tradebot_users_list ON
        tradebot_users_orders.discord_id = tradebot_users_list.discord_id
        JOIN lich_list ON
        tradebot_users_orders.item_id = lich_list.lich_id
        WHERE tradebot_users_orders.order_id='${payload[0].order_id}' AND tradebot_users_orders.visibility=TRUE`
        : ''
        ).then(res => {
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
  
  if (notification.channel == 'tradebot_filled_users_orders_update_new_message') {
    if (payload.message.platform == 'discord') {
      db.query(`
        UPDATE hubapp_messages_channels
        SET messages = messages || '[${JSON.stringify({message: payload.message.message.replace(/\'/g,`''`), discord_id: payload.message.discord_id, timestamp: payload.message.timestamp})}]'::jsonb,
        last_update_timestamp = ${new Date().getTime()}
        WHERE discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"';
      `).catch(console.error)
    }
  }
  if (notification.channel == 'tradebot_filled_users_orders_update_archived') {
    db.query(`
      UPDATE hubapp_messages_channels
      SET trade_active = false,
      trade_receipt_id = null,
      trade_type = null,
      messages = messages || '[${JSON.stringify({message: `This trading session has been closed`, discord_id: '111111111111111111', timestamp: new Date().getTime()})}]'::jsonb,
      last_update_timestamp = ${new Date().getTime()}
      WHERE discord_ids @> '"${payload.order_owner}"' AND discord_ids @> '"${payload.order_filler}"';
    `).catch(console.error)
  }
})

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});


function calculateSignaturePatreon() {
  return 
}