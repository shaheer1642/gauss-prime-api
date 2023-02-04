const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc} = require('./functions')
const db_modules = require('./db_modules')
const {event_emitter} = require('./event_emitter')
const JSONbig = require('json-bigint');

const endpoints = {
    'relicbot/squads/create': squadsCreate,
    'relicbot/squads/fetch': squadsFetch,
    'relicbot/squads/update': squadsUpdate,
    'relicbot/squads/addmember': squadsAddMember,
    'relicbot/squads/removemember': squadsRemoveMember,
    'relicbot/squads/leave': squadsLeave,
    'relicbot/squads/validate': squadsValidate,
    'relicbot/squads/invalidate': squadsInvalidate,
    'relicbot/squads/selecthost': squadsSelectHost,

    'relicbot/squads/messageCreate': squadsMessageCreate,
    'relicbot/squads/messagesFetch': squadsMessagesFetch,

    'relicbot/trackers/create': trackersCreate,
    'relicbot/trackers/fetch': trackersFetch,
    'relicbot/trackers/delete': trackersDelete,
    'relicbot/trackers/fetchSubscribers': trackersfetchSubscribers,

    'relicbot/users/fetch': usersFetch,

    'relicbot/defaultHostingTable/create': defaultHostingTableCreate,
    'relicbot/defaultHostingTable/fetch': defaultHostingTableFetch,
    'relicbot/defaultHostingTable/delete': defaultHostingTableDelete,
}

const pa_relics_list = [
    'lith_b10_relic',
    'lith_h7_relic',
    'lith_g6_relic',
    'meso_a4_relic',
    'meso_r5_relic',
    'meso_k5_relic',
    'neo_a8_relic',
    'neo_c3_relic',
    'neo_k5_relic',
    'axi_b5_relic',
    'axi_g9_relic',
    'axi_n10_relic',
]
const relics_list = {}
var hosting_table = []

event_emitter.on('db_connected', () => {
    db.query(`SELECT * FROM items_list WHERE item_url LIKE '%relic';SELECT * FROM rb_hosting_table`)
    .then(res => {
        res[0].rows.forEach(row => {
            relics_list[row.item_url] = row
        })
        pa_relics_list.map(relic_url => {
            relics_list[relic_url] = {
                vault_status: null,
                is_pa: true
            }
        })
        res[1].rows.forEach(row => {
            hosting_table.push({
                match_string: `${row.tier}_${row.main_relics.join('_')}_`,
                ...row
            })
        })
    }).catch(console.error)
})

const main_squads_channel = '1043987463049318450'

const squad_expiry =  3600000 // in ms
const squad_is_old =  900000 // in ms
const squad_closure = 900000 // in ms

function squadsMessageCreate(data,callback) {
    console.log('[squadsMessageCreate] data:',data)
    if (!data.thread_id) return callback({code: 500, err: 'No thread_id provided'})
    db.query(`
        INSERT INTO rb_squads_messages (message_id,message,discord_id,thread_id,squad_id,squad_thread_ids)
        VALUES (
            '${data.message_id}',
            '${data.message.replace(/'/g,`''`)}',
            '${data.discord_id}',
            '${data.thread_id}',
            (select squad_id FROM rb_squads WHERE thread_ids @> '"${data.thread_id}"' AND status='opened'),
            (select thread_ids FROM rb_squads WHERE thread_ids @> '"${data.thread_id}"' AND status='opened')
        )
    `).catch(err => {
        if (err.code != '23502') // message not sent in a tracked thread
            console.log(err)
    })
}

function squadsMessagesFetch(data,callback) {
    console.log('[relicbot/squadsMessagesFetch] data:', data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    db.query(`
        SELECT * FROM rb_squads_messages WHERE squad_id = '${data.squad_id}' ORDER BY creation_timestamp ASC;
    `).then(res => {
        return callback({
            code: 200,
            data: res.rows
        })
    }).catch(err => {
        return callback({
            code: 500,
            err: err
        })
    })
}

function squadsCreate(data,callback) {
    console.log('[squadsCreate] data:',data)
    if (!data.message) return callback({code: 500, err: 'No message provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    const lines = data.message.toLowerCase().trim().split('\n')
    Promise.all(lines.map(line => {
        return new Promise((resolve,reject) => {
            const squad = relicBotStringToSquad(line)
            if (!['lith','meso','neo','axi'].includes(squad.tier)) return resolve({
                code: 400,
                message: `Invalid tier **${squad.tier}**\nPlease include lith, meso, neo, or axi`
            })
            if (squad.main_relics.length == 0) return resolve({
                code: 400,
                message: `Relic name could not be determined`
            })
            for (const relic of squad.main_relics) {
                if (!['random','traces'].includes(relic.toLowerCase())) {
                    if (!relics_list[`${squad.tier}_${relic}_relic`.toLowerCase()]) return resolve({
                        code: 400,
                        message: `**${squad.tier} ${relic}** is not a valid relic`
                    })
                }
                if (squad.squad_type == '2b2' && !squad.is_vaulted && !relics_list[`${squad.tier}_${relic}_relic`.toLowerCase()].is_pa) return resolve({
                    code: 400,
                    message: `Cannot host **2b2** squad type for non-vaulted relics`
                })
            }
            if (['1b1','3b3'].includes(squad.squad_type)) return resolve({
                code: 400,
                message: `Cannot host **${squad.squad_type}** squad type`
            })
            if (squad.squad_type == '') squad.squad_type = '4b4'
            if (squad.main_refinements.length == 0) squad.main_refinements.push('rad')
            if (squad.is_steelpath && squad.is_railjack) squad.is_railjack = false

            const squad_id = uuid.v4()
            const squad_code = `${relicBotSquadToString(squad,true).toLowerCase().replace(/ /g,'_')}_${data.merge_squad == false ? `${new Date().getTime()}`:`${new Date(new Date().setHours(0,0,0,0)).getTime()}`}`
            console.log('squad_code:',squad_code)

            db.query(`INSERT INTO rb_squads (squad_id,squad_code,tier,members,original_host,main_relics,main_refinements,off_relics,off_refinements,squad_type,cycle_count,is_steelpath,is_railjack,creation_timestamp,joined_from_channel_ids,is_vaulted,logs) 
            VALUES 
                (
                (SELECT CASE WHEN (COUNT(squad_id) >= 24) THEN NULL ELSE '${squad_id}'::uuid END AS counted FROM rb_squads WHERE tier='${squad.tier}' AND status='active'),
                '${squad_code}',
                '${squad.tier}',
                '["${data.discord_id}"]',
                '${data.discord_id}',
                '${JSON.stringify(squad.main_relics)}',
                '${JSON.stringify(squad.main_refinements)}',
                '${JSON.stringify(squad.off_relics)}',
                '${JSON.stringify(squad.off_refinements)}',
                '${squad.squad_type}',
                '${squad.cycle_count}',
                ${squad.is_steelpath},
                ${squad.is_railjack},
                ${new Date().getTime()},
                '${data.channel_id ? `{"${data.discord_id}":"${data.channel_id}"}`:'{}'}',
                ${squad.is_vaulted},
                '["${new Date().getTime()} ${data.discord_id} created squad"]')
            `).then(res => {
                if (res.rowCount == 1) {
                    //db_modules.schedule_query(`UPDATE rb_squads SET is_old=true WHERE squad_id = '${squad_id}' AND status = 'active'`,squad_is_old)
                    //db_modules.schedule_query(`UPDATE rb_squads SET status='expired' WHERE squad_id = '${squad_id}' AND status='active'`,squad_expiry)
                    db_modules.schedule_query(`UPDATE rb_squads SET members = members-'${data.discord_id}', logs = logs || '"${new Date().getTime()} ${data.discord_id} removed from squad due to timeout"' WHERE members @> '"${data.discord_id}"' AND status='active' AND squad_id = '${squad_id}'`,squad_expiry)
                    return resolve({code: 200})
                } else return resolve({
                    code: 500,
                    message: 'unexpected db response'
                })
            }).catch(err => {
                if (err.code == '23502') {
                    return resolve({
                        code: 400,
                        message: `${squad.tier} squads limit has been reached. Please __try hosting later__ or __join an existing squad__`
                    })
                } else if (err.code == '23505') {
                    db.query(`SELECT * FROM rb_squads WHERE squad_code='${squad_code}' AND status='active'`)
                    .then(res => {
                        if (res.rowCount > 0) {
                            return resolve({
                                code: 399,
                                message: `**${relicBotSquadToString(squad,true)}** already exists. Would you like to __join existing squad__ or __host a new one__?`,
                                squad_id: res.rows[0].squad_id,
                                squad_code: res.rows[0].squad_code
                            })
                        }
                    }).catch(console.error)
                } else {
                    console.log(err)
                    return resolve({
                        code: 500,
                        message: err.stack
                    })
                }
            })
        })
    })).then(res => {
        return callback(res)
    }).catch(err => {
        console.log(err)
        return callback([{
            code: 500,
            message: err.stack
        }])
    })
}

function squadsFetch(data,callback) {
    console.log('[squadsFetch] data:',data)
    db.query(`
        SELECT * FROM rb_squads WHERE status='active' ${data.tier ? `AND tier='${data.tier}'`:''};
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

function squadsUpdate(data,callback) {
    if (!data.params) return callback({code: 500, err: 'No params provided'})
    db.query(`UPDATE rb_squads SET ${data.params}`).then(res => {
        if (!callback) return
        if (res.rowCount == 1) {
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(console.error)
}

function squadsAddMember(data,callback) {
    console.log('[squadsAddMember] data:',data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        UPDATE rb_squads 
        SET members = CASE WHEN members @> '"${data.discord_id}"'
        THEN members-'${data.discord_id}'
        ELSE members||'"${data.discord_id}"' END
        ${data.channel_id ? `,joined_from_channel_ids = 
        CASE WHEN members @> '"${data.discord_id}"'
        THEN joined_from_channel_ids - '${data.discord_id}'
        ELSE jsonb_set(joined_from_channel_ids, '{${data.discord_id}}', '"${data.channel_id}"') END
        ` : ''},
        logs = CASE WHEN members @> '"${data.discord_id}"'
        THEN logs || '"${new Date().getTime()} ${data.discord_id} left squad"'
        ELSE logs || '"${new Date().getTime()} ${data.discord_id} joined squad"' END
        WHERE status = 'active' AND squad_id = '${data.squad_id}'
        returning*;
    `).then(res => {
        if (res.rowCount == 1) {
            if (res.rows[0].members.includes(data.discord_id)) {
                db_modules.schedule_query(`UPDATE rb_squads SET members = members-'${data.discord_id}', logs = logs || '"${new Date().getTime()} ${data.discord_id} removed from squad due to timeout"' WHERE members @> '"${data.discord_id}"' AND status='active' AND squad_id = '${data.squad_id}'`,squad_expiry)
            }
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function squadsRemoveMember(data,callback) {
    console.log('[squadsRemoveMember] data:',data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`UPDATE rb_squads SET members=members-'${data.discord_id}' WHERE status='active' ${data.squad_id ? ` AND squad_id = '${data.squad_id}'`:''} ${data.tier ? ` AND tier = '${data.tier}'`:''}`)
    .then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function squadsLeave(data,callback) {
    console.log('[relicbot.squadsLeave] data:',data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    if (!data.tier) return callback({code: 500, err: 'No tier provided'})
    if (!['all','lith','meso','neo','axi'].includes(data.tier)) return callback({code: 500, err: `Invalid tier **${squad.tier}**\nPlease include lith, meso, neo, or axi`})
    db.query(`UPDATE rb_squads SET members=members-'${data.discord_id}', logs = logs || '"${new Date().getTime()} ${data.discord_id} left squad"'  WHERE status='active' AND members @> '"${data.discord_id}"' ${data.tier == 'all' ? '':` AND tier = '${data.tier}'`}`)
    .then(res => {
        return callback({
            code: 200
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function squadsValidate(data,callback) {
    console.log('[squadsValidate] data:',data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        UPDATE rb_squads SET validated_by = '${data.discord_id}' WHERE status = 'closed' AND squad_id = '${data.squad_id}' AND validated_by is null AND invalidated_by is null;
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function squadsInvalidate(data,callback) {
    console.log('[squadsInvalidate] data:',data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    if (!data.reason) return callback({code: 500, err: 'No reason provided'})
    db.query(`
        UPDATE rb_squads SET status = 'invalidated', invalidated_by = '${data.discord_id}', invalidation_reason = '${data.reason}' WHERE status = 'closed' AND squad_id = '${data.squad_id}' AND validated_by is null AND invalidated_by is null;
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function squadsSelectHost(data,callback) {
    console.log('[relicbot.squadsSelectHost] data:',data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        UPDATE rb_squads SET squad_host = '${data.discord_id}' WHERE status = 'opened' AND squad_id = '${data.squad_id}' AND members @> '"${data.discord_id}"';
    `).then(res => {
        if (res.rowCount == 1) {
            return callback({
                code: 200
            })
        } else return callback({
            code: 500,
            message: 'unexpected db response'
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function trackersCreate(data,callback) {
    console.log('[trackersCreate] data:',data)
    if (!data.message) return callback({code: 400, err: 'No message provided'})
    if (!data.discord_id) return callback({code: 400, err: 'No discord_id provided'})
    if (!data.channel_id) return callback({code: 400, err: 'No channel_id provided'})
    const lines = Array.isArray(data.message) ? data.message : data.message.toLowerCase().trim().split('\n')
    Promise.all(lines.map(line => {
        return new Promise((resolve,reject) => {
            const tracker_id = uuid.v4()
            const squad = relicBotStringToSquad(line)
            if (!['lith','meso','neo','axi'].includes(squad.tier)) return resolve({
                code: 400,
                message: `Invalid tier **${squad.tier}**`
            })
            if (squad.main_relics.length == 0) return resolve({
                code: 400,
                message: `Relic name could not be determined`
            })
            if (squad.squad_type == '') squad.squad_type = '4b4'
            if (squad.main_refinements.length == 0) squad.main_refinements.push('rad')

            db.query(`INSERT INTO rb_trackers (tracker_id,discord_id,channel_id,tier,main_relics,main_refinements,off_relics,off_refinements,squad_type,cycle_count) 
            VALUES (
                '${tracker_id}',
                '${data.discord_id}',
                '${data.channel_id}',
                '${squad.tier}',
                '${JSON.stringify(squad.main_relics)}',
                '${JSON.stringify(squad.main_refinements)}',
                '${JSON.stringify(squad.off_relics)}',
                '${JSON.stringify(squad.off_refinements)}',
                '${squad.squad_type}',
                '${squad.cycle_count}'
            )`).then(res => {
                if (res.rowCount == 1) {
                    return resolve({
                        code: 200
                    })
                } else return resolve({
                    code: 500,
                    message: 'unexpected db response'
                })
            }).catch(err => {
                console.log(err)
                return resolve({
                    code: 500,
                    message: err.stack
                })
            })
        })
    })).then(res => {
        return callback(res)
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function trackersFetch(data,callback) {
    console.log('[trackersFetch] data:',data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        SELECT * FROM rb_trackers WHERE discord_id='${data.discord_id}';
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

function trackersfetchSubscribers(data,callback) {
    console.log('[trackersfetchSubscribers] data:',data)
    if (!data.squad) return callback({code: 500, err: 'No squad obj provided'})
    const squad = data.squad
    db.query(`SELECT * FROM rb_trackers WHERE discord_id != '${squad.original_host}' AND tier = '${squad.tier}';`)
    .then(res => {
        const channel_ids = {};
        const hosted_squad = relicBotSquadToString(squad,false,true)
        res.rows.forEach(tracker => {
            const tracked_squad = relicBotSquadToString(tracker,false,true)
            if (hosted_squad == tracked_squad) {
                if (!channel_ids[tracker.channel_id]) 
                    channel_ids[tracker.channel_id] = []
                if (!channel_ids[tracker.channel_id].includes(tracker.discord_id))
                    channel_ids[tracker.channel_id].push(tracker.discord_id)
            } else {
                if (tracker.main_refinements.length == 0) {
                    tracker.main_relics.forEach(tracked_relic => {
                        if (squad.main_relics.includes(tracked_relic)) {
                            if (!channel_ids[tracker.channel_id]) 
                                channel_ids[tracker.channel_id] = []
                            if (!channel_ids[tracker.channel_id].includes(tracker.discord_id))
                                channel_ids[tracker.channel_id].push(tracker.discord_id)
                        }
                    })
                }
            }
        })
        return callback({
            code: 200,
            data: channel_ids
        })
    }).catch(err => {
        console.log(err)
        return callback({
            code: 500,
            message: err.stack
        })
    })
}

function trackersDelete(data,callback) {
    console.log('[trackersDelete] data:',data)
    if (!data.discord_id && !data.tracker_ids) return callback({code: 500, err: 'No discord_id or tracker_ids provided'})
    var query = ''
    if (data.discord_id) {
        query = `DELETE FROM rb_trackers WHERE discord_id='${data.discord_id}';`
    } else {
        data.tracker_ids.forEach(tracker_id => {
            query += `DELETE FROM rb_trackers WHERE tracker_id='${tracker_id}';`
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

function usersFetch(data,callback) {
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

function defaultHostingTableCreate(data, callback) {
    console.log('[defaultHostingTableCreate] data:',data)
    if (!data.tier) return callback({code: 400, message: 'No tier provided'})
    if (!data.main_relics) return callback({code: 400, message: 'No main_relics provided'})
    if (!data.main_refinements) return callback({code: 400, message: 'No main_refinements provided'})
    if (!data.squad_type) return callback({code: 400, message: 'No squad_type provided'})
    db.query(`
        INSERT INTO rb_hosting_table (
            tier,
            main_relics,
            main_refinements,
            squad_type
        ) VALUES (
            '${data.tier.toLowerCase()}',
            '${JSON.stringify(data.main_relics).toLowerCase()}',
            '${JSON.stringify(data.main_refinements).toLowerCase()}',
            '${data.squad_type.toLowerCase()}'
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

function defaultHostingTableFetch(data,callback) {
    console.log('[defaultHostingTableFetch] data:',data)
    db.query(`
        SELECT * FROM rb_hosting_table;
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

function defaultHostingTableDelete(data,callback) {
    console.log('[defaultHostingTableDelete] data:',data)
    if (!data.id) {
        if (callback) callback({code: 400, message: 'No id provided'})
        return
    }
    db.query(`DELETE FROM rb_hosting_table WHERE id=${data.id}`)
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

function relicBotStringToSquad(str) {
    var squad = {
        tier: '',
        main_relics: [],
        main_refinements: [],
        off_relics: [],
        off_refinements: [],
        squad_type: '',
        cycle_count: '',
        is_steelpath: false,
        is_railjack: false,
        is_vaulted: true
    }
    str = str.toLowerCase().trim()
    str = str.replace(/^h /,'').replace(/off$/g,'').replace(/off$/g,'').replace(/offcycle$/g,'').replace(/ or /g,' ').replace(/steel path/,'steelpath').replace(/rail jack/,'railjack')
    .replace(/^randoms /,'random ')
    .replace(/^random lith/,'lith random').replace(/^random meso/,'meso random').replace(/^random neo/,'neo random').replace(/^random axi/,'axi random')
    .replace(/^trace /,'traces ')
    .replace(/^traces lith/,'lith trace').replace(/^traces meso/,'meso trace').replace(/^traces neo/,'neo trace').replace(/^traces axi/,'axi trace');
    squad.tier = str.split(' ')[0]
    str = str.replaceAll(squad.tier,'').replace(/,/g,' ').replace(/\s+/g, ' ').trim()
    const subline = str.split(' with ')

    subline[0].split(' ').forEach((word,index) => {
        if (['int','flaw','rad','intact','flawless','radiant'].includes(word)) {
            word = word.replace('intact','int').replace('flawless','flaw').replace('radiant','rad')
            if (!squad.main_refinements.includes(word)) squad.main_refinements.push(word)
        }
        else if (['1b1','2b2','3b3','4b4'].includes(word)) {
            squad.squad_type = word
        }
        else if (['1b1i','1b1f','1b1r','2b2i','2b2f','2b2r','3b3i','3b3f','3b3r','4b4i','4b4f','4b4r',].includes(word)) {
            squad.squad_type = word.substring(0,3)
            const refinement = word[word.length - 1].replace('i','int').replace('f','flaw').replace('r','rad')
            if (!squad.main_refinements.includes(refinement)) squad.main_refinements.push(refinement)
        }
        else if (['random','traces'].includes(word)) {
            if (!squad.main_relics.includes(word)) squad.main_relics.push(word)
        }
        else if ((word.length == 2 || word.length == 3) && !Number(word[0]) && Number(`${word[1]}${word[2] || ''}`)) {
            if (!squad.main_relics.includes(word)) squad.main_relics.push(word)
        }
        else if (word.match('cycle') || word.match('cycles')) {
            const prev_word = subline[0].split(' ')[index-1]
            squad.cycle_count = prev_word
        }
        else if (word == 'steelpath' || word == 'sp') squad.is_steelpath = true
        else if (word == 'railjack' || word == 'rj') squad.is_railjack = true
    });
    subline[1]?.split(' ').forEach((word,index) => {
        if (['int','flaw','rad','intact','flawless','radiant'].includes(word)) {
            word = word.replace('intact','int').replace('flawless','flaw').replace('radiant','rad')
            if (!squad.off_refinements.includes(word)) squad.off_refinements.push(word)
        }
        else if ((word.length == 2 || word.length == 3) && !Number(word[0]) && Number(`${word[1]}${word[2] || ''}`)) {
            if (!squad.off_relics.includes(word)) squad.off_relics.push(word)
        }
        else if (word.match('cycle') || word.match('cycles')) {
            const prev_word = subline[1].split(' ')[index-1]
            squad.cycle_count = prev_word
        }
        else if (word == 'steelpath' || word == 'sp') squad.is_steelpath = true
        else if (word == 'railjack' || word == 'rj') squad.is_railjack = true
    });
    for (const relic of squad.main_relics) {
        console.log(relics_list[`${squad.tier}_${relic}_relic`.toLowerCase()]?.vault_status)
        if (!['V','B'].includes(relics_list[`${squad.tier}_${relic}_relic`.toLowerCase()]?.vault_status)) squad.is_vaulted = false
    }
    for (const host of hosting_table) {
        if (host.match_string.match(`${squad.tier}_`)) {
            squad.main_relics.forEach(relic => {
                if (host.match_string.match(`_${relic}_`) && squad.main_relics.length <= host.main_relics.length) {
                    squad.main_relics = host.main_relics
                    if (squad.squad_type == '')
                        squad.squad_type = host.squad_type
                    if (squad.main_refinements.length == 0)
                        squad.main_refinements = host.main_refinements
                }
            })
        }
    }
    return squad;
}

function relicBotSquadToString(squad,include_sp_rj,exclude_cycle_count) {
    return `${convertUpper(squad.tier)} ${squad.main_relics.join(' ').toUpperCase()} ${squad.squad_type} ${squad.main_refinements.join(' ')} ${squad.off_relics.length > 0 ? 'with':''} ${squad.off_relics.join(' ').toUpperCase()} ${squad.off_refinements.join(' ')} ${include_sp_rj ? (squad.is_steelpath ? 'Steelpath':squad.is_railjack ? 'Railjack':''):''} ${exclude_cycle_count ? '' : squad.cycle_count == '' ? '':`(${squad.cycle_count} cycles)`}`.replace(/\s+/g, ' ').trim()
}

db.on('notification',(notification) => {
    const payload = JSONbig.parse(notification.payload);
    if (['rb_hosting_table_insert','rb_hosting_table_update','rb_hosting_table_delete'].includes(notification.channel)) {
        db.query(`SELECT * FROM rb_hosting_table;`)
        .then(res => {
            hosting_table = []
            res.rows.forEach(row => {
                hosting_table.push({
                    match_string: `${row.tier}_${row.main_relics.join('_')}_`,
                    ...row
                })
            })
        }).catch(console.error)
    }
})

module.exports = {
    endpoints,
    squad_closure,
    relicBotSquadToString
}