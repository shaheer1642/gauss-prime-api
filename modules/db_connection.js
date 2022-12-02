const DB = require('pg');
const {event_emitter} = require('./event_emitter')

const db = new DB.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    keepAlive: true
})

db.connect().then(async res => {
    console.log('DB Connection established.')
    event_emitter.emit('db_connected')
    // Listening to triggers
    db.query(`
        LISTEN hubapp_messages_insert;

        LISTEN hubapp_users_update;

        LISTEN hub_recruitbot_squads_insert;
        LISTEN hub_recruitbot_squads_update;
        LISTEN hub_recruitbot_squads_delete;

        LISTEN tradebot_users_orders_insert;
        LISTEN tradebot_users_orders_update;
        LISTEN tradebot_users_orders_delete;

        LISTEN tradebot_filled_users_orders_insert;
        LISTEN tradebot_filled_users_orders_update_new_message;
        LISTEN tradebot_filled_users_orders_update_archived;

        LISTEN hubapp_messages_channels_update;

        LISTEN rb_squads_insert;
        LISTEN rb_squads_update;

        LISTEN tradebot_users_list_insert;
        LISTEN tradebot_users_list_update;
        LISTEN tradebot_users_list_delete;

        LISTEN scheduled_queries_insert;

        LISTEN rb_squads_messages_insert;
    `).then(res => {
        db.query(`SELECT * FROM scheduled_queries`).then(res => {
            res.rows.forEach(row => {
                setTimeout(() => {
                    db.query(`
                        ${row.query}
                        DELETE FROM scheduled_queries WHERE id=${row.id};
                    `).catch(console.error)
                }, row.call_timestamp - new Date().getTime());
            })
        }).catch(console.error)
    }).catch(err => console.log(err))
}).catch(err => {
    console.log('DB Connection failure.\n' + err)
    process.exit()
});

db.on('error', err => {
    console.log('=============== DB Connection error. ==============',err)
    process.exit()
})


setInterval(() => {
    db.query(`SELECT * FROM items_list`).then(res => {
        console.log('Pinged the DB. Received rows:',res.rowCount)
    }).catch(console.error)
}, 900000);

module.exports = {db};