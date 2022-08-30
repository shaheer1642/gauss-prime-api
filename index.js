const express = require('express')

const {db} = require('./modules/db_connection')

const app = express()
const port = 3001

app.get('/', async (req, res) => {
    console.log('express call')
    res.status(200).send('Hello World!');
})

app.get('/lich_list', async (callReq, callRes) => {
    console.log('express call get lich_list')
    await db.query(`select * from lich_list`).then(res => {
      callRes.status(200).send(JSON.stringify(res.rows));
    }).catch(err => {
      console.log(err)
      callRes.status(200).send(JSON.stringify(err));
    })
})

app.listen(process.env.PORT, () => {
  console.log(`Express running on port ${port}.`)
})