jest.mock('../config/config', () => ({ security: { adminSessionTimeout: 86400 } }), {
  virtual: true
})
jest.mock('../src/models/redis', () => ({
  getSession: jest.fn(),
  setSession: jest.fn(),
  deleteSession: jest.fn()
}))
jest.mock('../src/services/apiKeyService', () => ({}))
jest.mock('../src/services/userService', () => ({ validateUserSession: jest.fn() }))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  security: jest.fn()
}))

const express = require('express')
const request = require('supertest')
const redis = require('../src/models/redis')
const userService = require('../src/services/userService')
const adminService = require('../src/services/adminService')
const {
  authenticateAdmin,
  authenticateUserOrAdmin,
  requireAdmin
} = require('../src/middleware/auth')
const webRoutes = require('../src/routes/web')

describe('admin HTTP authentication', () => {
  let app
  let sessions
  let data

  beforeEach(() => {
    jest.clearAllMocks()
    sessions = new Map()
    data = {
      adminUsername: 'original',
      adminPassword: 'original-password',
      initializedAt: '2026-01-01T00:00:00.000Z'
    }
    let pending
    adminService.primaryPassword = null
    adminService.primaryPasswordHash = null
    adminService.storage = {
      readFileSync: () => JSON.stringify(data),
      writeFileSync: (_path, content) => {
        pending = JSON.parse(content)
      },
      renameSync: () => {
        data = pending
      }
    }
    redis.getSession.mockImplementation(async (token) => sessions.get(token) || {})
    redis.setSession.mockImplementation(async (token, session) => {
      sessions.set(token, { ...session })
    })
    redis.deleteSession.mockImplementation(async (token) => {
      sessions.delete(token)
    })
    userService.validateUserSession.mockResolvedValue(null)
    app = express()
    app.use(express.json())
    app.use('/web', webRoutes)
    app.get('/protected', authenticateAdmin, (req, res) => res.json({ admin: req.admin.username }))
    app.get('/mixed', authenticateUserOrAdmin, requireAdmin, (req, res) =>
      res.json({ admin: req.admin?.username || req.user.username })
    )
  })

  const login = async (username = 'original', password = 'original-password') => {
    const response = await request(app)
      .post('/web/auth/login')
      .send({ username, password })
      .expect(200)
    return response.body.token
  }

  test('creates independent admin logins and reports the correct identity throughout the panel', async () => {
    const originalToken = await login()
    const created = await request(app)
      .post('/web/auth/admins')
      .auth(originalToken, { type: 'bearer' })
      .send({ username: 'alice', password: 'alice-password' })
      .expect(201)
    const aliceToken = await login('alice', 'alice-password')
    expect(aliceToken).not.toBe(originalToken)
    for (const [token, username] of [
      [originalToken, 'original'],
      [aliceToken, 'alice']
    ]) {
      await request(app)
        .get('/protected')
        .auth(token, { type: 'bearer' })
        .expect(200, { admin: username })
      await request(app)
        .get('/mixed')
        .auth(token, { type: 'bearer' })
        .expect(200, { admin: username })
      const me = await request(app)
        .get('/web/auth/user')
        .auth(token, { type: 'bearer' })
        .expect(200)
      expect(me.body.user.username).toBe(username)
    }
    const listed = await request(app)
      .get('/web/auth/admins')
      .auth(aliceToken, { type: 'bearer' })
      .expect(200)
    expect(listed.body.currentAdminId).toBe(created.body.admin.id)
    expect(listed.body.admins).toHaveLength(2)
    expect(JSON.stringify(listed.body)).not.toMatch(/password|credentialsVersion/)
  })

  test('disabling an admin revokes access to panel, mixed APIs, profile, and refresh', async () => {
    const admin = await adminService.createAccount({
      username: 'alice',
      password: 'alice-password'
    })
    const originalToken = await login()
    const token = await login('alice', 'alice-password')
    const session = sessions.get(token)
    await request(app)
      .patch(`/web/auth/admins/${admin.id}`)
      .auth(originalToken, { type: 'bearer' })
      .send({ isActive: false })
      .expect(200)
    for (const url of ['/protected', '/mixed', '/web/auth/user']) {
      sessions.set(token, session)
      await request(app).get(url).auth(token, { type: 'bearer' }).expect(401)
    }
    sessions.set(token, session)
    await request(app).post('/web/auth/refresh').auth(token, { type: 'bearer' }).expect(401)
    await request(app)
      .post('/web/auth/login')
      .send({ username: 'alice', password: 'alice-password' })
      .expect(401)
    await request(app).get('/protected').auth(originalToken, { type: 'bearer' }).expect(200)
  })

  test('password changes affect the signed-in account and revoke all its sessions', async () => {
    await adminService.createAccount({ username: 'alice', password: 'alice-password' })
    const token = await login('alice', 'alice-password')
    const secondToken = await login('alice', 'alice-password')
    await request(app)
      .post('/web/auth/change-password')
      .auth(token, { type: 'bearer' })
      .send({
        currentPassword: 'alice-password',
        newPassword: 'replacement-password',
        newUsername: 'alice-new'
      })
      .expect(200)
    await request(app).get('/protected').auth(secondToken, { type: 'bearer' }).expect(401)
    await login('alice-new', 'replacement-password')
    await login()
  })

  test('rejects missing authentication, LDAP user tokens, and credential records as admin tokens', async () => {
    for (const token of ['', 'admin_credentials', 'x'.repeat(64)]) {
      await request(app)
        .post('/web/auth/admins')
        .set('Authorization', `Bearer ${token}`)
        .send({ username: 'alice', password: 'alice-password' })
        .expect(401)
    }
    userService.validateUserSession.mockResolvedValue({
      session: { createdAt: new Date().toISOString() },
      user: { id: 'ldap-user', username: 'ldap', role: 'admin', isActive: true }
    })
    await request(app)
      .post('/web/auth/admins')
      .set('x-user-token', 'ldap-token')
      .send({ username: 'alice', password: 'alice-password' })
      .expect(401)
    expect(data.adminAccounts).toBeUndefined()
  })

  test('accepts a legacy primary token but not a legacy-shaped token for an added account', async () => {
    await adminService.createAccount({ username: 'alice', password: 'alice-password' })
    const token = 'a'.repeat(64)
    sessions.set(token, { username: 'original', loginTime: new Date().toISOString() })
    await request(app).get('/protected').auth(token, { type: 'bearer' }).expect(200)
    sessions.set(token, { username: 'alice', loginTime: new Date().toISOString() })
    await request(app).get('/protected').auth(token, { type: 'bearer' }).expect(401)
  })

  test('supports explicit admin headers and rejects invalid account input safely', async () => {
    const token = await login()
    await request(app).get('/web/auth/user').set('x-admin-token', token).expect(200)
    await request(app)
      .post('/web/auth/admins')
      .auth(token, { type: 'bearer' })
      .send({ username: 'alice', password: {} })
      .expect(400)
    await request(app).post('/web/auth/login').send({ username: {}, password: [] }).expect(400)
  })

  test('logout invalidates only the selected session', async () => {
    const token = await login()
    const other = await login()
    await request(app).post('/web/auth/logout').auth(token, { type: 'bearer' }).expect(200)
    await request(app).get('/protected').auth(token, { type: 'bearer' }).expect(401)
    await request(app).get('/protected').auth(other, { type: 'bearer' }).expect(200)
  })

  test('refresh persists the configured lifetime and reports storage failure', async () => {
    const token = await login()
    const config = require('../config/config')
    config.security.adminSessionTimeout = 7200
    try {
      await request(app).post('/web/auth/refresh').auth(token, { type: 'bearer' }).expect(200)
      expect(redis.setSession).toHaveBeenLastCalledWith(
        token,
        expect.objectContaining({ adminId: 'primary' }),
        7200
      )
      redis.setSession.mockRejectedValue(new Error('Redis unavailable'))
      await request(app).post('/web/auth/refresh').auth(token, { type: 'bearer' }).expect(500)
    } finally {
      config.security.adminSessionTimeout = 86400
    }
  })
})
