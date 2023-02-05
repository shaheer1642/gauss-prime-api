const { db } = require("./db_connection")

const endpoints = {
    'globalVariables/fetch': globalVariablesFetch,
    'globalVariables/update': globalVariablesUpdate,
}

function globalVariablesFetch(data,callback) {
    console.log('[global_variables.globalVariablesFetch] data:',data)
    db.query(`
        SELECT * FROM global_variables_list ${data.var_name ? `WHERE var_name = '${data.var_name}'`:''};
    `).then(res => {
        res.rows.forEach((row,index) => {
            res.rows[index].var_value = row.var_data_type == 'object' || row.var_data_type == 'array' ? JSON.parse(row.var_value) : row.var_data_type == 'number' ? Number(row.var_value) : row.var_value
        })
        return callback ? callback({
            code: 200,
            data: data.var_name ? res.rows[0] : res.rows
        }) : null
    }).catch(err => {
        console.log(err)
        return callback ? callback({
            code: 500,
            message: err.stack
        }) : null
    })
}

function globalVariablesUpdate(data,callback) {
    console.log('[global_variables.globalVariablesUpdate] data:',data)
    if (!data.var_name) return callback ? callback({code: 400, message: 'No var_name provided'}) : null
    if (!data.var_value) return callback ? callback({code: 400, message: 'No var_value provided'}) : null
    db.query(`
        SELECT * FROM global_variables_list WHERE var_name = '${data.var_name}';
    `).then(res => {
        if (res.rowCount != 1) {
            return callback ? callback({
                code: 200,
                message: 'unexpected db response'
            }) : null
        } else {
            const db_var = res.rows[0]
            if (db_var.var_data_type == 'array' && !Array.isArray(data.var_value) || db_var.var_data_type != 'array' && typeof data.var_value != data.var_data_type) {
                return callback ? callback({
                    code: 200,
                    message: `invalid data_type provided for variable ${db.var_name}, correct data type is ${db_var.var_data_type}`
                }) : null
            } else {
                db.query(`UPDATE global_variables_list SET var_value = '${db_var.var_data_type == 'array' || db_var.var_data_type == 'object' ? JSON.stringify(data.var_value) : data.var_value}' WHERE var_name = '${data.var_name}'`)
                .then(res => {
                    if (res.rowCount == 1) {
                        return callback ? callback({
                            code: 200,
                            message: `variable updated`
                        }) : null
                    } else {
                        return callback ? callback({
                            code: 200,
                            message: 'unexpected db response'
                        }) : null
                    }
                }).catch(err => {
                    console.log(err)
                    return callback ? callback({
                        code: 500,
                        message: err.stack
                    }) : null
                })
            }
        }
    }).catch(err => {
        console.log(err)
        return callback ? callback({
            code: 500,
            message: err.stack
        }) : null
    })
}

module.exports = {
    endpoints,
}