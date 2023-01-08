const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc, getTodayStartMs, getWeekStartMs, getMonthStartMs} = require('./functions')
const db_modules = require('./db_modules')
const {event_emitter} = require('./event_emitter')
const JSONbig = require('json-bigint');
const { WebhookClient } = require('discord.js');
const clanWebhookClient = new WebhookClient({url: process.env.AS_CLAN_AFFILIATES_WEBHOOK});
const { getStateExpiry } = require('./worldstate')

const endpoints = {
    'allsquads/clans/create': clansCreate,
    'allsquads/clans/fetch': clansFetch,
    'allsquads/clans/delete': clansDelete,

    'allsquads/pingmutes/create': pingmutesCreate,
    'allsquads/pingmutes/fetch': pingmutesFetch,
    'allsquads/pingmutes/delete': pingmutesDelete,

    'allsquads/leaderboards/fetch': leaderboardsFetch,
}

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

function updateClanWebhookMessages() {
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

function pingmutesCreate(data,callback) {
    console.log('[trackersCreate] data:',data)
    if (!data.discord_id) return callback({code: 400, err: 'No discord_id provided'})
    if (!data.squad_string) return callback({code: 400, err: 'No squad_string provided'})
    if (!data.revoke_after) return callback({code: 400, err: 'No revoke_after provided'})
    const pingmute_id = uuid.v1()
    db.query(`INSERT INTO as_ping_mutes (discord_id,squad_string,pingmute_id) VALUES (
        '${data.discord_id}',
        '${data.squad_string}',
        '${pingmute_id}'
    )`).then(res => {
        db_modules.schedule_query(`DELETE FROM as_ping_mutes WHERE pingmute_id='${pingmute_id}'`, data.revoke_after)
        if (callback) {
            return callback({
                code: 200,
                data: res.rows
            })
        }
    }).catch(err => {
        console.log(err)
        if (callback) {
            return callback({
                code: 500,
                message: err.stack
            })
        }
    })
}

function pingmutesFetch(data,callback) {
    console.log('[allsquads/pingmutesFetch] data:', data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        SELECT * FROM as_ping_mutes WHERE discord_id='${data.discord_id}';
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

function pingmutesDelete(data,callback) {
    console.log('[allsquads/pingmutesDelete] data:',data)
    if (!data.discord_id && !data.pingmute_ids) return callback({code: 500, err: 'No discord_id or squad_strings provided'})
    var query = ''
    if (data.discord_id) {
        query = `DELETE FROM as_ping_mutes WHERE discord_id='${data.discord_id}';`
    } else {
        data.pingmute_ids.forEach(pingmute_id => {
            query += `DELETE FROM as_ping_mutes WHERE pingmute_id='${pingmute_id}';`
        })
    }
    db.query(query).then(res => {
        return callback({
            code: 200,
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function leaderboardsFetch(data,callback) {
    console.log('[leaderboardsFetch] data:',data)
    db.query(`
        SELECT * FROM tradebot_users_list;
        SELECT * FROM rb_squads;
        SELECT * FROM as_sb_squads;
    `).then(res => {
        const db_users = res[0].rows
        const db_squads = res[1].rows.concat(res[2].rows)

        var leaderboards = {
            all_time: [],
            this_month: [],
            this_week: [],
            today: [],
        }
        const today_start = getTodayStartMs()
        const week_start = getWeekStartMs()
        const month_start = getMonthStartMs()

        db_users.forEach(user => {
            const discord_id = user.discord_id
            if (!discord_id || discord_id == "0") return
            var squads_completed = {
                all_time: 0,
                today: 0,
                this_week: 0,
                this_month: 0
            }
            db_squads.forEach(squad => {
                if (squad.members.includes(discord_id) && squad.status == 'closed') {
                    squads_completed.all_time++
                    if (squad.creation_timestamp >= today_start) squads_completed.today++
                    if (squad.creation_timestamp >= week_start) squads_completed.this_week++
                    if (squad.creation_timestamp >= month_start) squads_completed.this_month++
                }
            })
            if (squads_completed.all_time > 0)
                leaderboards.all_time.push({
                    ...user,
                    squads_completed: squads_completed.all_time
                })
            if (squads_completed.today > 0)
                leaderboards.today.push({
                    ...user,
                    squads_completed: squads_completed.today
                })
            if (squads_completed.this_week > 0)
                leaderboards.this_week.push({
                    ...user,
                    squads_completed: squads_completed.this_week
                })
            if (squads_completed.this_month > 0)
                leaderboards.this_month.push({
                    ...user,
                    squads_completed: squads_completed.this_month
                })
        })
        leaderboards.all_time = leaderboards.all_time.sort(dynamicSortDesc("squads_completed"))
        leaderboards.today = leaderboards.today.sort(dynamicSortDesc("squads_completed"))
        leaderboards.this_week = leaderboards.this_week.sort(dynamicSortDesc("squads_completed"))
        leaderboards.this_month = leaderboards.this_month.sort(dynamicSortDesc("squads_completed"))
        if (data.limit) {
            leaderboards.all_time = leaderboards.all_time.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            leaderboards.today = leaderboards.today.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            leaderboards.this_week = leaderboards.this_week.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            leaderboards.this_month = leaderboards.this_month.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
        }
        console.log(JSON.stringify(leaderboards))
        return callback({
            code: 200,
            data: leaderboards
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function pingmuteOnSquadOpen(squad) {
    if (squad.squad_string.match('sortie')) {
        squad.members.forEach(discord_id => {
            pingmutesCreate({discord_id: discord_id, squad_string: 'sortie', revoke_after: getStateExpiry('sortie')})
        })
    }
    if (squad.squad_string.match('archon')) {
        squad.members.forEach(discord_id => {
            pingmutesCreate({discord_id: discord_id, squad_string: 'archon', revoke_after: getStateExpiry('archon_hunt')})
        })
    }
    if (squad.squad_string.match('incursion')) {
        squad.members.forEach(discord_id => {
            pingmutesCreate({discord_id: discord_id, squad_string: 'incursions', revoke_after: getStateExpiry('incursions')})
        })
    }
    if (squad.squad_string.match('eidolon')) {
        squad.members.forEach(discord_id => {
            pingmutesCreate({discord_id: discord_id, squad_string: 'eidolon', revoke_after: 3000000})
        })
    }
}

db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
    if (['as_clan_affiliates_insert','as_clan_affiliates_update','as_clan_affiliates_delete'].includes(notification.channel)) {
        updateClanWebhookMessages()
    }
})

module.exports = {
    endpoints,
    pingmuteOnSquadOpen
}