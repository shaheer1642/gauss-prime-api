
const uuid = require('uuid');
const { db } = require('../db_connection');
const square_test_client = require('./client')

async function createPaymentHubVIPSandbox(token,discord_id) {
    return new Promise((resolve,reject) => {
        square_test_client.paymentsApi.createPayment({
            sourceId: token,
            idempotencyKey: uuid.v4(),
            amountMoney: {
                amount: '099',
                currency: 'USD'
            }
        }).then(res => {
            db.query(`
                INSERT INTO wfhub_payment_receipts
                (discord_id,receipt_id,type,receipt,timestamp)
                VALUES
                (${discord_id},'${res.result.payment.orderId}','hub_vip_purchase','${JSON.stringify(res.result.payment)}',${new Date().getTime()})
            `).then(dbres => {
                if (dbres.rowCount == 1) {
                    resolve(res)
                } else {
                    reject({message: 'unexpected db response'})
                }
            }).catch(err => {
                reject(err)
            })
        }).catch(err => {
            reject(err)
        })
    })
}

async function createPaymentHubVIP(token,discord_id) {
    return new Promise((resolve,reject) => {
        square_test_client.paymentsApi.createPayment({
            sourceId: token,
            idempotencyKey: uuid.v4(),
            amountMoney: {
                amount: '100',
                currency: 'USD'
            }
        }).then(res => {
            db.query(`
                INSERT INTO wfhub_payment_receipts
                (discord_id,receipt_id,type,receipt,timestamp)
                VALUES
                (${discord_id},'${res.result.payment.orderId}','hub_vip_purchase','${JSON.stringify(res.result.payment)}',${new Date().getTime()})
            `).then(dbres => {
                if (dbres.rowCount == 1) {
                    resolve(res)
                } else {
                    reject({message: 'unexpected db response'})
                }
            }).catch(err => {
                reject(err)
            })
        }).catch(err => {
            reject(err)
        })
    })
}

BigInt.prototype.toJSON = function() { return this.toString() }

module.exports = {
    createPaymentHubVIPSandbox,
    createPaymentHubVIP
}