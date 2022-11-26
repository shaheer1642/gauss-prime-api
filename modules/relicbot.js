const { db } = require("./db_connection")
const uuid = require('uuid')
const {convertUpper, dynamicSort, dynamicSortDesc} = require('./functions')
const db_modules = require('./db_modules')

const endpoints = {
    'relicbot/squads/create': squadsCreate,
    'relicbot/squads/fetch': squadsFetch,
    'relicbot/squads/update': squadsUpdate,
    'relicbot/squads/addmember': squadsAddMember,
    'relicbot/squads/removemember': squadsRemoveMember,
    'relicbot/squads/leaveall': squadsLeaveAll,
    'relicbot/users/fetch': usersFetch,
}

const main_squads_channel = '1043987463049318450'

const squad_expiry =  3600000 // in ms
const squad_is_old =  900000 // in ms
const squad_closure = 900000 // in ms

function squadsCreate(data,callback) {
    console.log('[squadsCreate] data:',data)
    if (!data.message) return callback({code: 500, err: 'No message provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    const lines = data.message.toLowerCase().split('\n')
    Promise.all(lines.map(line => {
        return new Promise((resolve,reject) => {
            const squad_id = uuid.v4()
            var str = line
            str = str.toLowerCase().trim()
            str = str.replace(/^h /,'').replace(/off$/g,'').replace(/off$/g,'').replace(/offcycle$/g,'').replace(/ or /g,'')
            const tier = str.split(' ')[0]
            if (!['lith','meso','neo','axi'].includes(tier)) return resolve({
                code: 400,
                message: `Invalid tier **${tier}**`
            })
            str = str.replaceAll(str.split(' ')[0],'').replace(/,/g,' ').replace(/\s+/g, ' ').trim()
            const subline = str.split(' with ')

            var main_relics = []
            var main_refinements = []
            var off_relics = []
            var off_refinements = []
            var squad_type = ''
            var cycle_count = ''
            var is_steelpath = false
            var is_railjack = false

            subline[0].split(' ').forEach((word,index) => {
                if (['int','flaw','rad','intact','flawless','radiant'].includes(word)) {
                    word = word.replace('intact','int').replace('flawless','flaw').replace('radiant','rad')
                    if (!main_refinements.includes(word)) main_refinements.push(word)
                }
                else if (['2b2','4b4'].includes(word)) {
                    squad_type = word
                }
                else if (['2b2i','4b4i','2b2f','4b4f','2b2r','4b4r',].includes(word)) {
                    squad_type = word.substring(0,3)
                    const refinement = word[word.length - 1].replace('i','int').replace('f','flaw').replace('r','rad')
                    if (!main_refinements.includes(refinement)) main_refinements.push(refinement)
                }
                else if (['random','randoms','trace','traces'].includes(word)) {
                    if (!main_relics.includes(convertUpper(word))) main_relics.push(convertUpper(word))
                }
                else if ((word.length == 2 || word.length == 3) && !Number(word[0]) && Number(`${word[1]}${word[2] || ''}`)) {
                    if (!main_relics.includes(word.toUpperCase())) main_relics.push(word.toUpperCase())
                }
                else if (word.match('cycle') || word.match('cycles')) {
                    const prev_word = subline[0].split(' ')[index-1]
                    cycle_count = prev_word
                }
                else if (word == 'steelpath' || word == 'sp') is_steelpath = true
                else if (word == 'railjack' || word == 'rj') is_railjack = true
            });
            if (main_relics.length == 0) return resolve({
                code: 400,
                message: `Relic name could not be determined`
            })
            subline[1]?.split(' ').forEach((word,index) => {
                if (['int','flaw','rad','intact','flawless','radiant'].includes(word)) {
                    word = word.replace('intact','int').replace('flawless','flaw').replace('radiant','rad')
                    if (!off_refinements.includes(word)) off_refinements.push(word)
                }
                else if ((word.length == 2 || word.length == 3) && !Number(word[0]) && Number(`${word[1]}${word[2] || ''}`)) {
                    if (!off_relics.includes(word.toUpperCase())) off_relics.push(word.toUpperCase())
                }
                else if (word.match('cycle') || word.match('cycles')) {
                    const prev_word = subline[1].split(' ')[index-1]
                    cycle_count = prev_word
                }
                else if (word == 'steelpath' || word == 'sp') is_steelpath = true
                else if (word == 'railjack' || word == 'rj') is_railjack = true
            });

            if (squad_type == '') squad_type = '4b4'
            if (main_refinements.length == 0) main_refinements.push('rad')
            if (is_steelpath && is_railjack) is_railjack = false

            db.query(`INSERT INTO rb_squads (squad_id,tier,members,original_host,channel_id,main_relics,main_refinements,off_relics,off_refinements,squad_type,cycle_count,is_steelpath,is_railjack,creation_timestamp) 
            VALUES 
                ('${squad_id}',
                '${tier}',
                '["${data.discord_id}"]',
                '${data.discord_id}',
                '${data.channel_id || main_squads_channel}',
                '${JSON.stringify(main_relics)}',
                '${JSON.stringify(main_refinements)}',
                '${JSON.stringify(off_relics)}',
                '${JSON.stringify(off_refinements)}',
                '${squad_type}',
                '${cycle_count}',
                ${is_steelpath},
                ${is_railjack},
                ${new Date().getTime()})
            `).then(res => {
                if (res.rowCount == 1) {
                    db_modules.schedule_query(`UPDATE rb_squads SET is_old=true WHERE squad_id = '${squad_id}' AND status = 'active'`,squad_is_old)
                    db_modules.schedule_query(`UPDATE rb_squads SET status='expired' WHERE squad_id = '${squad_id}' AND status='active'`,squad_expiry)
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

}


function squadsAddMember(data,callback) {
    console.log('[squadsAddMember] data:',data)
    if (!data.squad_id) return callback({code: 500, err: 'No squad_id provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`
        UPDATE rb_squads SET members =
        CASE WHEN members @> '"${data.discord_id}"'
        THEN members-'${data.discord_id}'
        ELSE members||'"${data.discord_id}"' END
        WHERE status = 'active' AND squad_id = '${data.squad_id}'
        returning*;
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

function squadsLeaveAll(data,callback) {
    console.log('[squadsLeaveAll] data:',data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`UPDATE rb_squads SET members=members-'${data.discord_id}' WHERE status='active' AND members @> '"${data.discord_id}"' ${data.tier ? ` AND tier = '${data.tier}'`:''}`)
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

module.exports = {
    endpoints,
    squad_closure
}