const {db} = require('../db_connection')
const {event_emitter} = require('../event_emitter')
const JSONbig = require('json-bigint');

var as_users_fcm_tokens = {}

event_emitter.on('db_connected', () => {
    updateUsersTokens()
})

function updateUsersTokens() {
    db.query(`SELECT * FROM as_push_notify`).then(res => {
        res.rows.forEach(row => {
            if (!as_users_fcm_tokens[row.discord_id]) as_users_fcm_tokens[row.discord_id] = []
            as_users_fcm_tokens[row.discord_id].push(row.fcm_token)
        })
    }).catch(console.error)
}

db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
    if (notification.channel == 'as_push_notify_insert') {
        if (!as_users_fcm_tokens[payload.discord_id]) as_users_fcm_tokens[payload.discord_id] = []
        as_users_fcm_tokens[payload.discord_id].push(payload.fcm_token)
    }
})

module.exports = {
    as_users_fcm_tokens
}