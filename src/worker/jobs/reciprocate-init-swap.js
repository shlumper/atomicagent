const debug = require('debug')('liquality:agent:worker:reciprocate-init-swap')

const Check = require('../../models/Check')
const Order = require('../../models/Order')
const { RescheduleError } = require('../../utils/errors')

module.exports = async job => {
  const { agenda } = job
  const { data } = job.attrs

  const order = await Order.findOne({ orderId: data.orderId }).exec()
  if (!order) return
  if (order.status !== 'USER_FUNDED') return

  const check = await Check.getCheckForOrder(data.orderId)
  const reject = check.get('flags.reciprocate-init-swap.reject')
  if (reject) {
    debug(`Rejected ${data.orderId}`, reject.message)
    return
  }

  const approve = check.get('flags.reciprocate-init-swap.approve')
  if (!approve) {
    throw new RescheduleError(`Reschedule ${data.orderId}: reciprocate-init-swap is not approved yet`, order.from)
  }

  const fromClient = order.fromClient()
  const toClient = order.toClient()

  const fromCurrentBlockNumber = await fromClient.chain.getBlockHeight()
  const fromCurrentBlock = await fromClient.chain.getBlockByNumber(fromCurrentBlockNumber)

  if (order.isSwapExpired(fromCurrentBlock)) {
    debug(`Order ${order.orderId} expired due to swapExpiration`)

    order.addTx('fromRefundHash', { hash: Date.now(), placeholder: true })
    order.status = 'SWAP_EXPIRED'
    await order.save()

    await order.log('RECIPROCATE_INIT_SWAP', null, {
      fromBlock: fromCurrentBlockNumber
    })

    return agenda.now('find-refund-tx', { orderId: order.orderId, fromLastScannedBlock: fromCurrentBlockNumber })
  }

  const toLastScannedBlock = await toClient.chain.getBlockHeight()

  const toFundTx = await order.initiateSwap()

  debug('Initiated funding transaction', order.orderId, toFundTx.hash)

  order.addTx('toFundHash', toFundTx)
  order.status = 'AGENT_FUNDED'

  const toSecondaryFundTx = toFundTx.secondaryTx

  if (toSecondaryFundTx) {
    order.addTx('toSecondaryFundHash', toSecondaryFundTx)
  }

  await order.save()

  await agenda.now('verify-tx', { orderId: order.orderId, type: 'toFundHash' })

  if (toSecondaryFundTx) {
    await agenda.now('verify-tx', { orderId: order.orderId, type: 'toSecondaryFundHash' })
  }

  await order.log('RECIPROCATE_INIT_SWAP', null, {
    toLastScannedBlock: toLastScannedBlock,
    toFundHash: toFundTx.hash,
    toSecondaryFundHash: order.toSecondaryFundHash
  })

  return agenda.now('find-claim-tx-or-refund', { orderId: order.orderId, toLastScannedBlock })
}
