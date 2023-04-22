const {db} = require('../db_connection')
const {event_emitter} = require('../event_emitter')
const JSONbig = require('json-bigint');

var as_users_list = {}

event_emitter.on('db_connected', () => {
    updateUsersList()
})

function updateUsersList() {
    console.log('[as_users_list.updateUsersList] called')
    db.query(`SELECT * FROM as_users_list`).then(res => {
        res.rows.forEach(row => {
            as_users_list[row.user_id] = row
        })
        console.log('[as_users_list.updateUsersList] finished')
    }).catch(console.error)
}

function updateUser(user_id) {
    console.log('[as_users_list.updateUser] called')
    db.query(`SELECT * FROM as_users_list WHERE user_id = ${user_id}`).then(res => {
        res.rows.forEach(row => {
            as_users_list[row.user_id] = row
        })
        console.log('[as_users_list.updateUser] finished')
    }).catch(console.error)
}

function getAsUserByDiscordId(discord_id) {
    return Object.values(as_users_list).filter(user => user.discord_id == discord_id)?.[0]
}

db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
    if (['as_users_list_insert','as_users_list_update'].includes(notification.channel)) {
        updateUser(payload.user_id)
    }
})

module.exports = {
    as_users_list,
    getAsUserByDiscordId
}