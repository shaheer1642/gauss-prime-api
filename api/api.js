const express = require('express');
const api = express();
const path = require('path')
const {db} = require('../modules/db_connection')
const { request } = require('undici');
const uuid = require('uuid');
const cors = require('cors')
const bodyParser = require('body-parser')

api.use(cors())

api.use(bodyParser.urlencoded({extended: true}));
api.use(bodyParser.json())

api.use('/api/database',require('./routes/database'))
api.use('/api/patreon',require('./routes/patreon'))
api.use('/api/allsquads',require('./routes/allsquads'))
api.use('/api/wfrim',require('./routes/wfrim'))

api.get('/api', (req, res) => {
  res.send('Hello, this is the API for Gauss Prime. Nothing fancy to show on the web-page');
});

api.get('/api/discordOAuth2/authorize', async (req, res) => {
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

api.use(express.static(path.join(__dirname, '../frontend/build')))
api.get("*", (req, res) => res.sendFile(path.join(__dirname, '../frontend/build', 'index.html')));

module.exports = {
  api
}