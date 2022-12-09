const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc} = require('./functions')
const db_modules = require('./db_modules')
const {event_emitter} = require('./event_emitter')
const JSONbig = require('json-bigint');
const { WebhookClient } = require('discord.js');
const clanWebhookClient = new WebhookClient({url: process.env.AS_CLAN_AFFILIATES_WEBHOOK});

const endpoints = {
    'allsquads/clans/create': clansCreate,
    'allsquads/clans/fetch': clansFetch,
    'allsquads/clans/delete': clansDelete,
}

event_emitter.on('db_connected', () => {
    updateClanWebhookMessage()
})

function clansCreate(data, callback) {
    console.log('[keywordsCreate] data:',data)
    if (!data.clan_name) return callback({code: 400, message: 'No clan_name provided'})
    if (!data.logo_url) return callback({code: 400, message: 'No logo_url provided'})
    if (!data.description) return callback({code: 400, message: 'No description provided'})
    if (!data.requirements) return callback({code: 400, message: 'No requirements provided'})
    if (!data.stats) return callback({code: 400, message: 'No stats provided'})
    db.query(`
        INSERT INTO as_clan_affiliates (
            clan_name,
            logo_url,
            description,
            requirements,
            stats
        ) VALUES (
            '${data.clan_name}',
            '${data.logo_url}',
            '${data.description}',
            '${data.requirements}',
            '${data.stats}'
        )
    `).then(res => {
        updateClanWebhookMessage()
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

function clansFetch(data,callback) {
    console.log('[clansFetch] data:',data)
    db.query(`
        SELECT * FROM as_clan_affiliates;
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

function clansDelete(data,callback) {
    console.log('[keywordsDelete] data:',data)
    if (!data.id) {
        if (callback) callback({code: 400, message: 'No id provided'})
        return
    }
    db.query(`DELETE FROM as_clan_affiliates WHERE id=${data.id}`)
    .then(res => {
        updateClanWebhookMessage()
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

function updateClanWebhookMessage() {
    db.query(`
        SELECT * FROM as_clan_affiliates ORDER BY id;
        SELECT * FROM as_clan_affiliates_messages ORDER BY id;
    `).then(res => {
        const clans = res[0].rows
        const messages = res[1].rows
        clans.forEach((clan,index) => {
            if (!messages[index]) {
                clanWebhookClient.send(clanAffiliateEmbed(clan))
                .then(msg => {
                    db.query(`
                        INSERT INTO as_clan_affiliates_messages (message_id) VALUES ('${msg.id}');
                    `).catch(console.error)
                }).catch(console.error)
            } else {
                clanWebhookClient.editMessage(messages[index].message_id,clanAffiliateEmbed(clan)).catch(console.error)
            }
            if (index == clans.length - 1 && clans.length != messages.length) {
                messages.forEach((message,index2) => {
                    if (index2 <= index) return
                    clanWebhookClient.editMessage(message.message_id,{
                        content: '_ _',
                        embeds: []
                    }).catch(console.error)
                })
            }
        })
    }).catch(console.error)
}

function clanAffiliateEmbed(clan) {
    return {
        content: ' ',
        embeds: [{
            title: clan.clan_name,
            fields: [{
                name: '-- Requirements --',
                value: clan.requirements,
                inline: true
            },{
                name: '-- Stats --',
                value: clan.stats,
                inline: true
            },{
                name: '\u200b',
                value: clan.description,
                inline: false
            },],
            thumbnail: {
                url: clan.logo_url.match('http') ? clan.logo_url : null
            }
        }]
    }
}

db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
})

module.exports = {
    endpoints,
}