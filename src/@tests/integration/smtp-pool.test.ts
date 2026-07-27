import { assertEquals, assertRejects, assertStrictEquals } from 'jsr:@std/assert@^1.0.15'
import { SmtpConnectionPool } from 'modules/email/pool.ts'

/** A unique stand-in for a real `SmtpConnection` — the pool only ever stores/returns references. */
function fakeConnection(id: number) {
  return { id } as unknown as import('modules/email/pool.ts').SmtpConnection
}

Deno.test(
  'SmtpConnectionPool: acquire() dials up to `size` connections, then waits',
  async () => {
    const pool = new SmtpConnectionPool(2)
    let connectCount = 0
    const connect = () => {
      connectCount++
      return Promise.resolve(fakeConnection(connectCount))
    }

    const a = await pool.acquire(connect)
    const b = await pool.acquire(connect)
    assertEquals(connectCount, 2)

    let resolved = false
    const thirdAcquire = pool.acquire(connect).then((c) => {
      resolved = true
      return c
    })

    // Give any pending microtasks a chance to run; the third acquire() must still be pending.
    await Promise.resolve()
    await Promise.resolve()
    assertEquals(resolved, false)
    assertEquals(connectCount, 2) // no third dial happened while waiting

    pool.release(a)
    const c = await thirdAcquire

    assertEquals(resolved, true)
    assertStrictEquals(c, a) // the waiter got the released connection, not a freshly dialed one
    assertEquals(connectCount, 2)

    pool.release(b)
    pool.release(c)
  },
)

Deno.test(
  'SmtpConnectionPool: release() returns a connection to idle for the next acquire() to reuse',
  async () => {
    const pool = new SmtpConnectionPool(1)
    let connectCount = 0
    const connect = () => {
      connectCount++
      return Promise.resolve(fakeConnection(connectCount))
    }

    const first = await pool.acquire(connect)
    pool.release(first)

    const second = await pool.acquire(connect)

    assertStrictEquals(second, first) // reused the idle connection
    assertEquals(connectCount, 1) // connect() was never called a second time
  },
)

Deno.test(
  'SmtpConnectionPool: discard() frees the slot without keeping the connection around',
  async () => {
    const pool = new SmtpConnectionPool(1)
    let connectCount = 0
    const connect = () => {
      connectCount++
      return Promise.resolve(fakeConnection(connectCount))
    }

    const first = await pool.acquire(connect)
    pool.discard(first)

    await pool.acquire(connect)

    assertEquals(connectCount, 2) // discarded, not reused — a fresh connection had to be dialed
  },
)

Deno.test(
  'SmtpConnectionPool: discard() also removes the connection if it was sitting idle',
  async () => {
    const pool = new SmtpConnectionPool(1)
    let connectCount = 0
    const connect = () => {
      connectCount++
      return Promise.resolve(fakeConnection(connectCount))
    }

    const first = await pool.acquire(connect)
    pool.release(first) // now idle, not held by anyone
    pool.discard(first) // discarding it anyway must still remove it from idle

    await pool.acquire(connect)

    assertEquals(connectCount, 2) // the idle entry was really gone — a fresh dial was required
  },
)

Deno.test(
  'SmtpConnectionPool: discard() services a queued waiter instead of leaving it stuck forever',
  async () => {
    const pool = new SmtpConnectionPool(1)
    const first = await pool.acquire(() => Promise.resolve(fakeConnection(1)))

    let waiterConnectCount = 0
    const waiterAcquire = pool.acquire(() => {
      waiterConnectCount++
      return Promise.resolve(fakeConnection(2))
    })

    // The pool is full and `first` was never released — only discard() can unblock the waiter.
    pool.discard(first)

    const waiterConnection = await waiterAcquire
    assertEquals(waiterConnectCount, 1) // discard() dialed a fresh connection for the waiter
    assertStrictEquals((waiterConnection as unknown as { id: number }).id, 2)
  },
)

Deno.test(
  'SmtpConnectionPool: discard() rejects a queued waiter (instead of hanging) if its redial fails',
  async () => {
    const pool = new SmtpConnectionPool(1)
    const first = await pool.acquire(() => Promise.resolve(fakeConnection(1)))

    const dialError = new Error('dial failed')
    const waiterAcquire = pool.acquire(() => Promise.reject(dialError))

    pool.discard(first)

    await assertRejects(() => waiterAcquire, Error, 'dial failed')

    // The failed redial must free the slot back up for the next caller.
    const next = await pool.acquire(() => Promise.resolve(fakeConnection(3)))
    assertStrictEquals((next as unknown as { id: number }).id, 3)
  },
)
