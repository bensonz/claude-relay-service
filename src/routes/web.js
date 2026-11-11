const express = require('express')
const crypto = require('crypto')
const path = require('path')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')
const adminService = require('../services/adminService')
const { authenticateAdmin } = require('../middleware/auth')

const router = express.Router()

router.use('/assets', express.static(path.join(__dirname, '../../web/assets')))

router.get('/', (req, res) => {
  res.redirect(301, '/admin-next/api-stats')
})

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Username and password are required'
      })
    }

    const account = await adminService.authenticate(username, password)
    if (!account) {
      logger.security(`Failed login attempt for username: ${username}`)
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Invalid username or password'
      })
    }

    const sessionId = crypto.randomBytes(32).toString('hex')
    const now = new Date().toISOString()
    await redis.setSession(
      sessionId,
      {
        adminId: account.id,
        username: account.username,
        credentialsVersion: account.credentialsVersion,
        loginTime: now,
        lastActivity: now
      },
      config.security.adminSessionTimeout
    )

    logger.success(`Admin login successful: ${account.username}`)
    return res.json({
      success: true,
      token: sessionId,
      expiresIn: config.security.adminSessionTimeout,
      username: account.username
    })
  } catch (error) {
    logger.error('Admin login failed:', error)
    return res.status(500).json({ error: 'Login failed', message: 'Unable to sign in' })
  }
})

router.post('/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.cookies?.adminToken
    if (token) {
      await redis.deleteSession(token)
    }
    return res.json({ success: true, message: 'Logout successful' })
  } catch (error) {
    logger.error('Admin logout failed:', error)
    return res.status(500).json({ error: 'Logout failed', message: 'Unable to sign out' })
  }
})

router.post('/auth/change-password', authenticateAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, newUsername } = req.body
    const account = await adminService.changeCredentials(
      req.admin.id,
      currentPassword,
      newPassword,
      newUsername
    )
    await redis.deleteSession(req.admin.sessionId)
    logger.success(`Admin credentials changed: ${account.username}`)
    return res.json({
      success: true,
      message: 'Password changed successfully. Please login again.',
      newUsername: account.username
    })
  } catch (error) {
    logger.error('Admin credentials update failed:', error)
    return res.status(error.statusCode || 500).json({
      error: 'Change password failed',
      message: error.statusCode ? error.message : 'Unable to update admin credentials'
    })
  }
})

router.get('/auth/user', authenticateAdmin, (req, res) =>
  res.json({
    success: true,
    user: {
      id: req.admin.id,
      username: req.admin.username,
      isPrimary: req.admin.isPrimary,
      loginTime: req.admin.loginTime,
      lastActivity: req.admin.lastActivity
    }
  })
)

router.post('/auth/refresh', authenticateAdmin, async (req, res) => {
  try {
    await redis.setSession(
      req.admin.sessionId,
      {
        adminId: req.admin.id,
        username: req.admin.username,
        credentialsVersion: req.admin.credentialsVersion,
        loginTime: req.admin.loginTime,
        lastActivity: req.admin.lastActivity
      },
      config.security.adminSessionTimeout
    )
    return res.json({
      success: true,
      token: req.admin.sessionId,
      expiresIn: config.security.adminSessionTimeout
    })
  } catch (error) {
    logger.error('Admin session refresh failed:', error)
    return res
      .status(500)
      .json({ error: 'Token refresh failed', message: 'Unable to refresh session' })
  }
})

router.get('/auth/admins', authenticateAdmin, (req, res) => {
  try {
    return res.json({
      success: true,
      admins: adminService.listAccounts(),
      currentAdminId: req.admin.id
    })
  } catch (error) {
    logger.error('Admin account listing failed:', error)
    return res.status(500).json({ error: 'Unable to list admin accounts' })
  }
})

router.post('/auth/admins', authenticateAdmin, async (req, res) => {
  try {
    const admin = await adminService.createAccount(req.body)
    logger.security(`Admin ${req.admin.username} created admin ${admin.username}`)
    return res.status(201).json({ success: true, admin })
  } catch (error) {
    logger.error('Admin account creation failed:', error)
    return res.status(error.statusCode || 500).json({
      error: 'Create admin failed',
      message: error.statusCode ? error.message : 'Unable to create admin account'
    })
  }
})

router.patch('/auth/admins/:id', authenticateAdmin, async (req, res) => {
  try {
    const admin = await adminService.updateAccount(req.params.id, req.body, req.admin.id)
    logger.security(`Admin ${req.admin.username} updated admin ${admin.username}`)
    return res.json({ success: true, admin })
  } catch (error) {
    logger.error('Admin account update failed:', error)
    return res.status(error.statusCode || 500).json({
      error: 'Update admin failed',
      message: error.statusCode ? error.message : 'Unable to update admin account'
    })
  }
})

module.exports = router
