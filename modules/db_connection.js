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
}, 1800000);

module.exports = {db};