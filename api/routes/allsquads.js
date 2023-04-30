const { db } = require("../../modules/db_connection");
const express = require('express');
const router = new express.Router();
const { request } = require('undici');
const { generateVerificationId } = require('../../modules/functions')

router.get('/discordOAuth2/authorize', async (req, res) => {
    if (!req.query.state || !req.query.code) {
        return res.send({
            code: 400,
            message: 'Bad parameters'
        })
    }
    const login_token = req.query.state.split('_')[0]
    const origin = req.query.state.split('_')[1]
    console.log('origin', origin)
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
                UPDATE as_users_list SET login_token = '${login_token}' WHERE discord_id = '${userData.id}';
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

router.get('/verification', async (req, res) => {
    if (!req.query.redirect || !req.query.discord_id) {
        return res.send({
            code: 400,
            message: 'Bad parameters'
        })
    }
    const id = generateVerificationId()
    db.query(`INSERT INTO tradebot_users_unverified (id, discord_id) VALUES ('${id}','${req.query.discord_id}')`)
        .then(db_res => {
            if (db_res.rowCount == 1) {
                res.redirect(`${req.query.redirect}verification?code=${id}`)
            }
        }).catch(console.error)
})

router.get('/authenticate', async (req, res) => {
    if (!req.query.login_token) {
        return res.send({
            code: 400,
            message: 'Invalid token provided'
        })
    }
    db.query(`
      SELECT * FROM as_users_list WHERE login_token = '${req.query.login_token}';
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

module.exports = router