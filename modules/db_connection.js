const DB = require('pg');

const db = new DB.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

db.connect().then(async res => {
    console.log('DB Connection established.')
    db.query('LISTEN hubapp_messages_insert').catch(err => console.log(err))
}).catch(err => {
    console.log('DB Connection failure.\n' + err)
});

db.on('notification', notification => {
    console.log('db notification')
})

db.on('error', err => {
    console.log('=============== DB Connection error. ==============')
    console.log(err)
})

module.exports = {db};