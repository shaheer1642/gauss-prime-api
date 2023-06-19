const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc, getTodayStartMs, getWeekStartMs, getMonthStartMs, calcArrAvg, getWeekEndMs} = require('./functions')
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

    'allsquads/leaderboards/fetch': leaderboardsFetch,

    'allsquads/user/ratings/fetch': userRatingsFetch,
    'allsquads/user/ratings/create': userRatingsCreate,

    'allsquads/user/settings/update': userSettingsUpdate,
    'allsquads/user/chats/fetch': userChatsFetch,
    'allsquads/user/filledSquads/fetch': userfilledSquadsFetch,
    'allsquads/user/statistics/fetch': statisticsFetch,

    'allsquads/users/fetch': usersFetch,

    'allsquads/reports/lodge': logdeReport,
    'allsquads/reports/resolve': resolveReport,

    'allsquads/admincommands/liftglobalban': adminLiftGlobalBan,

    'allsquads/fcm/token/update': FCMTokenUpdate
}

function FCMTokenUpdate(data,callback) {
    console.log('[allsquads.FCMTokenUpdate] called',data)
    if (!data.user_id && !data.login_token) return callback({code: 400, message: 'No user_id or login_token provided'})
    if (!data.fcm_token) return callback({code: 400, message: 'No fcm_token provided'})
    db.query(`
        SELECT * FROM as_push_notify WHERE fcm_token = '${data.fcm_token}'
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200,
            })
        } else {
            db.query(`
                INSERT INTO as_push_notify (user_id,fcm_token) VALUES (
                    ${data.user_id ? `'${data.user_id}'` : `(SELECT user_id FROM as_users_list WHERE login_tokens @> '[{"token": "${data.login_token}"}]')`},
                    '${data.fcm_token}'
                )
            `).then(res => {
                if (res.rowCount == 1) {
                    return callback({
                        code: 200,
                    })
                } else {
                    return callback({
                        code: 500,
                        message: 'error adding db record'
                    })
                }
            }).catch(err => {
                if (err.code == '23505') return callback({
                    code: 200,
                }) 
                else {
                    console.log(err)
                    return callback({
                        code: 500,
                        message: err.stack
                    })
                }
            })
        }
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function adminLiftGlobalBan(data, callback) {
    console.log('[allsquads.resolveReport] data:',data)
    if (!data.user_id) return callback({code: 400, message: 'No user_id provided'})
    if (!data.identifier) return callback({code: 400, message: 'No identifier provided'})

    const user = Object.values(as_users_list).filter(user => user.user_id == data.identifier || user.ingame_name?.toLowerCase() == data.identifier.toLowerCase())?.[0]
    if (!user) return callback({code: 400, message: 'Given user does not exist'})
    if (!user.is_suspended) return callback({code: 400, message: 'Given user is not suspended'})
    if (user.suspended_by != data.user_id) return callback({code: 400, message: 'Given user was not suspended by you'})
    db.query(`
        UPDATE as_users_list SET is_suspended = false WHERE user_id = '${user.user_id}'
    `).then(res => {
        if (res.rowCount == 1) {
            callback({
                code: 200,
                data: 'Ban has been lifted'
            })
        } else {
            callback({
                code: 500,
                data: 'Unexpected DB response'
            })
        }
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function resolveReport(data, callback) {
    console.log('[allsquads.resolveReport] data:',data)
    if (!data.user_id) return callback({code: 400, message: 'No user_id provided'})
    if (!data.report_id) return callback({code: 400, message: 'No report_id provided'})
    if (!data.remarks) return callback({code: 400, message: 'No remarks provided'})
    if (!data.action) return callback({code: 400, message: 'No action provided'})
    if (data.action == 'global_ban' && !data.expiry) return callback({code: 400, message: 'No expiry provided'})

    if (data.action == 'reject') {
        db.query(`
            UPDATE as_reports SET status = 'rejected', action_taken = 'rejected', resolved_by = '${data.user_id}', remarks = '${data.remarks.replace(/'/g,`''`)}'
            WHERE report_id = ${data.report_id} AND status = 'under_review'
        `).then(res => {
            if (res.rowCount == 1) {
                callback({
                    code: 200,
                    data: 'Report has been rejected'
                })
            } else {
                callback({
                    code: 500,
                    data: 'Unexpected DB response'
                })
            }
        }).catch(err => {
            console.log(err)
            return callback({
                code: 500,
                message: err.stack
            })
        })
    } else if (data.action == 'warned') {
        db.query(`
            UPDATE as_reports SET status = 'resolved', action_taken = 'warned', resolved_by = '${data.user_id}', remarks = '${data.remarks.replace(/'/g,`''`)}'
            WHERE report_id = ${data.report_id} AND status = 'under_review'
        `).then(res => {
            if (res.rowCount == 1) {
                callback({
                    code: 200,
                    data: 'Report has been marked as warned'
                })
            } else {
                callback({
                    code: 500,
                    data: 'Unexpected DB response'
                })
            }
        }).catch(err => {
            console.log(err)
            return callback({
                code: 500,
                message: err.stack
            })
        })
    } else if (data.action == 'global_ban') {
        db.query(`
            UPDATE as_users_list SET is_suspended = true, suspended_by = '${data.user_id}', suspension_expiry = ${data.expiry}
            WHERE user_id = (SELECT reported_user FROM as_reports WHERE report_id = ${data.report_id} AND status = 'under_review') 
        `).then(res => {
            if (res.rowCount == 1) {
                db_modules.schedule_query(`UPDATE as_users_list SET is_suspended = false WHERE user_id = (SELECT reported_user FROM as_reports WHERE report_id = ${data.report_id})`, data.expiry - new Date().getTime())
                db.query(`
                    UPDATE as_reports SET status = 'resolved', action_taken = 'global_ban', resolved_by = '${data.user_id}', remarks = '${data.remarks.replace(/'/g,`''`)}'
                    WHERE report_id = ${data.report_id} AND status = 'under_review'
                `).then(res => {
                    if (res.rowCount == 1) {
                        callback({
                            code: 200,
                            data: 'Report has been resolved'
                        })
                    } else {
                        callback({
                            code: 500,
                            data: 'Unexpected DB response'
                        })
                    }
                }).catch(err => {
                    console.log(err)
                    return callback({
                        code: 500,
                        message: err.stack
                    })
                })
            } else {
                callback({
                    code: 500,
                    data: 'Unexpected DB response'
                })
            }
        }).catch(err => {
            console.log(err)
            return callback({
                code: 500,
                message: err.stack
            })
        })
    } else {
        callback({
            code: 400,
            data: 'Invalid action'
        })
    }
}

function logdeReport(data, callback) {
    console.log('[allsquads.logdeReport] data:',data)
    if (!data.user_id) return callback({code: 400, message: 'No user_id provided'})
    if (!data.identifier) return callback({code: 400, message: 'No identifier provided'})
    if (!data.reason) return callback({code: 400, message: 'No reason provided'})
    db.query(`
        INSERT INTO as_reports (user_id, reported_user, report) VALUES (
            '${data.user_id}',
            (SELECT user_id FROM as_users_list WHERE LOWER(ingame_name) = LOWER('${data.identifier}')),
            '${data.reason.replace(/'/g,`''`)}'
        )
    `).then(res => {
        if (res.rowCount == 1) {
            callback({
                code: 200,
                data: 'report added'
            })
        } else {
            callback({
                code: 500,
                data: 'Unexpected DB response'
            })
        }
    }).catch(err => {
        if (err.code == '23502') return callback({
            code: 400,
            message: 'The given user does not exist'
        })
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function userfilledSquadsFetch(data, callback) {
    console.log('[allsquads.userfilledSquadsFetch] data:',data)
    if (!data.user_id) return callback({code: 400, message: 'No user_id provided'})
    db.query(`
        SELECT * FROM as_sb_squads WHERE members @> '"${data.user_id}"' AND (status = 'opened' OR status = 'closed' OR status = 'disbanded');
        SELECT * FROM as_rb_squads WHERE members @> '"${data.user_id}"' AND (status = 'opened' OR status = 'closed' OR status = 'disbanded');
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
    if (!data.squad_id) return callback({code: 400, message: 'No user_id provided'})
    db.query(`
        SELECT * FROM as_sb_squads_messages SM
        JOIN as_sb_squads S ON S.squad_id = SM.squad_id
        WHERE S.members @> '"${data.user_id}"'
        ORDER BY SM.creation_timestamp ASC;
        SELECT * FROM as_rb_squads_messages SM
        JOIN as_rb_squads S ON S.squad_id = SM.squad_id
        WHERE S.members @> '"${data.user_id}"'
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

function usersFetch(data,callback) {
    console.log('[usersFetch] data:',data)
    db.query(`
        SELECT * FROM as_users_list;
    `).then(res => {
        // res.rows.map((row,index) => {
        //     delete row.login_tokens
        //     delete row.email
        //     delete row.password
        //     delete row.discord_token
        //     res[index] = row
        // })
        return callback({
            code: 200,
            data: res.rows.map(row => ({user_id: row.user_id, ingame_name: row.ingame_name}))
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: JSON.stringify(err.detail || err.stack || err)
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
    if (!data.user_id) return callback({code: 400, err: 'No user_id provided'})
    if (!data.squad_string) return callback({code: 400, err: 'No squad_string provided'})
    if (!data.revoke_after) return callback({code: 400, err: 'No revoke_after provided'})
    const pingmute_id = uuid.v1()
    db.query(`INSERT INTO as_ping_mutes (user_id,squad_string,pingmute_id) VALUES (
        '${data.user_id}',
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
    if (!data.user_id) return callback({code: 500, err: 'No user_id provided'})
    db.query(`
        SELECT * FROM as_ping_mutes WHERE user_id='${data.user_id}';
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
    if (!data.user_id && !data.pingmute_ids) return callback({code: 500, err: 'No user_id or squad_strings provided'})
    var query = ''
    if (data.user_id) {
        query = `DELETE FROM as_ping_mutes WHERE user_id='${data.user_id}';`
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

function updateProfileView(viewer_id, viewee_id) {
    if (!viewer_id || !viewee_id) return
    if (viewer_id == viewee_id) return
    const value = `${viewer_id}_${new Date().setHours(0,0,0,0)}`
    db.query(`UPDATE as_users_list SET profile_views = profile_views || '"${value}"' WHERE user_id = '${viewee_id}' AND NOT profile_views @> '"${value}"'`)
    .then(res => {
        if (res.rowCount == 1) console.log('user',as_users_list[viewee_id].ingame_name,'has gained +1 profile view from',as_users_list[viewer_id].ingame_name)
    }).catch(console.error)
}

function statisticsFetch(data,callback) {
    console.log('[allsquads.statisticsFetch] data:',data)
    if (!data.identifier) return callback({code: 500, err: 'No identifier provided'})
    db.query(`
        SELECT * FROM as_users_list WHERE LOWER(${Number(data.identifier) ? 'discord_id' : 'ingame_name'}) = LOWER('${data.identifier}');
    `).then(res => {
        if (res.rowCount == 0) return callback({code: 400, message: 'Given user does not exist'})
        const db_user = res.rows[0]
        delete db_user.login_token
        const user_id = db_user.user_id
        if (data.user_id) updateProfileView(data.user_id, user_id)
        db.query(`
            SELECT * FROM as_rb_squads WHERE status = 'closed' AND members @> '"${user_id}"';
            SELECT * FROM as_sb_squads WHERE status = 'closed' AND members @> '"${user_id}"';
            SELECT * FROM as_gabot_giveaways WHERE status = 'ended' AND user_id = '${user_id}';
            SELECT * FROM as_gabot_giveaways WHERE status = 'ended' AND winners_list @> '"${user_id}"';
            SELECT * FROM as_bb_blesses WHERE status = 'closed' AND user_id = '${user_id}';
            SELECT * FROM challenges_completed WHERE user_id = '${user_id}';
            SELECT * FROM as_users_ratings WHERE rating_type = 'squad_rating' AND rated_user = '${user_id}';
        `).then(res => {
            const filled_squads = res[0].rows.concat(res[1].rows)
            const hosted_giveaways = res[2].rows
            const won_giveaways = res[3].rows
            const hosted_blessings = res[4].rows
            const completed_challenges = res[5].rows
            const user_ratings = res[6].rows
            
            var statistics = {
                user: {
                    ...db_user
                },
                squads: {
                    top_squads: {},
                    total_squads: {
                        all_time: 0,
                        this_month: 0,
                        this_week: 0,
                        today: 0
                    },
                    total_relic_squads: {
                        all_time: 0,
                        this_month: 0,
                        this_week: 0,
                        today: 0
                    },
                    total_general_squads: {
                        all_time: 0,
                        this_month: 0,
                        this_week: 0,
                        today: 0
                    },
                },
                giveaways: {
                    hosted: hosted_giveaways.length,
                    won: won_giveaways.length
                },
                blessings: {
                    hosted: hosted_blessings.length
                },
                challenges: {
                    total_completed: completed_challenges.length
                },
                ratings: {
                    3: user_ratings.reduce((sum,rating) => rating.rating == 3 ? sum += 1 : sum += 0, 0),
                    2: user_ratings.reduce((sum,rating) => rating.rating == 2 ? sum += 1 : sum += 0, 0),
                    1: user_ratings.reduce((sum,rating) => rating.rating == 1 ? sum += 1 : sum += 0, 0),
                    rating: Number((user_ratings.reduce((sum,rating) => sum += rating.rating, 0) / user_ratings.length).toFixed(2))
                },
                account_balance: db_user?.balance || 0,
                reputation: {
                    total: 0,
                    squads: 0,
                    daywave_challenges: 0,
                    giveaways: 0,
                    blessings: 0,
                    user_ratings: 0,
                }, 
                total_profile_views: db_user.profile_views.length
            }
            const today_start = getTodayStartMs()
            const week_start = getWeekStartMs()
            const month_start = getMonthStartMs()
    
            filled_squads.forEach(squad => {
                // top squads
                if (!squad.squad_string) squad.squad_string = (relicBotSquadToString(squad,false,true)).toLowerCase().replace(/ /g,'_')
                if (!statistics.squads.top_squads[squad.squad_string]) statistics.squads.top_squads[squad.squad_string] = 0
                statistics.squads.top_squads[squad.squad_string]++
                // all time squads
                statistics.squads.total_squads.all_time++
                if (squad.bot_type == 'relicbot') statistics.squads.total_relic_squads.all_time++
                if (squad.bot_type == 'squadbot') statistics.squads.total_general_squads.all_time++
                // monthly squads
                if (squad.open_timestamp >= month_start) {
                    statistics.squads.total_squads.this_month++
                    if (squad.bot_type == 'relicbot') statistics.squads.total_relic_squads.this_month++
                    if (squad.bot_type == 'squadbot') statistics.squads.total_general_squads.this_month++
                }
                // weekly squads
                if (squad.open_timestamp >= week_start) {
                    statistics.squads.total_squads.this_week++
                    if (squad.bot_type == 'relicbot') statistics.squads.total_relic_squads.this_week++
                    if (squad.bot_type == 'squadbot') statistics.squads.total_general_squads.this_week++
                }
                // todays squads
                if (squad.open_timestamp >= today_start) {
                    statistics.squads.total_squads.today++
                    if (squad.bot_type == 'relicbot') statistics.squads.total_relic_squads.today++
                    if (squad.bot_type == 'squadbot') statistics.squads.total_general_squads.today++
                }
            })
            statistics.squads.top_squads = Object.keys(statistics.squads.top_squads).map(squad_string => ({squad_string: squad_string, hosts: statistics.squads.top_squads[squad_string]})).sort(dynamicSortDesc("hosts"))
            
            statistics.reputation.squads = filled_squads.reduce((sum,squad) => sum += rep_scheme[squad.bot_type], 0)
            statistics.reputation.daywave_challenges = completed_challenges.reduce((sum,challenge) => sum += rep_scheme.daywave_completion, 0)
            statistics.reputation.giveaways = hosted_giveaways.reduce((sum,giveaway) => sum += rep_scheme.giveaway, 0)
            statistics.reputation.blessings = hosted_blessings.reduce((sum,blessing) => sum += rep_scheme.blessing, 0)
            statistics.reputation.user_ratings = user_ratings.reduce((sum,rating) => sum += rep_scheme.rating[rating.rating], 0)
            statistics.reputation.total = Object.values(statistics.reputation).reduce((sum,val) => sum += val, 0)

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
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function leaderboardsFetch(data,callback) {
    console.log('[allsquads.leaderboardsFetch] data:',data)
    const ts = new Date().getTime()
    db.query(`
        SELECT * FROM as_users_list;
        SELECT * FROM as_rb_squads WHERE status = 'closed';
        SELECT * FROM as_sb_squads WHERE status = 'closed';
        SELECT * FROM as_gabot_giveaways WHERE status = 'ended';
        SELECT * FROM as_bb_blesses WHERE status = 'closed';
        SELECT * FROM challenges_completed;
        SELECT * FROM as_users_ratings WHERE rating_type = 'squad_rating';
    `).then(res => {
        console.log('DB query time',new Date().getTime() - ts,'ms')
        const db_users = res[0].rows
        const db_squads = res[1].rows.concat(res[2].rows)
        const db_giveaways = res[3].rows
        const db_blessings = res[4].rows
        const db_daywave_challenges = res[5].rows
        const db_users_ratings = res[6].rows

        var statistics = {
            all_time: [],
            this_month: [],
            this_week: [],
            today: [],
            top_squads: {},
            total_squads: 0,
            top_runners: {
                relic_runners: [],
                non_relic_runners: [],
                squad_runners: [],
                event_runners: [],
            },
        }
        const today_start = getTodayStartMs()
        const week_start = getWeekStartMs()
        const month_start = getMonthStartMs()
        const top_runners_start_ts = data.options?.top_runners?.start_timestamp || getWeekStartMs()
        const top_runners_end_ts = data.options?.top_runners?.end_timestamp || getWeekEndMs()

        db_squads.forEach(squad => {
            if (squad.open_timestamp >= week_start) {
                if (!squad.squad_string) 
                    squad.squad_string = (relicBotSquadToString(squad,false,true)).toLowerCase().replace(/ /g,'_')
                if (!statistics.top_squads[squad.squad_string]) 
                    statistics.top_squads[squad.squad_string] = 0
                statistics.top_squads[squad.squad_string]++
                statistics.total_squads++
            }
            squad.members.filter(id => !squad.invalidated_members?.includes(id)).forEach(member_id => {
                const userIndex = db_users.findIndex(u => u.user_id == member_id)
                if (userIndex == -1) return
                if (!db_users[userIndex].squads_filled) db_users[userIndex].squads_filled = []
                db_users[userIndex].squads_filled.push(squad)
            })
        })
        db_giveaways.forEach(giveaway => {
            const userIndex = db_users.findIndex(u => u.user_id == giveaway.user_id)
            if (userIndex == -1) return
            if (!db_users[userIndex].giveaways_hosted) db_users[userIndex].giveaways_hosted = []
            db_users[userIndex].giveaways_hosted.push(giveaway)
        })
        db_blessings.forEach(blessing => {
            const userIndex = db_users.findIndex(u => u.user_id == blessing.user_id)
            if (userIndex == -1) return
            if (!db_users[userIndex].blessings_hosted) db_users[userIndex].blessings_hosted = []
            db_users[userIndex].blessings_hosted.push(blessing)
        })
        db_daywave_challenges.forEach(daywave_challenge => {
            const userIndex = db_users.findIndex(u => u.user_id == daywave_challenge.user_id)
            if (userIndex == -1) return
            if (!db_users[userIndex].challenges_completed) db_users[userIndex].challenges_completed = []
            db_users[userIndex].challenges_completed.push(daywave_challenge)
        })
        db_users_ratings.forEach(user_rating => {
            const userIndex = db_users.findIndex(u => u.user_id == user_rating.rated_user)
            if (userIndex == -1) return
            if (!db_users[userIndex].ratings_received) db_users[userIndex].ratings_received = []
            db_users[userIndex].ratings_received.push(user_rating)
        })
        db_users.forEach(user => {
            const user_id = user.user_id
            if (!user_id || user_id == "0") return
            if (data.options?.skip_users?.includes(user_id)) return
            var reputation = {
                all_time: 0.0,
                this_month: 0.0,
                this_week: 0.0,
                today: 0.0
            }
            user.last_squad_timestamp = 0
            const squads_count = {squads: 0, relic_squads: 0, non_relic_squads: 0, event_squads: 0}
            user.squads_filled?.forEach(squad => {
                const rep = rep_scheme[squad.bot_type]
                reputation.all_time += rep
                if (squad.open_timestamp >= today_start) reputation.today += rep
                if (squad.open_timestamp >= week_start) reputation.this_week += rep
                if (squad.open_timestamp >= month_start) reputation.this_month += rep
                if (squad.open_timestamp > user.last_squad_timestamp ) user.last_squad_timestamp = squad.open_timestamp
                
                if (squad.open_timestamp > top_runners_start_ts && squad.open_timestamp < top_runners_end_ts && !user.is_staff && !user.is_admin) {
                    squads_count.squads++
                    if (squad.bot_type == 'relicbot') squads_count.relic_squads++
                    if (squad.bot_type == 'squadbot') squads_count.non_relic_squads++
                    
                    if (squad.bot_type == 'relicbot') squads_count.event_squads++  
                    if (squad.bot_type == 'squadbot' && (squad.squad_string.toLowerCase().replace(/_/g,' ').match(/\btraces\b/) || squad.squad_string.toLowerCase().replace(/_/g,' ').match(/\btrace\b/))) squads_count.event_squads++
                }
            })
            user.giveaways_hosted?.forEach(giveaway => {
                const rep = rep_scheme.giveaway
                reputation.all_time += rep
            })
            user.blessings_hosted?.forEach(blessing => {
                const rep = rep_scheme.blessing
                reputation.all_time += rep
            })
            user.challenges_completed?.forEach(daywave_challenge => {
                const rep = rep_scheme.daywave_completion
                reputation.all_time += rep
                if (daywave_challenge.timestamp >= today_start) reputation.today += rep 
                if (daywave_challenge.timestamp >= week_start) reputation.this_week += rep
                if (daywave_challenge.timestamp >= month_start) reputation.this_month += rep
            })
            user.ratings_received?.forEach(user_rating => {
                const rep = rep_scheme.rating[user_rating.rating]
                reputation.all_time += rep
            })
            if (reputation.all_time > 0) statistics.all_time.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, reputation: reputation.all_time, last_squad_timestamp: user.last_squad_timestamp })
            if (reputation.today > 0) statistics.today.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, reputation: reputation.today, last_squad_timestamp: user.last_squad_timestamp })
            if (reputation.this_week > 0) statistics.this_week.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, reputation: reputation.this_week, last_squad_timestamp: user.last_squad_timestamp })
            if (reputation.this_month > 0) statistics.this_month.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, reputation: reputation.this_month, last_squad_timestamp: user.last_squad_timestamp })
            if (squads_count.relic_squads > 0) statistics.top_runners.relic_runners.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, squads_count: squads_count.relic_squads, last_squad_timestamp: user.last_squad_timestamp })
            if (squads_count.non_relic_squads > 0) statistics.top_runners.non_relic_runners.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, squads_count: squads_count.non_relic_squads, last_squad_timestamp: user.last_squad_timestamp })
            if (squads_count.squads > 0) statistics.top_runners.squad_runners.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, squads_count: squads_count.squads, last_squad_timestamp: user.last_squad_timestamp })
            if (squads_count.event_squads > 0) statistics.top_runners.event_runners.push({ discord_id: user.discord_id, user_id: user.user_id, ingame_name: user.ingame_name, squads_count: squads_count.event_squads, last_squad_timestamp: user.last_squad_timestamp })
        })
        statistics.all_time = statistics.all_time.sort(dynamicSortDesc("reputation"))
        statistics.today = statistics.today.sort(dynamicSortDesc("reputation"))
        statistics.this_week = statistics.this_week.sort(dynamicSortDesc("reputation"))
        statistics.this_month = statistics.this_month.sort(dynamicSortDesc("reputation"))
        statistics.top_runners.relic_runners = statistics.top_runners.relic_runners.sort(dynamicSortDesc("squads_count"))
        statistics.top_runners.non_relic_runners = statistics.top_runners.non_relic_runners.sort(dynamicSortDesc("squads_count"))
        statistics.top_runners.squad_runners = statistics.top_runners.squad_runners.sort(dynamicSortDesc("squads_count"))
        statistics.top_runners.event_runners = statistics.top_runners.event_runners.sort(dynamicSortDesc("squads_count"))
        statistics.top_squads = Object.keys(statistics.top_squads).map(squad_string => ({squad_string: squad_string, hosts: statistics.top_squads[squad_string]})).sort(dynamicSortDesc("hosts"))
        if (data.options?.limit) {
            statistics.all_time = statistics.all_time.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.today = statistics.today.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.this_week = statistics.this_week.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.this_month = statistics.this_month.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.top_squads = statistics.top_squads.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.top_runners.relic_runners = statistics.top_runners.relic_runners.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.top_runners.non_relic_runners = statistics.top_runners.non_relic_runners.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.top_runners.squad_runners = statistics.top_runners.squad_runners.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
            statistics.top_runners.event_runners = statistics.top_runners.event_runners.map((o,index) => index < data.options.limit ? o:null).filter(o => o != null)
        }
        data.options?.exclude_stats?.forEach(stat => {
            if (statistics[stat]) delete statistics[stat]
        })
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
    if (!data.user_id) return callback({code: 400, err: 'No user_id provided'})
    if (!data.rating_type) return callback({code: 400, err: 'No rating_type provided'})
    db.query(`
        SELECT * FROM as_users_ratings WHERE user_id = '${data.user_id}' AND rating_type = '${data.rating_type}';
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
    if (!data.user_id) {
        if (callback) callback({code: 400, err: 'No user_id provided'})
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
        (user_id, rated_user, rating, rating_type, reason) 
        VALUES (
            '${data.user_id}',
            '${data.rated_user}',
            ${Number(data.rating)},
            '${data.rating_type}',
            ${data.reason ? `'${data.reason}'` : 'null'}
        )
        ON CONFLICT (user_id,rated_user,rating_type)
        DO UPDATE SET 
        rating = EXCLUDED.rating;
    `).then(res => {
        if (callback) {
            if (res.rowCount == 1) {
                return callback({
                    code: 200
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
    if (!data.user_id) return callback({code: 400, err: 'No user_id provided'})
    if (!data.setting_type) return callback({code: 400, err: 'No setting_type provided'})
    if (data.setting_value == undefined) return callback({code: 400, err: 'No setting_value provided'})
    if (['ping_dnd', 'ping_off'].includes(data.setting_type)) {
        db.query(`
            UPDATE as_users_list SET
            allowed_pings_status = allowed_pings_status ${data.setting_type == 'ping_dnd' ? data.setting_value ? `|| '"dnd"'`:`- 'dnd'` : data.setting_type == 'ping_off' ? data.setting_value ? `|| '"invisible"' || '"offline"'`:`- 'offline' - 'invisible'` : '[]'}
            WHERE user_id = '${data.user_id}'
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

function calculateBestPingRating(user_ids) {
    const hosts_rating = {}
    user_ids.forEach(host_id => {
        // calculate relative ping
        const relative_ratings = []
        user_ids.filter(id => id != host_id).forEach(client_id => {
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
        const considered_ping = (((relative_ping_precision/(user_ids.length - 1)) >= 0.5) ? relative_ping : (global_ping_precision >= 5 ? global_ping : Infinity)) || Infinity
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
    var hosts = Object.keys(hosts_rating).map(user_id => ({...hosts_rating[user_id], user_id: user_id}))
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
        squad.members.forEach(user_id => {
            pingmutesCreate({user_id: user_id, squad_string: 'sortie', revoke_after: getStateExpiry('sortie')})
        })
    }
    if (squad.squad_string.match('archon')) {
        squad.members.forEach(user_id => {
            pingmutesCreate({user_id: user_id, squad_string: 'archon', revoke_after: getStateExpiry('archon_hunt')})
        })
    }
    if (squad.squad_string.match('incursion')) {
        squad.members.forEach(user_id => {
            pingmutesCreate({user_id: user_id, squad_string: 'incursions', revoke_after: getStateExpiry('incursions')})
        })
    }
    if (squad.squad_string.match('eidolon')) {
        squad.members.forEach(user_id => {
            pingmutesCreate({user_id: user_id, squad_string: 'eidolon', revoke_after: 3000000})
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