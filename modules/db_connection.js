const DB = require('pg');

const db = new DB.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    keepAlive: true
})

db.connect().then(async res => {
    console.log('DB Connection established.')

    // Listening to triggers
    db.query('LISTEN hubapp_messages_insert').catch(err => console.log(err))

    db.query('LISTEN hubapp_users_update').catch(err => console.log(err))

    db.query('LISTEN hub_recruitbot_squads_insert').catch(err => console.log(err))
    db.query('LISTEN hub_recruitbot_squads_update').catch(err => console.log(err))
    db.query('LISTEN hub_recruitbot_squads_delete').catch(err => console.log(err))
    
    db.query('LISTEN tradebot_users_orders_insert').catch(err => console.log(err))
    db.query('LISTEN tradebot_users_orders_update').catch(err => console.log(err))
    db.query('LISTEN tradebot_users_orders_delete').catch(err => console.log(err))

    db.query('LISTEN tradebot_filled_users_orders_insert').catch(err => console.log(err))
    db.query('LISTEN tradebot_filled_users_orders_update_new_message').catch(console.error)
    db.query('LISTEN tradebot_filled_users_orders_update_archived').catch(console.error)
    
    db.query('LISTEN hubapp_messages_channels_update').catch(err => console.log(err))

    db.query('LISTEN rb_squads_insert').catch(err => console.log(err))
    db.query('LISTEN rb_squads_update').catch(err => console.log(err))

    db.query('LISTEN tradebot_users_list_insert').catch(console.error)
    db.query('LISTEN tradebot_users_list_update').catch(console.error)
    db.query('LISTEN tradebot_users_list_delete').catch(console.error)

    db.query('LISTEN scheduled_queries_insert').catch(console.error)

    db.query('LISTEN rb_squads_messages_insert').catch(console.error)

    db.query(`SELECT * FROM scheduled_queries`).then(res => {
        res.rows.forEach(row => {
            setTimeout(() => {
                db.query(`
                ${row.query}
                DELETE FROM scheduled_queries WHERE id=${row.id};
                `).catch(console.error)
            }, row.call_timestamp - row.created_timestamp);
        })
    })
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