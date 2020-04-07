/* eslint-env mocha */
const chai = require('chai')
const should = chai.should()
const chaiHttp = require('chai-http')
chai.use(chaiHttp)

const { prepare, mongoose } = require('./utils')
const { app } = require('../src/api')

describe('Asset Info', () => {
  before(async function () {
    this.timeout(10000)

    await prepare()
  })

  it('should get all the assets', async () => {
    return chai.request(app())
      .get('/api/swap/assetinfo')
      .then(res => {
        res.should.have.status(200)
        res.body.should.be.a('array')
        res.body.length.should.be.eql(4)
      })
  })

  it('should find update-agent-balance job', async function () {
    const job = await mongoose.connection.db.collection('agendaJobs')
      .findOne({ name: 'update-agent-balance', repeatInterval: '30 seconds' })

    should.exist(job)
  })
})
