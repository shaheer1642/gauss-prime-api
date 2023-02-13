const express = require('express');
const app = express();
const path = require('path')
const http = require('http');
const server = http.createServer(app);
const {db} = require('../modules/db_connection')
const axios = require('axios')
const { request } = require('undici');
const uuid = require('uuid');
const cors = require('cors')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const {generateVerificationId} = require('../modules/functions')

app.use(cors())
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json())

app.use(express.static(path.join(__dirname, '../frontend/build')))

app.get('/api', (req, res) => {
    res.send('Hello, this is the API for Gauss Prime. Nothing fancy to show on the web-page');
});

app.get('/api/patreon/oauth', (req,res) => {
  console.log('[/patreon/oauth] called')


  const oauthGrantCode = req.query.code
  const discord_id = req.query.state
  if (!oauthGrantCode || !discord_id) return res.status(400).send('Invalid request')

  const redirect_uri = 'https://gauss-prime-api.up.railway.app/api/patreon/oauth'

  axios({
    method: 'post',
    url: `https://www.patreon.com/api/oauth2/token?code=${oauthGrantCode}&grant_type=authorization_code&client_id=${process.env.PATREON_CLIENT_ID}&client_secret=${process.env.PATREON_CLIENT_SECRET}&redirect_uri=${redirect_uri}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }).then(token_res => {
    const oAuthToken = token_res.data.access_token
    axios({
      method: 'get',
      url: `https://www.patreon.com/api/oauth2/v2/identity`,
      headers: {
        Authorization: 'Bearer ' + oAuthToken
      },
    }).then(patreon_user => {
      const patreon_id = patreon_user.data.data.id
      console.log('[/patreon/oauth] patreon_id',patreon_id)
      if (!patreon_id) return res.status(500).send('INTERNAL ERROR: Unable to get patreon_id')
      db.query(`UPDATE tradebot_users_list SET patreon_id=${patreon_id} WHERE discord_id = ${discord_id}`)
      .then(db_res => {
        if (db_res.rowCount == 1) return res.redirect('https://www.patreon.com/join/warframehub')
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

app.post('/api/patreon/webhook', (req, res, next) => {
  console.log('[/patreon/webhook] called')
  console.log('[/patreon/webhook] headers:',JSON.stringify(req.headers))
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
    const payment_obj = req.body
    const patreon_id = payment_obj.data.relationships.user.data.id
    const receipt_id = payment_obj.data.id
    db.query(`
      INSERT INTO wfhub_payment_receipts 
      (payer_id, receipt_id, platform, details, timestamp)
      VALUES
      (${patreon_id}, '${receipt_id}', 'patreon', '${JSON.stringify(payment_obj)}', ${new Date().getTime()})
    `).then(res => {
      const last_charge_status = payment_obj.data.attributes.last_charge_status
      if (last_charge_status.toLowerCase() != 'paid') return
      const currently_entitled_amount_cents = payment_obj.data.attributes.currently_entitled_amount_cents
      if (currently_entitled_amount_cents < 379) return
      const patron_status = payment_obj.data.attributes.patron_status
      if (patron_status.toLowerCase() != 'active_patron') return
      const last_charge_date = new Date(payment_obj.data.attributes.last_charge_date).getTime()
      const next_charge_date = new Date(payment_obj.data.attributes.next_charge_date).getTime()
      db.query(`UPDATE tradebot_users_list SET is_patron=true, patreon_join_timestamp=${last_charge_date}, patreon_expiry_timestamp=${next_charge_date} WHERE patreon_id=${patreon_id}`).catch(console.error)
    }).catch(console.error)
});

app.get('/api/items/fetch', (req, res) => {
  db.query(`SELECT * FROM items_list`).then(items_list => {
    res.send(items_list.rows);
  }).catch(console.error)
});

app.get('/api/discordOAuth2/authorize', async (req, res) => {
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
      redirect_uri: `${process.env.API_URL}api/discordOAuth2/authorize`,
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

app.get('/api/allsquads/discordOAuth2/authorize', async (req, res) => {
  if (!req.query.state) {
    res.send('<html><body><h1>login_token not found, please try again</h1></body></html>')
    return
  }
  if (!req.query.code) {
    res.send('<html><body><h1>Authorization code not found, please try again</h1></body></html>')
    return
  }
  const login_token = req.query.state.split('_')[0]
  const origin = req.query.state.split('_')[1]
  console.log('origin',origin)
  request('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.BOT_CLIENT_ID,
      client_secret: process.env.BOT_CLIENT_SECRET,
      code: req.query.code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.API_URL}api/allsquads/discordOAuth2/authorize`,
      scope: 'identify',
    }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }).then(async tokenResponseData => {
    const oauthData = await getJSONResponse(tokenResponseData.body);
    console.log(oauthData);
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
        UPDATE tradebot_users_list SET login_token = '${login_token}' WHERE discord_id = '${userData.id}';
      `).then(db_res => {
        if (db_res.rowCount == 1) {
          res.redirect(origin)
        } else {
          res.redirect(`/api/allsquads/verification?redirect=${origin}&discord_id=${userData.id}`)
        }
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

app.get('/api/allsquads/verification', async (req, res) => {
  if (!req.query.redirect || !req.query.discord_id) {
    res.send('<html><body><h1>Invalid query, please try again</h1></body></html>')
    return
  }
  const id = generateVerificationId()
  db.query(`INSERT INTO tradebot_users_unverified (id, discord_id) VALUES ('${id}','${req.query.discord_id}')`)
  .then(db_res => {
    if (db_res.rowCount == 1) {
      res.redirect(`${req.query.redirect}verification?code=${id}`)
    }
  }).catch(console.error)
})

app.get('/api/allsquads/authenticate', async (req, res) => {
  if (!req.query.login_token) {
    return res.send({
      code: 400,
      message: 'Invalid token provided'
    })
  }
  db.query(`
    SELECT * FROM tradebot_users_list WHERE login_token = '${req.query.login_token}';
  `).then(db_res => {
      if (db_res.rowCount == 1) {
          return res.send({
              code: 200,
              data: db_res.rows[0]
          })
      } else {
          return res.send({
              code: 400,
              message: 'Invalid token provided'
          })
      }
  }).catch(err => {
      console.log(err)
      return res.send({
          code: 500,
          message: err.stack
      })
  })
})

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'))
});

server.listen(process.env.PORT, () => {
  console.log('Server is listening to port',process.env.PORT);
});

module.exports = {
    server
}