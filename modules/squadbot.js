const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc} = require('./functions')
const db_modules = require('./db_modules')
const {event_emitter} = require('./event_emitter')
const JSONbig = require('json-bigint');

const endpoints = {
    'squadbot/keywords/create': keywordsCreate,
    'squadbot/keywords/fetch': keywordsFetch,
    'squadbot/keywords/delete': keywordsDelete,
}

var host_keywords = []

event_emitter.on('db_connected', () => {
    db.query(`SELECT * FROM wfhub_keywords`)
    .then(res => {
        host_keywords = []
        res.rows.forEach(row => {
            host_keywords.push(row)
        })
    }).catch(console.error)
})


function keywordsCreate(data, callback) {
    console.log('[keywordsCreate] data:',data)
    if (!data.name) return callback({code: 400, message: 'No name provided'})
    if (!data.include) return callback({code: 400, message: 'No include provided'})
    db.query(`
        INSERT INTO wfhub_keywords (
            name,
            include
        ) VALUES (
            '${data.name.toLowerCase()}',
            ${data.include}
        )
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200,
                message: 'Success'
            })
        } else {
            return callback({
                code: 500,
                message: 'Unexpected error'
            })
        }
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.detail || err.stack
        })
    })
}

function keywordsFetch(data,callback) {
    console.log('[keywordsFetch] data:',data)
    db.query(`
        SELECT * FROM wfhub_keywords;
    `).then(res => {
        return callback({
            code: 200,
            data: res.rows
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function keywordsDelete(data,callback) {
    console.log('[keywordsDelete] data:',data)
    if (!data.id) {
        if (callback) callback({code: 400, message: 'No id provided'})
        return
    }
    db.query(`DELETE FROM wfhub_keywords WHERE id=${data.id}`)
    .then(res => {
        if (!callback) return
        if (res.rowCount == 0) {
            return callback({
                code: 500,
                message: 'Unexpected error'
            })
        } else {
            return callback({
                code: 200,
                message: 'Record deleted'
            })
        }
    }).catch(err => {
        console.log(err)
        if (!callback) return
        return callback({
            code: 500,
            message: err.stack
        })
    })
}


db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
    if (['wfhub_keywords_insert','wfhub_keywords_update','wfhub_keywords_delete'].includes(notification.channel)) {
        db.query(`SELECT * FROM wfhub_keywords`)
        .then(res => {
            host_keywords = []
            res.rows.forEach(row => {
                host_keywords.push(row)
            })
        }).catch(console.error)
    }
})

module.exports = {
    endpoints,
}