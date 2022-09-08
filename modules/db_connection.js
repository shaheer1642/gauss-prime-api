const DB = require('pg');

const db = new DB.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
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
    
    db.query('LISTEN hubapp_messages_channels_update').catch(err => console.log(err))
}).catch(err => {
    console.log('DB Connection failure.\n' + err)
});

db.on('error', err => {
    console.log('=============== DB Connection error. ==============')
    console.log(err)
})

module.exports = {db};