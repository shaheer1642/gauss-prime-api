const DB = require('pg');

const db = new DB.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
})

db.connect().then(async res => {
    console.log('DB Connection established.')
}).catch(err => {
    console.log('DB Connection failure.\n' + err)
    process.exit(1)
});

db.on('notification', msg => {
    console.log('db notification')
    console.log(msg.payload)
})

db.on('error', err => {
    console.log('=============== DB Connection error. ==============')
    console.log(err)
})

module.exports = {db};