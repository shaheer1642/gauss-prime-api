const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc, getTodayStartMs, getWeekStartMs, getMonthStartMs, calcArrAvg} = require('./functions')
const db_modules = require('./db_modules')
const {event_emitter} = require('./event_emitter')
const JSONbig = require('json-bigint');
const { WebhookClient } = require('discord.js');
const clanWebhookClient = new WebhookClient({url: process.env.AS_CLAN_AFFILIATES_WEBHOOK});
const { getStateExpiry } = require('./worldstate')
const {relicBotSquadToString} = require('./relicbot')
const {as_users_list} = require('./allsquads/as_users_list')
const {as_hosts_ratings} = require('./allsquads/as_users_ratings')

const endpoints = {
    'allsquads/clans/create': clansCreate,
    'allsquads/clans/fetch': clansFetch,
    'allsquads/clans/delete': clansDelete,

    'allsquads/faqs/create': faqsCreate,
    'allsquads/faqs/update': faqsUpdate,
    'allsquads/faqs/fetch': faqsFetch,
    'allsquads/faqs/delete': faqsDelete,

    'allsquads/pingmutes/create': pingmutesCreate,
    'allsquads/pingmutes/fetch': pingmutesFetch,
    'allsquads/pingmutes/delete': pingmutesDelete,

    'allsquads/statistics/fetch': statisticsFetch,

    'allsquads/user/ratings/fetch': userRatingsFetch,
    'allsquads/user/ratings/create': userRatingsCreate,

    'allsquads/user/settings/update': userSettingsUpdate,
    'allsquads/user/chats/fetch': userChatsFetch,
    'allsquads/user/filledSquads/fetch': userfilledSquadsFetch,

    'allsquads/userslist': usersList,

}

function userfilledSquadsFetch(data, callback) {
    console.log('[allsquads.userfilledSquadsFetch] data:',data)
    if (!data.discord_id) return callback({code: 400, message: 'No discord_id provided'})
    db.query(`
        SELECT * FROM as_sb_squads WHERE members @> '"${data.discord_id}"' AND (status = 'opened' OR status = 'closed' OR status = 'disbanded');
        SELECT * FROM rb_squads WHERE members @> '"${data.discord_id}"' AND (status = 'opened' OR status = 'closed' OR status = 'disbanded');
    `).then(res => {
        callback({
            code: 200,
            data: res[0].rows.concat(res[1].rows).sort(dynamicSortDesc("creation_timestamp"))
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function userChatsFetch(data, callback) {
    console.log('[allsquads.userChatsFetch] data:',data)
    if (!data.squad_id) return callback({code: 400, message: 'No discord_id provided'})
    db.query(`
        SELECT * FROM as_sb_squads_messages SM
        JOIN as_sb_squads S ON S.squad_id = SM.squad_id
        WHERE S.members @> '"${data.discord_id}"'
        ORDER BY SM.creation_timestamp ASC;
        SELECT * FROM rb_squads_messages SM
        JOIN rb_squads S ON S.squad_id = SM.squad_id
        WHERE S.members @> '"${data.discord_id}"'
        ORDER BY SM.creation_timestamp ASC;
    `).then(res => {
        const chats = res[0].rows.concat(res[1].rows)
        const squadChats = {}
        chats.forEach(chat => {
            if (!squadChats[chat.squad_id]) squadChats[chat.squad_id] = []
            squadChats[chat.squad_id].push(chat)
        })
        callback({
            code: 200,
            data: squadChats
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function usersList(data,callback) {
    console.log('[usersFetch] data:',data)
    db.query(`
        SELECT * FROM tradebot_users_list;
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

function clansCreate(data, callback) {
    console.log('[clansCreate] data:',data)
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
    console.log('[clansDelete] data:',data)
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

function faqsCreate(data, callback) {
    console.log('[allsquads.faqsCreate] data:',data)
    if (!data.title) return callback({code: 400, message: 'No title provided'})
    if (!data.body) return callback({code: 400, message: 'No body provided'})
    if (!data.language) return callback({code: 400, message: 'No language provided'})
    db.query(`
        INSERT INTO as_faq (
            title,
            body,
            image_url
        ) VALUES (
            '{"${data.language}": "${data.title.replace(/'/g,`''`).replace(/\"/g,`\\"`).replace(/\r\n/g,`\\n`).replace(/\n/g,`\\r\\n`)}"}',
            '{"${data.language}": "${data.body.replace(/'/g,`''`).replace(/\"/g,`\\"`).replace(/\r\n/g,`\\n`).replace(/\n/g,`\\r\\n`)}"}',
            ${data.image_url ? `{"${data.language}": "${data.image_url}"}`:'null'}
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
            message: err.detail || err.stack || err
        })
    })
}

function faqsUpdate(data, callback) {
    console.log('[allsquads.faqsUpdate] data:',data)
    if (!data.id) return callback({code: 400, message: 'No id(order) provided'})
    if (!data.faq_id) return callback({code: 400, message: 'No faq_id provided'})
    if (!data.title) return callback({code: 400, message: 'No title provided'})
    if (!data.body) return callback({code: 400, message: 'No body provided'})
    if (!data.language) return callback({code: 400, message: 'No language provided'})
    db.query(`
        UPDATE as_faq SET 
        id=${data.id},
        title = jsonb_set(title,'{${data.language}}', '"${data.title.replace(/'/g,`''`).replace(/\"/g,`\\"`).replace(/\r\n/g,`\\n`).replace(/\n/g,`\\r\\n`)}"', true),
        body = jsonb_set(body,'{${data.language}}', '"${data.body.replace(/'/g,`''`).replace(/\"/g,`\\"`).replace(/\r\n/g,`\\n`).replace(/\n/g,`\\r\\n`)}"', true)
        ${data.image_url ? `, image_url = jsonb_set(image_url,'{${data.language}}', '"${data.image_url}"', true)`:''}
        WHERE faq_id = '${data.faq_id}';
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200,
                message: 'Success'
            })
        } else {
            return callback({
                code: 500,
                message: 'Unexpected db response'
            })
        }
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.detail || err.stack || err
        })
    })
}

function faqsFetch(data,callback) {
    console.log('[allsquads.faqsFetch] data:',data)
    db.query(`
        SELECT * FROM as_faq ORDER BY id;
    `).then(res => {
        return callback({
            code: 200,
            data: res.rows
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.detail || err.stack || err
        })
    })
}

function faqsDelete(data,callback) {
    console.log('[allsquads.faqsDelete] data:',data)
    if (!data.faq_id) {
        if (callback) callback({code: 400, message: 'No faq_id provided'})
        return
    }
    db.query(`DELETE FROM as_faq WHERE faq_id='${data.faq_id}'`)
    .then(res => {
        if (!callback) return
        if (res.rowCount == 0) {
            return callback({
                code: 500,
                message: 'Unexpected db response'
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
            message: err.detail || err.stack || err
        })
    })
}

function clanAffiliateEmbed(clan) {
    return {
        content: ' ',
        embeds: [{
            title: clan.clan_name,
            fields: [{
                name: '-- Stats --',
                value: clan.stats,
                inline: true
            },{
                name: '-- Requirements --',
                value: clan.requirements,
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

function statisticsFetch(data,callback) {
    console.log('[allsquads.statisticsFetch] data:',data)
    db.query(`
        SELECT * FROM tradebot_users_list;
        SELECT * FROM rb_squads WHERE status = 'closed';
        SELECT * FROM as_sb_squads WHERE status = 'closed';
        SELECT * FROM as_gabot_giveaways WHERE status = 'ended';
        SELECT * FROM as_bb_blesses WHERE status = 'closed';
        SELECT * FROM challenges_completed;
        SELECT * FROM as_rank_roles;
        SELECT * FROM as_users_ratings WHERE rating_type = 'squad_rating';
    `).then(res => {
        const rep_scheme = {
            relicbot: 0.5,
            squadbot: 0.5,
            giveaway: 2.0,
            blessing: 0.5,
            daywave_completion: 0.5,
            ranks: {
                rank_1: 5.0,
                rank_2: 10.0,
                rank_3: 15.0,
                rank_4: 20.0,
                rank_5: 25.0,
            },
            rating: {
                1: 0.0,
                2: 0.5,
                3: 1.0,
            }
        }
        const db_users = res[0].rows
        const db_squads = res[1].rows.map(row => ({...row, bot_type: 'relicbot'})).concat(res[2].rows.map(row => ({...row, bot_type: 'squadbot'})))
        const db_giveaways = res[3].rows
        const db_blessings = res[4].rows
        const db_daywave_challenges = res[5].rows
        const db_rank_roles = res[6].rows
        const db_users_ratings = res[7].rows

        var statistics = {
            all_time: [],
            this_month: [],
            this_week: [],
            today: [],
            top_squads: {},
            total_squads: 0
        }
        const today_start = getTodayStartMs()
        const week_start = getWeekStartMs()
        const month_start = getMonthStartMs()

        db_squads.forEach(squad => {
            if (squad.creation_timestamp >= week_start) {
                if (!squad.squad_string) 
                    squad.squad_string = (relicBotSquadToString(squad,false,true)).toLowerCase().replace(/ /g,'_')
                if (!statistics.top_squads[squad.squad_string]) 
                    statistics.top_squads[squad.squad_string] = 0
                statistics.top_squads[squad.squad_string]++
                statistics.total_squads++
            }
        })
        const skip_users = data.skip_users || []
        db_users.forEach(user => {
            const discord_id = user.discord_id
            if (!discord_id || discord_id == "0") return
            if (skip_users.includes(discord_id)) return
            var reputation = {
                all_time: 0.0,
                today: 0.0,
                this_week: 0.0,
                this_month: 0.0
            }
            db_squads.forEach(squad => {
                if (squad.members.filter(id => !squad.invalidated_members?.includes(id)).includes(discord_id)) {
                    const rep = rep_scheme[squad.bot_type]
                    reputation.all_time += rep
                    if (squad.creation_timestamp >= today_start) reputation.today += rep
                    if (squad.creation_timestamp >= week_start) reputation.this_week += rep
                    if (squad.creation_timestamp >= month_start) reputation.this_month += rep
                }
            })
            db_giveaways.forEach(giveaway => {
                if (giveaway.discord_id == discord_id) {
                    const rep = rep_scheme.giveaway
                    reputation.all_time += rep
                    // if (giveaway.expiry_timestamp >= today_start) reputation.today += rep
                    // if (giveaway.expiry_timestamp >= week_start) reputation.this_week += rep
                    // if (giveaway.expiry_timestamp >= month_start) reputation.this_month += rep
                }
            })
            db_blessings.forEach(blessing => {
                if (blessing.discord_id == discord_id) {
                    const rep = rep_scheme.blessing
                    reputation.all_time += rep
                    // if (blessing.creation_timestamp >= today_start) reputation.today += rep
                    // if (blessing.creation_timestamp >= week_start) reputation.this_week += rep
                    // if (blessing.creation_timestamp >= month_start) reputation.this_month += rep
                }
            })
            db_daywave_challenges.forEach(daywave_challenge => {
                if (daywave_challenge.discord_id == discord_id) {
                    const rep = rep_scheme.daywave_completion
                    reputation.all_time += rep
                    if (daywave_challenge.timestamp >= today_start) reputation.today += rep 
                    if (daywave_challenge.timestamp >= week_start) reputation.this_week += rep
                    if (daywave_challenge.timestamp >= month_start) reputation.this_month += rep
                }
            })
            // db_rank_roles.forEach(rank_role => {
            //     if (rank_role.discord_id == discord_id) {
            //         const rep = rep_scheme.ranks[rank_role.rank_type]
            //         reputation.all_time += rep
            //     }
            // })
            db_users_ratings.forEach(user_rating => {
                if (user_rating.rated_user == discord_id) {
                    const rep = rep_scheme.rating[user_rating.rating]
                    reputation.all_time += rep
                }
            })
            if (reputation.all_time > 0)
                statistics.all_time.push({
                    ...user,
                    reputation: reputation.all_time
                })
            if (reputation.today > 0)
                statistics.today.push({
                    ...user,
                    reputation: reputation.today
                })
            if (reputation.this_week > 0)
                statistics.this_week.push({
                    ...user,
                    reputation: reputation.this_week
                })
            if (reputation.this_month > 0)
                statistics.this_month.push({
                    ...user,
                    reputation: reputation.this_month
                })
        })
        statistics.all_time = statistics.all_time.sort(dynamicSortDesc("reputation"))
        statistics.today = statistics.today.sort(dynamicSortDesc("reputation"))
        statistics.this_week = statistics.this_week.sort(dynamicSortDesc("reputation"))
        statistics.this_month = statistics.this_month.sort(dynamicSortDesc("reputation"))
        statistics.top_squads = Object.keys(statistics.top_squads).map(squad_string => ({squad_string: squad_string, hosts: statistics.top_squads[squad_string]})).sort(dynamicSortDesc("hosts"))
        if (data.limit) {
            statistics.all_time = statistics.all_time.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            statistics.today = statistics.today.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            statistics.this_week = statistics.this_week.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            statistics.this_month = statistics.this_month.map((user,index) => index < data.limit ? user:null).filter(o => o != null)
            statistics.top_squads = statistics.top_squads.map((host,index) => index < data.limit ? host:null).filter(o => o != null)
        }
        console.log(JSON.stringify(statistics))
        if (data.exclude_squads) {
            delete statistics.top_squads;
            delete statistics.total_squads;
        }
        if (data.exclude_daily) 
            delete statistics.today
        return callback({
            code: 200,
            data: statistics
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function userRatingsFetch(data,callback) {
    console.log('[allsquads.userRatingsFetch] data:',data)
    if (!data.discord_id) return callback({code: 400, err: 'No discord_id provided'})
    if (!data.rating_type) return callback({code: 400, err: 'No rating_type provided'})
    db.query(`
        SELECT * FROM as_users_ratings WHERE discord_id = '${data.discord_id}' AND rating_type = '${data.rating_type}';
    `).then(res => {
        const user_ratings = {}
        res.rows.forEach(row => {
            user_ratings[row.rated_user] = row.rating
        })
        return callback({
            code: 200,
            data: user_ratings
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.detail || err.stack || err
        })
    })
}
function userRatingsCreate(data,callback) {
    console.log('[allsquads.userRatingsCreate] data:',data)
    if (!data.discord_id) {
        if (callback) callback({code: 400, err: 'No discord_id provided'})
        return
    }
    if (!data.rated_user) {
        if (callback) callback({code: 400, err: 'No rated_user provided'})
        return
    }
    if (!data.rating_type) {
        if (callback) callback({code: 400, err: 'No rating_type provided'})
        return
    }
    if (!data.rating) {
        if (callback) callback({code: 400, err: 'No rating provided'})
        return
    }
    if (!Number(data.rating)) {
        if (callback) callback({code: 400, err: 'Invalid rating type'})
        return
    }
    db.query(`
        INSERT INTO as_users_ratings 
        (discord_id, rated_user, rating, rating_type, reason) 
        VALUES (
            '${data.discord_id}',
            '${data.rated_user}',
            ${Number(data.rating)},
            '${data.rating_type}',
            ${data.reason ? `'${data.reason}'` : 'null'}
        )
        ON CONFLICT (discord_id,rated_user,rating_type)
        DO UPDATE SET 
        rating = EXCLUDED.rating;
    `).then(res => {
        if (callback) {
            if (res.rowCount == 1) {
                return callback({
                    code: 200,
                    data: user_ratings
                })
            } else {
                return callback({
                    code: 500,
                    data: 'unexpected db response'
                })
            }
        }
    }).catch(err => {
        console.log(err)
        if (callback) {
            return callback({
                code: 500,
                message: err.detail || err.stack || err
            })
        }
    })
}

function userSettingsUpdate(data,callback) {
    console.log('[allsquads.userSettingsUpdate] data:',data)
    if (!data.discord_id) return callback({code: 400, err: 'No discord_id provided'})
    if (!data.setting_type) return callback({code: 400, err: 'No setting_type provided'})
    if (data.setting_value == undefined) return callback({code: 400, err: 'No setting_value provided'})
    if (['ping_dnd', 'ping_off'].includes(data.setting_type)) {
        db.query(`
            UPDATE tradebot_users_list
            SET
            allowed_pings_status = allowed_pings_status ${data.setting_type == 'ping_dnd' ? data.setting_value ? `|| '"dnd"'`:`- 'dnd'` : data.setting_type == 'ping_off' ? data.setting_value ? `|| '"invisible"' || '"offline"'`:`- 'offline' - 'invisible'` : '[]'}
            WHERE discord_id = '${data.discord_id}'
            returning *;
        `).then(res => {
            if (res.rowCount == 1) {
                return callback({
                    code: 200,
                    data: res.rows[0]
                })
            } else {
                return callback({
                    code: 500,
                    data: 'unexpected db response'
                })
            }
        }).catch(err => {
            console.log(err)
            return callback({
                code: 500,
                message: err.detail || err.stack || err
            })
        })
    }
}

function calculateBestPingRating(discord_ids) {
    const hosts_rating = {}
    discord_ids.forEach(host_id => {
        // calculate relative ping
        const relative_ratings = []
        discord_ids.filter(id => id != host_id).forEach(client_id => {
            const ping_rating = as_hosts_ratings[host_id]?.[client_id]
            if (ping_rating) relative_ratings.push(ping_rating)
        })
        const relative_ping = calcArrAvg(relative_ratings)
        const relative_ping_precision = relative_ratings.length
        // calculate global ping
        const global_ratings = []
        if (as_hosts_ratings[host_id]) {
            Object.keys(as_hosts_ratings[host_id]).forEach(global_client_id => {
                global_ratings.push(as_hosts_ratings[host_id][global_client_id])
            })
        }
        const global_ping = calcArrAvg(global_ratings)
        const global_ping_precision = global_ratings.length
        // calculate considered ping
        const considered_ping = (((relative_ping_precision/(discord_ids.length - 1)) >= 0.5) ? relative_ping : (global_ping_precision >= 5 ? global_ping : Infinity)) || Infinity
        // assign values
        hosts_rating[host_id] = {
            relative_ping: relative_ping || Infinity,
            relative_ping_precision: relative_ping_precision,
            global_ping: global_ping || Infinity,
            global_ping_precision: global_ping_precision,
            considered_ping: considered_ping,
            avg_squad_ping: getPingFromRating(considered_ping)
        }
    })
    var hosts = Object.keys(hosts_rating).map(key => ({...hosts_rating[key], discord_id: key, ign: as_users_list[key]?.ingame_name}))
    hosts = hosts.sort(dynamicSort('considered_ping'))
    return hosts

    function getPingFromRating(rating) {
        const high = Math.round(rating * 100)
        const low = Math.round((Math.ceil(rating) - 1) * 100)
        return `${low}-${high} ms`
    }
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
    pingmuteOnSquadOpen,
    calculateBestPingRating
}