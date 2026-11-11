<template>
  <section aria-labelledby="admin-accounts-title" class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2
          id="admin-accounts-title"
          class="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Admin accounts
        </h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Give each administrator their own login. All admins have full access to this panel and use
          the normal admin login page.
        </p>
      </div>
      <button
        class="btn btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="loading || saving || !!formMode || !!loadError"
        type="button"
        @click="openForm()"
      >
        <i class="fas fa-user-plus mr-2" />
        Add admin
      </button>
    </div>

    <div
      class="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
    >
      Use the account menu to change your own username or password. The original admin cannot be
      disabled or reset here.
    </div>

    <form
      v-if="formMode"
      class="rounded-xl border border-gray-200 bg-white/80 p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/80 sm:p-6"
      @submit.prevent="saveAccount"
    >
      <h3 class="mb-4 font-semibold text-gray-900 dark:text-gray-100">
        {{ formMode === 'create' ? 'Add admin' : `Reset password for ${selectedAdmin.username}` }}
      </h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <div v-if="formMode === 'create'" class="sm:col-span-2">
          <label
            class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            for="admin-username"
          >
            Username
          </label>
          <input
            id="admin-username"
            ref="usernameInput"
            v-model.trim="form.username"
            autocomplete="off"
            class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            :disabled="saving"
            maxlength="64"
            minlength="3"
            pattern="[A-Za-z0-9._\-]{3,64}"
            required
            spellcheck="false"
            type="text"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            3-64 letters, numbers, dots, underscores, or hyphens.
          </p>
        </div>
        <div>
          <label
            class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            for="admin-password"
          >
            {{ formMode === 'create' ? 'Password' : 'New password' }}
          </label>
          <input
            id="admin-password"
            ref="passwordInput"
            v-model="form.password"
            autocomplete="new-password"
            class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            :disabled="saving"
            minlength="8"
            required
            type="password"
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            At least 8 characters. Maximum 72 bytes; non-ASCII characters may use several bytes.
          </p>
        </div>
        <div>
          <label
            class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            for="admin-confirm-password"
          >
            Confirm password
          </label>
          <input
            id="admin-confirm-password"
            v-model="form.confirmPassword"
            autocomplete="new-password"
            class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            :disabled="saving"
            minlength="8"
            required
            type="password"
          />
        </div>
      </div>
      <p v-if="formMode === 'reset'" class="mt-4 text-sm text-amber-700 dark:text-amber-300">
        Resetting this password signs the administrator out on all devices.
      </p>
      <p v-if="formError" class="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
        {{ formError }}
      </p>
      <div class="mt-5 flex flex-wrap justify-end gap-3">
        <button
          class="btn bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          :disabled="saving"
          type="button"
          @click="closeForm"
        >
          Cancel
        </button>
        <button
          class="btn btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="saving"
          type="submit"
        >
          <i v-if="saving" class="fas fa-spinner fa-spin mr-2" />
          {{ saving ? 'Saving...' : formMode === 'create' ? 'Create admin' : 'Reset password' }}
        </button>
      </div>
    </form>

    <div v-if="loading" class="py-10 text-center" role="status">
      <div class="loading-spinner mx-auto mb-3" />
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading admin accounts...</p>
    </div>
    <div
      v-else-if="loadError"
      class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
      role="alert"
    >
      <p class="text-sm text-red-700 dark:text-red-300">{{ loadError }}</p>
      <button
        class="mt-3 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        type="button"
        @click="loadAccounts"
      >
        Try again
      </button>
    </div>
    <ul v-else class="space-y-3">
      <li
        v-for="admin in admins"
        :key="admin.id"
        class="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white/80 p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/80 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="break-all font-semibold text-gray-900 dark:text-gray-100">{{
              admin.username
            }}</span>
            <span v-if="admin.isPrimary" class="text-xs text-gray-500 dark:text-gray-400"
              >Original admin</span
            >
            <span
              v-if="admin.id === currentAdminId"
              class="text-xs text-blue-600 dark:text-blue-400"
              >You</span
            >
            <span
              :class="[
                'rounded-full px-2 py-0.5 text-xs font-medium',
                admin.isActive
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              ]"
            >
              {{ admin.isActive ? 'Active' : 'Disabled' }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Created {{ formatDate(admin.createdAt) }}
          </p>
        </div>
        <div v-if="canManage(admin)" class="flex flex-wrap gap-3">
          <button
            class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            :disabled="saving || !!formMode"
            type="button"
            @click="openForm(admin)"
          >
            Reset password
          </button>
          <button
            :class="[
              'rounded-lg px-3 py-2 text-sm disabled:opacity-50',
              admin.isActive
                ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40'
                : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40'
            ]"
            :disabled="saving || !!formMode"
            type="button"
            @click="statusTarget = admin"
          >
            {{ admin.isActive ? 'Disable' : 'Enable' }}
          </button>
        </div>
      </li>
    </ul>

    <ConfirmModal
      :confirm-text="statusTarget?.isActive ? 'Disable admin' : 'Enable admin'"
      :message="
        statusTarget?.isActive
          ? `Disable ${statusTarget.username}? They will be signed out on all devices and cannot log in until enabled again.`
          : `Enable ${statusTarget?.username}? They will regain full admin access.`
      "
      :show="!!statusTarget"
      :title="statusTarget?.isActive ? 'Disable admin account' : 'Enable admin account'"
      :type="statusTarget?.isActive ? 'warning' : 'primary'"
      @cancel="statusTarget = null"
      @confirm="toggleStatus"
    />
  </section>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import {
  createAdminAccountApi,
  getAdminAccountsApi,
  updateAdminAccountApi
} from '@/utils/http_apis'
import { showToast } from '@/utils/tools'

const admins = ref([])
const currentAdminId = ref('')
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const formMode = ref('')
const formError = ref('')
const selectedAdmin = ref(null)
const statusTarget = ref(null)
const usernameInput = ref(null)
const passwordInput = ref(null)
const form = reactive({ username: '', password: '', confirmPassword: '' })

const canManage = (admin) => !admin.isPrimary && admin.id !== currentAdminId.value
const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Unknown')

const loadAccounts = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getAdminAccountsApi()
    if (!result.success) {
      throw new Error(result.message || 'Failed to load admin accounts')
    }
    admins.value = result.admins
    currentAdminId.value = result.currentAdminId
  } catch (error) {
    loadError.value = error.message || 'Failed to load admin accounts'
  } finally {
    loading.value = false
  }
}

const closeForm = () => {
  if (saving.value) return
  formMode.value = ''
  selectedAdmin.value = null
  formError.value = ''
  Object.assign(form, { username: '', password: '', confirmPassword: '' })
}

const openForm = async (admin = null) => {
  if (saving.value || (admin && !canManage(admin))) return
  closeForm()
  selectedAdmin.value = admin
  formMode.value = admin ? 'reset' : 'create'
  await nextTick()
  const input = admin ? passwordInput.value : usernameInput.value
  input?.focus()
}

const saveAccount = async () => {
  if (saving.value) return
  formError.value = ''
  if (formMode.value === 'create' && !/^[A-Za-z0-9._-]{3,64}$/.test(form.username)) {
    formError.value = 'Use 3-64 letters, numbers, dots, underscores, or hyphens for the username.'
    return
  }
  if (form.password.length < 8 || new TextEncoder().encode(form.password).length > 72) {
    formError.value = 'Use a password with at least 8 characters and no more than 72 bytes.'
    return
  }
  if (form.password !== form.confirmPassword) {
    formError.value = 'The passwords do not match.'
    return
  }

  saving.value = true
  try {
    const creating = formMode.value === 'create'
    const result = creating
      ? await createAdminAccountApi({ username: form.username, password: form.password })
      : await updateAdminAccountApi(selectedAdmin.value.id, { password: form.password })
    if (!result.success) {
      throw new Error(result.message || 'Failed to save admin account')
    }
    showToast(
      creating ? 'Admin account created' : 'Password reset. Existing sessions are signed out.',
      'success'
    )
    saving.value = false
    closeForm()
    await loadAccounts()
  } catch (error) {
    formError.value = error.message || 'Failed to save admin account'
  } finally {
    saving.value = false
  }
}

const toggleStatus = async () => {
  const admin = statusTarget.value
  if (saving.value || !admin || !canManage(admin)) return
  statusTarget.value = null
  saving.value = true
  try {
    const result = await updateAdminAccountApi(admin.id, { isActive: !admin.isActive })
    if (!result.success) {
      throw new Error(result.message || 'Failed to update admin account')
    }
    showToast(admin.isActive ? 'Admin account disabled' : 'Admin account enabled', 'success')
    await loadAccounts()
  } catch (error) {
    showToast(error.message || 'Failed to update admin account', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(loadAccounts)
</script>
