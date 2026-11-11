jest.mock('../src/models/redis', () => ({
  getClient: jest.fn(() => ({ hset: jest.fn(), persist: jest.fn() }))
}))

const bcrypt = require('bcryptjs')
const { AdminService } = require('../src/services/adminService')

describe('local admin accounts', () => {
  let data
  let service
  let storage
  const originalPassword = 'original-password'

  beforeEach(() => {
    data = {
      adminUsername: 'original',
      adminPassword: originalPassword,
      initializedAt: '2026-01-01T00:00:00.000Z',
      version: '1.0.0'
    }
    let pending
    storage = {
      readFileSync: jest.fn(() => JSON.stringify(data)),
      writeFileSync: jest.fn((_path, content) => {
        pending = JSON.parse(content)
      }),
      renameSync: jest.fn(() => {
        data = pending
      })
    }
    service = new AdminService({ filePath: '/test/init.json', storage })
  })

  const sessionFor = (account) => ({
    adminId: account.id,
    username: account.username,
    credentialsVersion: account.credentialsVersion,
    loginTime: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  })

  test('preserves original login and legacy sessions when adding an account', async () => {
    const original = await service.authenticate('original', originalPassword)
    expect(original.id).toBe('primary')
    await service.createAccount({ username: 'alice', password: 'alice-password' })
    expect(await service.authenticate('original', originalPassword)).toMatchObject({
      id: 'primary'
    })
    expect(
      service.validateSession({ username: 'original', loginTime: new Date().toISOString() })
    ).toMatchObject({ id: 'primary' })
    expect(data.adminPassword).toBe(originalPassword)
    expect(data.version).toBe('1.0.0')
  })

  test('persists only bcrypt hashes for new admins and returns safe account metadata', async () => {
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    expect(created).toMatchObject({ username: 'alice', isPrimary: false, isActive: true })
    expect(created).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(data)).not.toContain('alice-password')
    expect(await bcrypt.compare('alice-password', data.adminAccounts[0].passwordHash)).toBe(true)
    expect(storage.writeFileSync.mock.calls[0][2]).toMatchObject({ mode: 0o600 })
    expect(new AdminService({ filePath: '/test/init.json', storage }).listAccounts()).toEqual(
      service.listAccounts()
    )
    expect(JSON.stringify(service.listAccounts())).not.toContain('passwordHash')
  })

  test('rejects duplicate names including the original admin, even during concurrent creates', async () => {
    await expect(
      service.createAccount({ username: 'original', password: 'alice-password' })
    ).rejects.toMatchObject({ statusCode: 409 })
    const results = await Promise.allSettled([
      service.createAccount({ username: 'alice', password: 'alice-password' }),
      service.createAccount({ username: 'alice', password: 'other-password' })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(data.adminAccounts).toHaveLength(1)
  })

  test.each([
    { username: {}, password: 'valid-password' },
    { username: 'bad name', password: 'valid-password' },
    { username: 'alice', password: {} },
    { username: 'alice', password: 'short' },
    { username: 'alice', password: 'x'.repeat(73) },
    { username: 'alice', password: '\u00e9'.repeat(37) }
  ])('rejects invalid account input: %j', async (input) => {
    await expect(service.createAccount(input)).rejects.toMatchObject({ statusCode: 400 })
    expect(storage.writeFileSync).not.toHaveBeenCalled()
  })

  test('disabling and re-enabling an account never revives its old sessions', async () => {
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    const session = sessionFor(await service.authenticate('alice', 'alice-password'))
    expect(service.validateSession(session)).toMatchObject({ id: created.id })
    await service.updateAccount(created.id, { isActive: false }, 'primary')
    expect(service.validateSession(session)).toBeNull()
    expect(await service.authenticate('alice', 'alice-password')).toBeNull()
    await service.updateAccount(created.id, { isActive: true }, 'primary')
    expect(service.validateSession(session)).toBeNull()
    expect(await service.authenticate('alice', 'alice-password')).toMatchObject({ id: created.id })
  })

  test('resets only the target account password and revokes its sessions', async () => {
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    const session = sessionFor(await service.authenticate('alice', 'alice-password'))
    const primarySession = sessionFor(await service.authenticate('original', originalPassword))
    await service.updateAccount(created.id, { password: 'replacement-password' }, 'primary')
    expect(service.validateSession(session)).toBeNull()
    expect(service.validateSession(primarySession)).toMatchObject({ id: 'primary' })
    expect(await service.authenticate('alice', 'alice-password')).toBeNull()
    expect(await service.authenticate('alice', 'replacement-password')).toMatchObject({
      id: created.id
    })
  })

  test('protects original account and prevents management changes to self', async () => {
    await expect(
      service.updateAccount('primary', { isActive: false }, 'someone')
    ).rejects.toMatchObject({ statusCode: 403 })
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    await expect(
      service.updateAccount(created.id, { isActive: false }, created.id)
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      service.updateAccount(created.id, { isActive: 'false' }, 'primary')
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  test('changing own credentials preserves other admins and rejects stale sessions', async () => {
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    const session = sessionFor(await service.authenticate('alice', 'alice-password'))
    await service.changeCredentials(created.id, 'alice-password', 'changed-password', 'alice-new')
    expect(service.validateSession(session)).toBeNull()
    expect(await service.authenticate('alice', 'alice-password')).toBeNull()
    expect(await service.authenticate('alice-new', 'changed-password')).toMatchObject({
      id: created.id
    })
    expect(await service.authenticate('original', originalPassword)).toMatchObject({
      id: 'primary'
    })
  })

  test('primary password changes revoke new and legacy primary sessions only', async () => {
    await service.createAccount({ username: 'alice', password: 'alice-password' })
    const session = sessionFor(await service.authenticate('original', originalPassword))
    const legacy = { username: 'original', loginTime: new Date().toISOString() }
    const otherSession = sessionFor(await service.authenticate('alice', 'alice-password'))
    await service.changeCredentials('primary', originalPassword, 'changed-password')
    expect(service.validateSession(session)).toBeNull()
    expect(service.validateSession(legacy)).toBeNull()
    expect(service.validateSession(otherSession)).toMatchObject({ username: 'alice' })
    expect(await service.authenticate('original', 'changed-password')).toMatchObject({
      id: 'primary'
    })
  })

  test('rejects wrong current passwords and username collisions without changing data', async () => {
    const created = await service.createAccount({ username: 'alice', password: 'alice-password' })
    const before = JSON.stringify(data)
    await expect(
      service.changeCredentials(created.id, originalPassword, 'changed-password')
    ).rejects.toMatchObject({ statusCode: 401 })
    await expect(
      service.changeCredentials(created.id, 'alice-password', 'changed-password', 'original')
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(JSON.stringify(data)).toBe(before)
  })

  test('rejects forged identities, malformed dates, and inactive sessions', async () => {
    const original = await service.authenticate('original', originalPassword)
    const session = sessionFor(original)
    expect(service.validateSession({ ...session, adminId: 'missing' })).toBeNull()
    expect(service.validateSession({ ...session, credentialsVersion: 'wrong' })).toBeNull()
    expect(service.validateSession({ username: 'alice', loginTime: session.loginTime })).toBeNull()
    expect(service.validateSession({ ...session, loginTime: 'invalid' })).toBeNull()
    expect(service.validateSession({ ...session, lastActivity: 'invalid' })).toBeNull()
    expect(service.validateSession({ ...session, lastActivity: '2020-01-01T00:00:00Z' })).toBeNull()
  })

  test('keeps the original file intact when atomic replacement fails', async () => {
    storage.renameSync.mockImplementation(() => {
      throw new Error('disk write failed')
    })
    await expect(
      service.createAccount({ username: 'alice', password: 'alice-password' })
    ).rejects.toThrow('disk write failed')
    expect(data.adminAccounts).toBeUndefined()
  })
})
