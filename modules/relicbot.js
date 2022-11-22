const { db } = require("./db_connection")
const uuid = require('uuid')

const endpoints = {
    'relicbot/squads/create': squadsCreate,
    'relicbot/squads/fetch': squadsFetch,
    'relicbot/squads/update': squadsUpdate,
    'relicbot/squads/addmember': squadsAddMember,
    'relicbot/squads/removemember': squadsRemoveMember,
}

function squadsCreate(data,callback) {
    console.log('[squadsCreate] data:',data)
    if (!data.message) return callback({code: 500, err: 'No message provided'})
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    const lines = data.message.toLowerCase().split('\n')
    Promise.all(lines.map(line => {
        return new Promise((resolve,reject) => {
            const words = line.split(' ')
            const tier = words[0], relic = words[1], host = data.discord_id, squad_id=uuid.v4();
            if (!['lith','meso','neo','axi'].includes(tier)) {
                return resolve({
                    code: 400,
                    message: `Invalid tier ${tier}`
                })
            }
            db.query(`INSERT INTO rb_squads (squad_id,tier,relic,members,original_host) VALUES ('${squad_id}','${tier}','${relic}','["${host}"]','${host}')`)
            .then(res => {
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
        return callback([{
            code: 500,
            message: err.stack
        }])
    })
}

function squadsFetch(data,callback) {
    console.log('[squadsFetch] data:',data)
    db.query(`SELECT * FROM rb_squads WHERE status='active' ${data.tier ? `AND tier='${data.tier}'`:''}`)
    .then(res => {
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
        THEN remove_dupes(members-'${data.discord_id}')
        ELSE remove_dupes(members||'"${data.discord_id}"') END
        WHERE status = 'active' AND squad_id = '${data.squad_id}'
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
        if (err.code == '23502') {
            // last member trying to leave
            db.query(`UPDATE rb_squads SET status = 'abandoned' WHERE squad_id = '${data.squad_id}'`)
            .then(res => {
                if (res.rowCount == 1) {
                    return callback({
                        code: 200
                    })
                } else return callback({
                    code: 500,
                    message: 'unexpected db response'
                })
            })
        } else {
            console.log(err)
            return callback({
                code: 500,
                message: err.stack
            })
        }
    })
}

function squadsRemoveMember(data,callback) {
    console.log('[squadsRemoveMember] data:',data)
    if (!data.discord_id) return callback({code: 500, err: 'No discord_id provided'})
    db.query(`UPDATE rb_squads SET members=remove_dupes(members-'${data.discord_id}') WHERE status='active' ${data.squad_id ? ` AND squad_id = '${data.squad_id}'`:''} ${data.tier ? ` AND tier = '${data.tier}'`:''}`)
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

module.exports = {
    endpoints
}