const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const redis = require('../models/redis')

function accountError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

class AdminService {
  constructor({ filePath = path.join(__dirname, '../../data/init.json'), storage = fs } = {}) {
    this.filePath = filePath
    this.storage = storage
    this.primaryPassword = null
    this.primaryPasswordHash = null
  }

  readData() {
    const data = JSON.parse(this.storage.readFileSync(this.filePath, 'utf8'))
    if (typeof data.adminUsername !== 'string' || typeof data.adminPassword !== 'string') {
      throw new Error('Invalid primary admin configuration in data/init.json')
    }
    if (data.adminAccounts !== undefined && !Array.isArray(data.adminAccounts)) {
      throw new Error('Invalid admin accounts in data/init.json')
    }
    return data
  }

  writeData(data) {
    // Replace the complete file atomically; a failed write leaves the working credentials intact.
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    this.storage.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
      mode: 0o600,
      flag: 'wx'
    })
    this.storage.renameSync(temporaryPath, this.filePath)
  }

  accountsFromData(data) {
    return [
      {
        id: 'primary',
        username: data.adminUsername,
        isPrimary: true,
        isActive: true,
        createdAt: data.initializedAt || null,
        updatedAt: data.updatedAt || null,
        credentialsVersion:
          data.adminCredentialsVersion || data.updatedAt || data.initializedAt || 'legacy'
      },
      ...(data.adminAccounts || [])
    ]
  }

  publicAccount(account) {
    return {
      id: account.id,
      username: account.username,
      isPrimary: account.id === 'primary',
      isActive: account.isActive === true,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    }
  }

  listAccounts() {
    return this.accountsFromData(this.readData()).map((account) => this.publicAccount(account))
  }

  getAccount(id) {
    return this.accountsFromData(this.readData()).find((account) => account.id === id) || null
  }

  validateUsername(username) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
      throw accountError('Username must be 3-64 letters, numbers, dots, underscores, or hyphens')
    }
  }

  validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
      throw accountError('Password must be at least 8 characters and at most 72 UTF-8 bytes')
    }
  }

  assertUniqueUsername(data, username, excludedId) {
    if (
      this.accountsFromData(data).some(
        (account) => account.username === username && account.id !== excludedId
      )
    ) {
      throw accountError('An admin with this username already exists', 409)
    }
  }

  async getPrimaryPasswordHash(data) {
    if (this.primaryPassword !== data.adminPassword || !this.primaryPasswordHash) {
      const passwordHash = await bcrypt.hash(data.adminPassword, 10)
      this.primaryPassword = data.adminPassword
      this.primaryPasswordHash = passwordHash
    }
    return this.primaryPasswordHash
  }

  async initialize() {
    const data = this.readData()
    const [primary] = this.accountsFromData(data)
    const passwordHash = await this.getPrimaryPasswordHash(data)
    const client = redis.getClient()
    await client.hset('session:admin_credentials', {
      username: primary.username,
      passwordHash,
      createdAt: primary.createdAt || '',
      updatedAt: primary.updatedAt || ''
    })
    await client.persist('session:admin_credentials')
    return this.publicAccount(primary)
  }

  async authenticate(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || !password) {
      return null
    }
    const data = this.readData()
    const account = this.accountsFromData(data).find((entry) => entry.username === username)
    if (!account || !account.isActive) {
      return null
    }
    const passwordHash =
      account.id === 'primary' ? await this.getPrimaryPasswordHash(data) : account.passwordHash
    if (!(await bcrypt.compare(password, passwordHash))) {
      return null
    }
    const current = this.getAccount(account.id)
    return current?.isActive && current.credentialsVersion === account.credentialsVersion
      ? current
      : null
  }

  validateSession(session) {
    if (!session?.username || !session.loginTime) {
      return null
    }
    const loginTime = Date.parse(session.loginTime)
    const lastActivity = Date.parse(session.lastActivity || session.loginTime)
    if (
      !Number.isFinite(loginTime) ||
      !Number.isFinite(lastActivity) ||
      Date.now() - lastActivity > 24 * 60 * 60 * 1000
    ) {
      return null
    }
    const data = this.readData()
    const account = this.accountsFromData(data).find(
      (entry) => entry.id === (session.adminId || 'primary')
    )
    if (!account?.isActive || account.username !== session.username) {
      return null
    }
    if (!session.adminId) {
      // Only the original account can use sessions issued before multi-admin support.
      const changedAt = Date.parse(data.updatedAt || data.initializedAt)
      return !data.adminCredentialsVersion &&
        (!Number.isFinite(changedAt) || loginTime >= changedAt)
        ? account
        : null
    }
    return session.credentialsVersion === account.credentialsVersion ? account : null
  }

  async createAccount({ username, password }) {
    this.validateUsername(username)
    this.validatePassword(password)
    this.assertUniqueUsername(this.readData(), username)
    const passwordHash = await bcrypt.hash(password, 10)
    // Re-read after hashing so simultaneous requests do not overwrite one another.
    const data = this.readData()
    this.assertUniqueUsername(data, username)
    const now = new Date().toISOString()
    const account = {
      id: crypto.randomUUID(),
      username,
      passwordHash,
      credentialsVersion: crypto.randomUUID(),
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
    data.adminAccounts = [...(data.adminAccounts || []), account]
    this.writeData(data)
    return this.publicAccount(account)
  }

  async updateAccount(id, changes, actorId) {
    if (id === 'primary' || id === actorId) {
      throw accountError(
        'Use Change Password to edit your own account; the original admin is protected',
        403
      )
    }
    const { password, isActive } = changes
    if (password === undefined && isActive === undefined) {
      throw accountError('Provide a password or an active status')
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      throw accountError('Active status must be a boolean')
    }
    let passwordHash
    if (password !== undefined) {
      this.validatePassword(password)
      passwordHash = await bcrypt.hash(password, 10)
    }
    const data = this.readData()
    const account = (data.adminAccounts || []).find((entry) => entry.id === id)
    if (!account) {
      throw accountError('Admin account not found', 404)
    }
    if (passwordHash !== undefined) {
      account.passwordHash = passwordHash
    }
    if (isActive !== undefined) {
      account.isActive = isActive
    }
    account.credentialsVersion = crypto.randomUUID()
    account.updatedAt = new Date().toISOString()
    this.writeData(data)
    return this.publicAccount(account)
  }

  async changeCredentials(id, currentPassword, newPassword, newUsername) {
    this.validatePassword(newPassword)
    const account = this.getAccount(id)
    const authenticated = account && (await this.authenticate(account.username, currentPassword))
    if (!authenticated || authenticated.id !== id) {
      throw accountError('Current password is incorrect', 401)
    }
    if (newUsername !== undefined && typeof newUsername !== 'string') {
      throw accountError('Username must be a string')
    }
    const username = newUsername?.trim() || account.username
    if (username !== account.username) {
      this.validateUsername(username)
    }
    const passwordHash = await bcrypt.hash(newPassword, 10)
    const data = this.readData()
    const current = this.accountsFromData(data).find((entry) => entry.id === id)
    if (!current?.isActive || current.credentialsVersion !== authenticated.credentialsVersion) {
      throw accountError('Account changed during the request. Please sign in again.', 409)
    }
    this.assertUniqueUsername(data, username, id)
    const credentialsVersion = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    if (id === 'primary') {
      // Preserve the existing setup/CLI recovery format for the original account.
      data.adminUsername = username
      data.adminPassword = newPassword
      data.adminCredentialsVersion = credentialsVersion
      data.updatedAt = updatedAt
    } else {
      Object.assign(current, { username, passwordHash, credentialsVersion, updatedAt })
    }
    this.writeData(data)
    return { ...this.publicAccount(current), username, updatedAt }
  }
}

module.exports = new AdminService()
module.exports.AdminService = AdminService
